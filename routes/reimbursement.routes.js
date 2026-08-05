import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import Reimbursement from '../models/Reimbursement.js'
import { protect } from '../middleware/auth.js'
import { istDateKey, istDateTime } from '../utils/dateIST.js'

const router = Router()
router.use(protect)

function validate(req, res) {
  const errs = validationResult(req)
  if (!errs.isEmpty()) { res.status(400).json({ message: errs.array()[0].msg }); return false }
  return true
}

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

/* ── Self-service ─────────────────────────────────────────────────────────── */

/** GET /api/reimbursements/my */
router.get('/my', async (req, res, next) => {
  try {
    const requests = await Reimbursement.find({ gymId: req.gymId, staffId: req.user._id }).sort({ createdAt: -1 })
    res.json(requests)
  } catch (err) { next(err) }
})

/** POST /api/reimbursements/my — request reimbursement for a purchase/payment */
router.post('/my',
  [
    body('item').notEmpty().withMessage('Please describe what was purchased or which service was paid for'),
    body('date').isISO8601().withMessage('A valid date is required'),
    body('amount').isFloat({ min: 0.01 }).withMessage('Enter a valid amount'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const dateKey = istDateKey(req.body.date)
      if (dateKey > istDateKey(new Date())) return res.status(400).json({ message: "Can't log a future date" })

      const request = await Reimbursement.create({
        gymId: req.gymId,
        staffId: req.user._id,
        item: req.body.item,
        date: istDateTime(dateKey),
        amount: req.body.amount,
        note: req.body.note || '',
      })
      res.status(201).json(request)
    } catch (err) { next(err) }
  }
)

/** PATCH /api/reimbursements/my/:id/cancel — withdraw a still-pending request */
router.patch('/my/:id/cancel', async (req, res, next) => {
  try {
    const request = await Reimbursement.findOne({ _id: req.params.id, gymId: req.gymId, staffId: req.user._id })
    if (!request) return res.status(404).json({ message: 'Reimbursement request not found' })
    if (request.status !== 'pending') return res.status(400).json({ message: 'Only pending requests can be cancelled' })
    await request.deleteOne()
    res.json({ message: 'Cancelled' })
  } catch (err) { next(err) }
})

/* ── Approvals (owner / permitted manager) ───────────────────────────────── */

/** GET /api/reimbursements/pending */
router.get('/pending', requirePayroll('approve'), async (req, res, next) => {
  try {
    const requests = await Reimbursement.find({ gymId: req.gymId, status: 'pending' })
      .sort({ date: -1 })
      .populate('staffId', 'name role')
    res.json(requests)
  } catch (err) { next(err) }
})

/** GET /api/reimbursements — all, optionally filtered */
router.get('/', requirePayroll('view'), async (req, res, next) => {
  try {
    const filter = { gymId: req.gymId }
    if (req.query.staffId) filter.staffId = req.query.staffId
    if (req.query.status) filter.status = req.query.status
    const requests = await Reimbursement.find(filter).sort({ createdAt: -1 }).populate('staffId', 'name role')
    res.json(requests)
  } catch (err) { next(err) }
})

/** PATCH /api/reimbursements/:id/approve */
router.patch('/:id/approve', requirePayroll('approve'), async (req, res, next) => {
  try {
    const request = await Reimbursement.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!request) return res.status(404).json({ message: 'Reimbursement request not found' })
    if (request.status !== 'pending') return res.status(400).json({ message: 'Only pending requests can be approved' })

    request.status = 'approved'
    request.reviewedBy = req.user._id
    request.reviewedAt = new Date()
    request.reviewNote = req.body.reviewNote || ''
    await request.save()

    res.json(request)
  } catch (err) { next(err) }
})

/** PATCH /api/reimbursements/:id/reject */
router.patch('/:id/reject', requirePayroll('approve'), async (req, res, next) => {
  try {
    const request = await Reimbursement.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!request) return res.status(404).json({ message: 'Reimbursement request not found' })
    if (request.status !== 'pending') return res.status(400).json({ message: 'Only pending requests can be rejected' })

    request.status = 'rejected'
    request.reviewedBy = req.user._id
    request.reviewedAt = new Date()
    request.reviewNote = req.body.reason || ''
    await request.save()

    res.json(request)
  } catch (err) { next(err) }
})

/** PATCH /api/reimbursements/:id/mark-paid — record that the approved amount was actually paid out */
router.patch('/:id/mark-paid', requirePayroll('approve'), async (req, res, next) => {
  try {
    const request = await Reimbursement.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!request) return res.status(404).json({ message: 'Reimbursement request not found' })
    if (request.status !== 'approved') return res.status(400).json({ message: 'Only approved requests can be marked paid' })

    request.status = 'paid'
    request.paidAt = new Date()
    await request.save()

    res.json(request)
  } catch (err) { next(err) }
})

export default router
