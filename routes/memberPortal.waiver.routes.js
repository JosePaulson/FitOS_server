import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import Member from '../models/Member.js'
import { getWaiverConfig, waiverStatus, signWaiver } from '../services/waiver.service.js'

const router = Router()
router.use(memberProtect)

/**
 * GET /api/member-portal/waiver
 * `enabled: false` lets the app hide every waiver prompt for gyms that don't use one.
 */
router.get('/', async (req, res, next) => {
  try {
    const cfg = await getWaiverConfig(req.gymId)
    if (!cfg.enabled) return res.json({ enabled: false })
    const member = await Member.findOne({ _id: req.memberId, gymId: req.gymId })
    if (!member) return res.status(404).json({ message: 'Member not found' })
    res.json({ enabled: true, ...cfg, ...waiverStatus(member, cfg), memberName: member.name })
  } catch (err) { next(err) }
})

// POST /api/member-portal/waiver/sign — { answers, signedName, guardianName?, signature?, agreed }
router.post('/sign', async (req, res, next) => {
  try {
    const member = await Member.findOne({ _id: req.memberId, gymId: req.gymId })
    if (!member) return res.status(404).json({ message: 'Member not found' })
    const { answers, signedName, guardianName, signature, agreed } = req.body
    const waiver = await signWaiver({
      gymId: req.gymId, member, answers, signedName, guardianName, signature, agreed,
      via: 'member-portal', ip: req.ip, userAgent: req.get('user-agent'),
    })
    res.status(201).json({ ok: true, parqFlagged: waiver.parqFlagged, signedAt: waiver.signedAt })
  } catch (err) { next(err) }
})

export default router
