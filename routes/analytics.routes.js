import { Router } from 'express'
import Member from '../models/Member.js'
import { protect, authorize } from '../middleware/auth.js'

const router = Router()
router.use(protect, authorize('owner', 'manager'))

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }

// ── GET /api/analytics/overview ─────────────────────────────────────────────
// Headline numbers + a 6-month gained-vs-lost trend for the wave chart.
router.get('/overview', async (req, res, next) => {
  try {
    const gymId = req.gymId
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)

    const [
      gainedThisMonth, lostThisMonth,
      expiring7, expiring3, expiring1,
      gainedByMonth, lostByMonth,
    ] = await Promise.all([
      Member.countDocuments({ gymId, isActive: true, createdAt: { $gte: startOfMonth } }),
      // "Lost" = became expired/cancelled this month — approximated by
      // updatedAt, since there's no separate churn-event log; a status
      // flip to expired/cancelled is what updatedAt reflects here in
      // practice (the renewal-reminder job and manual edits are the only
      // things that change status).
      Member.countDocuments({
        gymId, isActive: true,
        membershipStatus: { $in: ['expired', 'cancelled'] },
        updatedAt: { $gte: startOfMonth },
      }),
      Member.countDocuments({ gymId, isActive: true, membershipStatus: 'active', membershipExpiryDate: { $gte: now, $lte: addDays(now, 7) } }),
      Member.countDocuments({ gymId, isActive: true, membershipStatus: 'active', membershipExpiryDate: { $gte: now, $lte: addDays(now, 3) } }),
      Member.countDocuments({ gymId, isActive: true, membershipStatus: 'active', membershipExpiryDate: { $gte: now, $lte: addDays(now, 1) } }),
      Member.aggregate([
        { $match: { gymId, isActive: true, createdAt: { $gte: sixMonthsAgo } } },
        { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
      Member.aggregate([
        { $match: { gymId, isActive: true, membershipStatus: { $in: ['expired', 'cancelled'] }, updatedAt: { $gte: sixMonthsAgo } } },
        { $group: { _id: { year: { $year: '$updatedAt' }, month: { $month: '$updatedAt' } }, count: { $sum: 1 } } },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
    ])

    // Merge the two monthly series onto a common set of months so the
    // chart can plot both lines against the same x-axis even if a month
    // has entries in only one of them.
    const monthKey = (y, m) => `${y}-${m}`
    const gainedMap = new Map(gainedByMonth.map((r) => [monthKey(r._id.year, r._id.month), r.count]))
    const lostMap = new Map(lostByMonth.map((r) => [monthKey(r._id.year, r._id.month), r.count]))
    const months = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = monthKey(d.getFullYear(), d.getMonth() + 1)
      months.push({
        year: d.getFullYear(), month: d.getMonth() + 1,
        gained: gainedMap.get(key) || 0,
        lost: lostMap.get(key) || 0,
      })
    }

    res.json({
      gainedThisMonth,
      lostThisMonth,
      expiring: { in7: expiring7, in3: expiring3, in1: expiring1 },
      trend: months,
    })
  } catch (err) { next(err) }
})

// ── GET /api/analytics/expiring?window=7|3|1 ────────────────────────────────
// Active members whose plan lapses within the window — the "about to
// lose" follow-up list.
router.get('/expiring', async (req, res, next) => {
  try {
    const window = [1, 3, 7].includes(Number(req.query.window)) ? Number(req.query.window) : 7
    const now = new Date()

    const members = await Member.find({
      gymId: req.gymId,
      isActive: true,
      membershipStatus: 'active',
      membershipExpiryDate: { $gte: now, $lte: addDays(now, window) },
    })
      .sort({ membershipExpiryDate: 1 })
      .select('name phone email membershipExpiryDate currentPlanId')
      .populate('currentPlanId', 'name')

    res.json(members.map((m) => ({
      _id: m._id,
      name: m.name,
      phone: m.phone,
      email: m.email,
      planName: m.currentPlanId?.name || null,
      expiryDate: m.membershipExpiryDate,
      daysLeft: Math.ceil((startOfDay(m.membershipExpiryDate) - startOfDay(now)) / 86400000),
    })))
  } catch (err) { next(err) }
})

// ── GET /api/analytics/lost?days=30 ─────────────────────────────────────────
// Members who expired/cancelled recently — still-recoverable churn, for
// the follow-up list. Defaults to the last 30 days; older churn is less
// actionable so it's left out rather than growing this list forever.
router.get('/lost', async (req, res, next) => {
  try {
    const days = Number(req.query.days) > 0 ? Number(req.query.days) : 30
    const since = addDays(new Date(), -days)

    const members = await Member.find({
      gymId: req.gymId,
      isActive: true,
      membershipStatus: { $in: ['expired', 'cancelled'] },
      updatedAt: { $gte: since },
    })
      .sort({ updatedAt: -1 })
      .select('name phone email membershipStatus membershipExpiryDate currentPlanId updatedAt')
      .populate('currentPlanId', 'name')

    res.json(members.map((m) => ({
      _id: m._id,
      name: m.name,
      phone: m.phone,
      email: m.email,
      status: m.membershipStatus,
      planName: m.currentPlanId?.name || null,
      expiryDate: m.membershipExpiryDate,
      lostAt: m.updatedAt,
      daysSinceLost: Math.ceil((startOfDay(new Date()) - startOfDay(m.updatedAt)) / 86400000),
    })))
  } catch (err) { next(err) }
})

export default router
