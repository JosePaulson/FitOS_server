import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import TimetableSlot, { WEEKDAYS } from '../models/TimetableSlot.js'
import TrainerAvailability from '../models/TrainerAvailability.js'
import User from '../models/User.js'
import Member from '../models/Member.js'
import MemberPTPlan from '../models/MemberPTPlan.js'
import { protect, authorize } from '../middleware/auth.js'
import { isPastCancellationDeadline } from '../utils/dateIST.js'
import { sendPushToMember } from '../services/pushNotification.service.js'

const router = Router()
router.use(protect, authorize('owner', 'manager', 'trainer'))

const MEMBER_POPULATE = { path: 'memberId', select: 'name phone photo' }
const PLAN_POPULATE = { path: 'memberPTPlanId', select: 'name status trainerId' }
const TRAINER_POPULATE = { path: 'trainerId', select: 'name' }
const REQUEST_MEMBER_POPULATE = { path: 'pendingRequest.memberId', select: 'name phone photo' }
const REQUEST_PLAN_POPULATE = { path: 'pendingRequest.memberPTPlanId', select: 'name status' }
const POPULATE_ALL = [MEMBER_POPULATE, PLAN_POPULATE, TRAINER_POPULATE, REQUEST_MEMBER_POPULATE, REQUEST_PLAN_POPULATE]

function validate(req, res) {
  const errs = validationResult(req)
  if (!errs.isEmpty()) { res.status(400).json({ message: errs.array()[0].msg }); return false }
  return true
}

// A trainer manages only their own timetable; owner/manager can manage
// any trainer's on their behalf — same convention as trainer-availability.
function canManageTrainer(req, trainerId) {
  if (['owner', 'manager'].includes(req.user.role)) return true
  return req.user.role === 'trainer' && String(req.user._id) === String(trainerId)
}

// Normalizes a day's working hours to an array of {start, end} shifts,
// tolerating older TrainerAvailability docs saved before multi-shift
// support existed.
function getShifts(dayHours) {
  if (!dayHours) return []
  if (Array.isArray(dayHours.shifts) && dayHours.shifts.length > 0) return dayHours.shifts
  if (dayHours.start && dayHours.end) return [{ start: dayHours.start, end: dayHours.end }]
  return []
}

function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number)
  const total = h * 60 + m + minutes
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

// ── GET /api/timetable ──────────────────────────────────────────────────────
// Full gym timetable, optionally filtered to one trainer. Trainers only ever
// see their own — matches the feature's "edit all slots (if assigned
// trainer)" scoping, applied to viewing too so a trainer isn't browsing a
// colleague's pending requests. Owner/manager see everything.
router.get('/', async (req, res, next) => {
  try {
    const filter = { gymId: req.gymId }
    if (req.user.role === 'trainer') {
      filter.trainerId = req.user._id
    } else if (req.query.trainerId) {
      filter.trainerId = req.query.trainerId
    }

    const slots = await TimetableSlot.find(filter)
      .sort({ weekday: 1, startTime: 1 })
      .populate(POPULATE_ALL)
    res.json(slots)
  } catch (err) { next(err) }
})

