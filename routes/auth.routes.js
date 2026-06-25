import { Router }   from 'express'
import jwt          from 'jsonwebtoken'
import { body, validationResult } from 'express-validator'
import Gym  from '../models/Gym.js'
import User from '../models/User.js'
import { protect } from '../middleware/auth.js'

const router = Router()

const signAccess  = (id) => jwt.sign({ id }, process.env.JWT_SECRET,         { expiresIn: process.env.JWT_EXPIRES_IN  || '7d' })
const signRefresh = (id) => jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' })

function validate(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) { res.status(400).json({ message: errors.array()[0].msg }); return false }
  return true
}

// POST /api/auth/register
router.post('/register',
  [
    body('gymName').notEmpty().withMessage('Gym name is required'),
    body('subdomain').notEmpty().matches(/^[a-z0-9-]+$/).withMessage('Subdomain: lowercase letters, numbers, hyphens only'),
    body('name').notEmpty().withMessage('Your name is required'),
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { gymName, subdomain, name, email, password } = req.body

      if (await Gym.findOne({ subdomain })) {
        return res.status(409).json({ message: 'Subdomain already taken' })
      }

      const gym = await Gym.create({
        name: gymName, subdomain,
        plan: 'lite', planStatus: 'trialing',
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })

      const user = await User.create({ gymId: gym._id, name, email, passwordHash: password, role: 'owner' })
      gym.ownerUserId = user._id
      await gym.save()

      const accessToken  = signAccess(user._id)
      const refreshToken = signRefresh(user._id)
      user.refreshToken  = refreshToken
      await user.save({ validateBeforeSave: false })

      res.status(201).json({
        accessToken, refreshToken,
        user: { id: user._id, name: user.name, email: user.email, role: user.role },
        gym:  { id: gym._id,  name: gym.name,  subdomain: gym.subdomain, plan: gym.plan },
      })
    } catch (err) { next(err) }
  }
)

// POST /api/auth/login
router.post('/login',
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { email, password } = req.body
      const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash')

      if (!user || !(await user.comparePassword(password))) {
        return res.status(401).json({ message: 'Invalid email or password' })
      }
      if (!user.isActive) return res.status(403).json({ message: 'Account is deactivated' })

      const gym = await Gym.findById(user.gymId).select('name subdomain plan planStatus trialEndsAt')

      const accessToken  = signAccess(user._id)
      const refreshToken = signRefresh(user._id)
      user.refreshToken  = refreshToken
      user.lastLoginAt   = new Date()
      await user.save({ validateBeforeSave: false })

      res.json({
        accessToken, refreshToken,
        user: { id: user._id, name: user.name, email: user.email, role: user.role, gymId: user.gymId },
        gym,
      })
    } catch (err) { next(err) }
  }
)

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  const { refreshToken } = req.body
  if (!refreshToken) return res.status(401).json({ message: 'Refresh token required' })
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET)
    const user    = await User.findById(decoded.id).select('+refreshToken')

    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({ message: 'Invalid refresh token' })
    }

    const newAccess  = signAccess(user._id)
    const newRefresh = signRefresh(user._id)
    user.refreshToken = newRefresh
    await user.save({ validateBeforeSave: false })

    res.json({ accessToken: newAccess, refreshToken: newRefresh })
  } catch (err) { next(err) }
})

// POST /api/auth/logout
router.post('/logout', protect, async (req, res, next) => {
  try {
    req.user.refreshToken = undefined
    await req.user.save({ validateBeforeSave: false })
    res.json({ message: 'Logged out' })
  } catch (err) { next(err) }
})

// GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  const gym = await Gym.findById(req.gymId).select('name subdomain plan planStatus trialEndsAt')
  res.json({ user: req.user, gym })
})

export default router
