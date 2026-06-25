import Gym from '../models/Gym.js'

const PLAN_FEATURES = {
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

const TIERS = ['lite', 'basic', 'pro']

const FEATURE_TO_PLAN = {}
TIERS.forEach((tier) => {
  PLAN_FEATURES[tier].forEach((f) => {
    if (!FEATURE_TO_PLAN[f]) FEATURE_TO_PLAN[f] = tier
  })
})

export function planGate(feature) {
  return async (req, res, next) => {
    const gym = await Gym.findById(req.gymId).select('plan planStatus trialEndsAt')
    if (!gym) return res.status(404).json({ message: 'Gym not found' })

    if (gym.planStatus === 'trialing' && gym.trialEndsAt > new Date()) {
      return next()
    }

    if (!['active', 'trialing'].includes(gym.planStatus)) {
      return res.status(402).json({ message: 'Your subscription is inactive. Please update your billing.' })
    }

    const requiredTier      = FEATURE_TO_PLAN[feature]
    if (!requiredTier) return next()

    const gymTierIndex      = TIERS.indexOf(gym.plan)
    const requiredTierIndex = TIERS.indexOf(requiredTier)

    if (gymTierIndex < requiredTierIndex) {
      return res.status(403).json({
        message:      `This feature requires the '${requiredTier}' plan or above.`,
        requiredPlan: requiredTier,
        currentPlan:  gym.plan,
      })
    }

    next()
  }
}

export { PLAN_FEATURES, FEATURE_TO_PLAN }
