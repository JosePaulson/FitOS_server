import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import ExerciseCategory from '../models/ExerciseCategory.js'
import Exercise from '../models/Exercise.js'
import { protect, authorize } from '../middleware/auth.js'
import { DEFAULT_CATEGORIES, DEFAULT_EXERCISES } from '../utils/exerciseCatalogDefaults.js'

const router = Router()

function validate(req, res) {
  const errs = validationResult(req)
  if (!errs.isEmpty()) { res.status(400).json({ message: errs.array()[0].msg }); return false }
  return true
}

// Seeds a gym's catalog from the shared defaults the first time it's
// requested, so every gym starts fully populated and admins only ever
// need to *edit* from there rather than build a catalog from scratch.
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

/* ── Categories ───────────────────────────────────────────────────────── */

// GET /api/exercise-catalog/categories — any staff role can view
router.get('/categories', protect, async (req, res, next) => {
  try {
    await ensureSeeded(req.gymId)
    const categories = await ExerciseCategory.find({ gymId: req.gymId }).sort({ order: 1, label: 1 })
    res.json(categories)
  } catch (err) { next(err) }
})

// POST /api/exercise-catalog/categories — owner, manager
router.post('/categories',
  protect,
  authorize('owner', 'manager'),
  [
    body('label').trim().notEmpty().withMessage('Category name is required'),
    body('key').optional().trim(),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const label = req.body.label.trim()
      const key = (req.body.key || label).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      if (!key) return res.status(400).json({ message: 'Could not derive a valid key from that name' })

      const dupe = await ExerciseCategory.findOne({ gymId: req.gymId, key })
      if (dupe) return res.status(409).json({ message: 'A category with that name already exists' })

      const count = await ExerciseCategory.countDocuments({ gymId: req.gymId })
      const category = await ExerciseCategory.create({ gymId: req.gymId, key, label, order: count })
      res.status(201).json(category)
    } catch (err) { next(err) }
  }
)

// PATCH /api/exercise-catalog/categories/:id — owner, manager
router.patch('/categories/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const category = await ExerciseCategory.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!category) return res.status(404).json({ message: 'Category not found' })

    const { label, order } = req.body
    if (label !== undefined && label.trim()) category.label = label.trim()
    if (order !== undefined) category.order = Number(order)

    await category.save()
    res.json(category)
  } catch (err) { next(err) }
})

// DELETE /api/exercise-catalog/categories/:id — owner, manager
// Cascades: also removes every exercise filed under this category, since
// an orphaned exercise (no valid category) can't be selected anywhere.
router.delete('/categories/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const category = await ExerciseCategory.findOneAndDelete({ _id: req.params.id, gymId: req.gymId })
    if (!category) return res.status(404).json({ message: 'Category not found' })
    const { deletedCount } = await Exercise.deleteMany({ gymId: req.gymId, categoryKey: category.key })
    res.json({ message: 'Category deleted', exercisesRemoved: deletedCount })
  } catch (err) { next(err) }
})

/* ── Exercises ────────────────────────────────────────────────────────── */

// GET /api/exercise-catalog/exercises — any staff role can view
router.get('/exercises', protect, async (req, res, next) => {
  try {
    await ensureSeeded(req.gymId)
    const filter = { gymId: req.gymId }
    if (req.query.category) filter.categoryKey = req.query.category
    const exercises = await Exercise.find(filter).sort({ name: 1 })
    res.json(exercises)
  } catch (err) { next(err) }
})

// POST /api/exercise-catalog/exercises — owner, manager
router.post('/exercises',
  protect,
  authorize('owner', 'manager'),
  [
    body('name').trim().notEmpty().withMessage('Exercise name is required'),
    body('categoryKey').trim().notEmpty().withMessage('Category is required'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const categoryKey = req.body.categoryKey.trim().toLowerCase()
      const category = await ExerciseCategory.findOne({ gymId: req.gymId, key: categoryKey })
      if (!category) return res.status(400).json({ message: 'Unknown category' })

      const name = req.body.name.trim()
      const dupe = await Exercise.findOne({ gymId: req.gymId, categoryKey, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })
      if (dupe) return res.status(409).json({ message: 'That exercise already exists in this category' })

      const exercise = await Exercise.create({ gymId: req.gymId, categoryKey, name })
      res.status(201).json(exercise)
    } catch (err) { next(err) }
  }
)

// PATCH /api/exercise-catalog/exercises/:id — owner, manager
router.patch('/exercises/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const exercise = await Exercise.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!exercise) return res.status(404).json({ message: 'Exercise not found' })

    const { name, categoryKey } = req.body
    if (categoryKey !== undefined && categoryKey.trim()) {
      const category = await ExerciseCategory.findOne({ gymId: req.gymId, key: categoryKey.trim().toLowerCase() })
      if (!category) return res.status(400).json({ message: 'Unknown category' })
      exercise.categoryKey = category.key
    }
    if (name !== undefined && name.trim()) exercise.name = name.trim()

    await exercise.save()
    res.json(exercise)
  } catch (err) { next(err) }
})

// DELETE /api/exercise-catalog/exercises/:id — owner, manager
router.delete('/exercises/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const exercise = await Exercise.findOneAndDelete({ _id: req.params.id, gymId: req.gymId })
    if (!exercise) return res.status(404).json({ message: 'Exercise not found' })
    res.json({ message: 'Exercise deleted' })
  } catch (err) { next(err) }
})

export default router
