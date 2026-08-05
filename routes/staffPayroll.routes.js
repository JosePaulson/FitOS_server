import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import StaffAttendance from '../models/StaffAttendance.js'
import StaffSalary from '../models/StaffSalary.js'
import StaffWorkSchedule from '../models/StaffWorkSchedule.js'
import User from '../models/User.js'
import { protect } from '../middleware/auth.js'
import { istDateKey, istDayName, istDateTime, todayISTKey } from '../utils/dateIST.js'

const router = Router()
router.use(protect)

const DAY_NAME_TO_NUM = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }

function validate(req, res) {
  const errs = validationResult(req)
  if (!errs.isEmpty()) { res.status(400).json({ message: errs.array()[0].msg }); return false }
  return true
}

// Owners have full access to every payroll action. Managers only have
// what an owner has explicitly granted them (see permissions.payroll on
// User). Trainers/receptionists get no admin access here at all — their
// own attendance/pay is handled by the separate self-service routes
// below, which don't call this.
function canPayroll(user, action) {
  if (user.role === 'owner') return true
  if (user.role === 'manager') return !!user.permissions?.payroll?.[action]
  return false
}

function requirePayroll(action) {
  return (req, res, next) => {
    if (!canPayroll(req.user, action)) {
      return res.status(403).json({ message: `You don't have payroll ${action} access. Ask an owner to grant it.` })
    }
    next()
  }
}

/* ── Shared calculation helpers ──────────────────────────────────────────── */

function monthBounds(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const nextMonthKey = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return {
    daysInMonth,
    start: istDateTime(`${monthKey}-01`, '00:00'),
    end: istDateTime(`${nextMonthKey}-01`, '00:00'),
  }
}

/**
 * Builds the full day-by-day picture for one staff member in one month:
 * weekly/custom offs (from StaffWorkSchedule), merged with any actual
 * attendance records, for every day up to and including today (future
 * days aren't projected). This is what both the calendar UI and the
 * payroll math are built from.
 */
