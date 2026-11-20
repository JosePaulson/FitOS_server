import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import Member from '../models/Member.js'
import { ensureReferralCode, getReferralSettings } from '../services/referral.service.js'

const router = Router()
router.use(memberProtect)

/**
 * GET /api/member-portal/referral
 * The member's shareable code plus what the programme offers. `enabled: false`
 * lets the app hide the card entirely for gyms that haven't switched it on.
 */
router.get('/', async (req, res, next) => {
  try {
    const settings = await getReferralSettings(req.gymId)
    if (!settings.enabled) return res.json({ enabled: false })

    const member = await Member.findOne({ _id: req.memberId, gymId: req.gymId })
    if (!member) return res.status(404).json({ message: 'Member not found' })
    const code = await ensureReferralCode(member)

    const [referred, rewarded] = await Promise.all([
      Member.countDocuments({ gymId: req.gymId, referredBy: member._id }),
      Member.countDocuments({ gymId: req.gymId, referredBy: member._id, referralRewardGrantedAt: { $exists: true } }),
    ])
    res.json({ enabled: true, code, referred, rewarded, ...settings })
  } catch (err) { next(err) }
})

export default router
