import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import MemberWorkoutLog from '../models/MemberWorkoutLog.js'
import PTSession from '../models/PTSession.js'
import Member from '../models/Member.js'
import { estimateCaloriesBurned } from '../utils/calories.js'
import { istStartOfDay, istEndOfDay } from '../utils/dateIST.js'

const router = Router()
router.use(memberProtect)

/**
 * Estimate calories the same way PT sessions do — filling in a bodyweight
 * from the member's most recent logged entry (across BOTH self-logged
 * workouts and PT sessions) if this one doesn't have one yet.
 */
async function resolveCalories({ gymId, memberId, excludeId, bodyWeight, durationMinutes, exercises }) {
  let weightKg = Number(bodyWeight) || null

  if (!weightKg) {
    const [lastLog, lastSession] = await Promise.all([
      MemberWorkoutLog.findOne({
        gymId, memberId, bodyWeight: { $exists: true, $ne: null },
        ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      }).sort({ date: -1 }).select('bodyWeight date'),
      PTSession.findOne({
        gymId, memberId, bodyWeight: { $exists: true, $ne: null },
      }).sort({ date: -1 }).select('bodyWeight date'),
    ])
    const candidates = [lastLog, lastSession].filter(Boolean).sort((a, b) => new Date(b.date) - new Date(a.date))
    weightKg = candidates[0]?.bodyWeight || null
  }
  if (!weightKg) return null

  const member = await Member.findOne({ _id: memberId, gymId }).select('height')
  return estimateCaloriesBurned({ heightCm: member?.height, weightKg, durationMinutes, exercises })
}

/** POST /api/member-portal/workout-logs — log a self-tracked workout */
router.post('/', async (req, res, next) => {
  try {
    const { title, date, durationMinutes, exercises, bodyWeight, notes } = req.body

    const cleanExercises = Array.isArray(exercises)
      ? exercises.filter((e) => e?.name?.trim()).map((e) => ({
          name: String(e.name).slice(0, 120),
          sets: e.sets !== undefined && e.sets !== '' ? Number(e.sets) : undefined,
          reps: e.reps !== undefined && e.reps !== '' ? String(e.reps).slice(0, 20) : undefined,
          weight: e.weight !== undefined && e.weight !== '' ? Number(e.weight) : undefined,
          muscleGroup: e.muscleGroup ? String(e.muscleGroup).slice(0, 30) : undefined,
        }))
      : []

    const durationMin = durationMinutes ? Number(durationMinutes) : 60
    const bw = bodyWeight ? Number(bodyWeight) : undefined
    const when = date ? new Date(date) : new Date()

    const caloriesBurned = await resolveCalories({
      gymId: req.gymId, memberId: req.memberId,
      bodyWeight: bw, durationMinutes: durationMin, exercises: cleanExercises,
    })

    const log = await MemberWorkoutLog.create({
      gymId: req.gymId,
      memberId: req.memberId,
      date: when,
      title: title?.trim() || 'Workout',
      durationMinutes: durationMin,
      exercises: cleanExercises,
      bodyWeight: bw,
      notes: notes || '',
      caloriesBurned,
    })

    res.status(201).json(log)
  } catch (err) { next(err) }
})

/** GET /api/member-portal/workout-logs — recent self-logged workouts, optionally date-ranged */
router.get('/', async (req, res, next) => {
  try {
    const { limit = 30, from, to } = req.query
    const filter = { gymId: req.gymId, memberId: req.memberId }
    if (from || to) {
      filter.date = {}
      // See memberPortal.ptSession.routes.js for why this can't be a plain
      // `new Date(to)` — that casts to UTC midnight (5:30am IST), silently
      // dropping same-day logs made later than that.
      if (from) filter.date.$gte = istStartOfDay(from)
      if (to) filter.date.$lte = istEndOfDay(to)
    }
    const logs = await MemberWorkoutLog.find(filter)
      .sort({ date: -1 })
      .limit(Number(limit))
    res.json({ logs })
  } catch (err) { next(err) }
})

/**
 * GET /api/member-portal/workout-logs/progress/body-weight
 * Combined bodyweight + calories-burned time series from self-logged
 * workouts AND PT sessions — one unified graph regardless of where a
 * member's weight/session was recorded.
 * MUST be registered before GET /:id.
 */
