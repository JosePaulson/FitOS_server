import { Router } from 'express'
import Member     from '../models/Member.js'
import Invoice    from '../models/Invoice.js'
import Lead       from '../models/Lead.js'
import Attendance from '../models/Attendance.js'
import { protect, authorize } from '../middleware/auth.js'

const router = Router()

router.get('/', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const gymId = req.gymId
    const now   = new Date()
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const in7Days  = new Date(now); in7Days.setDate(now.getDate() + 7)
    const in30Days = new Date(now); in30Days.setDate(now.getDate() + 30)

    const [
      totalActive, totalExpired, newThisMonth,
      expiringIn7, expiringIn30, todayAttendance,
      monthRevenue, pendingInvoices, openLeads,
      recentMembers, revenueByMonth,
    ] = await Promise.all([
      Member.countDocuments({ gymId, membershipStatus: 'active',  isActive: true }),
      Member.countDocuments({ gymId, membershipStatus: 'expired', isActive: true }),
      Member.countDocuments({ gymId, isActive: true, createdAt: { $gte: startOfMonth } }),
      Member.countDocuments({ gymId, membershipStatus: 'active', isActive: true, membershipExpiryDate: { $gte: now, $lte: in7Days } }),
      Member.countDocuments({ gymId, membershipStatus: 'active', isActive: true, membershipExpiryDate: { $gte: now, $lte: in30Days } }),
      Attendance.countDocuments({ gymId, date: startOfToday }),
      Invoice.aggregate([
        { $match: { gymId, status: 'paid', paidAt: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ]),
      Invoice.aggregate([
        { $match: { gymId, status: 'pending' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
      ]),
      Lead.countDocuments({ gymId, stage: { $nin: ['converted', 'lost'] } }),
      Member.find({ gymId, isActive: true }).sort({ createdAt: -1 }).limit(5)
        .select('name phone membershipStatus membershipExpiryDate createdAt'),
      Invoice.aggregate([
        { $match: { gymId, status: 'paid', paidAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) } } },
        { $group: { _id: { year: { $year: '$paidAt' }, month: { $month: '$paidAt' } }, revenue: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
    ])

    res.json({
      members:  { active: totalActive, expired: totalExpired, newThisMonth, expiringIn7, expiringIn30 },
      attendance: { today: todayAttendance },
      revenue:  { thisMonth: monthRevenue[0]?.total || 0, pendingAmount: pendingInvoices[0]?.total || 0, pendingCount: pendingInvoices[0]?.count || 0, trend: revenueByMonth },
      leads:    { open: openLeads },
      recentMembers,
    })
  } catch (err) { next(err) }
})

export default router
