import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import { memberProtect } from '../middleware/memberAuth.js'
import PTSession from '../models/PTSession.js'
import User from '../models/User.js'
import TrainerAvailability from '../models/TrainerAvailability.js'
import TrainerTimeOff from '../models/TrainerTimeOff.js'
import { istDayName, istDateKey, istTimeOfDay, istDateTime, istStartOfDay } from '../utils/dateIST.js'

const router = Router()
router.use(memberProtect)

// Same shared populate config as the admin PT session routes — lets the
// member see the equipment/workout media a trainer optionally linked.
const EQUIPMENT_POPULATE = { path: 'equipment', select: 'name category imageUrl' }
const WORKOUT_POPULATE = { path: 'workouts', select: 'name category imageUrl videoUrl videoDurationSec' }

function validate(req, res) {
  const errs = validationResult(req)
  if (!errs.isEmpty()) { res.status(400).json({ message: errs.array()[0].msg }); return false }
  return true
}

// ── GET /api/member-portal/pt-sessions/trainers ────────────────────────────
// Active trainers (and owners, who often also train) at this gym, for the
// booking form's "preferred trainer" picker. MUST be before /:id.
router.get('/trainers', async (req, res, next) => {
  try {
    const trainers = await User.find({
      gymId: req.gymId,
      isActive: true,
      role: { $in: ['trainer', 'owner'] },
    }).select('name role').sort({ name: 1 })
    res.json(trainers)
  } catch (err) { next(err) }
})

// Normalizes a day's working hours to an array of {start, end} shifts,
// tolerating older TrainerAvailability docs saved before multi-shift
// support (which had a single start/end instead of a shifts array).
function getShifts(dayHours) {
  if (!dayHours) return []
  if (Array.isArray(dayHours.shifts) && dayHours.shifts.length > 0) return dayHours.shifts
  if (dayHours.start && dayHours.end) return [{ start: dayHours.start, end: dayHours.end }]
  return []
}

// ── GET /api/member-portal/pt-sessions/available-slots ──────────────────────
// Bookable time slots for a trainer on a given IST calendar day — factors in
// their weekly working hours, any time-off covering that day, and existing
// pending/scheduled bookings (so members can never double-book a trainer).
// MUST be before /:id.
router.get('/available-slots', async (req, res, next) => {
  try {
    const { trainerId, date } = req.query // date = "YYYY-MM-DD", an IST calendar day
    if (!trainerId || !date) return res.status(400).json({ message: 'trainerId and date are required' })

    const trainer = await User.findOne({ _id: trainerId, gymId: req.gymId, isActive: true })
    if (!trainer) return res.status(404).json({ message: 'Trainer not found' })

    const dayName = istDayName(istDateTime(date, '12:00')) // noon sidesteps any day-boundary edge cases
    const availability = await TrainerAvailability.findOne({ gymId: req.gymId, trainerId })
    const dayHours = availability?.weeklyHours?.[dayName]

    if (!dayHours || dayHours.isOff) {
      return res.json({ available: false, reason: "Trainer isn't working this day", slots: [] })
    }
    const shifts = getShifts(dayHours)
    if (shifts.length === 0) {
      return res.json({ available: false, reason: "Trainer's hours aren't set up for this day", slots: [] })
    }

    const dayStart = istStartOfDay(istDateTime(date, '00:00'))
    const timeOff = await TrainerTimeOff.findOne({
      gymId: req.gymId, trainerId,
      startDate: { $lte: dayStart }, endDate: { $gte: dayStart },
    })
    if (timeOff) {
      return res.json({ available: false, reason: timeOff.reason || 'Trainer is unavailable this day', slots: [] })
    }

    // Existing bookings that day — pending or confirmed both block the slot;
    // declined/cancelled/completed don't.
    const dayEnd = istDateTime(date, '23:59')
    const existing = await PTSession.find({
      gymId: req.gymId, trainerId,
      date: { $gte: dayStart, $lte: dayEnd },
      status: { $in: ['pending', 'scheduled'] },
    }).select('date durationMinutes')

    const slotMin = availability.slotDurationMinutes || 60
    const now = new Date()

    const slots = []
    for (const shift of shifts) {
      const [sh, sm] = shift.start.split(':').map(Number)
      const [eh, em] = shift.end.split(':').map(Number)
      const endMin = eh * 60 + em

      for (let cursor = sh * 60 + sm; cursor + slotMin <= endMin; cursor += slotMin) {
        const slotTime = `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`
        const slotStart = istDateTime(date, slotTime)
        const slotEndMs = slotStart.getTime() + slotMin * 60000

        if (slotStart < now) continue // don't offer past slots for today

        const conflict = existing.some((s) => {
          const bStart = new Date(s.date).getTime()
          const bEnd = bStart + (s.durationMinutes || 60) * 60000
          return bStart < slotEndMs && slotStart.getTime() < bEnd
        })
        if (!conflict) slots.push(slotTime)
      }
    }
    slots.sort()

    res.json({ available: slots.length > 0, slots })
  } catch (err) { next(err) }
})

