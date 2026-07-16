import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import PTSession from '../models/PTSession.js'
import Member from '../models/Member.js'
import { protect, authorize } from '../middleware/auth.js'
import { sendPushToMember } from '../services/pushNotification.service.js'
import { estimateCaloriesBurned } from '../utils/calories.js'

const router = Router()

// Shared populate config for equipment/workout links — keeps the media
// fields (image/video) available wherever a session is returned, without
// repeating this list at every route.
const EQUIPMENT_POPULATE = { path: 'equipment', select: 'name category imageUrl' }
const WORKOUT_POPULATE = { path: 'workouts', select: 'name category imageUrl videoUrl videoDurationSec' }

function validate(req, res) {
  const errs = validationResult(req)
  if (!errs.isEmpty()) { res.status(400).json({ message: errs.array()[0].msg }); return false }
  return true
}

/**
 * Estimate calories burned for a session, filling in a bodyweight from the
 * member's most recently logged session if this one doesn't have one yet.
 * Returns null (rather than throwing) when there still isn't enough data —
 * calorie tracking is a bonus, not something that should block a save.
 */
async function resolveCalories({ gymId, memberId, excludeId, bodyWeight, durationMinutes, exercises }) {
  if (exercises?.length === 0 || !durationMinutes) return null
  let weightKg = Number(bodyWeight) || null
  if (!weightKg) {
    const last = await PTSession.findOne({
      gymId, memberId,
      bodyWeight: { $exists: true, $ne: null },
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    }).sort({ date: -1 }).select('bodyWeight')
    weightKg = last?.bodyWeight || null
  }
  if (!weightKg) return null

  const member = await Member.findOne({ _id: memberId, gymId }).select('height')
  return estimateCaloriesBurned({
    heightCm: member?.height,
    weightKg,
    durationMinutes,
    exercises,
  })
}

// ── GET /api/pt-sessions ────────────────────────────────────────────────────
// List sessions — filtered by memberId, trainerId, date range, status
router.get('/', protect, authorize('owner', 'manager', 'trainer'), async (req, res, next) => {
  try {
    const { memberId, trainerId, status, from, to, page = 1, limit = 20 } = req.query
    const filter = { gymId: req.gymId }

    if (memberId) filter.memberId = memberId
    if (status) filter.status = status

    // Trainers see their own sessions, plus any unclaimed or specifically
    // requested-for-them pending booking requests they can act on.
    if (req.user.role === 'trainer') {
      filter.$or = [
        { trainerId: req.user._id },
        { status: 'pending', trainerId: null },
        { status: 'pending', requestedTrainerId: req.user._id },
      ]
    } else if (trainerId) {
      filter.trainerId = trainerId
    }

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
        .populate('memberId', 'name phone')
        .populate('trainerId', 'name')
        .populate(EQUIPMENT_POPULATE)
        .populate(WORKOUT_POPULATE),
      PTSession.countDocuments(filter),
    ])

    res.json({ sessions, total, page: Number(page), pages: Math.ceil(total / limit) })
  } catch (err) { next(err) }
})

// ── GET /api/pt-sessions/:id ────────────────────────────────────────────────
router.get('/:id', protect, authorize('owner', 'manager', 'trainer'), async (req, res, next) => {
  try {
    const session = await PTSession.findOne({ _id: req.params.id, gymId: req.gymId })
      .populate('memberId', 'name phone email')
      .populate('trainerId', 'name')
      .populate(EQUIPMENT_POPULATE)
      .populate(WORKOUT_POPULATE)
    if (!session) return res.status(404).json({ message: 'Session not found' })
    res.json(session)
  } catch (err) { next(err) }
})

