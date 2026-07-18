import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import PTPlan from '../models/PTPlan.js'
import { protect, authorize } from '../middleware/auth.js'

const router = Router()

function validate(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) { res.status(400).json({ message: errors.array()[0].msg }); return false }
  return true
}

/** GET /api/pt-plans — active PT plan catalog for this gym */
router.get('/', protect, async (req, res, next) => {
  try {
    const plans = await PTPlan.find({ gymId: req.gymId, isActive: true })
      .populate('trainerId', 'name')
      .sort({ fee: 1 })
    res.json(plans)
  } catch (err) { next(err) }
})

router.post('/', protect, authorize('owner', 'manager'),
  [
    body('name').notEmpty().withMessage('Plan name required'),
    body('numberOfClasses').isInt({ min: 1 }).withMessage('Number of classes required'),
    body('durationDays').isInt({ min: 1 }).withMessage('Duration in days required'),
    body('fee').isFloat({ min: 0 }).withMessage('Fee required'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { name, description, numberOfClasses, durationDays, fee, target, trainerId } = req.body
      const plan = await PTPlan.create({
        gymId: req.gymId, name, description,
        numberOfClasses: Number(numberOfClasses),
        durationDays: Number(durationDays),
        fee: Number(fee),
        target: target || '',
        trainerId: trainerId || undefined,
      })
      await plan.populate('trainerId', 'name')
      res.status(201).json(plan)
    } catch (err) { next(err) }
  }
)

router.patch('/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const allowed = ['name', 'description', 'numberOfClasses', 'durationDays', 'fee', 'target', 'trainerId', 'isActive']
    const updates = {}
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k] })
    const plan = await PTPlan.findOneAndUpdate({ _id: req.params.id, gymId: req.gymId }, updates, { new: true, runValidators: true })
      .populate('trainerId', 'name')
    if (!plan) return res.status(404).json({ message: 'PT plan not found' })
    res.json(plan)
  } catch (err) { next(err) }
})

router.delete('/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    await PTPlan.findOneAndUpdate({ _id: req.params.id, gymId: req.gymId }, { isActive: false })
    res.json({ message: 'PT plan deactivated' })
  } catch (err) { next(err) }
})

export default router
