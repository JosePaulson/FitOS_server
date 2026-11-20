import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import Gym from '../models/Gym.js'
import { devOr } from '../utils/errors.js'

// Staff routes that must keep working even when a gym's own FitOS
// subscription has lapsed — otherwise a gym that can't pay could never
// reach the page that lets them pay, or contact support about it. Matched
// as a path prefix against req.originalUrl.
const SUBSCRIPTION_GATE_EXEMPT_PREFIXES = [
  '/api/auth',
  '/api/subscriptions',
  '/api/saas-admin',
  '/api/webhooks',
]

export async function protect(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Please sign in to continue.' })
  }

  const token = header.split(' ')[1]

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const user    = await User.findById(decoded.id).select('-passwordHash -refreshToken')

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'This account is no longer active. Please contact the gym owner.' })
    }

    req.user  = user
    req.gymId = user.gymId
    await blockIfSubscriptionInactive(req, res, next)
  } catch {
    return res.status(401).json({ message: 'Your session has expired. Please sign in again.' })
  }
}

/**
 * Blocks staff (gym admin) from creating, editing, or deleting anything —
 * adding a member, scheduling a PT slot, logging a lead, etc. — while the
 * GYM's own FitOS subscription is inactive (past_due, cancelled, or
 * paused). Viewing (GET) always stays available regardless, and a
 * short exemption list keeps the subscription/payment flow itself, the
 * platform-level superadmin console, and auth reachable no matter what.
 *
 * Fails OPEN on any lookup error — a missing/unreadable Gym record should
 * never be the reason an entire gym's staff gets locked out of the app.
 */
async function blockIfSubscriptionInactive(req, res, next) {
  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
  const isExempt = SUBSCRIPTION_GATE_EXEMPT_PREFIXES.some((p) => req.originalUrl.startsWith(p))

  if (!isMutating || isExempt) return next()

  try {
    const gym = await Gym.findById(req.gymId).select('planStatus trialEndsAt')
    if (!gym) return next() // fail open — don't let a data issue lock out an entire gym

    const withinTrial = gym.planStatus === 'trialing' && gym.trialEndsAt && gym.trialEndsAt > new Date()
    if (gym.planStatus === 'active' || withinTrial) return next()

    return res.status(402).json({
      message: 'Your gym\'s subscription is inactive. Renew to continue making changes — you can still view everything in the meantime.',
      code: 'SUBSCRIPTION_INACTIVE',
      planStatus: gym.planStatus,
    })
  } catch {
    return next() // fail open
  }
}

export function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: devOr(`Role '${req.user.role}' is not allowed to access this resource`, 'You don\u2019t have permission to do that.'),
      })
    }
    next()
  }
}
