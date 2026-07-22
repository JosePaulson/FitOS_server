import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import MembershipPlan from '../models/MembershipPlan.js'
import { protect, authorize } from '../middleware/auth.js'
import { approxDurationDays } from '../utils/planDuration.js'

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
    body('durationValue').isInt({ min: 1 }).withMessage('Duration value required'),
    body('durationUnit').optional().isIn(['days', 'months']).withMessage('Duration unit must be days or months'),
    body('price').isFloat({ min: 0 }).withMessage('Price required'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { name, description, durationValue, durationUnit, price, sessionsIncluded } = req.body
      const plan = await MembershipPlan.create({
        gymId: req.gymId, name, description,
        durationValue: Number(durationValue),
        durationUnit: durationUnit || 'days',
        price: Number(price),
        sessionsIncluded: Number(sessionsIncluded) || 0,
      })
      res.status(201).json(plan)
    } catch (err) { next(err) }
  }
)

router.patch('/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const allowed = ['name','description','durationValue','durationUnit','price','sessionsIncluded','isActive']
    const updates = {}
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k] })

    // findOneAndUpdate bypasses document middleware, so recompute the
    // legacy display field ourselves whenever duration inputs change.
    if (updates.durationValue !== undefined || updates.durationUnit !== undefined) {
      const existing = await MembershipPlan.findOne({ _id: req.params.id, gymId: req.gymId })
      if (!existing) return res.status(404).json({ message: 'Plan not found' })
      const unit  = updates.durationUnit  ?? existing.durationUnit
      const value = updates.durationValue ?? existing.durationValue
      updates.durationDays = approxDurationDays(unit, value)
    }

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
