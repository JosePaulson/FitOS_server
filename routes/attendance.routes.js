import { Router }  from 'express'
import mongoose    from 'mongoose'
import Attendance  from '../models/Attendance.js'
import Member      from '../models/Member.js'
import { protect } from '../middleware/auth.js'

const router = Router()

router.post('/checkin', protect, async (req, res, next) => {
  try {
    const { memberId, type = 'gym', classId, trainerId } = req.body
    if (!memberId) return res.status(400).json({ message: 'memberId required' })

    const member = await Member.findOne({ _id: memberId, gymId: req.gymId })
    if (!member) return res.status(404).json({ message: 'Member not found' })

    const today = new Date(); today.setHours(0, 0, 0, 0)

    const record = await Attendance.findOneAndUpdate(
      { gymId: req.gymId, memberId, date: today, type },
      { $setOnInsert: { checkInTime: new Date() }, classId, trainerId },
      { upsert: true, new: true }
    )
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
    const filter = { gymId: req.gymId }
    if (date) { const d = new Date(date); d.setHours(0,0,0,0); filter.date = d }
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

    const summary = await Attendance.aggregate([
      { $match: { gymId: req.gymId, memberId: new mongoose.Types.ObjectId(memberId) } },
      { $group: { _id: { year: { $year: '$date' }, month: { $month: '$date' } }, count: { $sum: 1 } } },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 12 },
    ])
    res.json(summary)
  } catch (err) { next(err) }
})

export default router