// ── POST /api/pt-sessions ───────────────────────────────────────────────────
router.post('/',
  protect,
  authorize('owner', 'manager', 'trainer'),
  [
    body('memberId').notEmpty().withMessage('Member required'),
    body('date').notEmpty().withMessage('Date required'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { memberId, date, title, notes, exercises, bodyWeight, bodyFat, status, equipment, workouts, durationMinutes } = req.body

      const member = await Member.findOne({ _id: memberId, gymId: req.gymId })
      if (!member) return res.status(404).json({ message: 'Member not found' })

      // Trainers are always the trainer; owners/managers can specify
      const trainerId = req.user.role === 'trainer'
        ? req.user._id
        : (req.body.trainerId || req.user._id)

      const caloriesBurned = await resolveCalories({
        gymId: req.gymId, memberId, bodyWeight,
        durationMinutes: durationMinutes || 60,
        exercises: exercises || [],
      })

      const session = await PTSession.create({
        gymId: req.gymId,
        memberId,
        trainerId,
        date: new Date(date),
        durationMinutes: durationMinutes || 60,
        title: title || '',
        notes: notes || '',
        exercises: exercises || [],
        bodyWeight,
        bodyFat,
        caloriesBurned,
        status: status || 'scheduled',
        // Both optional — a trainer doesn't have to link anything
        equipment: equipment || [],
        workouts: workouts || [],
      })

      const populated = await session.populate([
        { path: 'memberId', select: 'name phone' },
        { path: 'trainerId', select: 'name' },
        EQUIPMENT_POPULATE,
        WORKOUT_POPULATE,
      ])

      res.status(201).json(populated)
    } catch (err) { next(err) }
  }
)

// ── PATCH /api/pt-sessions/:id ──────────────────────────────────────────────
router.patch('/:id',
  protect,
  authorize('owner', 'manager', 'trainer'),
  async (req, res, next) => {
    try {
      const allowed = ['date', 'title', 'notes', 'exercises', 'bodyWeight', 'bodyFat', 'status', 'trainerId', 'equipment', 'workouts', 'durationMinutes']
      const updates = {}
      allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k] })

      // Trainers can only edit their own sessions
      const filter = { _id: req.params.id, gymId: req.gymId }
      if (req.user.role === 'trainer') filter.trainerId = req.user._id

      const current = await PTSession.findOne(filter)
      if (!current) return res.status(404).json({ message: 'Session not found or access denied' })

      // Recalculate calories whenever anything that feeds the estimate
      // changes, using the merged (updated-or-existing) values.
      if (['bodyWeight', 'durationMinutes', 'exercises'].some((k) => updates[k] !== undefined)) {
        updates.caloriesBurned = await resolveCalories({
          gymId: req.gymId, memberId: current.memberId, excludeId: current._id,
          bodyWeight: updates.bodyWeight !== undefined ? updates.bodyWeight : current.bodyWeight,
          durationMinutes: updates.durationMinutes !== undefined ? updates.durationMinutes : current.durationMinutes,
          exercises: updates.exercises !== undefined ? updates.exercises : current.exercises,
        })
      }

      const session = await PTSession.findOneAndUpdate(filter, updates, { new: true, runValidators: true })
        .populate('memberId', 'name phone')
        .populate('trainerId', 'name')
        .populate(EQUIPMENT_POPULATE)
        .populate(WORKOUT_POPULATE)

      if (!session) return res.status(404).json({ message: 'Session not found or access denied' })

      // Notify the member — fire-and-forget, never blocks the response
      const sessionDate = new Date(session.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      const bodyText = updates.date
        ? `Your PT session was rescheduled to ${sessionDate}.`
        : `Your PT session on ${sessionDate} was updated.`
      sendPushToMember(session.memberId?._id || session.memberId, {
        title: 'PT session updated',
        body: bodyText,
        url: '/workouts',
        tag: 'pt-session-updated',
      }).catch((e) => console.error('[push] PT session update failed:', e.message))

      res.json(session)
    } catch (err) { next(err) }
  }
)

