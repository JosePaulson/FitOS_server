import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import LeaveRequest from '../models/LeaveRequest.js'
import { protect } from '../middleware/auth.js'
import { istDateKey, istDateTime } from '../utils/dateIST.js'

const router = Router()
router.use(protect)

function validate(req, res) {
  const errs = validationResult(req)
  if (!errs.isEmpty()) { res.status(400).json({ message: errs.array()[0].msg }); return false }
  return true
}

// Same payroll-permission model as staffPayroll.routes.js — owners have
// full access, managers only what's been explicitly granted, trainers
// and receptionists only ever act on their own requests.
function canPayroll(user, action) {
  if (user.role === 'owner') return true
  if (user.role === 'manager') return !!user.permissions?.payroll?.[action]
  return false
}

function requirePayroll(action) {
  return (req, res, next) => {
    if (!canPayroll(req.user, action)) {
      return res.status(403).json({ message: `You don't have payroll ${action} access. Ask an owner to grant it.` })
    }
    next()
  }
}

function daysBetweenInclusive(fromKey, toKey) {
  const [fy, fm, fd] = fromKey.split('-').map(Number)
  const [ty, tm, td] = toKey.split('-').map(Number)
  const from = Date.UTC(fy, fm - 1, fd)
  const to = Date.UTC(ty, tm - 1, td)
  return Math.round((to - from) / 86400000) + 1
}

/* ── Self-service ─────────────────────────────────────────────────────────── */

/** GET /api/leave/my — my own leave requests */
router.get('/my', async (req, res, next) => {
  try {
    const requests = await LeaveRequest.find({ gymId: req.gymId, staffId: req.user._id }).sort({ createdAt: -1 })
    res.json(requests)
  } catch (err) { next(err) }
})

/** POST /api/leave/my — submit a new leave request */
router.post('/my',
  [
    body('fromDate').isISO8601().withMessage('A valid start date is required'),
    body('toDate').isISO8601().withMessage('A valid end date is required'),
    body('reason').notEmpty().withMessage('Please provide a reason for the leave'),
    body('leaveType').optional().isIn(['paid', 'unpaid']),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const fromKey = istDateKey(req.body.fromDate)
      const toKey = istDateKey(req.body.toDate)
      if (toKey < fromKey) return res.status(400).json({ message: 'End date must be on or after the start date' })

      const request = await LeaveRequest.create({
        gymId: req.gymId,
        staffId: req.user._id,
        fromDate: istDateTime(fromKey),
        toDate: istDateTime(toKey),
        days: daysBetweenInclusive(fromKey, toKey),
        leaveType: req.body.leaveType === 'paid' ? 'paid' : 'unpaid',
        reason: req.body.reason,
      })
      res.status(201).json(request)
    } catch (err) { next(err) }
  }
)

/** PATCH /api/leave/my/:id/cancel — withdraw a still-pending request */
router.patch('/my/:id/cancel', async (req, res, next) => {
  try {
    const request = await LeaveRequest.findOne({ _id: req.params.id, gymId: req.gymId, staffId: req.user._id })
    if (!request) return res.status(404).json({ message: 'Leave request not found' })
    if (request.status !== 'pending') return res.status(400).json({ message: 'Only pending requests can be cancelled' })
    request.status = 'cancelled'
    await request.save()
    res.json(request)
  } catch (err) { next(err) }
})

/* ── Approvals (owner / permitted manager) ───────────────────────────────── */

/** GET /api/leave/pending — every staff member's pending leave requests */
router.get('/pending', requirePayroll('approve'), async (req, res, next) => {
  try {
    const requests = await LeaveRequest.find({ gymId: req.gymId, status: 'pending' })
      .sort({ fromDate: 1 })
      .populate('staffId', 'name role')
    res.json(requests)
  } catch (err) { next(err) }
})

/** GET /api/leave — all leave requests for the gym, optionally filtered by staff/status */
router.get('/', requirePayroll('view'), async (req, res, next) => {
  try {
    const filter = { gymId: req.gymId }
    if (req.query.staffId) filter.staffId = req.query.staffId
    if (req.query.status) filter.status = req.query.status
    const requests = await LeaveRequest.find(filter).sort({ createdAt: -1 }).populate('staffId', 'name role')
    res.json(requests)
  } catch (err) { next(err) }
})

/** PATCH /api/leave/:id/approve */
router.patch('/:id/approve',
  requirePayroll('approve'),
  [body('leaveType').optional().isIn(['paid', 'unpaid'])],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const request = await LeaveRequest.findOne({ _id: req.params.id, gymId: req.gymId })
      if (!request) return res.status(404).json({ message: 'Leave request not found' })
      if (request.status !== 'pending') return res.status(400).json({ message: 'Only pending requests can be approved' })

      if (req.body.leaveType) request.leaveType = req.body.leaveType
      request.status = 'approved'
      request.reviewedBy = req.user._id
      request.reviewedAt = new Date()
      request.reviewNote = req.body.reviewNote || ''
      await request.save()

      res.json(request)
    } catch (err) { next(err) }
  }
)

/** PATCH /api/leave/:id/reject */
router.patch('/:id/reject', requirePayroll('approve'), async (req, res, next) => {
  try {
    const request = await LeaveRequest.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!request) return res.status(404).json({ message: 'Leave request not found' })
    if (request.status !== 'pending') return res.status(400).json({ message: 'Only pending requests can be rejected' })

    request.status = 'rejected'
    request.reviewedBy = req.user._id
    request.reviewedAt = new Date()
    request.reviewNote = req.body.reason || ''
    await request.save()

    res.json(request)
  } catch (err) { next(err) }
})

export default router
