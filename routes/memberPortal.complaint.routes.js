import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import { memberProtect } from '../middleware/memberAuth.js'
import Complaint from '../models/Complaint.js'

const router = Router()
router.use(memberProtect)

function validate(req, res) {
  const errs = validationResult(req)
  if (!errs.isEmpty()) { res.status(400).json({ message: errs.array()[0].msg }); return false }
  return true
}

// GET /api/member-portal/complaints — the member's own complaints/requests
router.get('/', async (req, res, next) => {
  try {
    const complaints = await Complaint.find({ gymId: req.gymId, memberId: req.memberId })
      .sort({ createdAt: -1 })
      .populate('responses.respondedBy', 'name')
    res.json(complaints)
  } catch (err) { next(err) }
})

// POST /api/member-portal/complaints — raise a new complaint or request
router.post('/',
  [
    body('subject').trim().notEmpty().withMessage('Subject is required'),
    body('message').trim().notEmpty().withMessage('Please describe your complaint or request'),
    body('type').optional().isIn(['complaint', 'request']),
    body('category').optional().isIn(['trainer', 'staff', 'equipment', 'cleanliness', 'facility', 'billing', 'class-schedule', 'other']),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { subject, message, type, category } = req.body
      const complaint = await Complaint.create({
        gymId: req.gymId,
        memberId: req.memberId,
        subject, message,
        type: type || 'complaint',
        category: category || 'other',
      })
      res.status(201).json(complaint)
    } catch (err) { next(err) }
  }
)

export default router