// ── POST /api/pt-sessions/:id/confirm ───────────────────────────────────────
// Confirms a member-requested (pending) booking, turning it into a
// scheduled session. Owners/managers can assign or reassign a trainer at
// confirmation time; trainers confirm onto themselves by default.
router.post('/:id/confirm',
  protect,
  authorize('owner', 'manager', 'trainer'),
  async (req, res, next) => {
    try {
      const filter = { _id: req.params.id, gymId: req.gymId, status: 'pending' }
      // Trainers can only confirm requests that are unassigned, already
      // theirs, or specifically asked for them.
      if (req.user.role === 'trainer') {
        filter.$or = [
          { trainerId: req.user._id },
          { trainerId: null },
          { requestedTrainerId: req.user._id },
        ]
      }

      const session = await PTSession.findOne(filter)
      if (!session) return res.status(404).json({ message: 'Pending request not found or access denied' })

      const trainerId = req.body.trainerId
        || session.trainerId
        || (req.user.role === 'trainer' ? req.user._id : null)
      if (!trainerId) return res.status(400).json({ message: 'Select a trainer to confirm this session' })

      session.trainerId = trainerId
      session.status = 'scheduled'
      if (req.body.date) session.date = new Date(req.body.date)
      await session.save()

      const populated = await session.populate([
        { path: 'memberId', select: 'name phone' },
        { path: 'trainerId', select: 'name' },
        EQUIPMENT_POPULATE,
        WORKOUT_POPULATE,
      ])

      const sessionDate = new Date(session.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      sendPushToMember(session.memberId?._id || session.memberId, {
        title: 'PT session confirmed',
        body: `Your PT session request for ${sessionDate} was confirmed.`,
        url: '/workouts',
        tag: 'pt-session-confirmed',
      }).catch((e) => console.error('[push] PT session confirm failed:', e.message))

      res.json(populated)
    } catch (err) { next(err) }
  }
)

// ── POST /api/pt-sessions/:id/decline ───────────────────────────────────────
// Declines a member-requested (pending) booking, with an optional reason.
router.post('/:id/decline',
  protect,
  authorize('owner', 'manager', 'trainer'),
  async (req, res, next) => {
    try {
      const filter = { _id: req.params.id, gymId: req.gymId, status: 'pending' }
      if (req.user.role === 'trainer') {
        filter.$or = [
          { trainerId: req.user._id },
          { trainerId: null },
          { requestedTrainerId: req.user._id },
        ]
      }

      const session = await PTSession.findOneAndUpdate(
        filter,
        { status: 'declined', declineReason: req.body.reason || '' },
        { new: true }
      )
        .populate('memberId', 'name phone')
        .populate('trainerId', 'name')

      if (!session) return res.status(404).json({ message: 'Pending request not found or access denied' })

      const sessionDate = new Date(session.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      sendPushToMember(session.memberId?._id || session.memberId, {
        title: 'PT session request declined',
        body: req.body.reason
          ? `Your request for ${sessionDate} was declined: ${req.body.reason}`
          : `Your PT session request for ${sessionDate} was declined. Please try another slot.`,
        url: '/workouts',
        tag: 'pt-session-declined',
      }).catch((e) => console.error('[push] PT session decline failed:', e.message))

      res.json(session)
    } catch (err) { next(err) }
  }
)

// ── DELETE /api/pt-sessions/:id ─────────────────────────────────────────────
router.delete('/:id', protect, authorize('owner', 'manager', 'trainer'), async (req, res, next) => {
  try {
    const filter = { _id: req.params.id, gymId: req.gymId }
    if (req.user.role === 'trainer') filter.trainerId = req.user._id
    const session = await PTSession.findOneAndDelete(filter)
    if (!session) return res.status(404).json({ message: 'Session not found or access denied' })
    res.json({ message: 'Session deleted' })
  } catch (err) { next(err) }
})

// ── POST /api/pt-sessions/:id/body-weight ──────────────────────────────────
// Quick endpoint to log/update just the body weight for a session
router.post('/:id/body-weight',
  protect,
  authorize('owner', 'manager', 'trainer'),
  [body('bodyWeight').isNumeric().withMessage('Valid body weight required')],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { bodyWeight, bodyFat } = req.body
      const filter = { _id: req.params.id, gymId: req.gymId }
      if (req.user.role === 'trainer') filter.trainerId = req.user._id

      const current = await PTSession.findOne(filter)
      if (!current) return res.status(404).json({ message: 'Session not found' })

      const caloriesBurned = await resolveCalories({
        gymId: req.gymId, memberId: current.memberId, excludeId: current._id,
        bodyWeight, durationMinutes: current.durationMinutes, exercises: current.exercises,
      })

      const session = await PTSession.findOneAndUpdate(
        filter,
        { bodyWeight, caloriesBurned, ...(bodyFat !== undefined ? { bodyFat } : {}) },
        { new: true }
      )
      if (!session) return res.status(404).json({ message: 'Session not found' })
      res.json(session)
    } catch (err) { next(err) }
  }
)

// ── GET /api/pt-sessions/member/:memberId/progress ─────────────────────────
// Body weight progress for a member — for charts
router.get('/member/:memberId/progress', protect, authorize('owner', 'manager', 'trainer'), async (req, res, next) => {
  try {
    const sessions = await PTSession.find({
      gymId: req.gymId,
      memberId: req.params.memberId,
      bodyWeight: { $exists: true, $ne: null },
    })
      .sort({ date: 1 })
      .select('date bodyWeight bodyFat status')

    res.json(sessions)
  } catch (err) { next(err) }
})

export default router