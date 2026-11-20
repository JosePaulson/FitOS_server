import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import Member from '../models/Member.js'
import MembershipPlan from '../models/MembershipPlan.js'
import Invoice from '../models/Invoice.js'
import MemberAuth from '../models/MemberAuth.js'
import bcrypt from 'bcryptjs'
import { protect, authorize } from '../middleware/auth.js'
import { permit } from '../services/permissions.service.js'
import { priceInvoice } from '../utils/pricing.js'
import { resolveDiscount, recordRedemption } from '../services/coupon.service.js'
import { getReferralSettings, findReferrer, generateReferralCode } from '../services/referral.service.js'
import { freezeMembership, resumeMembership } from '../services/membershipFreeze.service.js'
import { sendWelcomeEmail, sendInvoiceEmail } from '../services/email.service.js'
import { resolveGymSender } from '../utils/gymEmailSender.js'
import { sendPushToMember } from '../services/pushNotification.service.js'
import { addPlanDuration } from '../utils/planDuration.js'
import { findActiveMemberByPhone, duplicatePhoneMessage } from '../services/memberIdentity.service.js'
import { isValidPhone, phoneKey, digitsOf } from '../utils/identity.js'
import { renewalPeriod, statusForExpiry } from '../utils/membershipDates.js'

const router = Router()

function validate(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) { res.status(400).json({ message: errors.array()[0].msg }); return false }
  return true
}

/**
 * Build invoice payload — tax extracted from the (possibly discounted)
 * tax-inclusive price. `discount` = { discountAmount, couponId, couponCode }
 * from resolveDiscount(); omit for no discount.
 */
function buildInvoicePayload(gymId, memberId, plan, invoiceDate, discount = {}) {
  const taxRate = plan.taxRate ?? 18
  const { listAmount, discountAmount, baseAmount, taxAmount, totalAmount } =
    priceInvoice(plan.price, taxRate, discount.discountAmount || 0)
  return {
    gymId, memberId,
    planId: plan._id,
    listAmount, discountAmount,
    ...(discountAmount > 0 ? { couponId: discount.couponId, couponCode: discount.couponCode } : {}),
    baseAmount,
    taxRate,
    taxAmount,
    totalAmount,
    status: 'pending',
    dueDate: invoiceDate || new Date(),
    // Mongoose's `timestamps` option only auto-sets createdAt when it's
    // not already present on the doc — passing it here lets a backdated
    // (or future-dated) enrolment show that same date as the invoice date,
    // instead of always showing "today".
    ...(invoiceDate ? { createdAt: invoiceDate } : {}),
  }
}

/**
 * Fire welcome + invoice emails after enrolment or renewal.
 * Uses fire-and-forget (.catch) so email failure never breaks the API response.
 */
async function fireEnrolmentEmails({ member, invoice, plan, gymId, isRenewal = false }) {
  // Push notification — independent of whether the member has an email on
  // file; it works off the member's browser subscription instead.
  sendPushToMember(member._id, {
    title: isRenewal ? 'Membership renewed 🎉' : 'Invoice ready',
    body: isRenewal
      ? `Your "${plan.name}" membership was renewed. Receipt: ₹${invoice.totalAmount.toLocaleString('en-IN')}`
      : `New invoice for "${plan.name}" — ₹${invoice.totalAmount.toLocaleString('en-IN')}`,
    url: '/billing',
    tag: 'invoice',
  }).catch((e) => console.error('[push] Invoice notification failed:', e.message))

  if (!member.email) return   // no email address — skip email sends only

  // Resolve gym's own sender address + branding (falls back to platform defaults if not set)
  const { from, replyTo, gymName, logo, emailSignature, emailFooterText, welcomeEmailBody, invoiceEmailBody } = await resolveGymSender(gymId)

  const expiryDate = member.membershipExpiryDate?.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  if (!isRenewal) {
    // Welcome email — only on first enrolment
    sendWelcomeEmail({
      to: member.email, from, replyTo, logo, emailSignature, emailFooterText, welcomeEmailBody,
      memberName: member.name,
      gymName, planName: plan.name, expiryDate,
    }).catch((e) => console.error('[email] Welcome email failed:', e.message))
  }

  // Invoice / receipt email — on both enrolment and renewal
  sendInvoiceEmail({
    to: member.email, from, replyTo, logo, emailSignature, emailFooterText, invoiceEmailBody,
    memberName: member.name,
    gymName,
    invoiceNumber: invoice.invoiceNumber,
    planName: plan.name,
    baseAmount: invoice.baseAmount,
    taxRate: invoice.taxRate,
    taxAmount: invoice.taxAmount,
    totalAmount: invoice.totalAmount,
  }).catch((e) => console.error('[email] Invoice email failed:', e.message))
}

