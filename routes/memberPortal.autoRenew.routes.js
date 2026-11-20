import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import Member from '../models/Member.js'
import { RENEWAL_LEAD_DAYS } from '../services/autoRenew.service.js'

const router = Router()
router.use(memberProtect)

const describe = (member) => ({
  enabled: !!member.autoRenew?.enabled,
  canEnable: !!member.currentPlanId,
  planName: member.currentPlanId?.name, price: member.currentPlanId?.price,
  expiry: member.membershipExpiryDate, leadDays: RENEWAL_LEAD_DAYS,
})

// GET /api/member-portal/auto-renew
router.get('/', async (req, res, next) => {
  try {
    const member = await Member.findOne({ _id: req.memberId, gymId: req.gymId }).populate('currentPlanId', 'name price')
    if (!member) return res.status(404).json({ message: 'Member not found' })
    res.json(describe(member))
  } catch (err) { next(err) }
})

// PUT /api/member-portal/auto-renew — { enabled: boolean }
router.put('/', async (req, res, next) => {
  try {
    if (typeof req.body.enabled !== 'boolean') return res.status(400).json({ message: 'enabled (true/false) required' })
    const member = await Member.findOne({ _id: req.memberId, gymId: req.gymId }).populate('currentPlanId', 'name price')
    if (!member) return res.status(404).json({ message: 'Member not found' })
    if (req.body.enabled && !member.currentPlanId) return res.status(400).json({ message: 'You need an active plan before turning on auto-renew.' })
    member.autoRenew = { enabled: req.body.enabled, lastNoticeForExpiry: undefined } // re-arm: the current expiry can be notified again
    await member.save({ validateBeforeSave: false })
    res.json(describe(member))
  } catch (err) { next(err) }
})

export default router
