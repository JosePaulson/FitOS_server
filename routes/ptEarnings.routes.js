import { Router } from 'express'
import User from '../models/User.js'
import MemberPTPlan from '../models/MemberPTPlan.js'
import { protect, authorize } from '../middleware/auth.js'
import { computeTrainerEarnings, getPendingPayouts, getPreviousPlans, getMemberBreakdown, PERIODS } from '../services/ptEarnings.service.js'

const router = Router()
router.use(protect, authorize('owner', 'manager', 'trainer'))

function normalizePeriod(q) {
  return PERIODS.includes(q) ? q : 'total'
}

// A trainer only ever sees their own earnings; owner/manager can look at
// any trainer (and get the all-trainers overview below).
function resolveTrainerId(req) {
  if (req.user.role === 'trainer') return String(req.user._id)
  return req.query.trainerId || null
}

// ── GET /api/pt-earnings/trainers?period= ───────────────────────────────────
// Owner/manager only — every trainer's earnings for the period + pending
// payout total, for the overview table / trainer picker.
router.get('/trainers', authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const period = normalizePeriod(req.query.period)
    const trainers = await User.find({ gymId: req.gymId, role: 'trainer' }).select('name')

    const rows = await Promise.all(trainers.map(async (t) => {
      const [{ periodEarning, classesInPeriod }, { total: pendingTotal, items }] = await Promise.all([
        computeTrainerEarnings(req.gymId, t._id, period),
        getPendingPayouts(req.gymId, t._id),
      ])
      return {
        trainerId: t._id,
        trainerName: t.name,
        periodEarning,
        classesInPeriod,
        pendingTotal,
        pendingCount: items.length,
      }
    }))

    res.json({ period, trainers: rows })
  } catch (err) { next(err) }
})

// ── GET /api/pt-earnings/detail?trainerId=&period= ──────────────────────────
router.get('/detail', async (req, res, next) => {
  try {
    const trainerId = resolveTrainerId(req)
    if (!trainerId) return res.status(400).json({ message: 'trainerId is required' })

    const trainer = await User.findOne({ _id: trainerId, gymId: req.gymId }).select('name')
    if (!trainer) return res.status(404).json({ message: 'Trainer not found' })

    const period = normalizePeriod(req.query.period)
    const [earnings, pending, members] = await Promise.all([
      computeTrainerEarnings(req.gymId, trainerId, period),
      getPendingPayouts(req.gymId, trainerId),
      getMemberBreakdown(req.gymId, trainerId),
    ])

    res.json({
      trainer: { _id: trainer._id, name: trainer.name },
      period,
      periodEarning: earnings.periodEarning,
      classesInPeriod: earnings.classesInPeriod,
      pending,
      members,
    })
  } catch (err) { next(err) }
})

// ── GET /api/pt-earnings/previous?trainerId= ────────────────────────────────
// "Previous earnings" — full ledger of this trainer's no-longer-active
// plans (completed/expired/cancelled), each with its own payment status.
router.get('/previous', async (req, res, next) => {
  try {
    const trainerId = resolveTrainerId(req)
    if (!trainerId) return res.status(400).json({ message: 'trainerId is required' })

    const trainer = await User.findOne({ _id: trainerId, gymId: req.gymId }).select('name')
    if (!trainer) return res.status(404).json({ message: 'Trainer not found' })

    const plans = await getPreviousPlans(req.gymId, trainerId)
    res.json({ trainer: { _id: trainer._id, name: trainer.name }, plans })
  } catch (err) { next(err) }
})

// ── PATCH /api/pt-earnings/plans/:id/payment-status ─────────────────────────
// Toggles a plan's commission between "received" and "pending" — owner/
// manager can do this for any plan; a trainer only for their own. Body:
// { paid: boolean }.
router.patch('/plans/:id/payment-status', async (req, res, next) => {
  try {
    const plan = await MemberPTPlan.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!plan) return res.status(404).json({ message: 'Plan not found' })

    const isOwnPlan = req.user.role === 'trainer' && String(plan.trainerId) === String(req.user._id)
    if (!['owner', 'manager'].includes(req.user.role) && !isOwnPlan) {
      return res.status(403).json({ message: 'You can only update your own plans' })
    }

    const paid = !!req.body.paid
    plan.trainerPayout = paid
      ? { paid: true, paidAt: new Date(), paidBy: req.user._id }
      : { paid: false, paidAt: null, paidBy: null }
    await plan.save()

    res.json({ message: paid ? 'Marked as received' : 'Marked as pending', planId: plan._id, paid })
  } catch (err) { next(err) }
})

export default router