async function computeMonth(gymId, staffId, monthKey) {
  const { daysInMonth, start, end } = monthBounds(monthKey)

  const [schedule, records] = await Promise.all([
    StaffWorkSchedule.findOne({ gymId, staffId }),
    StaffAttendance.find({ gymId, staffId, date: { $gte: start, $lt: end } }),
  ])

  const weeklyOffDays = new Set(schedule?.weeklyOffDays ?? [0])
  const customOffKeys = new Set((schedule?.customOffDates || []).map((d) => istDateKey(d)))
  const byKey = new Map(records.map((r) => [istDateKey(r.date), r]))
  const todayKey = todayISTKey()

  const days = []
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${monthKey}-${String(day).padStart(2, '0')}`
    if (dateKey > todayKey) break

    const dayNum = DAY_NAME_TO_NUM[istDayName(istDateTime(dateKey))]
    const isOff = weeklyOffDays.has(dayNum) || customOffKeys.has(dateKey)
    const record = byKey.get(dateKey)

    let status
    if (record && record.requestStatus === 'approved') status = record.status
    else if (record && record.requestStatus === 'pending') status = 'pending'
    else if (isOff) status = 'off'
    else status = 'absent' // no record, not an off day, date has already passed

    days.push({
      date: dateKey,
      status,
      isOff,
      record: record ? {
        id: record._id,
        status: record.status,
        requestStatus: record.requestStatus,
        notes: record.notes,
        rejectionReason: record.rejectionReason,
      } : null,
    })
  }

  return { daysInMonth, days }
}

function summarizeDays(days) {
  const s = { present: 0, absent: 0, halfDay: 0, off: 0, paidLeave: 0, unpaidLeave: 0, pending: 0 }
  for (const d of days) {
    if (d.status === 'present') s.present++
    else if (d.status === 'absent') s.absent++
    else if (d.status === 'half-day') s.halfDay++
    else if (d.status === 'off') s.off++
    else if (d.status === 'leave-paid') s.paidLeave++
    else if (d.status === 'leave-unpaid') s.unpaidLeave++
    else if (d.status === 'pending') s.pending++
  }
  return s
}

async function computePayroll(gymId, staffId, monthKey) {
  const [salary, month] = await Promise.all([
    StaffSalary.findOne({ gymId, staffId }),
    computeMonth(gymId, staffId, monthKey),
  ])
  const summary = summarizeDays(month.days)
  const base = salary?.monthlyBaseSalary ?? null
  const perDayRate = base != null ? base / month.daysInMonth : 0
  // A half-day counts as half a deduction — present for pay purposes on
  // the other half.
  const deductionDays = summary.absent + summary.unpaidLeave + summary.halfDay * 0.5
  const netPayable = base != null ? Math.max(0, Math.round((base - deductionDays * perDayRate) * 100) / 100) : null

  return {
    baseSalary: base,
    daysInMonth: month.daysInMonth,
    perDayRate: Math.round(perDayRate * 100) / 100,
    deductionDays,
    netPayable,
    summary,
    days: month.days,
  }
}

/* ── Self-service — every staff member manages their own record ─────────── */

/** GET /api/staff-payroll/my/calendar?month=YYYY-MM */
router.get('/my/calendar', async (req, res, next) => {
  try {
    const monthKey = req.query.month || todayISTKey().slice(0, 7)
    const data = await computeMonth(req.gymId, req.user._id, monthKey)
    res.json(data)
  } catch (err) { next(err) }
})

/** GET /api/staff-payroll/my/summary?month=YYYY-MM */
router.get('/my/summary', async (req, res, next) => {
  try {
    const monthKey = req.query.month || todayISTKey().slice(0, 7)
    const data = await computePayroll(req.gymId, req.user._id, monthKey)
    res.json(data)
  } catch (err) { next(err) }
})

/** POST /api/staff-payroll/my/attendance — submit today's (or a past) attendance for approval */
router.post('/my/attendance',
  [
    body('date').isISO8601().withMessage('A valid date is required'),
    body('status').isIn(['present', 'absent', 'half-day', 'leave-paid', 'leave-unpaid']).withMessage('Invalid status'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const dateKey = istDateKey(req.body.date)
      if (dateKey > todayISTKey()) return res.status(400).json({ message: "Can't submit attendance for a future date" })

      // Staff can request a leave type, but final "paid vs unpaid" is an
      // approval decision — self-submitted leave always lands as
      // unpaid until an approver upgrades it, so nobody can grant
      // themselves a paid day off.
      const status = req.body.status === 'leave-paid' ? 'leave-unpaid' : req.body.status

      const record = await StaffAttendance.findOneAndUpdate(
        { gymId: req.gymId, staffId: req.user._id, date: istDateTime(dateKey) },
        {
          gymId: req.gymId, staffId: req.user._id, date: istDateTime(dateKey),
          status, source: 'staff', requestStatus: 'pending',
          notes: req.body.notes || '', submittedBy: req.user._id, submittedAt: new Date(),
          approvedBy: null, approvedAt: null, rejectionReason: '',
        },
        { new: true, upsert: true }
      )
      res.status(201).json(record)
    } catch (err) { next(err) }
  }
)

/**
 * POST /api/staff-payroll/my/attendance/bulk — submit a whole batch of days
 * for approval in one go (e.g. at the start of a month, submitting every
 * marked day from last month at once). Each entry becomes its own pending
 * StaffAttendance record, same rules as the single-day endpoint: future
 * dates are rejected and self-submitted leave always lands as unpaid until
 * an approver upgrades it.
 */
router.post('/my/attendance/bulk',
  [
    body('entries').isArray({ min: 1 }).withMessage('Select at least one date'),
    body('entries.*.date').isISO8601().withMessage('Every entry needs a valid date'),
    body('entries.*.status').isIn(['present', 'absent', 'half-day', 'leave-paid', 'leave-unpaid']).withMessage('Invalid status'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const todayKey = todayISTKey()
      const seen = new Set()
      const results = []
      const errors = []

      for (const entry of req.body.entries) {
        const dateKey = istDateKey(entry.date)
        if (dateKey > todayKey) { errors.push({ date: dateKey, message: "Can't submit a future date" }); continue }
        if (seen.has(dateKey)) { errors.push({ date: dateKey, message: 'Duplicate date in submission' }); continue }
        seen.add(dateKey)

        const status = entry.status === 'leave-paid' ? 'leave-unpaid' : entry.status

        const record = await StaffAttendance.findOneAndUpdate(
          { gymId: req.gymId, staffId: req.user._id, date: istDateTime(dateKey) },
          {
            gymId: req.gymId, staffId: req.user._id, date: istDateTime(dateKey),
            status, source: 'staff', requestStatus: 'pending',
            notes: entry.notes || '', submittedBy: req.user._id, submittedAt: new Date(),
            approvedBy: null, approvedAt: null, rejectionReason: '',
          },
          { new: true, upsert: true }
        )
        results.push(record)
      }

      res.status(201).json({ submitted: results, errors })
    } catch (err) { next(err) }
  }
)

/* ── Admin — salary ───────────────────────────────────────────────────────── */

/** GET /api/staff-payroll/staff/:staffId/salary */
router.get('/staff/:staffId/salary', requirePayroll('view'), async (req, res, next) => {
  try {
    const salary = await StaffSalary.findOne({ gymId: req.gymId, staffId: req.params.staffId })
    res.json(salary)
  } catch (err) { next(err) }
})

/** PUT /api/staff-payroll/staff/:staffId/salary */
router.put('/staff/:staffId/salary',
  requirePayroll('edit'),
  [body('monthlyBaseSalary').isFloat({ min: 0 }).withMessage('Enter a valid salary amount')],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const existing = await StaffSalary.findOne({ gymId: req.gymId, staffId: req.params.staffId })
      const historyEntry = existing ? { monthlyBaseSalary: existing.monthlyBaseSalary, changedAt: new Date(), changedBy: req.user._id } : null

      const salary = await StaffSalary.findOneAndUpdate(
        { gymId: req.gymId, staffId: req.params.staffId },
        {
          $set: { monthlyBaseSalary: req.body.monthlyBaseSalary, effectiveFrom: new Date(), updatedBy: req.user._id },
          ...(historyEntry ? { $push: { history: historyEntry } } : {}),
        },
        { new: true, upsert: true }
      )
      res.json(salary)
    } catch (err) { next(err) }
  }
)

/* ── Admin — off-day schedule ─────────────────────────────────────────────── */

/** GET /api/staff-payroll/staff/:staffId/schedule */
router.get('/staff/:staffId/schedule', requirePayroll('view'), async (req, res, next) => {
  try {
    const schedule = await StaffWorkSchedule.findOne({ gymId: req.gymId, staffId: req.params.staffId })
    res.json(schedule || { weeklyOffDays: [0], customOffDates: [] })
  } catch (err) { next(err) }
})

/** PUT /api/staff-payroll/staff/:staffId/schedule */
router.put('/staff/:staffId/schedule',
  requirePayroll('edit'),
  [body('weeklyOffDays').isArray().withMessage('weeklyOffDays must be an array')],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const weeklyOffDays = req.body.weeklyOffDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      const customOffDates = (req.body.customOffDates || []).map((d) => istDateTime(istDateKey(d)))

      const schedule = await StaffWorkSchedule.findOneAndUpdate(
        { gymId: req.gymId, staffId: req.params.staffId },
        { weeklyOffDays, customOffDates, updatedBy: req.user._id },
        { new: true, upsert: true }
      )
      res.json(schedule)
    } catch (err) { next(err) }
  }
)

/* ── Admin — viewing a staff member's calendar/payroll ────────────────────── */

/** GET /api/staff-payroll/staff/:staffId/calendar?month=YYYY-MM */
router.get('/staff/:staffId/calendar', requirePayroll('view'), async (req, res, next) => {
  try {
    const monthKey = req.query.month || todayISTKey().slice(0, 7)
    const data = await computeMonth(req.gymId, req.params.staffId, monthKey)
    res.json(data)
  } catch (err) { next(err) }
})

/** GET /api/staff-payroll/staff/:staffId/summary?month=YYYY-MM */
router.get('/staff/:staffId/summary', requirePayroll('view'), async (req, res, next) => {
  try {
    const monthKey = req.query.month || todayISTKey().slice(0, 7)
    const data = await computePayroll(req.gymId, req.params.staffId, monthKey)
    res.json(data)
  } catch (err) { next(err) }
})

/** POST /api/staff-payroll/staff/:staffId/attendance — admin sets a record directly (auto-approved) */
router.post('/staff/:staffId/attendance',
  requirePayroll('edit'),
  [
    body('date').isISO8601(),
    body('status').isIn(['present', 'absent', 'half-day', 'leave-paid', 'leave-unpaid']),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const dateKey = istDateKey(req.body.date)
      const record = await StaffAttendance.findOneAndUpdate(
        { gymId: req.gymId, staffId: req.params.staffId, date: istDateTime(dateKey) },
        {
          gymId: req.gymId, staffId: req.params.staffId, date: istDateTime(dateKey),
          status: req.body.status, source: 'admin', requestStatus: 'approved',
          notes: req.body.notes || '', submittedBy: req.user._id, submittedAt: new Date(),
          approvedBy: req.user._id, approvedAt: new Date(), rejectionReason: '',
        },
        { new: true, upsert: true }
      )
      res.status(201).json(record)
    } catch (err) { next(err) }
  }
)

/** DELETE /api/staff-payroll/attendance/:id */
router.delete('/attendance/:id', requirePayroll('delete'), async (req, res, next) => {
  try {
    const record = await StaffAttendance.findOneAndDelete({ _id: req.params.id, gymId: req.gymId })
    if (!record) return res.status(404).json({ message: 'Record not found' })
    res.json({ message: 'Deleted' })
  } catch (err) { next(err) }
})

/* ── Approvals ────────────────────────────────────────────────────────────── */

/** GET /api/staff-payroll/pending — every staff member's pending requests */
router.get('/pending', requirePayroll('approve'), async (req, res, next) => {
  try {
    const records = await StaffAttendance.find({ gymId: req.gymId, requestStatus: 'pending' })
      .sort({ date: -1 })
      .populate('staffId', 'name role')
    res.json(records)
  } catch (err) { next(err) }
})

/**
 * PATCH /api/staff-payroll/attendance/approve-bulk — approve (or reject) a
 * specific set of pending records in one request. Used by the "select all
 * for this staff member's month" review flow in Approvals.
 */
router.patch('/attendance/approve-bulk',
  requirePayroll('approve'),
  [
    body('ids').isArray({ min: 1 }).withMessage('Select at least one record'),
    body('decision').isIn(['approve', 'reject']).withMessage('decision must be approve or reject'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const records = await StaffAttendance.find({ _id: { $in: req.body.ids }, gymId: req.gymId, requestStatus: 'pending' })
      const results = []
      for (const record of records) {
        if (req.body.decision === 'approve') {
          record.requestStatus = 'approved'
          record.approvedBy = req.user._id
          record.approvedAt = new Date()
          record.rejectionReason = ''
        } else {
          record.requestStatus = 'rejected'
          record.approvedBy = req.user._id
          record.approvedAt = new Date()
          record.rejectionReason = req.body.reason || ''
        }
        await record.save()
        results.push(record)
      }
      res.json({ updated: results.length, records: results })
    } catch (err) { next(err) }
  }
)

/**
 * PATCH /api/staff-payroll/staff/:staffId/attendance/approve-month — approve
 * every pending record for one staff member within a given month at once
 * (the "owner/manager checks the entire month and approves" flow).
 */
router.patch('/staff/:staffId/attendance/approve-month',
  requirePayroll('approve'),
  async (req, res, next) => {
    try {
      const monthKey = req.query.month || todayISTKey().slice(0, 7)
      const { start, end } = monthBounds(monthKey)
      const records = await StaffAttendance.find({
        gymId: req.gymId, staffId: req.params.staffId, requestStatus: 'pending',
        date: { $gte: start, $lt: end },
      })
      for (const record of records) {
        record.requestStatus = 'approved'
        record.approvedBy = req.user._id
        record.approvedAt = new Date()
        record.rejectionReason = ''
        await record.save()
      }
      res.json({ updated: records.length })
    } catch (err) { next(err) }
  }
)

/** PATCH /api/staff-payroll/attendance/:id/approve — optionally upgrade a leave request to paid */
router.patch('/attendance/:id/approve',
  requirePayroll('approve'),
  [body('markPaid').optional().isBoolean()],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const record = await StaffAttendance.findOne({ _id: req.params.id, gymId: req.gymId })
      if (!record) return res.status(404).json({ message: 'Record not found' })

      if (req.body.markPaid === true && record.status === 'leave-unpaid') record.status = 'leave-paid'
      else if (req.body.markPaid === false && record.status === 'leave-paid') record.status = 'leave-unpaid'

      record.requestStatus = 'approved'
      record.approvedBy = req.user._id
      record.approvedAt = new Date()
      record.rejectionReason = ''
      await record.save()

      res.json(record)
    } catch (err) { next(err) }
  }
)

/** PATCH /api/staff-payroll/attendance/:id/reject */
router.patch('/attendance/:id/reject', requirePayroll('approve'), async (req, res, next) => {
  try {
    const record = await StaffAttendance.findOneAndUpdate(
      { _id: req.params.id, gymId: req.gymId },
      { requestStatus: 'rejected', approvedBy: req.user._id, approvedAt: new Date(), rejectionReason: req.body.reason || '' },
      { new: true }
    )
    if (!record) return res.status(404).json({ message: 'Record not found' })
    res.json(record)
  } catch (err) { next(err) }
})

/* ── Analytics (owner only) ──────────────────────────────────────────────── */

/** GET /api/staff-payroll/analytics?month=YYYY-MM&staffId=optional */
router.get('/analytics', async (req, res, next) => {
  if (req.user.role !== 'owner') return res.status(403).json({ message: 'Owner access only' })
  try {
    const monthKey = req.query.month || todayISTKey().slice(0, 7)
    // Owners aren't staff — they don't have attendance/payroll of their own,
    // so they never appear in payroll analytics/listings.
    const filter = { gymId: req.gymId, isActive: true, role: { $ne: 'owner' } }
    if (req.query.staffId) filter._id = req.query.staffId

    const staff = await User.find(filter).select('name role')
    const rows = await Promise.all(
      staff.map(async (s) => {
        const payroll = await computePayroll(req.gymId, s._id, monthKey)
        return {
          staffId: s._id, name: s.name, role: s.role,
          baseSalary: payroll.baseSalary, netPayable: payroll.netPayable,
          present: payroll.summary.present, absent: payroll.summary.absent, halfDay: payroll.summary.halfDay,
          off: payroll.summary.off, paidLeave: payroll.summary.paidLeave,
          unpaidLeave: payroll.summary.unpaidLeave, pending: payroll.summary.pending,
        }
      })
    )

    const totals = rows.reduce((acc, r) => ({
      baseSalary: acc.baseSalary + (r.baseSalary || 0),
      netPayable: acc.netPayable + (r.netPayable || 0),
      pending: acc.pending + r.pending,
    }), { baseSalary: 0, netPayable: 0, pending: 0 })

    res.json({ month: monthKey, rows, totals })
  } catch (err) { next(err) }
})

/* ── Access control (owner only) — grants a manager payroll permissions ──── */

/** PUT /api/staff-payroll/permissions/:managerId */
router.put('/permissions/:managerId',
  [
    body('view').isBoolean(), body('edit').isBoolean(),
    body('approve').isBoolean(), body('delete').isBoolean(),
  ],
  async (req, res, next) => {
    if (req.user.role !== 'owner') return res.status(403).json({ message: 'Owner access only' })
    if (!validate(req, res)) return
    try {
      const target = await User.findOne({ _id: req.params.managerId, gymId: req.gymId })
      if (!target) return res.status(404).json({ message: 'Staff member not found' })
      if (target.role !== 'manager') return res.status(400).json({ message: 'Payroll access can only be customized for managers' })

      const { view, edit, approve, delete: del } = req.body
      target.permissions = { ...target.permissions, payroll: { view, edit, approve, delete: del } }
      await target.save()

      res.json({ permissions: target.permissions })
    } catch (err) { next(err) }
  }
)

export default router
