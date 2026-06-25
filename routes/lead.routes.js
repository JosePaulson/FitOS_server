import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import Lead from '../models/Lead.js'
import { protect, authorize } from '../middleware/auth.js'
import { sendLeadAckEmail }   from '../services/email.service.js'

const router = Router()

function validate(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) { res.status(400).json({ message: errors.array()[0].msg }); return false }
  return true
}

const INTEREST_MAP = {
  'Free trial':     'free-trial',
  'Product demo':   'product-demo',
  'Pricing info':   'pricing-info',
  'Migration help': 'migration-help',
}

// POST /api/leads/enquiry — public
router.post('/enquiry',
  [
    body('name').notEmpty().withMessage('Name is required'),
    body('phone').notEmpty().withMessage('Phone is required'),
    body('email').isEmail().withMessage('Valid email required'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { name, phone, email, gymName, memberRange, interest, message } = req.body
      const lead = await Lead.create({
        gymId: null, name, phone, email, gymName, memberRange,
        interest: INTEREST_MAP[interest] || 'free-trial',
        message, source: 'landing-page', stage: 'new',
      })
      sendLeadAckEmail({ to: email, name }).catch(console.error)
      res.status(201).json({ message: 'Enquiry received!', id: lead._id })
    } catch (err) { next(err) }
  }
)

// GET /api/leads
router.get('/', protect, async (req, res, next) => {
  try {
    const { stage, page = 1, limit = 20 } = req.query
    const filter = { gymId: req.gymId }
    if (stage) filter.stage = stage

    const [leads, total] = await Promise.all([
      Lead.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit)).populate('assignedTo', 'name'),
      Lead.countDocuments(filter),
    ])
    res.json({ leads, total, page: Number(page), pages: Math.ceil(total / limit) })
  } catch (err) { next(err) }
})

// GET /api/leads/:id
router.get('/:id', protect, async (req, res, next) => {
  try {
    const lead = await Lead.findOne({ _id: req.params.id, gymId: req.gymId }).populate('assignedTo', 'name email')
    if (!lead) return res.status(404).json({ message: 'Lead not found' })
    res.json(lead)
  } catch (err) { next(err) }
})

// PATCH /api/leads/:id
router.patch('/:id', protect, async (req, res, next) => {
  try {
    const updates = {}
    ;['stage', 'assignedTo', 'interest'].forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k] })
    if (updates.stage === 'converted') updates.convertedAt = new Date()

    const lead = await Lead.findOneAndUpdate({ _id: req.params.id, gymId: req.gymId }, updates, { new: true, runValidators: true })
    if (!lead) return res.status(404).json({ message: 'Lead not found' })
    res.json(lead)
  } catch (err) { next(err) }
})

// POST /api/leads/:id/notes
router.post('/:id/notes', protect, async (req, res, next) => {
  try {
    const { text } = req.body
    if (!text) return res.status(400).json({ message: 'Note text is required' })
    const lead = await Lead.findOneAndUpdate(
      { _id: req.params.id, gymId: req.gymId },
      { $push: { notes: { text, createdBy: req.user._id } } },
      { new: true }
    )
    if (!lead) return res.status(404).json({ message: 'Lead not found' })
    res.json(lead)
  } catch (err) { next(err) }
})

// DELETE /api/leads/:id
router.delete('/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    await Lead.findOneAndDelete({ _id: req.params.id, gymId: req.gymId })
    res.json({ message: 'Lead deleted' })
  } catch (err) { next(err) }
})

export default router
