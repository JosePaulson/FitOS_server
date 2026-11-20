import { Router }  from 'express'
import mongoose    from 'mongoose'
import Attendance  from '../models/Attendance.js'
import Member      from '../models/Member.js'
import { protect } from '../middleware/auth.js'
import { evaluateEngagement, visitsOnDay, monthlyVisitCounts } from '../services/engagement.service.js'
import { istStartOfDay, istDateKey } from '../utils/dateIST.js'

const router = Router()

router.post('/checkin', protect, async (req, res, next) => {
  try {
    const { memberId, type = 'gym', classId, trainerId } = req.body
    if (!memberId) return res.status(400).json({ message: 'memberId required' })

    const member = await Member.findOne({ _id: memberId, gymId: req.gymId })
    if (!member) return res.status(404).json({ message: 'Member not found' })
    if (member.membershipStatus === 'paused') {
      return res.status(403).json({ message: `${member.name}'s membership is on hold \u2014 resume it before checking them in.` })
    }

    // IST calendar day (same as the member-portal check-in) so the two can never create two records for one day.
    const today = istStartOfDay(new Date())

    const record = await Attendance.findOneAndUpdate(
      { gymId: req.gymId, memberId, date: today, type },
      { $setOnInsert: { checkInTime: new Date() }, classId, trainerId },
      { upsert: true, new: true }
    )
    evaluateEngagement(memberId).catch(() => {}) // badges / challenges (fire-and-forget; never blocks check-in)
    res.status(201).json(record)
  } catch (err) { next(err) }
})

router.patch('/:id/checkout', protect, async (req, res, next) => {
  try {
    const record = await Attendance.findOneAndUpdate(
      { _id: req.params.id, gymId: req.gymId },
      { checkOutTime: new Date() },
      { new: true }
    )
    if (!record) return res.status(404).json({ message: 'Attendance record not found' })
    res.json(record)
  } catch (err) { next(err) }
})

router.get('/', protect, async (req, res, next) => {
  try {
    const { date, memberId, page = 1, limit = 50 } = req.query

    // Single-day view: one row per member who showed up that day — via gym
    // attendance, a completed PT session and/or a logged workout (max one per day).
    if (date && !memberId) {
      const visits = await visitsOnDay({ gymId: req.gymId, day: istDateKey(date) })
      const members = await Member.find({ _id: { $in: visits.map((v) => v.memberId) }, gymId: req.gymId }).select('name phone photo').lean()
      const byId = new Map(members.map((m) => [String(m._id), m]))
      const records = visits
        .filter((v) => byId.has(v.memberId))
        .map((v) => ({
          _id: v.memberId, memberId: byId.get(v.memberId), checkInTime: v.time,
          type: v.sources[0], sources: v.sources,
        }))
        .sort((a, b) => (b.checkInTime ? new Date(b.checkInTime) : 0) - (a.checkInTime ? new Date(a.checkInTime) : 0))
      return res.json({ records, total: records.length })
    }

    const filter = { gymId: req.gymId }
    if (date) filter.date = istStartOfDay(date)
    if (memberId) filter.memberId = memberId

    const [records, total] = await Promise.all([
      Attendance.find(filter).sort({ checkInTime: -1 }).skip((page - 1) * limit).limit(Number(limit))
        .populate('memberId', 'name phone photo'),
      Attendance.countDocuments(filter),
    ])
    res.json({ records, total })
  } catch (err) { next(err) }
})

router.get('/summary', protect, async (req, res, next) => {
  try {
    const { memberId } = req.query
    if (!memberId) return res.status(400).json({ message: 'memberId required' })

    if (!mongoose.Types.ObjectId.isValid(memberId) || !(await Member.exists({ _id: memberId, gymId: req.gymId }))) {
      return res.status(404).json({ message: 'Member not found' })
    }
    // Distinct visit days per month (attendance / completed PT / workout log, max one per day)
    const summary = await monthlyVisitCounts(memberId, 12)
    res.json(summary)
  } catch (err) { next(err) }
})

export default router
