import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import { uploadImage, handleUploadErrors } from '../middleware/upload.js'
import { uploadImageBuffer, deleteAsset } from '../services/cloudinaryUpload.service.js'
import TransformationPhoto from '../models/TransformationPhoto.js'

const router = Router()
router.use(memberProtect)

// ── GET /api/member-portal/transformation ───────────────────────────────────
// Chronological (oldest first) — the natural order for a before→now story,
// and lets the frontend just grab the first/last entries for a comparison.
router.get('/', async (req, res, next) => {
  try {
    const photos = await TransformationPhoto.find({ gymId: req.gymId, memberId: req.memberId })
      .sort({ date: 1 })
    res.json(photos)
  } catch (err) { next(err) }
})

// ── POST /api/member-portal/transformation ──────────────────────────────────
// multipart/form-data — field "image", plus date/weight/note.
router.post('/', handleUploadErrors(uploadImage), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'A photo is required' })

    const date = req.body.date ? new Date(req.body.date) : new Date()
    if (Number.isNaN(date.getTime())) return res.status(400).json({ message: 'Invalid date' })

    let weight = null
    if (req.body.weight !== undefined && req.body.weight !== '') {
      weight = Number(req.body.weight)
      if (Number.isNaN(weight) || weight <= 0) return res.status(400).json({ message: 'Invalid weight' })
    }

    const uploaded = await uploadImageBuffer(req.file.buffer, 'fitos/transformation')

    const photo = await TransformationPhoto.create({
      gymId: req.gymId,
      memberId: req.memberId,
      date,
      weight,
      note: (req.body.note || '').slice(0, 300),
      photoUrl: uploaded.url,
      photoPublicId: uploaded.publicId,
    })

    res.status(201).json(photo)
  } catch (err) { next(err) }
})

// ── PATCH /api/member-portal/transformation/:id ─────────────────────────────
// Metadata only (date/weight/note) — to change the photo itself, delete
// and re-add.
router.patch('/:id', async (req, res, next) => {
  try {
    const photo = await TransformationPhoto.findOne({ _id: req.params.id, gymId: req.gymId, memberId: req.memberId })
    if (!photo) return res.status(404).json({ message: 'Photo not found' })

    if (req.body.date !== undefined) {
      const date = new Date(req.body.date)
      if (Number.isNaN(date.getTime())) return res.status(400).json({ message: 'Invalid date' })
      photo.date = date
    }
    if (req.body.weight !== undefined) {
      if (req.body.weight === null || req.body.weight === '') {
        photo.weight = null
      } else {
        const weight = Number(req.body.weight)
        if (Number.isNaN(weight) || weight <= 0) return res.status(400).json({ message: 'Invalid weight' })
        photo.weight = weight
      }
    }
    if (req.body.note !== undefined) {
      photo.note = String(req.body.note).slice(0, 300)
    }

    await photo.save()
    res.json(photo)
  } catch (err) { next(err) }
})

// ── DELETE /api/member-portal/transformation/:id ────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const photo = await TransformationPhoto.findOne({ _id: req.params.id, gymId: req.gymId, memberId: req.memberId })
    if (!photo) return res.status(404).json({ message: 'Photo not found' })

    await deleteAsset(photo.photoPublicId, 'image')
    await photo.deleteOne()

    res.json({ message: 'Photo removed' })
  } catch (err) { next(err) }
})

export default router
