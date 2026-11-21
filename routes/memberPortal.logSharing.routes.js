import { Router } from 'express'
import mongoose from 'mongoose'
import { memberProtect } from '../middleware/memberAuth.js'
import Member from '../models/Member.js'
import User from '../models/User.js'

const router = Router()
router.use(memberProtect)

async function payload(gymId, member) {
  const trainers = await User.find({ gymId, role: 'trainer', isActive: true }).select('name').sort({ name: 1 }).lean()
  const s = member.logSharing || {}
  return {
    sharing: {
      workoutLogs: !!s.workoutLogs,
      mealLogs: !!s.mealLogs,
      trainerIds: (s.trainerIds || []).map(String),
    },
    trainers: trainers.map((t) => ({ _id: String(t._id), name: t.name })),
  }
}

// GET /api/member-portal/log-sharing — current choices + the gym's trainers to pick from
router.get('/', async (req, res, next) => {
  try {
    const member = await Member.findOne({ _id: req.memberId, gymId: req.gymId }).select('logSharing')
    if (!member) return res.status(404).json({ message: 'Member not found' })
    res.json(await payload(req.gymId, member))
  } catch (err) { next(err) }
})

// PUT /api/member-portal/log-sharing — { workoutLogs?, mealLogs?, trainerIds? }
router.put('/', async (req, res, next) => {
  try {
    const { workoutLogs, mealLogs, trainerIds } = req.body || {}
    const $set = {}
    if (workoutLogs !== undefined) $set['logSharing.workoutLogs'] = !!workoutLogs
    if (mealLogs !== undefined) $set['logSharing.mealLogs'] = !!mealLogs
    if (trainerIds !== undefined) {
      if (!Array.isArray(trainerIds)) return res.status(400).json({ message: 'trainerIds must be a list' })
      const ids = [...new Set(trainerIds.map(String))].filter((id) => mongoose.Types.ObjectId.isValid(id))
      // Only active trainers of this gym can be picked
      const valid = await User.find({ _id: { $in: ids }, gymId: req.gymId, role: 'trainer', isActive: true }).select('_id').lean()
      $set['logSharing.trainerIds'] = valid.map((t) => t._id)
    }
    if (!Object.keys($set).length) return res.status(400).json({ message: 'Nothing to update' })
    const member = await Member.findOneAndUpdate({ _id: req.memberId, gymId: req.gymId }, { $set }, { new: true }).select('logSharing')
    if (!member) return res.status(404).json({ message: 'Member not found' })
    res.json(await payload(req.gymId, member))
  } catch (err) { next(err) }
})

export default router
