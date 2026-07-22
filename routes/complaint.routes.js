import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import Complaint from '../models/Complaint.js'
import { protect, authorize } from '../middleware/auth.js'

const router = Router()

function validate(req, res) {
  const errs = validationResult(req)
  if (!errs.isEmpty()) { res.status(400).json({ message: errs.array()[0].msg }); return false }
  return true
}

// GET /api/complaints — gym owners/managers see everything raised by members
router.get('/', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const { status, type, page = 1, limit = 20 } = req.query
    const filter = { gymId: req.gymId }
    if (status) filter.status = status
    if (type) filter.type = type

    const [complaints, total, openCount] = await Promise.all([
      Complaint.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate('memberId', 'name phone email photo')
        .populate('responses.respondedBy', 'name'),
      Complaint.countDocuments(filter),
      Complaint.countDocuments({ gymId: req.gymId, status: { $in: ['open', 'in-progress'] } }),
    ])

    res.json({ complaints, total, page: Number(page), pages: Math.ceil(total / limit), openCount })
  } catch (err) { next(err) }
})

// GET /api/complaints/:id
router.get('/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const complaint = await Complaint.findOne({ _id: req.params.id, gymId: req.gymId })
      .populate('memberId', 'name phone email photo')
      .populate('responses.respondedBy', 'name')
    if (!complaint) return res.status(404).json({ message: 'Not found' })
    res.json(complaint)
  } catch (err) { next(err) }
})

// PATCH /api/complaints/:id — update status/priority
router.patch('/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const allowed = ['status', 'priority']
    const updates = {}
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k] })
    if (updates.status === 'resolved' || updates.status === 'closed') {
      updates.resolvedAt = new Date()
    }

    const complaint = await Complaint.findOneAndUpdate(
      { _id: req.params.id, gymId: req.gymId },
      updates,
      { new: true, runValidators: true }
    ).populate('memberId', 'name phone email photo').populate('responses.respondedBy', 'name')

    if (!complaint) return res.status(404).json({ message: 'Not found' })
    res.json(complaint)
  } catch (err) { next(err) }
})

// POST /api/complaints/:id/respond — staff reply, optionally moves to in-progress
router.post('/:id/respond', protect, authorize('owner', 'manager'),
  [body('text').notEmpty().withMessage('Response text is required')],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const complaint = await Complaint.findOne({ _id: req.params.id, gymId: req.gymId })
      if (!complaint) return res.status(404).json({ message: 'Not found' })

      complaint.responses.push({ text: req.body.text, respondedBy: req.user._id })
      if (complaint.status === 'open') complaint.status = 'in-progress'
      await complaint.save()

      await complaint.populate('memberId', 'name phone email photo')
      await complaint.populate('responses.respondedBy', 'name')
      res.status(201).json(complaint)
    } catch (err) { next(err) }
  }
)

export default router
