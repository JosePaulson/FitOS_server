import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import jwt from 'jsonwebtoken'
import MemberAuth from '../models/MemberAuth.js'
import Member from '../models/Member.js'
import Gym from '../models/Gym.js'
import { memberProtect } from '../middleware/memberAuth.js'
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import { getRpIdAndOrigin, WEBAUTHN_CHALLENGE_TTL_MS } from '../config/webauthn.js'

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

// Shared by both PIN login and WebAuthn login — issues tokens and shapes
// the same response either way, so the client doesn't need to care which
// method was used.
async function issueLoginResponse(auth, gym) {
  const member = await Member.findById(auth.memberId)
    .select('name phone email membershipStatus membershipExpiryDate currentPlanId photo createdAt')
    .populate('currentPlanId', 'name price durationDays')

  const accessToken = signAccess(auth._id)
  const refreshToken = signRefresh(auth._id)
  auth.refreshToken = refreshToken
  auth.lastLoginAt = new Date()
  await auth.save({ validateBeforeSave: false })

  return {
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
      createdAt: member.createdAt,
    },
    gym: {
      id: gym._id,
      name: gym.name,
      subdomain: gym.subdomain,
      logo: gym.logo,
    },
  }
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

      res.json(await issueLoginResponse(auth, gym))
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
    const gym = await Gym.findById(req.gymId).select('name subdomain logo settings location openingHours')
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

/* ── Fingerprint / biometric login (WebAuthn) ────────────────────────────
 * "Registration" (enrolling a device's fingerprint/face) happens from
 * within Profile settings, after the member is already signed in via
 * PIN — those two routes are memberProtect'd. "Login" (using an already-
 * registered device instead of typing the PIN) happens pre-auth, so
 * those two need the gym subdomain + phone to know whose credentials to
 * check against, same as the PIN login route above.
 * ──────────────────────────────────────────────────────────────────── */

/** POST /api/member-portal/auth/webauthn/login-options */
router.post('/webauthn/login-options',
  [body('subdomain').notEmpty(), body('phone').notEmpty()],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { subdomain, phone } = req.body
      const gym = await Gym.findOne({ subdomain: subdomain.toLowerCase().trim() })
      if (!gym) return res.status(404).json({ message: 'Gym not found. Check your gym subdomain.' })

      const auth = await MemberAuth.findOne({ gymId: gym._id, phone: phone.trim() })
      if (!auth || !auth.isActive || !auth.webauthnCredentials?.length) {
        return res.status(404).json({ message: 'No fingerprint login set up for this account yet.' })
      }

      const { rpID } = getRpIdAndOrigin(req)
      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: auth.webauthnCredentials.map((c) => ({ id: c.credentialId, transports: c.transports })),
        userVerification: 'preferred',
      })

      auth.webauthnChallenge = options.challenge
      auth.webauthnChallengeExpiresAt = new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS)
      await auth.save({ validateBeforeSave: false })

      res.json(options)
    } catch (err) { next(err) }
  }
)

/** POST /api/member-portal/auth/webauthn/login-verify */
router.post('/webauthn/login-verify',
  [body('subdomain').notEmpty(), body('phone').notEmpty(), body('response').notEmpty()],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { subdomain, phone, response } = req.body
      const gym = await Gym.findOne({ subdomain: subdomain.toLowerCase().trim() })
      if (!gym) return res.status(404).json({ message: 'Gym not found.' })

      const auth = await MemberAuth.findOne({ gymId: gym._id, phone: phone.trim() }).select('+webauthnChallenge +webauthnChallengeExpiresAt')
      if (!auth || !auth.isActive) return res.status(401).json({ message: 'Fingerprint login failed' })
      if (!auth.webauthnChallenge || auth.webauthnChallengeExpiresAt < new Date()) {
        return res.status(401).json({ message: 'That login attempt expired — try again.' })
      }

      const credential = auth.webauthnCredentials.find((c) => c.credentialId === response.id)
      if (!credential) return res.status(401).json({ message: 'Unrecognized device — try your PIN instead.' })

      const { rpID, origin } = getRpIdAndOrigin(req)
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: auth.webauthnChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: credential.credentialId,
          publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64')),
          counter: credential.counter,
          transports: credential.transports,
        },
      })
      if (!verification.verified) return res.status(401).json({ message: 'Fingerprint login failed' })

      credential.counter = verification.authenticationInfo.newCounter
      auth.webauthnChallenge = null
      auth.webauthnChallengeExpiresAt = null

      res.json(await issueLoginResponse(auth, gym))
    } catch (err) { next(err) }
  }
)

/** GET /api/member-portal/auth/webauthn — list this member's registered devices */
router.get('/webauthn', memberProtect, async (req, res, next) => {
  try {
    const auth = await MemberAuth.findById(req.memberAuth._id)
    res.json((auth.webauthnCredentials || []).map((c) => ({
      credentialId: c.credentialId,
      deviceName: c.deviceName,
      createdAt: c.createdAt,
    })))
  } catch (err) { next(err) }
})

/** POST /api/member-portal/auth/webauthn/register-options */
router.post('/webauthn/register-options', memberProtect, async (req, res, next) => {
  try {
    const auth = await MemberAuth.findById(req.memberAuth._id)
    const member = await Member.findById(req.memberId).select('name')
    const { rpID, rpName } = getRpIdAndOrigin(req)

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: auth.phone,
      userID: Buffer.from(auth._id.toString()),
      userDisplayName: member?.name || auth.phone,
      attestationType: 'none',
      excludeCredentials: (auth.webauthnCredentials || []).map((c) => ({ id: c.credentialId, transports: c.transports })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred', authenticatorAttachment: 'platform' },
    })

    auth.webauthnChallenge = options.challenge
    auth.webauthnChallengeExpiresAt = new Date(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS)
    await auth.save({ validateBeforeSave: false })

    res.json(options)
  } catch (err) { next(err) }
})

/** POST /api/member-portal/auth/webauthn/register-verify */
router.post('/webauthn/register-verify',
  memberProtect,
  [body('response').notEmpty()],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { response, deviceName } = req.body
      const auth = await MemberAuth.findById(req.memberAuth._id).select('+webauthnChallenge +webauthnChallengeExpiresAt')
      if (!auth.webauthnChallenge || auth.webauthnChallengeExpiresAt < new Date()) {
        return res.status(400).json({ message: 'That setup attempt expired — try again.' })
      }

      const { rpID, origin } = getRpIdAndOrigin(req)
      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: auth.webauthnChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      })
      if (!verification.verified) return res.status(400).json({ message: 'Could not verify your device — try again.' })

      const { credential } = verification.registrationInfo
      auth.webauthnCredentials.push({
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64'),
        counter: credential.counter,
        transports: credential.transports || [],
        deviceName: deviceName?.trim() || 'This device',
      })
      auth.webauthnChallenge = null
      auth.webauthnChallengeExpiresAt = null
      await auth.save({ validateBeforeSave: false })

      res.status(201).json({ message: 'Fingerprint login enabled for this device' })
    } catch (err) { next(err) }
  }
)

/** DELETE /api/member-portal/auth/webauthn/:credentialId — turn off fingerprint login for one device */
router.delete('/webauthn/:credentialId', memberProtect, async (req, res, next) => {
  try {
    const auth = await MemberAuth.findById(req.memberAuth._id)
    auth.webauthnCredentials = (auth.webauthnCredentials || []).filter((c) => c.credentialId !== req.params.credentialId)
    await auth.save({ validateBeforeSave: false })
    res.json({ message: 'Removed' })
  } catch (err) { next(err) }
})

export default router