// ── POST /api/timetable/:trainerId/generate ────────────────────────────────
// "First trainer will add timetable" — builds one empty slot per working
// hour from the trainer's TrainerAvailability. Idempotent/additive: existing
// slots (and whoever's booked into them) are left untouched; this only ever
// fills in gaps, e.g. after working hours are set up or extended.
router.post('/:trainerId/generate', async (req, res, next) => {
  try {
    const { trainerId } = req.params
    if (!canManageTrainer(req, trainerId)) {
      return res.status(403).json({ message: 'You can only build your own timetable' })
    }

    const trainer = await User.findOne({ _id: trainerId, gymId: req.gymId })
    if (!trainer) return res.status(404).json({ message: 'Trainer not found' })

    let availability = await TrainerAvailability.findOne({ gymId: req.gymId, trainerId })
    if (!availability) {
      availability = await TrainerAvailability.create({ gymId: req.gymId, trainerId })
    }
    const slotMin = availability.slotDurationMinutes || 60

    let created = 0
    for (const weekday of WEEKDAYS) {
      const dayHours = availability.weeklyHours?.[weekday]
      if (!dayHours || dayHours.isOff) continue

      for (const shift of getShifts(dayHours)) {
        const [sh, sm] = shift.start.split(':').map(Number)
        const [eh, em] = shift.end.split(':').map(Number)
        const endMin = eh * 60 + em

        for (let cursor = sh * 60 + sm; cursor + slotMin <= endMin; cursor += slotMin) {
          const startTime = `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`
          const endTime = addMinutes(startTime, slotMin)

          // Explicit existence check + create/update, rather than relying on
          // findOneAndUpdate's rawResult/lastErrorObject metadata — that
          // shape isn't reliably returned across mongoose/driver versions
          // (on Mongoose 8 it can come back plain `null` for a fresh upsert
          // insert instead of the {lastErrorObject, value} wrapper).
          const existing = await TimetableSlot.findOne(
            { gymId: req.gymId, trainerId, weekday, startTime }
          ).select('_id')

          if (existing) {
            await TimetableSlot.updateOne({ _id: existing._id }, { $set: { endTime } })
          } else {
            try {
              await TimetableSlot.create({
                gymId: req.gymId, trainerId, weekday, startTime, endTime,
                status: 'empty', memberId: null,
              })
              created += 1
            } catch (e) {
              // Duplicate key = another concurrent generate() beat us to it
              // for this exact cell — not an error, just already handled.
              if (e.code !== 11000) throw e
            }
          }
        }
      }
    }

    const slots = await TimetableSlot.find({ gymId: req.gymId, trainerId })
      .sort({ weekday: 1, startTime: 1 })
      .populate(POPULATE_ALL)
    res.json({ created, slots })
  } catch (err) { next(err) }
})

// ── POST /api/timetable/:trainerId/slots ────────────────────────────────────
// Manually add empty slots for any combination of weekdays × start times in
// one action — e.g. every Mon/Wed/Fri at 6:00am and 7:00am at once. This is
// deliberately independent of TrainerAvailability/generate, so a trainer
// isn't limited to whatever their saved working hours happen to produce —
// useful for one-off extra slots, or building the timetable out manually
// before working hours are even configured.
router.post('/:trainerId/slots',
  [
    body('weekdays').isArray({ min: 1 }).withMessage('Pick at least one day'),
    body('weekdays.*').isIn(WEEKDAYS).withMessage('Invalid weekday'),
    body('times').isArray({ min: 1 }).withMessage('Pick at least one time'),
    body('times.*').matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Times must be in HH:mm format'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { trainerId } = req.params
      if (!canManageTrainer(req, trainerId)) {
        return res.status(403).json({ message: 'You can only edit your own timetable' })
      }
      const trainer = await User.findOne({ _id: trainerId, gymId: req.gymId })
      if (!trainer) return res.status(404).json({ message: 'Trainer not found' })

      const { weekdays, times } = req.body
      const durationMinutes = Number(req.body.durationMinutes) || 60

      let created = 0
      let skipped = 0
      for (const weekday of weekdays) {
        for (const startTime of times) {
          const endTime = addMinutes(startTime, durationMinutes)
          const existing = await TimetableSlot.findOne({ gymId: req.gymId, trainerId, weekday, startTime }).select('_id')
          if (existing) { skipped += 1; continue }
          try {
            await TimetableSlot.create({
              gymId: req.gymId, trainerId, weekday, startTime, endTime,
              status: 'empty', memberId: null,
            })
            created += 1
          } catch (e) {
            if (e.code === 11000) { skipped += 1; continue } // concurrent add, already handled
            throw e
          }
        }
      }

      const slots = await TimetableSlot.find({ gymId: req.gymId, trainerId })
        .sort({ weekday: 1, startTime: 1 })
        .populate(POPULATE_ALL)
      res.json({ created, skipped, slots })
    } catch (err) { next(err) }
  }
)

