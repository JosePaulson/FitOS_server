import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import Equipment from '../models/Equipment.js'
import { protect, authorize } from '../middleware/auth.js'
import { uploadImage, handleUploadErrors } from '../middleware/upload.js'
import { uploadImageBuffer, deleteAsset } from '../services/cloudinaryUpload.service.js'

const router = Router()

function validate(req, res) {
  const errs = validationResult(req)
  if (!errs.isEmpty()) { res.status(400).json({ message: errs.array()[0].msg }); return false }
  return true
}

// GET /api/equipment — any staff role can view
router.get('/', protect, async (req, res, next) => {
  try {
    const { category } = req.query
    const filter = { gymId: req.gymId, isActive: true }
    if (category) filter.category = category
    const equipment = await Equipment.find(filter).sort({ name: 1 })
    res.json(equipment)
  } catch (err) { next(err) }
})

// GET /api/equipment/:id
router.get('/:id', protect, async (req, res, next) => {
  try {
    const item = await Equipment.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!item) return res.status(404).json({ message: 'Equipment not found' })
    res.json(item)
  } catch (err) { next(err) }
})

// POST /api/equipment — owner, manager, trainer
router.post('/',
  protect,
  authorize('owner', 'manager', 'trainer'),
  handleUploadErrors(uploadImage),
  [body('name').notEmpty().withMessage('Equipment name is required')],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { name, category, description } = req.body
      let imageUrl = '', imagePublicId = ''

      if (req.file) {
        const uploaded = await uploadImageBuffer(req.file.buffer, 'fitos/equipment')
        imageUrl      = uploaded.url
        imagePublicId = uploaded.publicId
      }

      const equipment = await Equipment.create({
        gymId: req.gymId, name, category, description,
        imageUrl, imagePublicId,
      })
      res.status(201).json(equipment)
    } catch (err) { next(err) }
  }
)

// PATCH /api/equipment/:id — owner, manager, trainer
router.patch('/:id',
  protect,
  authorize('owner', 'manager', 'trainer'),
  handleUploadErrors(uploadImage),
  async (req, res, next) => {
    try {
      const equipment = await Equipment.findOne({ _id: req.params.id, gymId: req.gymId })
      if (!equipment) return res.status(404).json({ message: 'Equipment not found' })

      const { name, category, description, isActive } = req.body
      if (name        !== undefined) equipment.name        = name
      if (category    !== undefined) equipment.category    = category
      if (description !== undefined) equipment.description = description
      if (isActive    !== undefined) equipment.isActive     = isActive === 'true' || isActive === true

      // Replace image if a new one was uploaded
      if (req.file) {
        const oldPublicId = equipment.imagePublicId
        const uploaded = await uploadImageBuffer(req.file.buffer, 'fitos/equipment')
        equipment.imageUrl      = uploaded.url
        equipment.imagePublicId = uploaded.publicId
        if (oldPublicId) deleteAsset(oldPublicId, 'image')   // fire-and-forget cleanup
      }

      await equipment.save()
      res.json(equipment)
    } catch (err) { next(err) }
  }
)

// DELETE /api/equipment/:id — owner, manager
router.delete('/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const equipment = await Equipment.findOneAndDelete({ _id: req.params.id, gymId: req.gymId })
    if (!equipment) return res.status(404).json({ message: 'Equipment not found' })
    if (equipment.imagePublicId) deleteAsset(equipment.imagePublicId, 'image')
    res.json({ message: 'Equipment deleted' })
  } catch (err) { next(err) }
})

export default router
