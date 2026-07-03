import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import PTSession from '../models/PTSession.js'
import Member from '../models/Member.js'
import { protect, authorize } from '../middleware/auth.js'

const router = Router()

function validate(req, res) {
  const errs = validationResult(req)
  if (!errs.isEmpty()) { res.status(400).json({ message: errs.array()[0].msg }); return false }
  return true
}

// ── GET /api/pt-sessions ────────────────────────────────────────────────────
// List sessions — filtered by memberId, trainerId, date range, status
router.get('/', protect, authorize('owner', 'manager', 'trainer'), async (req, res, next) => {
  try {
    const { memberId, trainerId, status, from, to, page = 1, limit = 20 } = req.query
    const filter = { gymId: req.gymId }

    if (memberId) filter.memberId = memberId
    if (status) filter.status = status

    // Trainers only see their own sessions unless owner/manager
    if (req.user.role === 'trainer') {
      filter.trainerId = req.user._id
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
        .populate('trainerId', 'name'),
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
      const { memberId, date, title, notes, exercises, bodyWeight, bodyFat, status } = req.body

      const member = await Member.findOne({ _id: memberId, gymId: req.gymId })
      if (!member) return res.status(404).json({ message: 'Member not found' })

      // Trainers are always the trainer; owners/managers can specify
      const trainerId = req.user.role === 'trainer'
        ? req.user._id
        : (req.body.trainerId || req.user._id)

      const session = await PTSession.create({
        gymId: req.gymId,
        memberId,
        trainerId,
        date: new Date(date),
        title: title || '',
        notes: notes || '',
        exercises: exercises || [],
        bodyWeight,
        bodyFat,
        status: status || 'scheduled',
      })

      const populated = await session.populate([
        { path: 'memberId', select: 'name phone' },
        { path: 'trainerId', select: 'name' },
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
      const allowed = ['date', 'title', 'notes', 'exercises', 'bodyWeight', 'bodyFat', 'status', 'trainerId']
      const updates = {}
      allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k] })

      // Trainers can only edit their own sessions
      const filter = { _id: req.params.id, gymId: req.gymId, acknowledgedByMember: false }
      if (req.user.role === 'trainer') filter.trainerId = req.user._id

      const session = await PTSession.findOneAndUpdate(filter, updates, { new: true, runValidators: true })
        .populate('memberId', 'name phone')
        .populate('trainerId', 'name')

      if (!session) return res.status(404).json({ message: 'Session not found or access denied' })
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

      const session = await PTSession.findOneAndUpdate(
        filter,
        { bodyWeight, ...(bodyFat !== undefined ? { bodyFat } : {}) },
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
