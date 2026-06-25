import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import MembershipPlan from '../models/MembershipPlan.js'
import { protect, authorize } from '../middleware/auth.js'

const router = Router()

function validate(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) { res.status(400).json({ message: errors.array()[0].msg }); return false }
  return true
}

router.get('/', protect, async (req, res, next) => {
  try {
    const plans = await MembershipPlan.find({ gymId: req.gymId, isActive: true }).sort({ price: 1 })
    res.json(plans)
  } catch (err) { next(err) }
})

router.post('/', protect, authorize('owner', 'manager'),
  [
    body('name').notEmpty().withMessage('Plan name required'),
    body('durationDays').isInt({ min: 1 }).withMessage('Duration in days required'),
    body('price').isFloat({ min: 0 }).withMessage('Price required'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { name, description, durationDays, price, sessionsIncluded } = req.body
      const plan = await MembershipPlan.create({
        gymId: req.gymId, name, description,
        durationDays: Number(durationDays), price: Number(price),
        sessionsIncluded: Number(sessionsIncluded) || 0,
      })
      res.status(201).json(plan)
    } catch (err) { next(err) }
  }
)

router.patch('/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const allowed = ['name','description','durationDays','price','sessionsIncluded','isActive']
    const updates = {}
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k] })
    const plan = await MembershipPlan.findOneAndUpdate({ _id: req.params.id, gymId: req.gymId }, updates, { new: true, runValidators: true })
    if (!plan) return res.status(404).json({ message: 'Plan not found' })
    res.json(plan)
  } catch (err) { next(err) }
})

router.delete('/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    await MembershipPlan.findOneAndUpdate({ _id: req.params.id, gymId: req.gymId }, { isActive: false })
    res.json({ message: 'Plan deactivated' })
  } catch (err) { next(err) }
})

export default router
