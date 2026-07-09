import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import WorkoutLibrary from '../models/WorkoutLibrary.js'
import { protect, authorize } from '../middleware/auth.js'
import { uploadWorkoutMedia, handleUploadErrors } from '../middleware/upload.js'
import { uploadImageBuffer, uploadVideoBuffer, deleteAsset } from '../services/cloudinaryUpload.service.js'

const router = Router()
const MAX_VIDEO_SECONDS = 20

function validate(req, res) {
  const errs = validationResult(req)
  if (!errs.isEmpty()) { res.status(400).json({ message: errs.array()[0].msg }); return false }
  return true
}

// GET /api/workout-library — any staff role can view
router.get('/', protect, async (req, res, next) => {
  try {
    const { category } = req.query
    const filter = { gymId: req.gymId, isActive: true }
    if (category) filter.category = category
    const workouts = await WorkoutLibrary.find(filter).sort({ name: 1 })
    res.json(workouts)
  } catch (err) { next(err) }
})

// GET /api/workout-library/:id
router.get('/:id', protect, async (req, res, next) => {
  try {
    const item = await WorkoutLibrary.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!item) return res.status(404).json({ message: 'Workout not found' })
    res.json(item)
  } catch (err) { next(err) }
})

// POST /api/workout-library — owner, manager, trainer
router.post('/',
  protect,
  authorize('owner', 'manager', 'trainer'),
  handleUploadErrors(uploadWorkoutMedia),
  [body('name').notEmpty().withMessage('Workout name is required')],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { name, category, description } = req.body
      const doc = { gymId: req.gymId, name, category, description }

      if (req.files?.image?.[0]) {
        const img = await uploadImageBuffer(req.files.image[0].buffer, 'fitos/workouts')
        doc.imageUrl      = img.url
        doc.imagePublicId = img.publicId
      }

      if (req.files?.video?.[0]) {
        try {
          const vid = await uploadVideoBuffer(req.files.video[0].buffer, 'fitos/workouts', MAX_VIDEO_SECONDS)
          doc.videoUrl         = vid.url
          doc.videoPublicId    = vid.publicId
          doc.videoDurationSec = vid.duration
        } catch (videoErr) {
          // Roll back the image we just uploaded, if any, so we don't leave
          // a half-created workout's media orphaned in Cloudinary.
          if (doc.imagePublicId) deleteAsset(doc.imagePublicId, 'image')
          return res.status(400).json({ message: videoErr.message })
        }
      }

      const workout = await WorkoutLibrary.create(doc)
      res.status(201).json(workout)
    } catch (err) { next(err) }
  }
)

// PATCH /api/workout-library/:id — owner, manager, trainer
router.patch('/:id',
  protect,
  authorize('owner', 'manager', 'trainer'),
  handleUploadErrors(uploadWorkoutMedia),
  async (req, res, next) => {
    try {
      const workout = await WorkoutLibrary.findOne({ _id: req.params.id, gymId: req.gymId })
      if (!workout) return res.status(404).json({ message: 'Workout not found' })

      const { name, category, description, isActive } = req.body
      if (name        !== undefined) workout.name        = name
      if (category    !== undefined) workout.category    = category
      if (description !== undefined) workout.description = description
      if (isActive    !== undefined) workout.isActive     = isActive === 'true' || isActive === true

      if (req.files?.image?.[0]) {
        const oldPublicId = workout.imagePublicId
        const img = await uploadImageBuffer(req.files.image[0].buffer, 'fitos/workouts')
        workout.imageUrl      = img.url
        workout.imagePublicId = img.publicId
        if (oldPublicId) deleteAsset(oldPublicId, 'image')
      }

      if (req.files?.video?.[0]) {
        const vid = await uploadVideoBuffer(req.files.video[0].buffer, 'fitos/workouts', MAX_VIDEO_SECONDS)
        // Only replace after the new upload succeeds (uploadVideoBuffer
        // already rejects + cleans itself up if it's too long)
        const oldPublicId = workout.videoPublicId
        workout.videoUrl         = vid.url
        workout.videoPublicId    = vid.publicId
        workout.videoDurationSec = vid.duration
        if (oldPublicId) deleteAsset(oldPublicId, 'video')
      }

      await workout.save()
      res.json(workout)
    } catch (err) { next(err) }
  }
)

// DELETE /api/workout-library/:id — owner, manager
router.delete('/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const workout = await WorkoutLibrary.findOneAndDelete({ _id: req.params.id, gymId: req.gymId })
    if (!workout) return res.status(404).json({ message: 'Workout not found' })
    if (workout.imagePublicId) deleteAsset(workout.imagePublicId, 'image')
    if (workout.videoPublicId) deleteAsset(workout.videoPublicId, 'video')
    res.json({ message: 'Workout deleted' })
  } catch (err) { next(err) }
})

export default router
