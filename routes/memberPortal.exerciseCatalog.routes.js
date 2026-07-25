import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import ExerciseCategory from '../models/ExerciseCategory.js'
import Exercise from '../models/Exercise.js'
import { DEFAULT_CATEGORIES, DEFAULT_EXERCISES } from '../utils/exerciseCatalogDefaults.js'

const router = Router()
router.use(memberProtect)

// Mirrors the admin-side seeding so a member's very first request also
// gets a fully populated catalog, even if no admin has opened the
// management page yet.
async function ensureSeeded(gymId) {
  const existing = await ExerciseCategory.countDocuments({ gymId })
  if (existing > 0) return

  await ExerciseCategory.insertMany(
    DEFAULT_CATEGORIES.map((c) => ({ gymId, key: c.key, label: c.label, order: c.order }))
  )
  const exerciseDocs = Object.entries(DEFAULT_EXERCISES).flatMap(([categoryKey, names]) =>
    names.map((name) => ({ gymId, categoryKey, name }))
  )
  await Exercise.insertMany(exerciseDocs)
}

// GET /api/member-portal/exercise-catalog — the gym's categories + exercises
// in one call, shaped for the workout-log "muscle group chips + name
// suggestions" UI.
router.get('/', async (req, res, next) => {
  try {
    await ensureSeeded(req.gymId)
    const [categories, exercises] = await Promise.all([
      ExerciseCategory.find({ gymId: req.gymId }).sort({ order: 1, label: 1 }),
      Exercise.find({ gymId: req.gymId }).sort({ name: 1 }),
    ])

    const catalog = {}
    for (const ex of exercises) {
      if (!catalog[ex.categoryKey]) catalog[ex.categoryKey] = []
      catalog[ex.categoryKey].push(ex.name)
    }

    res.json({
      muscleGroups: categories.map((c) => ({ key: c.key, label: c.label })),
      catalog,
    })
  } catch (err) { next(err) }
})

export default router
