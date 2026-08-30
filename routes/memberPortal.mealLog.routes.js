import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import { uploadImage, handleUploadErrors } from '../middleware/upload.js'
import { uploadImageBuffer, deleteAsset } from '../services/cloudinaryUpload.service.js'
import MealLog, { MEAL_TYPE_OPTIONS } from '../models/MealLog.js'

const router = Router()
router.use(memberProtect)

// ── GET /api/member-portal/meal-log ──────────────────────────────────────
// Most-recent-first. Optional ?limit (default 100, hard cap 200) and
// ?date=YYYY-MM-DD to scope to a single calendar day (used by the "jump to
// a day" view, if the frontend ever adds one — harmless if unused).
router.get('/', async (req, res, next) => {
  try {
    const { limit = 100, date } = req.query
    const query = { gymId: req.gymId, memberId: req.memberId }

    if (date) {
      const start = new Date(`${date}T00:00:00.000Z`)
      const end = new Date(`${date}T23:59:59.999Z`)
      if (!Number.isNaN(start.getTime())) query.eatenAt = { $gte: start, $lte: end }
    }

    const logs = await MealLog.find(query)
      .sort({ eatenAt: -1 })
      .limit(Math.min(Number(limit) || 100, 200))

    res.json({ logs, mealTypes: MEAL_TYPE_OPTIONS })
  } catch (err) { next(err) }
})

// ── POST /api/member-portal/meal-log ─────────────────────────────────────
// multipart/form-data — field "image", plus mealType/eatenAt/note.
router.post('/', handleUploadErrors(uploadImage), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'A photo of your meal is required' })

    const mealType = MEAL_TYPE_OPTIONS.includes(req.body.mealType) ? req.body.mealType : 'Snack'

    // Defaults to right now if the client didn't send one — the frontend
    // always sends the current date/time pre-filled (editable), so this
    // fallback mainly guards against a malformed request.
    const eatenAt = req.body.eatenAt ? new Date(req.body.eatenAt) : new Date()
    if (Number.isNaN(eatenAt.getTime())) return res.status(400).json({ message: 'Invalid date/time' })

    const uploaded = await uploadImageBuffer(req.file.buffer, 'fitos/meal-log')

    const log = await MealLog.create({
      gymId: req.gymId,
      memberId: req.memberId,
      mealType,
      eatenAt,
      note: (req.body.note || '').slice(0, 300),
      photoUrl: uploaded.url,
      photoPublicId: uploaded.publicId,
    })

    res.status(201).json(log)
  } catch (err) { next(err) }
})

// ── PATCH /api/member-portal/meal-log/:id ────────────────────────────────
// Metadata only (mealType/eatenAt/note) — to change the photo itself,
// delete and re-add, same convention as TransformationPhoto.
router.patch('/:id', async (req, res, next) => {
  try {
    const log = await MealLog.findOne({ _id: req.params.id, gymId: req.gymId, memberId: req.memberId })
    if (!log) return res.status(404).json({ message: 'Meal log not found' })

    if (req.body.mealType !== undefined) {
      if (!MEAL_TYPE_OPTIONS.includes(req.body.mealType)) {
        return res.status(400).json({ message: 'Invalid meal type' })
      }
      log.mealType = req.body.mealType
    }
    if (req.body.eatenAt !== undefined) {
      const eatenAt = new Date(req.body.eatenAt)
      if (Number.isNaN(eatenAt.getTime())) return res.status(400).json({ message: 'Invalid date/time' })
      log.eatenAt = eatenAt
    }
    if (req.body.note !== undefined) {
      log.note = String(req.body.note).slice(0, 300)
    }

    await log.save()
    res.json(log)
  } catch (err) { next(err) }
})

// ── DELETE /api/member-portal/meal-log/:id ───────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const log = await MealLog.findOne({ _id: req.params.id, gymId: req.gymId, memberId: req.memberId })
    if (!log) return res.status(404).json({ message: 'Meal log not found' })

    await deleteAsset(log.photoPublicId, 'image')
    await log.deleteOne()

    res.json({ message: 'Meal log removed' })
  } catch (err) { next(err) }
})

export default router
