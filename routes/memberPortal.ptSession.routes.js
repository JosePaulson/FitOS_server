// import { Router } from 'express'
// import { memberProtect } from '../middleware/memberAuth.js'
// import PTSession from '../models/PTSession.js'

// const router = Router()
// router.use(memberProtect)

// // Same shared populate config as the admin PT session routes — lets the
// // member see the equipment/workout media a trainer optionally linked.
// const EQUIPMENT_POPULATE = { path: 'equipment', select: 'name category imageUrl' }
// const WORKOUT_POPULATE = { path: 'workouts', select: 'name category imageUrl videoUrl videoDurationSec' }

// // ── GET /api/member-portal/pt-sessions ─────────────────────────────────────
// // IMPORTANT: literal sub-paths (/progress/body-weight) must come BEFORE /:id
// router.get('/', async (req, res, next) => {
//   try {
//     const { status, from, to, page = 1, limit = 50 } = req.query
//     const filter = { gymId: req.gymId, memberId: req.memberId }
//     if (status) filter.status = status
//     if (from || to) {
//       filter.date = {}
//       if (from) filter.date.$gte = new Date(from)
//       if (to) filter.date.$lte = new Date(to)
//     }

//     const [sessions, total] = await Promise.all([
//       PTSession.find(filter)
//         .sort({ date: -1 })
//         .skip((page - 1) * limit)
//         .limit(Number(limit))
//         .populate('trainerId', 'name')
//         .populate(EQUIPMENT_POPULATE)
//         .populate(WORKOUT_POPULATE),
//       PTSession.countDocuments(filter),
//     ])

//     // Compute stats from all sessions (not just current page)
//     const allSessions = await PTSession.find({
//       gymId: req.gymId,
//       memberId: req.memberId,
//     }).select('status')
//     const totalCompleted = allSessions.filter((s) => s.status === 'completed').length
//     const totalScheduled = allSessions.filter((s) => s.status === 'scheduled').length

//     res.json({
//       sessions,
//       total,
//       page: Number(page),
//       pages: Math.ceil(total / limit),
//       totalCompleted,
//       totalScheduled,
//     })
//   } catch (err) { next(err) }
// })

// // ── GET /api/member-portal/pt-sessions/progress/body-weight ────────────────
// // MUST be before /:id — otherwise Express matches 'progress' as the id param
// router.get('/progress/body-weight', async (req, res, next) => {
//   try {
//     const sessions = await PTSession.find({
//       gymId: req.gymId,
//       memberId: req.memberId,
//       bodyWeight: { $exists: true, $ne: null },
//     })
//       .sort({ date: 1 })
//       .select('date bodyWeight bodyFat title status')
//     res.json(sessions)
//   } catch (err) { next(err) }
// })

// // ── POST /api/member-portal/pt-sessions/:id/acknowledge ────────────────────
// // MUST also be before the GET /:id so POST doesn't get eaten
// router.post('/:id/acknowledge', async (req, res, next) => {
//   try {
//     const session = await PTSession.findOne({
//       _id: req.params.id,
//       memberId: req.memberId,
//     })
//     if (!session) {
//       return res.status(404).json({ message: 'Session not found' })
//     }
//     if (session.acknowledgedByMember) {
//       return res.status(400).json({ message: 'Session already acknowledged' })
//     }

//     // Allow acknowledging past OR same-day sessions only
//     const sessionDate = new Date(session.date)
//     sessionDate.setHours(23, 59, 59, 999)
//     if (session.status !== 'completed' && sessionDate > new Date()) {
//       return res.status(400).json({ message: 'Cannot acknowledge a future session' })
//     }

//     session.acknowledgedByMember = true
//     session.acknowledgedAt = new Date()

//     // Auto-complete when acknowledged — covers both 'scheduled' and 'missed'
//     if (session.status === 'scheduled' || session.status === 'missed') {
//       session.status = 'completed'
//     }

//     await session.save()

//     // Return fresh populated session so the frontend can update immediately
//     const populated = await PTSession.findById(session._id)
//       .populate('trainerId', 'name')
//       .populate(EQUIPMENT_POPULATE)
//       .populate(WORKOUT_POPULATE)
//     res.json({ message: 'Session acknowledged', session: populated })
//   } catch (err) { next(err) }
// })

// // ── GET /api/member-portal/pt-sessions/:id ─────────────────────────────────
// // Keep this LAST — the wildcard :id would match 'progress' and 'acknowledge' otherwise
// router.get('/:id', async (req, res, next) => {
//   try {
//     const session = await PTSession.findOne({
//       _id: req.params.id,
//       memberId: req.memberId,
//     })
//       .populate('trainerId', 'name')
//       .populate(EQUIPMENT_POPULATE)
//       .populate(WORKOUT_POPULATE)
//     if (!session) return res.status(404).json({ message: 'Session not found' })
//     res.json(session)
//   } catch (err) { next(err) }
// })

// export default router


import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import { memberProtect } from '../middleware/memberAuth.js'
import PTSession from '../models/PTSession.js'
import User from '../models/User.js'

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
// A member withdraws their own pending or not-yet-happened booking.
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

    session.status = 'cancelled'
    await session.save()
    res.json({ message: 'Booking cancelled', session })
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
    if (sessionDate > new Date()) {
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