/**
 * Give a newly-created member a starting member-portal PIN: the last 4 digits
 * of the phone number entered at enrolment. Staff can still override it via
 * the existing "Set PIN" flow, and members can change it themselves from
 * Profile — this only provides a sensible default so they can log in straight
 * away.
 *
 * Never throws: failing to create the PIN must not roll back or fail an
 * otherwise-successful enrolment (staff can still use "Set PIN" afterwards).
 * Skipped when the phone has fewer than 4 digits, or when a MemberAuth
 * record already exists for this member / phone (never overwrites a PIN).
 */
async function createDefaultMemberPin(member) {
  try {
    const digits = String(member.phone || '').replace(/\D/g, '')
    if (digits.length < 4) return false
    const pin = digits.slice(-4)

    const existing = await MemberAuth.findOne({
      gymId: member.gymId,
      $or: [{ memberId: member._id }, { phone: member.phone }],
    })
    if (existing) {
      if (String(existing.memberId) === String(member._id)) return false
      // Same number, different member: only an ARCHIVED member's leftover login may be replaced.
      const owner = await Member.findById(existing.memberId).select('isActive')
      if (owner && owner.isActive !== false) return false
      await MemberAuth.deleteOne({ _id: existing._id })
    }

    await MemberAuth.create({
      gymId: member.gymId,
      memberId: member._id,
      phone: member.phone,
      email: member.email,
      pinHash: await bcrypt.hash(pin, 10),
      isActive: true,
    })
    return true
  } catch (e) {
    console.error('[member] Default PIN creation failed:', e.message)
    return false
  }
}

// GET /api/members
router.get('/', protect, async (req, res, next) => {
  try {
    const { search, status, page = 1, limit = 20, expiringInDays } = req.query
    const filter = { gymId: req.gymId, isActive: true }
    if (status) filter.membershipStatus = status
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ]
    }
    if (expiringInDays) {
      const future = new Date()
      future.setDate(future.getDate() + Number(expiringInDays))
      filter.membershipExpiryDate = { $lte: future, $gte: new Date() }
    }

    const [members, total] = await Promise.all([
      Member.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .populate('currentPlanId', 'name price taxRate taxInclusive durationDays durationUnit durationValue')
        .populate('assignedTrainerId', 'name'),
      Member.countDocuments(filter),
    ])
    res.json({ members, total, page: Number(page), pages: Math.ceil(total / limit) })
  } catch (err) { next(err) }
})

// GET /api/members/:id
// GET /api/members/check-phone?phone=...&excludeId=... — live warning while typing in the add/edit form
router.get('/check-phone', protect, async (req, res, next) => {
  try {
    const phone = String(req.query.phone || '')
    if (digitsOf(phone).length < 7) return res.json({ available: true, incomplete: true }) // still typing
    if (!isValidPhone(phone)) return res.json({ available: false, valid: false, message: 'Enter a valid phone number (7\u201315 digits).' })
    const excludeId = /^[a-f0-9]{24}$/.test(String(req.query.excludeId || '')) ? req.query.excludeId : undefined
    const dup = await findActiveMemberByPhone(req.gymId, phone, excludeId)
    res.json(dup
      ? { available: false, valid: true, message: duplicatePhoneMessage(dup), member: { _id: dup._id, name: dup.name } }
      : { available: true, valid: true })
  } catch (err) { next(err) }
})

router.get('/:id', protect, async (req, res, next) => {
  try {
    const member = await Member.findOne({ _id: req.params.id, gymId: req.gymId })
      .populate('currentPlanId assignedTrainerId', 'name price taxRate taxInclusive durationDays durationUnit durationValue')
    if (!member) return res.status(404).json({ message: 'Member not found' })
    res.json(member)
  } catch (err) { next(err) }
})

