import { Router } from 'express'
import Gym    from '../models/Gym.js'
import Member from '../models/Member.js'
import Lead   from '../models/Lead.js'
import { protect } from '../middleware/auth.js'

const router = Router()

function saasAdminOnly(req, res, next) {
  const adminGymId = process.env.SAAS_ADMIN_GYM_ID
  if (!adminGymId) return res.status(503).json({ message: 'SaaS admin panel not configured (set SAAS_ADMIN_GYM_ID)' })
  if (req.user.role !== 'owner' || req.user.gymId.toString() !== adminGymId) {
    return res.status(403).json({ message: 'SaaS admin access denied' })
  }
  next()
}

router.get('/overview', protect, saasAdminOnly, async (req, res, next) => {
  try {
    const now          = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const [totalGyms, activeGyms, trialingGyms, pastDueGyms, cancelledGyms, newGymsThisMonth, planBreakdown] = await Promise.all([
      Gym.countDocuments(),
      Gym.countDocuments({ planStatus: 'active' }),
      Gym.countDocuments({ planStatus: 'trialing' }),
      Gym.countDocuments({ planStatus: 'past_due' }),
      Gym.countDocuments({ planStatus: 'cancelled' }),
      Gym.countDocuments({ createdAt: { $gte: startOfMonth } }),
      Gym.aggregate([
        { $group: { _id: { plan: '$plan', status: '$planStatus' }, count: { $sum: 1 } } },
        { $sort: { '_id.plan': 1 } },
      ]),
    ])

    res.json({
      gyms: { total: totalGyms, active: activeGyms, trialing: trialingGyms, pastDue: pastDueGyms, cancelled: cancelledGyms, newThisMonth: newGymsThisMonth },
      planBreakdown,
    })
  } catch (err) { next(err) }
})

router.get('/gyms', protect, saasAdminOnly, async (req, res, next) => {
  try {
    const { page = 1, limit = 20, plan, status, search } = req.query
    const filter = {}
    if (plan)   filter.plan       = plan
    if (status) filter.planStatus = status
    if (search) filter.name       = { $regex: search, $options: 'i' }

    const [gyms, total] = await Promise.all([
      Gym.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit)).populate('ownerUserId', 'name email'),
      Gym.countDocuments(filter),
    ])

    const gymIds       = gyms.map((g) => g._id)
    const memberCounts = await Member.aggregate([
      { $match: { gymId: { $in: gymIds }, isActive: true } },
      { $group: { _id: '$gymId', count: { $sum: 1 } } },
    ])
    const countMap = Object.fromEntries(memberCounts.map((m) => [m._id.toString(), m.count]))

    res.json({
      gyms:  gyms.map((g) => ({ ...g.toObject(), memberCount: countMap[g._id.toString()] || 0 })),
      total, page: Number(page), pages: Math.ceil(total / limit),
    })
  } catch (err) { next(err) }
})

router.patch('/gyms/:id', protect, saasAdminOnly, async (req, res, next) => {
  try {
    const allowed = ['plan', 'planStatus', 'trialEndsAt', 'renewsAt']
    const updates = {}
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k] })
    const gym = await Gym.findByIdAndUpdate(req.params.id, updates, { new: true })
    if (!gym) return res.status(404).json({ message: 'Gym not found' })
    res.json(gym)
  } catch (err) { next(err) }
})

router.get('/leads', protect, saasAdminOnly, async (req, res, next) => {
  try {
    const { page = 1, limit = 20, stage } = req.query
    const filter = { gymId: null }
    if (stage) filter.stage = stage
    const [leads, total] = await Promise.all([
      Lead.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit)),
      Lead.countDocuments(filter),
    ])
    res.json({ leads, total })
  } catch (err) { next(err) }
})

export default router
