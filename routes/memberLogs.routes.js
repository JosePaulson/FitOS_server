import { Router } from 'express'
import mongoose from 'mongoose'
import { protect, authorize } from '../middleware/auth.js'
import Member from '../models/Member.js'
import MemberWorkoutLog from '../models/MemberWorkoutLog.js'
import MealLog from '../models/MealLog.js'
import { canViewLogs, GYM_ROLES } from '../utils/logSharing.js'

const router = Router()
router.use(protect, authorize('owner', 'manager', 'trainer'))

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// GET /api/member-logs/members?q= — members whose logs this staff user is allowed to see
router.get('/members', async (req, res, next) => {
  try {
    const q = { gymId: req.gymId, $or: [{ 'logSharing.workoutLogs': true }, { 'logSharing.mealLogs': true }] }
    if (!GYM_ROLES.includes(req.user.role)) q['logSharing.trainerIds'] = req.user._id   // trainers: only members who picked them
    const search = String(req.query.q || '').trim()
    if (search) q.$and = [{ $or: [{ name: new RegExp(escapeRe(search), 'i') }, { phone: new RegExp(escapeRe(search), 'i') }] }]

    const members = await Member.find(q).select('name phone photo membershipStatus logSharing').sort({ name: 1 }).limit(200).lean()
    res.json({
      members: members
        .map((m) => ({
          _id: m._id, name: m.name, phone: m.phone, photo: m.photo, membershipStatus: m.membershipStatus,
          workout: canViewLogs(m, req.user, 'workout'), meal: canViewLogs(m, req.user, 'meal'),
        }))
        .filter((m) => m.workout || m.meal),
    })
  } catch (err) { next(err) }
})

async function loadShared(req, res, kind) {
  const { memberId } = req.params
  if (!mongoose.Types.ObjectId.isValid(memberId)) { res.status(404).json({ message: 'Member not found' }); return null }
  const member = await Member.findOne({ _id: memberId, gymId: req.gymId }).select('name logSharing')
  if (!member) { res.status(404).json({ message: 'Member not found' }); return null }
  if (!canViewLogs(member, req.user, kind)) {
    res.status(403).json({ message: `This member hasn\u2019t shared their ${kind} logs with you.` }); return null
  }
  return member
}

// GET /api/member-logs/:memberId/workout-logs
router.get('/:memberId/workout-logs', async (req, res, next) => {
  try {
    const member = await loadShared(req, res, 'workout'); if (!member) return
    const logs = await MemberWorkoutLog.find({ gymId: req.gymId, memberId: member._id }).sort({ date: -1 }).limit(100).lean()
    res.json({ logs })
  } catch (err) { next(err) }
})

// GET /api/member-logs/:memberId/meal-logs
router.get('/:memberId/meal-logs', async (req, res, next) => {
  try {
    const member = await loadShared(req, res, 'meal'); if (!member) return
    const logs = await MealLog.find({ gymId: req.gymId, memberId: member._id }).sort({ eatenAt: -1 }).limit(100).select('-photoPublicId').lean()
    res.json({ logs })
  } catch (err) { next(err) }
})

export default router
