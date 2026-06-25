import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import User from '../models/User.js'
import { protect, authorize } from '../middleware/auth.js'

const router = Router()

function validate(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) { res.status(400).json({ message: errors.array()[0].msg }); return false }
  return true
}

router.get('/', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const staff = await User.find({ gymId: req.gymId }).select('-passwordHash -refreshToken -resetPasswordToken').sort({ createdAt: -1 })
    res.json(staff)
  } catch (err) { next(err) }
})

router.post('/', protect, authorize('owner'),
  [
    body('name').notEmpty().withMessage('Name required'),
    body('email').isEmail().withMessage('Valid email required'),
    body('role').isIn(['manager', 'trainer', 'receptionist']).withMessage('Invalid role'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { name, email, role, password } = req.body
      const exists = await User.findOne({ gymId: req.gymId, email: email.toLowerCase() })
      if (exists) return res.status(409).json({ message: 'A staff member with this email already exists' })

      const user = await User.create({ gymId: req.gymId, name, email, role, passwordHash: password })
      res.status(201).json({ id: user._id, name: user.name, email: user.email, role: user.role, isActive: user.isActive, createdAt: user.createdAt })
    } catch (err) { next(err) }
  }
)

router.patch('/:id', protect, authorize('owner'), async (req, res, next) => {
  try {
    if (req.params.id === req.user._id.toString()) return res.status(400).json({ message: 'You cannot edit your own role' })
    const allowed = ['role', 'isActive', 'name']
    const updates = {}
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k] })
    const user = await User.findOneAndUpdate({ _id: req.params.id, gymId: req.gymId }, updates, { new: true }).select('-passwordHash -refreshToken')
    if (!user) return res.status(404).json({ message: 'Staff member not found' })
    res.json(user)
  } catch (err) { next(err) }
})

router.delete('/:id', protect, authorize('owner'), async (req, res, next) => {
  try {
    if (req.params.id === req.user._id.toString()) return res.status(400).json({ message: 'You cannot remove yourself' })
    await User.findOneAndUpdate({ _id: req.params.id, gymId: req.gymId }, { isActive: false })
    res.json({ message: 'Staff member deactivated' })
  } catch (err) { next(err) }
})

export default router
