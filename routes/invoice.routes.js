import { Router } from 'express'
import Invoice from '../models/Invoice.js'
import { protect, authorize } from '../middleware/auth.js'

const router = Router()

// GET /api/invoices
router.get('/', protect, async (req, res, next) => {
  try {
    const { memberId, status, page = 1, limit = 20 } = req.query
    const filter = { gymId: req.gymId }
    if (memberId) filter.memberId = memberId
    if (status)   filter.status   = status

    const [invoices, total] = await Promise.all([
      Invoice.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate('memberId', 'name phone')
        .populate('planId',   'name durationDays'),
      Invoice.countDocuments(filter),
    ])
    res.json({ invoices, total, page: Number(page), pages: Math.ceil(total / limit) })
  } catch (err) { next(err) }
})

// GET /api/invoices/stats/revenue — sum totalAmount (tax-inclusive)
router.get('/stats/revenue', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const months = await Invoice.aggregate([
      { $match: { gymId: req.gymId, status: 'paid' } },
      {
        $group: {
          _id:      { year: { $year: '$paidAt' }, month: { $month: '$paidAt' } },
          revenue:  { $sum: '$totalAmount' },   // tax-inclusive total
          taxCollected: { $sum: '$taxAmount' }, // GST portion for records
          count:    { $sum: 1 },
        },
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 12 },
    ])
    res.json(months)
  } catch (err) { next(err) }
})

// GET /api/invoices/:id
router.get('/:id', protect, async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, gymId: req.gymId })
      .populate('memberId', 'name phone email')
      .populate('planId',   'name durationDays price taxRate')
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' })
    res.json(invoice)
  } catch (err) { next(err) }
})

// PATCH /api/invoices/:id/mark-paid
router.patch('/:id/mark-paid', protect, authorize('owner', 'manager', 'receptionist'), async (req, res, next) => {
  try {
    const { paymentMethod = 'cash', notes } = req.body
    const invoice = await Invoice.findOneAndUpdate(
      { _id: req.params.id, gymId: req.gymId },
      { status: 'paid', paidAt: new Date(), paymentMethod, notes },
      { new: true }
    )
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' })
    res.json(invoice)
  } catch (err) { next(err) }
})

export default router