// ── PATCH /api/timetable/:id/assign ─────────────────────────────────────────
// Trainer (or owner/manager) directly puts a member into a slot — the main
// way a timetable gets filled in beyond the initial empty grid.
router.patch('/:id/assign',
  [body('memberId').notEmpty().withMessage('Member required')],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const slot = await TimetableSlot.findOne({ _id: req.params.id, gymId: req.gymId })
      if (!slot) return res.status(404).json({ message: 'Slot not found' })
      if (!canManageTrainer(req, slot.trainerId)) {
        return res.status(403).json({ message: 'You can only edit your own timetable' })
      }

      const { memberId } = req.body
      const member = await Member.findOne({ _id: memberId, gymId: req.gymId })
      if (!member) return res.status(404).json({ message: 'Member not found' })

      // Resolve which PT plan this slot runs under — required so the
      // timetable can show it, and so it's clear the member actually has
      // an active plan at all.
      let memberPTPlanId = req.body.memberPTPlanId || null
      if (memberPTPlanId) {
        const plan = await MemberPTPlan.findOne({ _id: memberPTPlanId, gymId: req.gymId, memberId, status: 'active' })
        if (!plan) return res.status(400).json({ message: "That PT plan isn't active for this member" })
      } else {
        const activePlans = await MemberPTPlan.find({ gymId: req.gymId, memberId, status: 'active' })
        if (activePlans.length === 0) {
          return res.status(400).json({ message: `${member.name} doesn't have an active PT plan` })
        }
        if (activePlans.length > 1) {
          return res.status(400).json({ message: `${member.name} has more than one active PT plan — specify which one` })
        }
        memberPTPlanId = activePlans[0]._id
      }

      slot.memberId = memberId
      slot.memberPTPlanId = memberPTPlanId
      slot.status = 'booked'
      slot.pendingRequest = undefined
      await slot.save()
      await slot.populate(POPULATE_ALL)

      sendPushToMember(memberId, {
        title: 'Weekly PT slot assigned',
        body: `You've been added to a weekly slot: ${cap(slot.weekday)} ${slot.startTime}.`,
        url: '/timetable',
        tag: 'timetable-assigned',
      }).catch((e) => console.error('[push] timetable assign failed:', e.message))

      res.json(slot)
    } catch (err) { next(err) }
  }
)

// ── PATCH /api/timetable/:id/empty ──────────────────────────────────────────
// Trainer clears out whoever's in one of their own slots — "trainers to
// mark (for all members assigned to trainer)". Same 2-hour cutoff as a
// member cancelling their own slot; owner/manager can override it since
// they're rescheduling administratively, not "cancelling" in the same sense.
router.patch('/:id/empty', async (req, res, next) => {
  try {
    const slot = await TimetableSlot.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!slot) return res.status(404).json({ message: 'Slot not found' })
    if (!canManageTrainer(req, slot.trainerId)) {
      return res.status(403).json({ message: 'You can only edit your own timetable' })
    }
    if (slot.status !== 'booked') {
      return res.status(400).json({ message: 'This slot is already empty' })
    }

    const bypassDeadline = ['owner', 'manager'].includes(req.user.role)
    if (!bypassDeadline && isPastCancellationDeadline(slot.weekday, slot.startTime)) {
      return res.status(400).json({ message: 'This slot can only be cleared at least 2 hours before it starts' })
    }

    const previousMemberId = slot.memberId
    slot.memberId = null
    slot.memberPTPlanId = null
    slot.status = 'empty'
    await slot.save()
    await slot.populate(POPULATE_ALL)

    if (previousMemberId) {
      sendPushToMember(previousMemberId, {
        title: 'Weekly PT slot cancelled',
        body: `Your weekly slot on ${cap(slot.weekday)} ${slot.startTime} was cleared by your trainer.`,
        url: '/timetable',
        tag: 'timetable-cleared',
      }).catch((e) => console.error('[push] timetable empty failed:', e.message))
    }

    res.json(slot)
  } catch (err) { next(err) }
})

