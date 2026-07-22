import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import { memberProtect } from '../middleware/memberAuth.js'
import StaffRating from '../models/StaffRating.js'
import User from '../models/User.js'

const router = Router()
router.use(memberProtect)

function validate(req, res) {
  const errs = validationResult(req)
  if (!errs.isEmpty()) { res.status(400).json({ message: errs.array()[0].msg }); return false }
  return true
}

// GET /api/member-portal/staff-ratings/staff — active staff/trainers at this
// gym the member can rate, along with the member's own existing rating (if any).
router.get('/staff', async (req, res, next) => {
  try {
    const [staff, myRatings] = await Promise.all([
      User.find({ gymId: req.gymId, isActive: true }).select('name role').sort({ name: 1 }),
      StaffRating.find({ gymId: req.gymId, memberId: req.memberId }),
    ])
    const myRatingMap = Object.fromEntries(myRatings.map((r) => [String(r.staffId), r]))
    res.json(staff.map((s) => ({
      _id: s._id, name: s.name, role: s.role,
      myRating: myRatingMap[String(s._id)]?.rating || null,
      myRemark: myRatingMap[String(s._id)]?.remark || '',
    })))
  } catch (err) { next(err) }
})

// POST /api/member-portal/staff-ratings — rate/remark a staff member.
// Upserts so re-submitting updates the member's existing rating.
router.post('/',
  [
    body('staffId').notEmpty().withMessage('Staff member is required'),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { staffId, rating, remark } = req.body
      const staff = await User.findOne({ _id: staffId, gymId: req.gymId, isActive: true })
      if (!staff) return res.status(404).json({ message: 'Staff member not found' })

      const doc = await StaffRating.findOneAndUpdate(
        { gymId: req.gymId, staffId, memberId: req.memberId },
        { rating: Number(rating), remark: remark || '' },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
      )
      res.status(201).json(doc)
    } catch (err) { next(err) }
  }
)

export default router
