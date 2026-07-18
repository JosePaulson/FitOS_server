import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import jwt from 'jsonwebtoken'
import MemberAuth from '../models/MemberAuth.js'
import Member from '../models/Member.js'
import Gym from '../models/Gym.js'
import { memberProtect } from '../middleware/memberAuth.js'

const router = Router()

const signAccess = (id) => jwt.sign(
  { id },
  process.env.MEMBER_JWT_SECRET || process.env.JWT_SECRET,
  { expiresIn: '1d' }
)
const signRefresh = (id) => jwt.sign(
  { id },
  process.env.MEMBER_JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET,
  { expiresIn: '30d' }
)

function validate(req, res) {
  const errs = validationResult(req)
  if (!errs.isEmpty()) { res.status(400).json({ message: errs.array()[0].msg }); return false }
  return true
}

/**
 * POST /api/member-portal/auth/login
 * Members log in with phone + PIN.
 * They must provide the gym subdomain so we can scope the lookup.
 */
router.post('/login',
  [
    body('subdomain').notEmpty().withMessage('Gym subdomain required'),
    body('phone').notEmpty().withMessage('Phone number required'),
    body('pin').isLength({ min: 4, max: 6 }).withMessage('PIN must be 4–6 digits'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { subdomain, phone, pin } = req.body
      console.log(req.body)

      const gym = await Gym.findOne({ subdomain: subdomain.toLowerCase().trim() })
      if (!gym) return res.status(404).json({ message: 'Gym not found. Check your gym subdomain.' })

      const auth = await MemberAuth.findOne({ gymId: gym._id, phone: phone.trim() }).select('+pinHash')
      if (!auth || !(await auth.comparePin(pin))) {
        return res.status(401).json({ message: 'Incorrect phone or PIN' })
      }
      if (!auth.isActive) {
        return res.status(403).json({ message: 'Your account has been deactivated. Contact your gym.' })
      }

      const member = await Member.findById(auth.memberId)
        .select('name phone email membershipStatus membershipExpiryDate currentPlanId photo createdAt')
        .populate('currentPlanId', 'name price durationDays')

      const accessToken = signAccess(auth._id)
      const refreshToken = signRefresh(auth._id)
      auth.refreshToken = refreshToken
      auth.lastLoginAt = new Date()
      await auth.save({ validateBeforeSave: false })

      res.json({
        accessToken,
        refreshToken,
        member: {
          id: member._id,
          name: member.name,
          phone: member.phone,
          email: member.email,
          photo: member.photo,
          membershipStatus: member.membershipStatus,
          membershipExpiryDate: member.membershipExpiryDate,
          currentPlanId: member.currentPlanId,
          createdAt: member.createdAt
        },
        gym: {
          id: gym._id,
          name: gym.name,
          subdomain: gym.subdomain,
          logo: gym.logo,
        },
      })
    } catch (err) { next(err) }
  }
)

/**
 * POST /api/member-portal/auth/refresh
 */
router.post('/refresh', async (req, res, next) => {
  const { refreshToken } = req.body
  if (!refreshToken) return res.status(401).json({ message: 'Refresh token required' })
  try {
    const secret = process.env.MEMBER_JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET
    const decoded = jwt.verify(refreshToken, secret)
    const auth = await MemberAuth.findById(decoded.id).select('+refreshToken')

    if (!auth || auth.refreshToken !== refreshToken) {
      return res.status(401).json({ message: 'Invalid refresh token' })
    }

    const newAccess = signAccess(auth._id)
    const newRefresh = signRefresh(auth._id)
    auth.refreshToken = newRefresh
    await auth.save({ validateBeforeSave: false })

    res.json({ accessToken: newAccess, refreshToken: newRefresh })
  } catch (err) { next(err) }
})

/**
 * POST /api/member-portal/auth/logout
 */
router.post('/logout', memberProtect, async (req, res, next) => {
  try {
    req.memberAuth.refreshToken = undefined
    await req.memberAuth.save({ validateBeforeSave: false })
    res.json({ message: 'Logged out' })
  } catch (err) { next(err) }
})

/**
 * GET /api/member-portal/auth/me
 */
router.get('/me', memberProtect, async (req, res, next) => {
  try {
    const member = await Member.findById(req.memberId)
      .populate('currentPlanId', 'name price durationDays taxRate')
    const gym = await Gym.findById(req.gymId).select('name subdomain logo settings location')
    res.json({ member, gym })
  } catch (err) { next(err) }
})

/**
 * POST /api/member-portal/auth/set-pin
 * Staff sets a member's PIN (or member changes their own PIN after login).
 */
router.post('/set-pin',
  [
    body('memberId').notEmpty().withMessage('memberId required'),
    body('gymId').notEmpty().withMessage('gymId required'),
    body('pin').isLength({ min: 4, max: 6 }).withMessage('PIN must be 4–6 digits'),
  ],
  async (req, res, next) => {
    try {
      const { memberId, gymId, pin } = req.body
      const member = await Member.findOne({ _id: memberId, gymId })
      if (!member) return res.status(404).json({ message: 'Member not found' })

      // Upsert — create if first time, update if changing PIN
      await MemberAuth.findOneAndUpdate(
        { gymId, memberId },
        {
          gymId, memberId,
          phone: member.phone,
          email: member.email,
          pinHash: pin,       // hashed by pre-save hook
          isActive: true,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: false }
      ).then(async (doc) => {
        // Manually hash since upsert bypasses pre-save
        const bcrypt = (await import('bcryptjs')).default
        doc.pinHash = await bcrypt.hash(pin, 10)
        console.log(doc.pinHash)
        await doc.save({ validateBeforeSave: false })
      })

      res.json({ message: `PIN set for ${member.name}` })
    } catch (err) { next(err) }
  }
)

/**
 * POST /api/member-portal/auth/change-pin
 * Member changes their own PIN after verifying the old one.
 */
router.post('/change-pin', memberProtect,
  [
    body('currentPin').notEmpty().withMessage('Current PIN required'),
    body('newPin').isLength({ min: 4, max: 6 }).withMessage('New PIN must be 4–6 digits'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { currentPin, newPin } = req.body
      const auth = await MemberAuth.findById(req.memberAuth._id).select('+pinHash')

      if (!(await auth.comparePin(currentPin))) {
        return res.status(401).json({ message: 'Current PIN is incorrect' })
      }

      const bcrypt = (await import('bcryptjs')).default
      auth.pinHash = await bcrypt.hash(newPin, 10)
      await auth.save({ validateBeforeSave: false })

      res.json({ message: 'PIN changed successfully' })
    } catch (err) { next(err) }
  }
)

export default router
