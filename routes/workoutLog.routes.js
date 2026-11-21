import { Router } from 'express'
import MemberWorkoutLog from '../models/MemberWorkoutLog.js'
import { protect, authorize } from '../middleware/auth.js'
import Member from '../models/Member.js'
import { canViewLogs } from '../utils/logSharing.js'

const router = Router()

/**
 * GET /api/workout-logs?memberId=... — read-only, staff-facing list of a
 * member's self-logged workouts (as opposed to trainer-run PT sessions).
 * Exists mainly so the admin dashboard can merge a member's self-logged
 * lifts into the same personal-record lookup used for PT sessions —
 * a PR is a PR regardless of which side it was logged from.
 * Respects the member's sharing choice (Member.logSharing).
 */
router.get('/', protect, authorize('owner', 'manager', 'trainer'), async (req, res, next) => {
  try {
    const { memberId, limit = 100 } = req.query
    if (!memberId) return res.status(400).json({ message: 'memberId is required' })

    // Only logs the member has chosen to share with this staff user (empty otherwise).
    const member = await Member.findOne({ _id: memberId, gymId: req.gymId }).select('logSharing')
    if (!member || !canViewLogs(member, req.user, 'workout')) return res.json({ logs: [], shared: false })

    const logs = await MemberWorkoutLog.find({ gymId: req.gymId, memberId })
      .sort({ date: -1 })
      .limit(Number(limit))
    res.json({ logs })
  } catch (err) { next(err) }
})

export default router
