import { Router } from 'express'
import WorkoutPlan from '../models/WorkoutPlan.js'
import DietPlan    from '../models/DietPlan.js'
import { protect, authorize } from '../middleware/auth.js'
import { sendPushToMembers } from '../services/pushNotification.service.js'
import { seedPrebuiltPlansForGym } from '../utils/seedPrebuiltPlans.js'
import { uploadDietFile, handleUploadErrors } from '../middleware/upload.js'
import { uploadDocumentBuffer, deleteAsset } from '../services/cloudinaryUpload.service.js'

const router = Router()

// POST /api/workout-plans/seed-templates
// Lets an existing gym (registered before this feature existed) pull in
// the same starter workout/diet library that new gyms get automatically.
// Safe to call repeatedly — a no-op once templates already exist.
router.post('/seed-templates', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const result = await seedPrebuiltPlansForGym(req.gymId)
    const total = result.workoutsAdded + result.dietsAdded
    res.json({
      message: total > 0
        ? `Added ${result.workoutsAdded} workout plan(s) and ${result.dietsAdded} diet plan(s).`
        : 'Starter plans are already loaded for this gym.',
      ...result,
    })
  } catch (err) { next(err) }
})

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

    // Notify every member this plan is currently assigned to — fire-and-forget
    if (plan.assignedTo?.length) {
      sendPushToMembers(plan.assignedTo, {
        title: 'Workout plan updated',
        body:  `"${plan.name}" was just updated by your gym.`,
        url:   '/workouts',
        tag:   'workout-updated',
      }).catch((e) => console.error('[push] workout update failed:', e.message))
    }

    res.json(plan)
  } catch (err) { next(err) }
})

router.post('/workout/:id/assign', protect, authorize('owner', 'manager', 'trainer'), async (req, res, next) => {
  try {
    const { memberIds } = req.body
    if (!Array.isArray(memberIds) || !memberIds.length) return res.status(400).json({ message: 'memberIds array required' })
    const plan = await WorkoutPlan.findOneAndUpdate({ _id: req.params.id, gymId: req.gymId }, { $addToSet: { assignedTo: { $each: memberIds } } }, { new: true })
    if (!plan) return res.status(404).json({ message: 'Workout plan not found' })

    sendPushToMembers(memberIds, {
      title: 'New workout plan assigned',
      body:  `"${plan.name}" was just assigned to you.`,
      url:   '/workouts',
      tag:   'workout-updated',
    }).catch((e) => console.error('[push] workout assign failed:', e.message))

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

router.post('/diet', protect, authorize('owner', 'manager', 'trainer'), handleUploadErrors(uploadDietFile), async (req, res, next) => {
  try {
    const { name, description, goal, targetCalories, targetProtein, targetCarbs, targetFat, isTemplate } = req.body
    if (!name) return res.status(400).json({ message: 'Plan name is required' })

    let meals = []
    if (req.body.meals) {
      try { meals = JSON.parse(req.body.meals) } catch { meals = [] }
    }

    const doc = { gymId: req.gymId, name, description, goal, targetCalories, targetProtein, targetCarbs, targetFat, meals, isTemplate: !!isTemplate, createdBy: req.user._id }

    if (req.file) {
      const uploaded = await uploadDocumentBuffer(req.file.buffer, 'fitos/diet-plans', req.file.originalname)
      doc.fileUrl = uploaded.url
      doc.filePublicId = uploaded.publicId
      doc.fileResourceType = uploaded.resourceType
      doc.fileName = req.file.originalname
      doc.fileType = req.file.mimetype
      doc.fileSizeBytes = req.file.size
    }

    const plan = await DietPlan.create(doc)
    res.status(201).json(plan)
  } catch (err) { next(err) }
})

router.patch('/diet/:id', protect, authorize('owner', 'manager', 'trainer'), handleUploadErrors(uploadDietFile), async (req, res, next) => {
  try {
    const existing = await DietPlan.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!existing) return res.status(404).json({ message: 'Diet plan not found' })

    const allowed = ['name','description','goal','targetCalories','targetProtein','targetCarbs','targetFat','isTemplate']
    const updates = {}
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k] })
    if (req.body.meals !== undefined) {
      try { updates.meals = JSON.parse(req.body.meals) } catch { /* leave meals untouched if unparsable */ }
    }

    // A newly uploaded file replaces any existing one; `removeFile: true`
    // (with no new file) clears an existing attachment instead. Either
    // way the old Cloudinary asset is cleaned up rather than orphaned.
    if (req.file) {
      if (existing.filePublicId) await deleteAsset(existing.filePublicId, existing.fileResourceType || 'raw')
      const uploaded = await uploadDocumentBuffer(req.file.buffer, 'fitos/diet-plans', req.file.originalname)
      updates.fileUrl = uploaded.url
      updates.filePublicId = uploaded.publicId
      updates.fileResourceType = uploaded.resourceType
      updates.fileName = req.file.originalname
      updates.fileType = req.file.mimetype
      updates.fileSizeBytes = req.file.size
    } else if (req.body.removeFile === 'true' && existing.filePublicId) {
      await deleteAsset(existing.filePublicId, existing.fileResourceType || 'raw')
      updates.fileUrl = null
      updates.filePublicId = null
      updates.fileResourceType = null
      updates.fileName = null
      updates.fileType = null
      updates.fileSizeBytes = null
    }

    const plan = await DietPlan.findOneAndUpdate({ _id: req.params.id, gymId: req.gymId }, updates, { new: true })

    if (plan.assignedTo?.length) {
      sendPushToMembers(plan.assignedTo, {
        title: 'Diet plan updated',
        body:  `"${plan.name}" was just updated by your gym.`,
        url:   '/workouts',
        tag:   'diet-updated',
      }).catch((e) => console.error('[push] diet update failed:', e.message))
    }

    res.json(plan)
  } catch (err) { next(err) }
})

router.post('/diet/:id/assign', protect, authorize('owner', 'manager', 'trainer'), async (req, res, next) => {
  try {
    const { memberIds } = req.body
    const plan = await DietPlan.findOneAndUpdate({ _id: req.params.id, gymId: req.gymId }, { $addToSet: { assignedTo: { $each: memberIds } } }, { new: true })
    if (!plan) return res.status(404).json({ message: 'Diet plan not found' })

    sendPushToMembers(memberIds || [], {
      title: 'New diet plan assigned',
      body:  `"${plan.name}" was just assigned to you.`,
      url:   '/workouts',
      tag:   'diet-updated',
    }).catch((e) => console.error('[push] diet assign failed:', e.message))

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
