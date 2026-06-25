import { Router } from 'express'
import WorkoutPlan from '../models/WorkoutPlan.js'
import DietPlan    from '../models/DietPlan.js'
import { protect, authorize } from '../middleware/auth.js'

const router = Router()

// ── Workout Plans ──────────────────────────────────────────────────────────

router.get('/workout', protect, async (req, res, next) => {
  try {
    const { memberId, templates } = req.query
    const filter = { gymId: req.gymId, isActive: true }
    if (templates === 'true') filter.isTemplate = true
    if (memberId) filter.assignedTo = memberId
    const plans = await WorkoutPlan.find(filter).sort({ createdAt: -1 }).populate('assignedTo', 'name').populate('createdBy', 'name')
    res.json(plans)
  } catch (err) { next(err) }
})

router.get('/workout/:id', protect, async (req, res, next) => {
  try {
    const plan = await WorkoutPlan.findOne({ _id: req.params.id, gymId: req.gymId }).populate('assignedTo', 'name phone')
    if (!plan) return res.status(404).json({ message: 'Workout plan not found' })
    res.json(plan)
  } catch (err) { next(err) }
})

router.post('/workout', protect, authorize('owner', 'manager', 'trainer'), async (req, res, next) => {
  try {
    const { name, description, goal, durationWeeks, days, isTemplate } = req.body
    if (!name) return res.status(400).json({ message: 'Plan name is required' })
    const plan = await WorkoutPlan.create({ gymId: req.gymId, name, description, goal, durationWeeks, days: days || [], isTemplate: !!isTemplate, createdBy: req.user._id })
    res.status(201).json(plan)
  } catch (err) { next(err) }
})

router.patch('/workout/:id', protect, authorize('owner', 'manager', 'trainer'), async (req, res, next) => {
  try {
    const allowed = ['name','description','goal','durationWeeks','days','isTemplate']
    const updates = {}
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k] })
    const plan = await WorkoutPlan.findOneAndUpdate({ _id: req.params.id, gymId: req.gymId }, updates, { new: true })
    if (!plan) return res.status(404).json({ message: 'Workout plan not found' })
    res.json(plan)
  } catch (err) { next(err) }
})

router.post('/workout/:id/assign', protect, authorize('owner', 'manager', 'trainer'), async (req, res, next) => {
  try {
    const { memberIds } = req.body
    if (!Array.isArray(memberIds) || !memberIds.length) return res.status(400).json({ message: 'memberIds array required' })
    const plan = await WorkoutPlan.findOneAndUpdate({ _id: req.params.id, gymId: req.gymId }, { $addToSet: { assignedTo: { $each: memberIds } } }, { new: true })
    if (!plan) return res.status(404).json({ message: 'Workout plan not found' })
    res.json(plan)
  } catch (err) { next(err) }
})

router.delete('/workout/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    await WorkoutPlan.findOneAndUpdate({ _id: req.params.id, gymId: req.gymId }, { isActive: false })
    res.json({ message: 'Workout plan removed' })
  } catch (err) { next(err) }
})

// ── Diet Plans ─────────────────────────────────────────────────────────────

router.get('/diet', protect, async (req, res, next) => {
  try {
    const { memberId, templates } = req.query
    const filter = { gymId: req.gymId, isActive: true }
    if (templates === 'true') filter.isTemplate = true
    if (memberId) filter.assignedTo = memberId
    const plans = await DietPlan.find(filter).sort({ createdAt: -1 }).populate('assignedTo', 'name')
    res.json(plans)
  } catch (err) { next(err) }
})

router.post('/diet', protect, authorize('owner', 'manager', 'trainer'), async (req, res, next) => {
  try {
    const { name, description, goal, targetCalories, targetProtein, targetCarbs, targetFat, meals, isTemplate } = req.body
    if (!name) return res.status(400).json({ message: 'Plan name is required' })
    const plan = await DietPlan.create({ gymId: req.gymId, name, description, goal, targetCalories, targetProtein, targetCarbs, targetFat, meals: meals || [], isTemplate: !!isTemplate, createdBy: req.user._id })
    res.status(201).json(plan)
  } catch (err) { next(err) }
})

router.patch('/diet/:id', protect, authorize('owner', 'manager', 'trainer'), async (req, res, next) => {
  try {
    const allowed = ['name','description','goal','targetCalories','targetProtein','targetCarbs','targetFat','meals','isTemplate']
    const updates = {}
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k] })
    const plan = await DietPlan.findOneAndUpdate({ _id: req.params.id, gymId: req.gymId }, updates, { new: true })
    if (!plan) return res.status(404).json({ message: 'Diet plan not found' })
    res.json(plan)
  } catch (err) { next(err) }
})

router.post('/diet/:id/assign', protect, authorize('owner', 'manager', 'trainer'), async (req, res, next) => {
  try {
    const { memberIds } = req.body
    const plan = await DietPlan.findOneAndUpdate({ _id: req.params.id, gymId: req.gymId }, { $addToSet: { assignedTo: { $each: memberIds } } }, { new: true })
    if (!plan) return res.status(404).json({ message: 'Diet plan not found' })
    res.json(plan)
  } catch (err) { next(err) }
})

router.delete('/diet/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    await DietPlan.findOneAndUpdate({ _id: req.params.id, gymId: req.gymId }, { isActive: false })
    res.json({ message: 'Diet plan removed' })
  } catch (err) { next(err) }
})

export default router
