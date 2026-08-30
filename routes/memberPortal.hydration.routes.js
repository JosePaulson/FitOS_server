import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import HydrationSchedule from '../models/HydrationSchedule.js'

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const router = Router()
router.use(memberProtect)

// ── GET /api/member-portal/hydration ─────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const schedule = await HydrationSchedule.findOne({ gymId: req.gymId, memberId: req.memberId })
    res.json({ enabled: schedule?.enabled || false, times: schedule?.times || [] })
  } catch (err) { next(err) }
})

// ── PUT /api/member-portal/hydration ──────────────────────────────────────
// Full replace of { enabled, times } — the frontend always sends the
// complete desired state, so this is a simple upsert rather than a patch.
router.put('/', async (req, res, next) => {
  try {
    const enabled = !!req.body.enabled
    const times = Array.isArray(req.body.times)
      ? [...new Set(req.body.times.filter((t) => TIME_RE.test(t)))].sort()
      : []

    const schedule = await HydrationSchedule.findOneAndUpdate(
      { gymId: req.gymId, memberId: req.memberId },
      { $set: { enabled, times } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    )

    res.json({ enabled: schedule.enabled, times: schedule.times })
  } catch (err) { next(err) }
})

export default router
