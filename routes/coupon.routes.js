import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import Coupon from '../models/Coupon.js'
import Member from '../models/Member.js'
import MembershipPlan from '../models/MembershipPlan.js'
import PTPlan from '../models/PTPlan.js'
import { protect, authorize } from '../middleware/auth.js'
import { permit } from '../services/permissions.service.js'
import { validateCoupon } from '../services/coupon.service.js'

const router = Router()

function validate(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) { res.status(400).json({ message: errors.array()[0].msg }); return false }
  return true
}

const FIELDS = ['code', 'description', 'type', 'value', 'maxDiscount', 'minAmount', 'appliesTo', 'planIds',
  'validFrom', 'validTo', 'usageLimit', 'perMemberLimit', 'isActive']

const couponRules = [
  body('code').optional().trim().isLength({ min: 3, max: 24 }).withMessage('Code must be 3–24 characters')
    .matches(/^[A-Za-z0-9_-]+$/).withMessage('Code can only use letters, numbers, - and _'),
  body('type').optional().isIn(['percent', 'flat']).withMessage('Type must be percent or flat'),
  body('value').optional().isFloat({ gt: 0 }).withMessage('Discount value must be greater than 0'),
]

function checkBusinessRules(data, res) {
  if (data.type === 'percent' && data.value > 100) { res.status(400).json({ message: 'A percentage discount can\u2019t exceed 100%' }); return false }
  if (data.validFrom && data.validTo && new Date(data.validTo) < new Date(data.validFrom)) {
    res.status(400).json({ message: '"Valid to" must be after "valid from"' }); return false
  }
  return true
}

// GET /api/coupons
router.get('/', protect, async (req, res, next) => {
  try {
    const coupons = await Coupon.find({ gymId: req.gymId }).sort({ createdAt: -1 })
    res.json(coupons)
  } catch (err) { next(err) }
})

// POST /api/coupons
router.post('/', protect, permit('coupons.manage'),
  [body('code').notEmpty().withMessage('Code required'), body('type').notEmpty().withMessage('Type required'),
   body('value').notEmpty().withMessage('Value required'), ...couponRules],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const data = {}
      FIELDS.forEach((k) => { if (req.body[k] !== undefined && req.body[k] !== '') data[k] = req.body[k] })
      if (!checkBusinessRules(data, res)) return
      const coupon = await Coupon.create({ ...data, gymId: req.gymId })
      res.status(201).json(coupon)
    } catch (err) { next(err) } // duplicate code → 409 via errorHandler
  }
)

// PATCH /api/coupons/:id
router.patch('/:id', protect, permit('coupons.manage'), couponRules, async (req, res, next) => {
  if (!validate(req, res)) return
  try {
    const coupon = await Coupon.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!coupon) return res.status(404).json({ message: 'Coupon not found' })

    FIELDS.forEach((k) => {
      if (req.body[k] === undefined) return
      // Past redemptions reference the code & discount terms — don't let them change under it.
      if (coupon.usedCount > 0 && ['code', 'type', 'value'].includes(k)) return
      coupon[k] = req.body[k] === '' ? undefined : req.body[k]
    })
    if (!checkBusinessRules(coupon, res)) return
    await coupon.save()
    res.json(coupon)
  } catch (err) { next(err) }
})

// DELETE /api/coupons/:id — hard delete if never used, otherwise just deactivate
router.delete('/:id', protect, permit('coupons.manage'), async (req, res, next) => {
  try {
    const coupon = await Coupon.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!coupon) return res.status(404).json({ message: 'Coupon not found' })
    if (coupon.usedCount > 0) {
      coupon.isActive = false
      await coupon.save()
      return res.json({ message: 'Coupon has been used before, so it was deactivated instead of deleted', deactivated: true })
    }
    await coupon.deleteOne()
    res.json({ message: 'Coupon deleted' })
  } catch (err) { next(err) }
})

// POST /api/coupons/validate — preview a discount at the front desk
// Body: { code, planId, type?: 'membership'|'pt' (default membership), memberId? }
router.post('/validate', protect, async (req, res, next) => {
  try {
    const { code, planId, memberId } = req.body
    const type = req.body.type === 'pt' ? 'pt' : 'membership'
    if (!planId) return res.status(400).json({ message: 'Select a plan first' })

    const plan = type === 'pt'
      ? await PTPlan.findOne({ _id: planId, gymId: req.gymId })
      : await MembershipPlan.findOne({ _id: planId, gymId: req.gymId })
    if (!plan) return res.status(404).json({ message: 'Plan not found' })

    const amount = type === 'pt' ? plan.fee : plan.price
    const { coupon, discount } = await validateCoupon({ gymId: req.gymId, memberId, code, amount, type, planId })
    res.json({ code: coupon.code, discount, amount, finalAmount: Math.round((amount - discount) * 100) / 100 })
  } catch (err) { next(err) }
})

// GET /api/coupons/referrals — referral programme snapshot for the Offers page
router.get('/referrals', protect, async (req, res, next) => {
  try {
    const gymId = req.gymId
    const [referred, rewarded, top] = await Promise.all([
      Member.countDocuments({ gymId, referredBy: { $exists: true, $ne: null } }),
      Member.countDocuments({ gymId, referralRewardGrantedAt: { $exists: true } }),
      Member.aggregate([
        { $match: { gymId, referredBy: { $exists: true, $ne: null } } },
        { $group: { _id: '$referredBy', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'members', localField: '_id', foreignField: '_id', as: 'm' } },
        { $project: { count: 1, name: { $arrayElemAt: ['$m.name', 0] }, phone: { $arrayElemAt: ['$m.phone', 0] } } },
      ]),
    ])
    res.json({ referred, rewarded, top })
  } catch (err) { next(err) }
})

export default router
