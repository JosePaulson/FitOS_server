import { Router } from 'express'
import TrainerAvailability from '../models/TrainerAvailability.js'
import TrainerTimeOff from '../models/TrainerTimeOff.js'
import User from '../models/User.js'
import { protect } from '../middleware/auth.js'
import { istStartOfDay } from '../utils/dateIST.js'

const router = Router()
router.use(protect)

// A trainer can manage their own availability; owner/manager can manage
// anyone's on their behalf.
function canManage(req, trainerId) {
  if (['owner', 'manager'].includes(req.user.role)) return true
  return req.user.role === 'trainer' && String(req.user._id) === String(trainerId)
}

/** GET /api/trainer-availability/:trainerId — weekly hours (creates a default doc on first read) */
router.get('/:trainerId', async (req, res, next) => {
  try {
    const trainer = await User.findOne({ _id: req.params.trainerId, gymId: req.gymId })
    if (!trainer) return res.status(404).json({ message: 'Trainer not found' })

    let availability = await TrainerAvailability.findOne({ gymId: req.gymId, trainerId: req.params.trainerId })
    if (!availability) {
      availability = await TrainerAvailability.create({ gymId: req.gymId, trainerId: req.params.trainerId })
    }
    res.json(availability)
  } catch (err) { next(err) }
})

/** PATCH /api/trainer-availability/:trainerId — update weekly working hours */
router.patch('/:trainerId', async (req, res, next) => {
  try {
    if (!canManage(req, req.params.trainerId)) {
      return res.status(403).json({ message: "You can only manage your own availability" })
    }
    const { weeklyHours, slotDurationMinutes } = req.body
    const updates = {}
    if (weeklyHours) updates.weeklyHours = weeklyHours
    if (slotDurationMinutes) updates.slotDurationMinutes = Number(slotDurationMinutes)

    const availability = await TrainerAvailability.findOneAndUpdate(
      { gymId: req.gymId, trainerId: req.params.trainerId },
      { $set: updates },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    )
    res.json(availability)
  } catch (err) { next(err) }
})

/** GET /api/trainer-availability/:trainerId/time-off — upcoming + recent time-off entries */
router.get('/:trainerId/time-off', async (req, res, next) => {
  try {
    const entries = await TrainerTimeOff.find({ gymId: req.gymId, trainerId: req.params.trainerId })
      .sort({ startDate: -1 })
      .limit(100)
    res.json(entries)
  } catch (err) { next(err) }
})

/** POST /api/trainer-availability/:trainerId/time-off — mark specific day(s) unavailable */
router.post('/:trainerId/time-off', async (req, res, next) => {
  try {
    if (!canManage(req, req.params.trainerId)) {
      return res.status(403).json({ message: "You can only manage your own availability" })
    }
    const { startDate, endDate, reason } = req.body
    if (!startDate) return res.status(400).json({ message: 'startDate required' })

    const entry = await TrainerTimeOff.create({
      gymId: req.gymId,
      trainerId: req.params.trainerId,
      startDate: istStartOfDay(startDate),
      endDate: istStartOfDay(endDate || startDate),
      reason: reason || '',
    })
    res.status(201).json(entry)
  } catch (err) { next(err) }
})

/** DELETE /api/trainer-availability/:trainerId/time-off/:id */
router.delete('/:trainerId/time-off/:id', async (req, res, next) => {
  try {
    if (!canManage(req, req.params.trainerId)) {
      return res.status(403).json({ message: "You can only manage your own availability" })
    }
    await TrainerTimeOff.findOneAndDelete({ _id: req.params.id, gymId: req.gymId, trainerId: req.params.trainerId })
    res.json({ message: 'Removed' })
  } catch (err) { next(err) }
})

export default router
