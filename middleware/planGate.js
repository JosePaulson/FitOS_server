import Gym from '../models/Gym.js'
import SubscriptionPlan from '../models/SubscriptionPlan.js'

// Hardcoded fallback — used until a super-admin creates real
// SubscriptionPlan records (see models/SubscriptionPlan.js and
// routes/saasAdmin.routes.js). The moment any active plan exists in the
// database, DB-driven config takes over completely, including tier order
// (via sortOrder) — this table is never touched, just no longer consulted.
const DEFAULT_PLAN_FEATURES = {
  lite: [
    'members_100', 'billing', 'leads', 'attendance',
    'workout_plans', 'invoices', 'razorpay', 'email_notifications',
  ],
  basic: [
    'members_300', 'whatsapp_notifications', 'calendar',
    'self_booking', 'broadcast', 'workout_logger', 'reviews', 'member_app',
  ],
  pro: [
    'members_unlimited', 'class_scheduling', 'auto_renewal_reminders',
    'birthday_greetings', 'pt_sessions', 'push_notifications',
    'daily_report', 'staff_app', 'analytics', 'rewards',
  ],
}
const DEFAULT_TIERS = ['lite', 'basic', 'pro']

// Plan config changes rarely (a super-admin editing it), so a short
// in-memory cache avoids an extra DB round-trip on every gated request
// without risking a stale value for long if something does change.
let cache = null
let cacheAt = 0
const CACHE_MS = 60_000

async function loadPlanConfig() {
  const now = Date.now()
  if (cache && now - cacheAt < CACHE_MS) return cache

  const dbPlans = await SubscriptionPlan.find({ isActive: true }).sort({ sortOrder: 1 }).lean()

  let tiers, featuresByTier
  if (dbPlans.length > 0) {
    tiers = dbPlans.map((p) => p.key)
    featuresByTier = Object.fromEntries(dbPlans.map((p) => [p.key, p.features || []]))
  } else {
    tiers = DEFAULT_TIERS
    featuresByTier = DEFAULT_PLAN_FEATURES
  }

  const featureToPlan = {}
  tiers.forEach((tier) => {
    ;(featuresByTier[tier] || []).forEach((f) => {
      if (!featureToPlan[f]) featureToPlan[f] = tier
    })
  })

  cache = { tiers, featuresByTier, featureToPlan }
  cacheAt = now
  return cache
}

/** Clears the plan-config cache immediately — called after a super-admin edits a plan, so the change takes effect on the very next request. */
export function invalidatePlanConfigCache() {
  cache = null
}

export function planGate(feature) {
  return async (req, res, next) => {
    try {
      const gym = await Gym.findById(req.gymId).select('plan planStatus trialEndsAt')
      if (!gym) return res.status(404).json({ message: 'Gym not found' })

      if (gym.planStatus === 'trialing' && gym.trialEndsAt > new Date()) {
        return next()
      }

      if (!['active', 'trialing'].includes(gym.planStatus)) {
        return res.status(402).json({ message: 'Your subscription is inactive. Please update your billing.' })
      }

      const { tiers, featureToPlan } = await loadPlanConfig()
      const requiredTier = featureToPlan[feature]
      if (!requiredTier) return next()

      const gymTierIndex      = tiers.indexOf(gym.plan)
      const requiredTierIndex = tiers.indexOf(requiredTier)

      if (gymTierIndex < requiredTierIndex) {
        return res.status(403).json({
          message:      `This feature requires the '${requiredTier}' plan or above.`,
          requiredPlan: requiredTier,
          currentPlan:  gym.plan,
        })
      }

      next()
    } catch (err) {
      next(err)
    }
  }
}

export { DEFAULT_PLAN_FEATURES as PLAN_FEATURES, DEFAULT_TIERS as TIERS }

