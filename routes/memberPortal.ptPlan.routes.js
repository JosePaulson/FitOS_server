import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import MemberPTPlan from '../models/MemberPTPlan.js'
import PTPlan from '../models/PTPlan.js'
import Gym from '../models/Gym.js'

const router = Router()
router.use(memberProtect)

/**
 * GET /api/member-portal/pt-plans/catalog — the gym's published PT plan
 * catalog (for the Plans page / "PT plans available" prompts), plus a
 * "starts at" per-session price: the plan with the HIGHEST total fee,
 * divided by its number of classes. Bigger packages are usually the best
 * per-session value, so this tends to surface the most attractive number —
 * not necessarily the cheapest plan overall.
 * MUST be registered before GET '/' isn't an issue here since there's no
 * conflicting :id route in this file, but kept first for clarity.
 */
router.get('/catalog', async (req, res, next) => {
  try {
    const [plans, gym] = await Promise.all([
      PTPlan.find({ gymId: req.gymId, isActive: true }).populate('trainerId', 'name').sort({ fee: 1 }),
      Gym.findById(req.gymId).select('name'),
    ])

    let startingAtPerSession = null
    if (plans.length > 0) {
      const highestFeePlan = [...plans].sort((a, b) => b.fee - a.fee)[0]
      if (highestFeePlan.numberOfClasses > 0) {
        startingAtPerSession = Math.round(highestFeePlan.fee / highestFeePlan.numberOfClasses)
      }
    }

    res.json({ plans, gymName: gym?.name || '', startingAtPerSession })
  } catch (err) { next(err) }
})

/** GET /api/member-portal/pt-plans — the member's own PT plan history (active first, then most recent) */
router.get('/', async (req, res, next) => {
  try {
    const assignments = await MemberPTPlan.find({ gymId: req.gymId, memberId: req.memberId })
      .populate('trainerId', 'name')
      .sort({ createdAt: -1 })

    // Explicit ordering: active plans first, then the rest by recency
    const order = { active: 0, completed: 1, expired: 2, cancelled: 3 }
    assignments.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || new Date(b.createdAt) - new Date(a.createdAt))

    res.json({ plans: assignments })
  } catch (err) { next(err) }
})

export default router
