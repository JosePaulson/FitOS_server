import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import Member from '../models/Member.js'
import MembershipPlan from '../models/MembershipPlan.js'
import Invoice from '../models/Invoice.js'
import Attendance from '../models/Attendance.js'
import WorkoutPlan from '../models/WorkoutPlan.js'
import DietPlan from '../models/DietPlan.js'

const router = Router()

// All routes require member JWT
router.use(memberProtect)

/* ── Profile ─────────────────────────────────────────────────────────────── */

/** GET /api/member-portal/me */
router.get('/me', async (req, res, next) => {
  try {
    const member = await Member.findById(req.memberId)
      .populate('currentPlanId', 'name price durationDays taxRate taxAmount baseAmount')
      .populate('assignedTrainerId', 'name phone')
    if (!member) return res.status(404).json({ message: 'Member not found' })
    res.json(member)
  } catch (err) { next(err) }
})

/* ── Membership plans ─────────────────────────────────────────────────────── */

/** GET /api/member-portal/plans — all active plans for this gym */
router.get('/plans', async (req, res, next) => {
  try {
    const plans = await MembershipPlan.find({ gymId: req.gymId, isActive: true }).sort({ price: 1 })
    res.json(plans)
  } catch (err) { next(err) }
})

/* ── Invoices / billing ───────────────────────────────────────────────────── */

/** GET /api/member-portal/invoices */
router.get('/invoices', async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query
    const [invoices, total] = await Promise.all([
      Invoice.find({ gymId: req.gymId, memberId: req.memberId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate('planId', 'name durationDays'),
      Invoice.countDocuments({ gymId: req.gymId, memberId: req.memberId }),
    ])
    res.json({ invoices, total, page: Number(page), pages: Math.ceil(total / limit) })
  } catch (err) { next(err) }
})

/** GET /api/member-portal/invoices/:id */
router.get('/invoices/:id', async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, memberId: req.memberId })
      .populate('planId', 'name durationDays price')
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' })
    res.json(invoice)
  } catch (err) { next(err) }
})

/* ── Attendance ───────────────────────────────────────────────────────────── */

/** GET /api/member-portal/attendance?month=2025-01 */
router.get('/attendance', async (req, res, next) => {
  try {
    const { month } = req.query   // e.g. "2025-06"
    const filter = { gymId: req.gymId, memberId: req.memberId }

    if (month) {
      const [year, m] = month.split('-').map(Number)
      const start = new Date(year, m - 1, 1)
      const end = new Date(year, m, 1)
      filter.date = { $gte: start, $lt: end }
    } else {
      // Default: last 30 days
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 30)
      filter.date = { $gte: cutoff }
    }

    const records = await Attendance.find(filter).sort({ date: -1 })

    // Build streak — consecutive days attended
    const dates = records.map((r) => r.date.toISOString().split('T')[0])
    const uniqueDates = [...new Set(dates)].sort().reverse()
    let streak = 0
    const today = new Date().toISOString().split('T')[0]
    let check = today
    for (const d of uniqueDates) {
      if (d === check) {
        streak++
        const dt = new Date(check)
        dt.setDate(dt.getDate() - 1)
        check = dt.toISOString().split('T')[0]
      } else break
    }

    res.json({ records, total: records.length, streak })
  } catch (err) { next(err) }
})

/** GET /api/member-portal/attendance/summary — monthly check-in counts */
router.get('/attendance/summary', async (req, res, next) => {
  try {
    const summary = await Attendance.aggregate([
      { $match: { gymId: req.gymId, memberId: req.memberId } },
      {
        $group: {
          _id: { year: { $year: '$date' }, month: { $month: '$date' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 6 },
    ])
    res.json(summary)
  } catch (err) { next(err) }
})

/* ── Workout Plans ────────────────────────────────────────────────────────── */

/** GET /api/member-portal/workout-plans */
router.get('/workout-plans', async (req, res, next) => {
  try {
    const plans = await WorkoutPlan.find({
      gymId: req.gymId,
      assignedTo: req.memberId,
      isActive: true,
    }).sort({ createdAt: -1 })
    res.json(plans)
  } catch (err) { next(err) }
})

/** GET /api/member-portal/workout-plans/:id */
router.get('/workout-plans/:id', async (req, res, next) => {
  try {
    const plan = await WorkoutPlan.findOne({
      _id: req.params.id,
      gymId: req.gymId,
      assignedTo: req.memberId,
    })
    if (!plan) return res.status(404).json({ message: 'Workout plan not found' })
    res.json(plan)
  } catch (err) { next(err) }
})

/* ── Diet Plans ───────────────────────────────────────────────────────────── */

/** GET /api/member-portal/diet-plans */
router.get('/diet-plans', async (req, res, next) => {
  try {
    const plans = await DietPlan.find({
      gymId: req.gymId,
      assignedTo: req.memberId,
      isActive: true,
    }).sort({ createdAt: -1 })
    res.json(plans)
  } catch (err) { next(err) }
})

/** GET /api/member-portal/diet-plans/:id */
router.get('/diet-plans/:id', async (req, res, next) => {
  try {
    const plan = await DietPlan.findOne({
      _id: req.params.id,
      gymId: req.gymId,
      assignedTo: req.memberId,
    })
    if (!plan) return res.status(404).json({ message: 'Diet plan not found' })
    res.json(plan)
  } catch (err) { next(err) }
})

export default router
