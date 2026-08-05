import { Router }   from 'express'
import jwt          from 'jsonwebtoken'
import crypto       from 'crypto'
import bcrypt        from 'bcryptjs'
import { body, validationResult } from 'express-validator'
import Gym  from '../models/Gym.js'
import User from '../models/User.js'
import { protect } from '../middleware/auth.js'
import { seedPrebuiltPlansForGym } from '../utils/seedPrebuiltPlans.js'
import { sendEmail } from '../services/email.service.js'

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

      // Give the new gym a ready-to-use starter library of workout/diet
      // plans so the dashboard isn't empty on day one. Non-blocking — a
      // seeding hiccup should never stop registration from completing.
      seedPrebuiltPlansForGym(gym._id).catch((e) =>
        console.error('[register] Failed to seed prebuilt plans:', e.message)
      )

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

// PATCH /api/auth/change-password — signed-in user changes their own password
router.patch('/change-password',
  protect,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const user = await User.findById(req.user._id).select('+passwordHash')
      const ok = await user.comparePassword(req.body.currentPassword)
      if (!ok) return res.status(401).json({ message: 'Current password is incorrect' })

      // User.passwordHash isn't auto-hashed by a pre-save hook in this
      // schema, so hash it explicitly here to match comparePassword's
      // bcrypt.compare usage.
      user.passwordHash = await bcrypt.hash(req.body.newPassword, 10)
      // Rotate the refresh token so other sessions are signed out.
      user.refreshToken = undefined
      await user.save({ validateBeforeSave: false })

      res.json({ message: 'Password changed successfully' })
    } catch (err) { next(err) }
  }
)

// POST /api/auth/forgot-password — request a reset link by email
router.post('/forgot-password',
  [body('email').isEmail().withMessage('Valid email required')],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const user = await User.findOne({ email: req.body.email.toLowerCase() })

      // Always respond the same way whether or not the email exists, so
      // this endpoint can't be used to enumerate registered accounts.
      const genericResponse = { message: 'If an account exists for that email, a reset link has been sent.' }
      if (!user) return res.json(genericResponse)

      const rawToken = crypto.randomBytes(32).toString('hex')
      user.resetPasswordToken = crypto.createHash('sha256').update(rawToken).digest('hex')
      user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour
      await user.save({ validateBeforeSave: false })

      const gym = await Gym.findById(user.gymId).select('name')
      const resetUrl = `${process.env.CLIENT_URL || ''}/reset-password/${rawToken}`

      sendEmail({
        to: user.email,
        subject: 'Reset your FitOS password',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
            <h2 style="margin:0 0 8px">Reset your password</h2>
            <p style="color:#555">We received a request to reset the password for your ${gym?.name || 'FitOS'} account.</p>
            <p style="margin:24px 0">
              <a href="${resetUrl}" style="display:inline-block;background:#C8F135;color:#0D0D0D;font-weight:700;padding:10px 20px;border-radius:8px;text-decoration:none">Reset password</a>
            </p>
            <p style="color:#888;font-size:13px">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
          </div>
        `,
      }).catch((e) => console.error('[forgot-password] Failed to send email:', e.message))

      res.json(genericResponse)
    } catch (err) { next(err) }
  }
)

// POST /api/auth/reset-password/:token — set a new password using a reset link
router.post('/reset-password/:token',
  [body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex')
      const user = await User.findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { $gt: new Date() },
      }).select('+resetPasswordToken +resetPasswordExpires')

      if (!user) return res.status(400).json({ message: 'This reset link is invalid or has expired' })

      user.passwordHash = await bcrypt.hash(req.body.password, 10)
      user.resetPasswordToken = undefined
      user.resetPasswordExpires = undefined
      user.refreshToken = undefined // sign out existing sessions
      await user.save({ validateBeforeSave: false })

      res.json({ message: 'Password reset successfully. You can now sign in.' })
    } catch (err) { next(err) }
  }
)

// GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  const gym = await Gym.findById(req.gymId).select('name subdomain plan planStatus trialEndsAt')
  res.json({ user: req.user, gym })
})

export default router
