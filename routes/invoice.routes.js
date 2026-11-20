import { Router } from 'express'
import Invoice from '../models/Invoice.js'
import { protect, authorize } from '../middleware/auth.js'
import { permit } from '../services/permissions.service.js'
import Member from '../models/Member.js'
import Gym from '../models/Gym.js'
import { fulfillInvoicePayment, recordInvoicePayment } from '../services/paymentFulfillment.service.js'
import { createPaymentLink, isRazorpayConfigured } from '../services/razorpay.service.js'
import { streamInvoicePdf } from '../services/invoicePdf.service.js'

const router = Router()

// GET /api/invoices
router.get('/', protect, permit('billing.view'), async (req, res, next) => {
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
        .populate('planId',   'name durationDays')
        .populate('ptPlanId', 'name numberOfClasses durationDays'),
      Invoice.countDocuments(filter),
    ])
    res.json({ invoices, total, page: Number(page), pages: Math.ceil(total / limit) })
  } catch (err) { next(err) }
})

// GET /api/invoices/stats/revenue — sum totalAmount (tax-inclusive)
router.get('/stats/revenue', protect, permit('revenue.view'), async (req, res, next) => {
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
router.get('/:id', protect, permit('billing.view'), async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, gymId: req.gymId })
      .populate('memberId', 'name phone email')
      .populate('planId',   'name durationDays price taxRate')
      .populate('ptPlanId', 'name numberOfClasses durationDays fee')
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' })
    res.json(invoice)
  } catch (err) { next(err) }
})

// PATCH /api/invoices/:id/mark-paid
router.patch('/:id/mark-paid', protect, permit('billing.collect'), async (req, res, next) => {
  try {
    const { paymentMethod = 'cash', notes } = req.body
    const invoice = await Invoice.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' })
    if (invoice.status === 'paid') return res.status(400).json({ message: 'Invoice is already paid' })

    // Covers two cases identically: an ordinary front-desk invoice (already
    // fulfilled at creation — this just records payment), and a member's
    // self-checkout invoice they abandoned online and paid in person
    // instead (not yet fulfilled — this also activates the membership/PT
    // plan, same as if they'd finished paying online).
    await fulfillInvoicePayment({ invoiceId: invoice._id, method: paymentMethod })

    if (notes !== undefined) {
      invoice.notes = notes
      await invoice.save()
    }

    const updated = await Invoice.findById(invoice._id)
      .populate('memberId', 'name phone')
      .populate('planId',   'name durationDays')
      .populate('ptPlanId', 'name numberOfClasses durationDays')
    res.json(updated)
  } catch (err) { next(err) }
})

const populateInvoice = (q) => q
  .populate('memberId', 'name phone')
  .populate('planId',   'name durationDays')
  .populate('ptPlanId', 'name numberOfClasses durationDays')

// POST /api/invoices/:id/payments — record a (part) payment received at the front desk
// Body: { amount, method?, note? }. The instalment that clears the balance marks the
// invoice paid (and activates anything waiting on payment); earlier ones leave it 'partial'.
router.post('/:id/payments', protect, permit('billing.collect'), async (req, res, next) => {
  try {
    const exists = await Invoice.exists({ _id: req.params.id, gymId: req.gymId })
    if (!exists) return res.status(404).json({ message: 'Invoice not found' })

    const { amount, method = 'cash', note } = req.body
    await recordInvoicePayment({
      invoiceId: req.params.id, amount, method, note, receivedBy: req.user?._id,
    })
    res.json(await populateInvoice(Invoice.findById(req.params.id)))
  } catch (err) { next(err) }
})

// POST /api/invoices/:id/payment-link — Razorpay hosted link for the balance due,
// ready to share over WhatsApp/SMS. Reuses a still-valid link for the same balance.
router.post('/:id/payment-link', protect, permit('billing.collect'), async (req, res, next) => {
  try {
    if (!isRazorpayConfigured()) {
      return res.status(503).json({ message: 'Online payments aren\u2019t set up yet, so a payment link can\u2019t be created.' })
    }
    const invoice = await Invoice.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' })
    if (!['pending', 'partial', 'overdue'].includes(invoice.status)) {
      return res.status(400).json({ message: `This invoice is ${invoice.status} \u2014 nothing left to collect.` })
    }
    const balance = invoice.balanceDue
    if (!(balance > 0)) return res.status(400).json({ message: 'Nothing left to collect on this invoice.' })

    const LINK_TTL_MS = 13 * 24 * 60 * 60 * 1000 // links are created with a 14-day expiry
    const link = invoice.paymentLink
    if (link?.url && link.amount === balance && link.createdAt && Date.now() - link.createdAt.getTime() < LINK_TTL_MS) {
      return res.json({ url: link.url, amount: balance, reused: true })
    }

    const [member, gym] = await Promise.all([
      Member.findById(invoice.memberId).select('name phone email'),
      Gym.findById(req.gymId).select('name'),
    ])
    const created = await createPaymentLink({
      amount: balance,
      referenceId: `${invoice._id}-${Date.now().toString(36)}`,
      description: `Invoice ${invoice.invoiceNumber} - ${gym?.name || 'Gym'}`,
      customer: { name: member?.name, phone: member?.phone, email: member?.email },
      notes: { invoiceId: invoice._id.toString(), gymId: String(req.gymId) },
    })

    invoice.paymentLink = { id: created.id, url: created.short_url, amount: balance, createdAt: new Date() }
    await invoice.save()
    res.json({ url: created.short_url, amount: balance })
  } catch (err) { next(err) }
})

// GET /api/invoices/:id/pdf — GST invoice PDF
router.get('/:id/pdf', protect, permit('billing.view'), async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, gymId: req.gymId })
      .populate('planId', 'name').populate('ptPlanId', 'name')
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' })
    const [member, gym] = await Promise.all([
      Member.findById(invoice.memberId).select('name phone email'),
      Gym.findById(req.gymId).select('name address city state phone settings.gst'),
    ])
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber || 'invoice'}.pdf"`)
    streamInvoicePdf({ invoice, member, gym }, res)
  } catch (err) { next(err) }
})

export default router