// POST /api/members — enrol new member
router.post('/',
  protect,
  permit('members.enrol'),
  [
    body('name').notEmpty().withMessage('Name required'),
    body('phone').notEmpty().withMessage('Phone required'),
    body('planId').notEmpty().withMessage('Membership plan required'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { name, phone, email, dob, age, gender, height, planId, assignedTrainerId, source, emergencyContact, healthNotes, membershipStartDate, couponCode, referralCode } = req.body
      // One active member per phone number. Checked before anything is created, with a message
      // that names the existing member so staff can see at a glance who it is.
      if (!isValidPhone(phone)) {
        const message = 'Enter a valid phone number (7\u201315 digits).'
        return res.status(400).json({ message, fields: { phone: message } })
      }
      const duplicate = await findActiveMemberByPhone(req.gymId, phone)
      if (duplicate) {
        const message = duplicatePhoneMessage(duplicate)
        return res.status(409).json({ message, fields: { phone: message }, existingMember: { _id: duplicate._id, name: duplicate.name } })
      }

      const plan = await MembershipPlan.findOne({ _id: planId, gymId: req.gymId })
      if (!plan) return res.status(404).json({ message: 'Plan not found' })

      // Admin can back-date or future-date the membership start — defaults
      // to today when not provided.
      const startDate = membershipStartDate ? new Date(membershipStartDate) : new Date()
      const expiryDate = addPlanDuration(startDate, plan)

      // Referral: a friend's code gives this member a first-invoice discount
      // and (once they pay) rewards the referrer. Wrong codes are rejected
      // loudly rather than silently ignored — staff are typing it in front
      // of the customer and should know it didn't take.
      let referrer = null
      let referralPercent = 0
      if (referralCode && String(referralCode).trim()) {
        const settings = await getReferralSettings(req.gymId)
        if (!settings.enabled) return res.status(400).json({ message: 'The referral programme isn\u2019t switched on for this gym' })
        referrer = await findReferrer(req.gymId, referralCode)
        if (!referrer) return res.status(400).json({ message: 'That referral code isn\u2019t valid' })
        const digits = (v) => String(v || '').replace(/\D/g, '').slice(-10)
        if (digits(referrer.phone) === digits(phone)) {
          return res.status(400).json({ message: 'A member can\u2019t refer themselves' })
        }
        referralPercent = settings.refereeDiscountPercent
      }

      // Coupon and referral discounts don't stack — the larger one wins.
      const discount = await resolveDiscount({
        gymId: req.gymId, couponCode, referralPercent,
        amount: plan.price, type: 'membership', planId: plan._id,
      })

      const member = await Member.create({
        gymId: req.gymId, name, phone, email, dob, age, gender, height,
        currentPlanId: plan._id,
        // A back-dated start can mean the period has already ended — don't store that as 'active'.
        membershipStatus: statusForExpiry(expiryDate), joinDate: startDate,
        membershipStartDate: startDate, membershipExpiryDate: expiryDate,
        assignedTrainerId, source: referrer ? 'referral' : (source || 'walk-in'),
        referredBy: referrer?._id,
        referralCode: await generateReferralCode(req.gymId),
        emergencyContact, healthNotes,
      })

      const invoice = await Invoice.create(buildInvoicePayload(req.gymId, member._id, plan, startDate, discount))
      await recordRedemption({
        gymId: req.gymId, couponId: discount.couponId, memberId: member._id,
        invoiceId: invoice._id, discountAmount: discount.discountAmount,
      })

      // Default member-portal PIN = last 4 digits of the phone number.
      await createDefaultMemberPin(member)

      res.status(201).json({ member, invoice })
    } catch (err) { next(err) }
  }
)

// PATCH /api/members/:id
router.patch('/:id', protect, permit('members.manage'), async (req, res, next) => {
  try {
    const allowed = ['name', 'phone', 'email', 'dob', 'age', 'gender', 'height', 'photo', 'emergencyContact', 'healthNotes', 'assignedTrainerId', 'membershipStatus', 'source', 'membershipStartDate', 'membershipExpiryDate', 'currentPlanId']
    const updates = {}
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k] })

    // Changing the plan here is a direct reassignment (e.g. correcting a
    // data-entry mistake) — it does NOT recalculate membership dates. Use
    // the dedicated Renew flow when the intent is to extend validity.
    if (updates.currentPlanId) {
      const plan = await MembershipPlan.findOne({ _id: updates.currentPlanId, gymId: req.gymId })
      if (!plan) return res.status(404).json({ message: 'Plan not found' })
    }

    if (updates.phone !== undefined) {
      if (!isValidPhone(updates.phone)) {
        const message = 'Enter a valid phone number (7\u201315 digits).'
        return res.status(400).json({ message, fields: { phone: message } })
      }
      const duplicate = await findActiveMemberByPhone(req.gymId, updates.phone, req.params.id)
      if (duplicate) {
        const message = duplicatePhoneMessage(duplicate)
        return res.status(409).json({ message, fields: { phone: message }, existingMember: { _id: duplicate._id, name: duplicate.name } })
      }
    }

    const member = await Member.findOneAndUpdate(
      { _id: req.params.id, gymId: req.gymId },
      updates,
      { new: true, runValidators: true }
    ).populate('currentPlanId assignedTrainerId', 'name price taxRate taxInclusive durationDays durationUnit durationValue')
    if (!member) return res.status(404).json({ message: 'Member not found' })
    res.json(member)
  } catch (err) { next(err) }
})

