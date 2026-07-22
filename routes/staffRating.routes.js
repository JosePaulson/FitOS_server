import { Router } from 'express'
import StaffRating from '../models/StaffRating.js'
import User from '../models/User.js'
import { protect, authorize } from '../middleware/auth.js'

const router = Router()

// GET /api/staff-ratings — owner-only. Optional ?staffId= to filter one staff member.
router.get('/', protect, authorize('owner'), async (req, res, next) => {
  try {
    const { staffId } = req.query
    const filter = { gymId: req.gymId }
    if (staffId) filter.staffId = staffId

    const ratings = await StaffRating.find(filter)
      .sort({ createdAt: -1 })
      .populate('memberId', 'name photo')
      .populate('staffId', 'name role')

    // Per-staff summary (average rating + count) — powers the admin dashboard view
    const summaryAgg = await StaffRating.aggregate([
      { $match: { gymId: req.gymId } },
      { $group: { _id: '$staffId', avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
    ])
    const staffIds = summaryAgg.map((s) => s._id)
    const staffDocs = await User.find({ _id: { $in: staffIds } }).select('name role')
    const staffMap = Object.fromEntries(staffDocs.map((s) => [String(s._id), s]))

    const summary = summaryAgg
      .map((s) => ({
        staffId: s._id,
        name: staffMap[String(s._id)]?.name || 'Unknown',
        role: staffMap[String(s._id)]?.role || '',
        avgRating: Math.round(s.avgRating * 10) / 10,
        count: s.count,
      }))
      .sort((a, b) => b.avgRating - a.avgRating)

    res.json({ ratings, summary })
  } catch (err) { next(err) }
})

export default router
