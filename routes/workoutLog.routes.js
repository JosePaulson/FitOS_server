import { Router } from 'express'
import MemberWorkoutLog from '../models/MemberWorkoutLog.js'
import { protect, authorize } from '../middleware/auth.js'

const router = Router()

/**
 * GET /api/workout-logs?memberId=... — read-only, staff-facing list of a
 * member's self-logged workouts (as opposed to trainer-run PT sessions).
 * Exists mainly so the admin dashboard can merge a member's self-logged
 * lifts into the same personal-record lookup used for PT sessions —
 * a PR is a PR regardless of which side it was logged from.
 */
router.get('/', protect, authorize('owner', 'manager', 'trainer'), async (req, res, next) => {
  try {
    const { memberId, limit = 100 } = req.query
    if (!memberId) return res.status(400).json({ message: 'memberId is required' })

    const logs = await MemberWorkoutLog.find({ gymId: req.gymId, memberId })
      .sort({ date: -1 })
      .limit(Number(limit))
    res.json({ logs })
  } catch (err) { next(err) }
})

export default router
