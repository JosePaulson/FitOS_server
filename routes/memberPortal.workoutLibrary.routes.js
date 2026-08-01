import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import WorkoutLibrary from '../models/WorkoutLibrary.js'

const router = Router()
router.use(memberProtect)

// GET /api/member-portal/workout-library — read-only, for the member's
// "Workout Videos" tab. Categories match the gym's exercise catalog (see
// GET /api/member-portal/exercise-catalog), so the two stay in sync.
router.get('/', async (req, res, next) => {
  try {
    const { category } = req.query
    const filter = { gymId: req.gymId, isActive: true }
    if (category) filter.category = category
    const workouts = await WorkoutLibrary.find(filter).sort({ category: 1, order: 1, name: 1 })
    res.json(workouts)
  } catch (err) { next(err) }
})

export default router