// ── POST /api/timetable/:id/approve-request ─────────────────────────────────
// Approves a member's request to take an open slot.
router.post('/:id/approve-request', async (req, res, next) => {
  try {
    const slot = await TimetableSlot.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!slot) return res.status(404).json({ message: 'Slot not found' })
    if (!canManageTrainer(req, slot.trainerId)) {
      return res.status(403).json({ message: 'You can only edit your own timetable' })
    }
    if (!slot.pendingRequest?.memberId) {
      return res.status(400).json({ message: 'No pending request on this slot' })
    }

    slot.memberId = slot.pendingRequest.memberId
    slot.memberPTPlanId = slot.pendingRequest.memberPTPlanId
    slot.status = 'booked'
    const requesterId = slot.pendingRequest.memberId
    slot.pendingRequest = undefined
    await slot.save()
    await slot.populate(POPULATE_ALL)

    sendPushToMember(requesterId, {
      title: 'Slot request approved',
      body: `You're confirmed for ${cap(slot.weekday)} ${slot.startTime}.`,
      url: '/timetable',
      tag: 'timetable-request-approved',
    }).catch((e) => console.error('[push] timetable approve failed:', e.message))

    res.json(slot)
  } catch (err) { next(err) }
})

// ── POST /api/timetable/:id/decline-request ─────────────────────────────────
router.post('/:id/decline-request', async (req, res, next) => {
  try {
    const slot = await TimetableSlot.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!slot) return res.status(404).json({ message: 'Slot not found' })
    if (!canManageTrainer(req, slot.trainerId)) {
      return res.status(403).json({ message: 'You can only edit your own timetable' })
    }
    if (!slot.pendingRequest?.memberId) {
      return res.status(400).json({ message: 'No pending request on this slot' })
    }

    const requesterId = slot.pendingRequest.memberId
    slot.pendingRequest = undefined
    await slot.save()
    await slot.populate(POPULATE_ALL)

    sendPushToMember(requesterId, {
      title: 'Slot request declined',
      body: req.body.reason
        ? `Your request for ${slot.weekday} ${slot.startTime} was declined: ${req.body.reason}`
        : `Your request for ${slot.weekday} ${slot.startTime} was declined. Try another slot.`,
      url: '/timetable',
      tag: 'timetable-request-declined',
    }).catch((e) => console.error('[push] timetable decline failed:', e.message))

    res.json(slot)
  } catch (err) { next(err) }
})

// ── DELETE /api/timetable/:id ────────────────────────────────────────────────
// Removes a slot row entirely — e.g. cleanup after working hours shrink, or
// an admin tidying up the timetable. Distinct from "empty": this deletes the
// cell itself rather than just vacating it. No 2-hour cutoff here — deleting
// a row is an admin/trainer scheduling action, not a member-style cancel.
router.delete('/:id', async (req, res, next) => {
  try {
    const slot = await TimetableSlot.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!slot) return res.status(404).json({ message: 'Slot not found' })
    if (!canManageTrainer(req, slot.trainerId)) {
      return res.status(403).json({ message: 'You can only edit your own timetable' })
    }

    const previousMemberId = slot.status === 'booked' ? slot.memberId : null
    const { weekday, startTime } = slot
    await slot.deleteOne()

    if (previousMemberId) {
      sendPushToMember(previousMemberId, {
        title: 'Weekly PT slot removed',
        body: `Your weekly slot on ${cap(weekday)} ${startTime} was removed from the timetable.`,
        url: '/timetable',
        tag: 'timetable-deleted',
      }).catch((e) => console.error('[push] timetable delete failed:', e.message))
    }

    res.json({ message: 'Slot removed' })
  } catch (err) { next(err) }
})

export default router
