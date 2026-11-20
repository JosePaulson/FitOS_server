import { Router } from 'express'
import Gym    from '../models/Gym.js'
import Member from '../models/Member.js'
import Lead   from '../models/Lead.js'
import SubscriptionPlan from '../models/SubscriptionPlan.js'
import { protect } from '../middleware/auth.js'
import { invalidatePlanConfigCache, PLAN_FEATURES } from '../middleware/planGate.js'
import { devOr } from '../utils/errors.js'

const router = Router()

function saasAdminOnly(req, res, next) {
  const adminGymId = process.env.SAAS_ADMIN_GYM_ID
  if (!adminGymId) return res.status(503).json({ message: devOr('SaaS admin panel not configured (set SAAS_ADMIN_GYM_ID)', 'This area isn\u2019t available.') })
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

// ── Subscription plans (feature-gate tiers + Razorpay pricing) ─────────────

// Seeds the built-in lite/basic/pro defaults into the database on first
// visit to the management page, so the super-admin starts with real,
// editable rows instead of an empty list. A no-op once anything exists.
async function seedDefaultPlansIfEmpty() {
  const count = await SubscriptionPlan.countDocuments()
  if (count > 0) return
  const defaults = Object.entries(PLAN_FEATURES).map(([key, features], i) => ({
    key, name: key.charAt(0).toUpperCase() + key.slice(1), features, sortOrder: i,
  }))
  await SubscriptionPlan.insertMany(defaults)
}

router.get('/plans', protect, saasAdminOnly, async (req, res, next) => {
  try {
    await seedDefaultPlansIfEmpty()
    const plans = await SubscriptionPlan.find().sort({ sortOrder: 1 })
    res.json(plans)
  } catch (err) { next(err) }
})

router.post('/plans', protect, saasAdminOnly, async (req, res, next) => {
  try {
    const { key, name } = req.body
    if (!key || !name) return res.status(400).json({ message: 'key and name are required' })

    const allowed = ['key', 'name', 'description', 'priceMonthly', 'priceYearly', 'razorpayPlanIdMonthly', 'razorpayPlanIdYearly', 'memberLimit', 'features', 'isActive', 'sortOrder']
    const data = {}
    allowed.forEach((k) => { if (req.body[k] !== undefined) data[k] = req.body[k] })

    const plan = await SubscriptionPlan.create(data)
    invalidatePlanConfigCache()
    res.status(201).json(plan)
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: `A plan with key '${req.body.key}' already exists` })
    next(err)
  }
})

router.patch('/plans/:id', protect, saasAdminOnly, async (req, res, next) => {
  try {
    const allowed = ['name', 'description', 'priceMonthly', 'priceYearly', 'razorpayPlanIdMonthly', 'razorpayPlanIdYearly', 'memberLimit', 'features', 'isActive', 'sortOrder']
    const updates = {}
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k] })

    const plan = await SubscriptionPlan.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true })
    if (!plan) return res.status(404).json({ message: 'Plan not found' })
    invalidatePlanConfigCache()
    res.json(plan)
  } catch (err) { next(err) }
})

// Deactivates rather than deletes — a gym could still be on this tier
// (gym.plan is just a string, not a hard reference), so removing the row
// entirely could leave planGate.js unable to find a matching tier at all.
// Deactivating keeps the row (and its features/index) around while
// hiding it from anywhere a super-admin would offer it going forward.
router.delete('/plans/:id', protect, saasAdminOnly, async (req, res, next) => {
  try {
    const plan = await SubscriptionPlan.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true })
    if (!plan) return res.status(404).json({ message: 'Plan not found' })
    invalidatePlanConfigCache()
    res.json({ message: 'Plan deactivated', plan })
  } catch (err) { next(err) }
})

export default router