router.get('/progress/body-weight', async (req, res, next) => {
  try {
    const [weightLogs, weightSessions, calorieLogs, calorieSessions] = await Promise.all([
      MemberWorkoutLog.find({ gymId: req.gymId, memberId: req.memberId, bodyWeight: { $exists: true, $ne: null } })
        .select('date bodyWeight').sort({ date: 1 }),
      PTSession.find({ gymId: req.gymId, memberId: req.memberId, bodyWeight: { $exists: true, $ne: null } })
        .select('date bodyWeight').sort({ date: 1 }),
      MemberWorkoutLog.find({ gymId: req.gymId, memberId: req.memberId, caloriesBurned: { $exists: true, $ne: null } })
        .select('date caloriesBurned').sort({ date: 1 }),
      PTSession.find({ gymId: req.gymId, memberId: req.memberId, caloriesBurned: { $exists: true, $ne: null } })
        .select('date caloriesBurned').sort({ date: 1 }),
    ])

    // Keyed by day so a bodyWeight entry and a caloriesBurned entry from
    // the same date/session merge into one point instead of two.
    const byDay = new Map()
    function upsert(date, patch) {
      const key = new Date(date).toDateString()
      const existing = byDay.get(key) || { date }
      byDay.set(key, { ...existing, ...patch })
    }
    for (const l of weightLogs)     upsert(l.date, { bodyWeight: l.bodyWeight })
    for (const s of weightSessions) upsert(s.date, { bodyWeight: s.bodyWeight })
    for (const l of calorieLogs)     upsert(l.date, { caloriesBurned: l.caloriesBurned })
    for (const s of calorieSessions) upsert(s.date, { caloriesBurned: s.caloriesBurned })

    const points = [...byDay.values()].sort((a, b) => new Date(a.date) - new Date(b.date))

    res.json({ points })
  } catch (err) { next(err) }
})

/** GET /api/member-portal/workout-logs/:id */
router.get('/:id', async (req, res, next) => {
  try {
    const log = await MemberWorkoutLog.findOne({ _id: req.params.id, gymId: req.gymId, memberId: req.memberId })
    if (!log) return res.status(404).json({ message: 'Workout log not found' })
    res.json(log)
  } catch (err) { next(err) }
})

/** PATCH /api/member-portal/workout-logs/:id — edit a self-logged workout */
router.patch('/:id', async (req, res, next) => {
  try {
    const log = await MemberWorkoutLog.findOne({ _id: req.params.id, gymId: req.gymId, memberId: req.memberId })
    if (!log) return res.status(404).json({ message: 'Workout log not found' })

    const { title, date, durationMinutes, exercises, bodyWeight, notes } = req.body

    if (title !== undefined) log.title = title.trim() || 'Workout'
    if (date !== undefined) log.date = new Date(date)
    if (durationMinutes !== undefined) log.durationMinutes = Number(durationMinutes) || 60
    if (notes !== undefined) log.notes = notes
    if (bodyWeight !== undefined) log.bodyWeight = bodyWeight === '' ? undefined : Number(bodyWeight)
    if (exercises !== undefined) {
      log.exercises = Array.isArray(exercises)
        ? exercises.filter((e) => e?.name?.trim()).map((e) => ({
            name: String(e.name).slice(0, 120),
            sets: e.sets !== undefined && e.sets !== '' ? Number(e.sets) : undefined,
            reps: e.reps !== undefined && e.reps !== '' ? String(e.reps).slice(0, 20) : undefined,
            weight: e.weight !== undefined && e.weight !== '' ? Number(e.weight) : undefined,
            muscleGroup: e.muscleGroup ? String(e.muscleGroup).slice(0, 30) : undefined,
          }))
        : log.exercises
    }

    log.caloriesBurned = await resolveCalories({
      gymId: req.gymId, memberId: req.memberId, excludeId: log._id,
      bodyWeight: log.bodyWeight, durationMinutes: log.durationMinutes, exercises: log.exercises,
    })

    await log.save()
    res.json(log)
  } catch (err) { next(err) }
})

/** DELETE /api/member-portal/workout-logs/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    const log = await MemberWorkoutLog.findOneAndDelete({ _id: req.params.id, gymId: req.gymId, memberId: req.memberId })
    if (!log) return res.status(404).json({ message: 'Workout log not found' })
    res.json({ message: 'Deleted' })
  } catch (err) { next(err) }
})

export default router
