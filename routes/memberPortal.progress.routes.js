import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import BodyMeasurement from '../models/BodyMeasurement.js'
import MemberWorkoutLog from '../models/MemberWorkoutLog.js'
import { computePRs, metricChanges, METRICS } from '../services/progress.service.js'

const router = Router()
router.use(memberProtect)

const dayOf = (d) => new Date(d).toISOString().slice(0, 10)

/**
 * GET /api/member-portal/progress/summary
 * Body-measurement history (weight also picks up the body weight members log
 * with their workouts), change since the first reading, and personal records.
 */
router.get('/summary', async (req, res, next) => {
  try {
    const [measurements, logs] = await Promise.all([
      BodyMeasurement.find({ memberId: req.memberId }).sort({ date: 1 }).limit(500).lean(),
      MemberWorkoutLog.find({ memberId: req.memberId }).select('date bodyWeight exercises').sort({ date: 1 }).limit(2000).lean(),
    ])

    // Weight readings from workout logs fill the gaps; a measurement on the same day wins.
    const logWeights = logs.filter((l) => l.bodyWeight > 0).map((l) => ({ date: l.date, weightKg: l.bodyWeight, fromLog: true }))
    const measuredDays = new Set(measurements.filter((m) => typeof m.weightKg === 'number').map((m) => dayOf(m.date)))
    const merged = [...measurements, ...logWeights.filter((w) => !measuredDays.has(dayOf(w.date)))]

    const series = {}
    for (const m of METRICS) {
      series[m] = merged
        .filter((x) => typeof x[m] === 'number')
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .map((x) => ({ date: x.date, value: x[m] }))
    }

    const prs = computePRs(logs)
    res.json({
      measurements: [...measurements].reverse().slice(0, 30),   // newest first, for the history list
      series, changes: metricChanges(merged),
      prs: prs.slice(0, 20), prTotal: prs.length,
    })
  } catch (err) { next(err) }
})

// POST /api/member-portal/progress/measurements — any subset of the metrics
router.post('/measurements', async (req, res, next) => {
  try {
    const data = {}
    for (const m of METRICS) {
      const v = req.body[m]
      if (v === undefined || v === null || v === '') continue
      const n = Number(v)
      if (!Number.isFinite(n)) return res.status(400).json({ message: `${m} must be a number` })
      data[m] = n
    }
    if (!Object.keys(data).length) return res.status(400).json({ message: 'Enter at least one measurement' })

    let date = new Date()
    if (req.body.date) {
      date = new Date(req.body.date)
      if (Number.isNaN(date.getTime())) return res.status(400).json({ message: 'That date isn\u2019t valid' })
      if (date.getTime() > Date.now() + 24 * 3600 * 1000) return res.status(400).json({ message: 'The date can\u2019t be in the future' })
    }
    const doc = await BodyMeasurement.create({
      gymId: req.gymId, memberId: req.memberId, date, ...data,
      notes: req.body.notes ? String(req.body.notes).slice(0, 300) : undefined,
    })
    res.status(201).json(doc)
  } catch (err) { next(err) } // out-of-range values surface as a clean 400 via the Mongoose validation handler
})

// DELETE /api/member-portal/progress/measurements/:id
router.delete('/measurements/:id', async (req, res, next) => {
  try {
    const r = await BodyMeasurement.findOneAndDelete({ _id: req.params.id, memberId: req.memberId })
    if (!r) return res.status(404).json({ message: 'Measurement not found' })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

export default router
