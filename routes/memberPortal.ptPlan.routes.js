import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import MemberPTPlan from '../models/MemberPTPlan.js'

const router = Router()
router.use(memberProtect)

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