// ── POST /api/member-portal/pt-sessions/request ─────────────────────────────
// A member books a PT session slot off the calendar. Lands as 'pending'
// until a trainer (or manager/owner) confirms it from the admin dashboard.
// MUST be before /:id.
router.post('/request',
  [
    body('date').notEmpty().withMessage('Pick a date and time for the session'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { date, trainerId, title, notes, durationMinutes } = req.body

      const when = new Date(date)
      if (Number.isNaN(when.getTime())) {
        return res.status(400).json({ message: 'Invalid date' })
      }
      if (when < new Date()) {
        return res.status(400).json({ message: 'Pick a time in the future' })
      }

      if (trainerId) {
        const trainer = await User.findOne({ _id: trainerId, gymId: req.gymId, isActive: true })
        if (!trainer) return res.status(404).json({ message: 'Trainer not found' })

        // Re-validate against working hours, time-off, and existing bookings
        // server-side — the available-slots endpoint is advisory for the UI,
        // this is the actual gate.
        const dateKey = istDateKey(when)
        const dayName = istDayName(when)
        const availability = await TrainerAvailability.findOne({ gymId: req.gymId, trainerId })
        const dayHours = availability?.weeklyHours?.[dayName]
        if (dayHours && dayHours.isOff) {
          return res.status(400).json({ message: `${trainer.name} isn't working that day` })
        }
        if (dayHours && !dayHours.isOff) {
          const requestedTime = istTimeOfDay(when)
          const shifts = getShifts(dayHours)
          const withinAnyShift = shifts.some((s) => requestedTime >= s.start && requestedTime < s.end)
          if (!withinAnyShift) {
            const shiftsText = shifts.length > 0
              ? shifts.map((s) => `${s.start}–${s.end}`).join(', ')
              : 'not set up'
            return res.status(400).json({ message: `${trainer.name}'s working hours that day are ${shiftsText}` })
          }
        }

        const dayStart = istStartOfDay(when)
        const timeOff = await TrainerTimeOff.findOne({
          gymId: req.gymId, trainerId,
          startDate: { $lte: dayStart }, endDate: { $gte: dayStart },
        })
        if (timeOff) {
          return res.status(400).json({ message: `${trainer.name} is unavailable that day${timeOff.reason ? ` (${timeOff.reason})` : ''}` })
        }

        const durMin = durationMinutes || 60
        const newEndMs = when.getTime() + durMin * 60000
        const sameDaySessions = await PTSession.find({
          gymId: req.gymId, trainerId,
          status: { $in: ['pending', 'scheduled'] },
          date: { $gte: dayStart, $lt: new Date(dayStart.getTime() + 86400000) },
        }).select('date durationMinutes')
        const overlapping = sameDaySessions.some((s) => {
          const exStart = new Date(s.date).getTime()
          const exEnd = exStart + (s.durationMinutes || 60) * 60000
          return exStart < newEndMs && when.getTime() < exEnd
        })
        if (overlapping) {
          return res.status(409).json({ message: `${trainer.name} already has a booking at that time — pick another slot` })
        }
      }

      const session = await PTSession.create({
        gymId: req.gymId,
        memberId: req.memberId,
        trainerId: trainerId || undefined,
        requestedTrainerId: trainerId || undefined,
        date: when,
        durationMinutes: durationMinutes || 60,
        title: title || 'PT Session request',
        notes: notes || '',
        status: 'pending',
        bookingSource: 'member',
      })

      const populated = await session.populate([
        { path: 'trainerId', select: 'name' },
        { path: 'requestedTrainerId', select: 'name' },
      ])

      res.status(201).json(populated)
    } catch (err) { next(err) }
  }
)

