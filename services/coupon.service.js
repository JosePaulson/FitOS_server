import Coupon from '../models/Coupon.js'
import CouponRedemption from '../models/CouponRedemption.js'
import { computeDiscount } from '../utils/pricing.js'

/** A user-facing problem with a coupon (bad code, expired, used up…) — maps to HTTP 400. */
export class CouponError extends Error {
  constructor(message) { super(message); this.status = 400; this.isCouponError = true }
}

export const normalizeCode = (code) => String(code || '').trim().toUpperCase()

/**
 * Validates `code` for this purchase and returns { coupon, discount }.
 * Throws CouponError with a message safe to show the member/staff.
 *
 * @param amount  tax-inclusive price being paid, before discount
 * @param type    'membership' | 'pt'
 * @param planId  the MembershipPlan / PTPlan being bought
 * @param memberId omit for a brand-new member (per-member limit can't apply yet)
 */
export async function validateCoupon({ gymId, memberId, code, amount, type, planId }) {
  const norm = normalizeCode(code)
  if (!norm) throw new CouponError('Enter a coupon code')

  const coupon = await Coupon.findOne({ gymId, code: norm })
  if (!coupon || !coupon.isActive) throw new CouponError('This coupon code isn\u2019t valid')

  const now = new Date()
  if (coupon.validFrom && now < coupon.validFrom) throw new CouponError('This coupon isn\u2019t active yet')
  if (coupon.validTo && now > coupon.validTo) throw new CouponError('This coupon has expired')

  if (coupon.appliesTo?.length && !coupon.appliesTo.includes(type)) {
    throw new CouponError(`This coupon doesn\u2019t apply to ${type === 'pt' ? 'PT plans' : 'memberships'}`)
  }
  if (coupon.planIds?.length && !coupon.planIds.some((id) => String(id) === String(planId))) {
    throw new CouponError('This coupon doesn\u2019t apply to the selected plan')
  }
  if (coupon.minAmount > 0 && amount < coupon.minAmount) {
    throw new CouponError(`This coupon needs a minimum purchase of \u20B9${coupon.minAmount.toLocaleString('en-IN')}`)
  }
  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
    throw new CouponError('This coupon has reached its usage limit')
  }
  if (memberId && coupon.perMemberLimit > 0) {
    const used = await CouponRedemption.countDocuments({ couponId: coupon._id, memberId })
    if (used >= coupon.perMemberLimit) throw new CouponError('You\u2019ve already used this coupon')
  }

  const discount = computeDiscount(coupon, amount)
  if (discount <= 0) throw new CouponError('This coupon gives no discount on this purchase')
  return { coupon, discount }
}

/**
 * Picks the discount for a purchase: an explicit coupon and/or the
 * referral discount, whichever is larger (they don't stack).
 * Returns { discountAmount, couponId, couponCode } — zeros/undefined when none.
 */
export async function resolveDiscount({ gymId, memberId, couponCode, referralPercent = 0, amount, type, planId }) {
  let best = { discountAmount: 0, couponId: undefined, couponCode: undefined }

  if (couponCode) {
    const { coupon, discount } = await validateCoupon({ gymId, memberId, code: couponCode, amount, type, planId })
    best = { discountAmount: discount, couponId: coupon._id, couponCode: coupon.code }
  }
  if (referralPercent > 0) {
    const referral = Math.round(amount * referralPercent) / 100
    if (referral > best.discountAmount) {
      best = { discountAmount: Math.min(referral, amount), couponId: undefined, couponCode: 'REFERRAL' }
    }
  }
  return best
}

/** Counts a coupon use against its limits. Call once the invoice exists. */
export async function recordRedemption({ gymId, couponId, memberId, invoiceId, discountAmount }) {
  if (!couponId) return
  await CouponRedemption.create({ gymId, couponId, memberId, invoiceId, discountAmount })
  await Coupon.updateOne({ _id: couponId }, { $inc: { usedCount: 1 } })
}

/** Frees a coupon use (e.g. a member re-prices an abandoned pending checkout). */
export async function releaseRedemption(invoiceId) {
  const r = await CouponRedemption.findOneAndDelete({ invoiceId })
  if (r) await Coupon.updateOne({ _id: r.couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } })
}