// POST /api/members/:id/renew
router.post('/:id/renew', protect, permit('members.enrol'), async (req, res, next) => {
  try {
    const { planId, startDate, couponCode } = req.body
    const member = await Member.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!member) return res.status(404).json({ message: 'Member not found' })

    // Renewing while on hold: end the hold first so the frozen days are
    // added back before the renewal extends from the corrected expiry.
    if (member.membershipStatus === 'paused') await resumeMembership(member, { by: req.user?._id })

    const plan = await MembershipPlan.findOne({ _id: planId || member.currentPlanId, gymId: req.gymId })
    if (!plan) return res.status(404).json({ message: 'Plan not found' })

    // If the admin explicitly picked a start date (any date — past or
    // future), always base the new expiry off that. Otherwise fall back to
    // the normal "extend from current expiry, or from today if already
    // lapsed" behaviour.
    const period = renewalPeriod({
      explicitStart: startDate, status: member.membershipStatus,
      expiry: member.membershipExpiryDate, existingStart: member.membershipStartDate,
    })
    const base = period.base
    const newExpiry = addPlanDuration(base, plan)

    // Validate the coupon before touching the member, so a bad code can't
    // leave a half-renewed membership behind.
    const discount = await resolveDiscount({
      gymId: req.gymId, memberId: member._id, couponCode,
      amount: plan.price, type: 'membership', planId: plan._id,
    })

    member.currentPlanId = plan._id
    member.membershipStatus = 'active'
    member.membershipStartDate = period.start // unchanged when extending a running membership; moves when a new period begins
    member.membershipExpiryDate = newExpiry
    await member.save()

    const invoice = await Invoice.create(buildInvoicePayload(req.gymId, member._id, plan, undefined, discount))
    await recordRedemption({
      gymId: req.gymId, couponId: discount.couponId, memberId: member._id,
      invoiceId: invoice._id, discountAmount: discount.discountAmount,
    })

    // Fire renewal invoice email (non-blocking)
    fireEnrolmentEmails({ member, invoice, plan, gymId: req.gymId, isRenewal: true })

    res.json({ member, invoice })
  } catch (err) { next(err) }
})

// POST /api/members/:id/freeze — put an active membership on hold
// Body: { endDate?: ISO date (planned auto-resume), reason?: string, fee?: number (tax-inclusive ₹) }
router.post('/:id/freeze', protect, permit('members.hold'), async (req, res, next) => {
  try {
    const member = await Member.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!member) return res.status(404).json({ message: 'Member not found' })
    const { endDate, reason, fee } = req.body
    const { feeInvoice } = await freezeMembership(member, { endDate, reason, fee, by: req.user?._id })
    res.json({ member, feeInvoice })
  } catch (err) { next(err) }
})

// POST /api/members/:id/unfreeze — resume now; the days spent on hold are added to the expiry
router.post('/:id/unfreeze', protect, permit('members.hold'), async (req, res, next) => {
  try {
    const member = await Member.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!member) return res.status(404).json({ message: 'Member not found' })
    const { days } = await resumeMembership(member, { by: req.user?._id })
    res.json({ member, daysAdded: days })
  } catch (err) { next(err) }
})

// DELETE /api/members/:id — soft delete
router.delete('/:id', protect, permit('members.manage'), async (req, res, next) => {
  try {
    const archived = await Member.findOneAndUpdate({ _id: req.params.id, gymId: req.gymId }, { isActive: false })
    // An archived member must not be able to log in, and their login must not block the number being reused.
    if (archived) await MemberAuth.deleteOne({ memberId: archived._id })
    res.json({ message: 'Member archived' })
  } catch (err) { next(err) }
})

export default router