// ── POST /api/member-portal/pt-sessions/:id/cancel ──────────────────────────
// A member withdraws their own pending or not-yet-happened booking. Deletes
// the record entirely (rather than soft-cancelling) — a withdrawn request
// shouldn't linger in the trainer's/gym's history.
// MUST be before /:id.
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const session = await PTSession.findOne({ _id: req.params.id, memberId: req.memberId })
    if (!session) return res.status(404).json({ message: 'Session not found' })
    if (!['pending', 'scheduled'].includes(session.status)) {
      return res.status(400).json({ message: 'Only pending or scheduled sessions can be cancelled' })
    }
    if (new Date(session.date) < new Date()) {
      return res.status(400).json({ message: 'Cannot cancel a session that has already passed' })
    }

    await session.deleteOne()
    res.json({ message: 'Booking cancelled' })
  } catch (err) { next(err) }
})

// ── GET /api/member-portal/pt-sessions ─────────────────────────────────────
// IMPORTANT: literal sub-paths (/progress/body-weight) must come BEFORE /:id
router.get('/', async (req, res, next) => {
  try {
    const { status, from, to, page = 1, limit = 50 } = req.query
    const filter = { gymId: req.gymId, memberId: req.memberId }
    if (status) filter.status = status
    if (from || to) {
      filter.date = {}
      if (from) filter.date.$gte = new Date(from)
      if (to) filter.date.$lte = new Date(to)
    }

    const [sessions, total] = await Promise.all([
      PTSession.find(filter)
        .sort({ date: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate('trainerId', 'name')
        .populate(EQUIPMENT_POPULATE)
        .populate(WORKOUT_POPULATE),
      PTSession.countDocuments(filter),
    ])

    // Compute stats from all sessions (not just current page)
    const allSessions = await PTSession.find({
      gymId: req.gymId,
      memberId: req.memberId,
    }).select('status')
    const totalCompleted = allSessions.filter((s) => s.status === 'completed').length
    const totalScheduled = allSessions.filter((s) => s.status === 'scheduled').length

    res.json({
      sessions,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      totalCompleted,
      totalScheduled,
    })
  } catch (err) { next(err) }
})

// ── GET /api/member-portal/pt-sessions/progress/body-weight ────────────────
// MUST be before /:id — otherwise Express matches 'progress' as the id param
router.get('/progress/body-weight', async (req, res, next) => {
  try {
    const sessions = await PTSession.find({
      gymId: req.gymId,
      memberId: req.memberId,
      bodyWeight: { $exists: true, $ne: null },
    })
      .sort({ date: 1 })
      .select('date bodyWeight bodyFat title status')
    res.json(sessions)
  } catch (err) { next(err) }
})

// ── POST /api/member-portal/pt-sessions/:id/acknowledge ────────────────────
// MUST also be before the GET /:id so POST doesn't get eaten
router.post('/:id/acknowledge', async (req, res, next) => {
  try {
    const session = await PTSession.findOne({
      _id: req.params.id,
      memberId: req.memberId,
    })
    if (!session) {
      return res.status(404).json({ message: 'Session not found' })
    }
    if (session.acknowledgedByMember) {
      return res.status(400).json({ message: 'Session already acknowledged' })
    }

    // Allow acknowledging past OR same-day sessions only
    const sessionDate = new Date(session.date)
    sessionDate.setHours(23, 59, 59, 999)
    if (session.status !== 'completed' && sessionDate > new Date()) {
      return res.status(400).json({ message: 'Cannot acknowledge a future session' })
    }

    session.acknowledgedByMember = true
    session.acknowledgedAt = new Date()

    // Auto-complete when acknowledged — covers both 'scheduled' and 'missed'
    if (session.status === 'scheduled' || session.status === 'missed') {
      session.status = 'completed'
    }

    await session.save()

    // Return fresh populated session so the frontend can update immediately
    const populated = await PTSession.findById(session._id)
      .populate('trainerId', 'name')
      .populate(EQUIPMENT_POPULATE)
      .populate(WORKOUT_POPULATE)
    res.json({ message: 'Session acknowledged', session: populated })
  } catch (err) { next(err) }
})

// ── GET /api/member-portal/pt-sessions/:id ─────────────────────────────────
// Keep this LAST — the wildcard :id would match 'progress' and 'acknowledge' otherwise
router.get('/:id', async (req, res, next) => {
  try {
    const session = await PTSession.findOne({
      _id: req.params.id,
      memberId: req.memberId,
    })
      .populate('trainerId', 'name')
      .populate(EQUIPMENT_POPULATE)
      .populate(WORKOUT_POPULATE)
    if (!session) return res.status(404).json({ message: 'Session not found' })
    res.json(session)
  } catch (err) { next(err) }
})

export default router