import { Router } from 'express'
import Member from '../models/Member.js'
import MemberWaiver from '../models/MemberWaiver.js'
import Gym from '../models/Gym.js'
import { protect } from '../middleware/auth.js'
import { permit } from '../services/permissions.service.js'
import { getWaiverConfig, waiverStatus, signWaiver } from '../services/waiver.service.js'
import { streamWaiverPdf } from '../services/waiverPdf.service.js'

const router = Router()

// GET /api/waivers/config — is the waiver on, which wording/version, PAR-Q questions
router.get('/config', protect, async (req, res, next) => {
  try { res.json(await getWaiverConfig(req.gymId)) } catch (err) { next(err) }
})

// GET /api/waivers/member/:memberId — a member's latest signed waiver + where they stand
router.get('/member/:memberId', protect, async (req, res, next) => {
  try {
    const member = await Member.findOne({ _id: req.params.memberId, gymId: req.gymId })
    if (!member) return res.status(404).json({ message: 'Member not found' })
    const cfg = await getWaiverConfig(req.gymId)
    const latest = await MemberWaiver.findOne({ gymId: req.gymId, memberId: member._id }).sort({ signedAt: -1 }).lean()
    let waiver = null
    if (latest) {
      const { signature, ...rest } = latest // image is only needed in the PDF
      waiver = { ...rest, hasSignature: !!signature }
    }
    res.json({ status: waiverStatus(member, cfg), waiver, member: { _id: member._id, name: member.name } })
  } catch (err) { next(err) }
})

// POST /api/waivers/member/:memberId/sign — collect the waiver at the front desk
// Body: { answers: boolean[7], signedName, guardianName?, signature?: PNG data URL, agreed: true }
router.post('/member/:memberId/sign', protect, permit('waivers.sign'), async (req, res, next) => {
  try {
    const member = await Member.findOne({ _id: req.params.memberId, gymId: req.gymId })
    if (!member) return res.status(404).json({ message: 'Member not found' })
    const { answers, signedName, guardianName, signature, agreed } = req.body
    const waiver = await signWaiver({
      gymId: req.gymId, member, answers, signedName, guardianName, signature, agreed,
      via: 'front-desk', receivedBy: req.user._id, ip: req.ip, userAgent: req.get('user-agent'),
    })
    res.status(201).json({ ok: true, parqFlagged: waiver.parqFlagged, signedAt: waiver.signedAt })
  } catch (err) { next(err) }
})

// GET /api/waivers/member/:memberId/pdf — the signed record as a PDF
router.get('/member/:memberId/pdf', protect, async (req, res, next) => {
  try {
    const member = await Member.findOne({ _id: req.params.memberId, gymId: req.gymId }).select('name phone email')
    if (!member) return res.status(404).json({ message: 'Member not found' })
    const waiver = await MemberWaiver.findOne({ gymId: req.gymId, memberId: member._id }).sort({ signedAt: -1 })
    if (!waiver) return res.status(404).json({ message: 'This member hasn\u2019t signed a waiver yet' })
    const gym = await Gym.findById(req.gymId).select('name')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="waiver-${member.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf"`)
    streamWaiverPdf({ waiver, member, gym }, res)
  } catch (err) { next(err) }
})

export default router
