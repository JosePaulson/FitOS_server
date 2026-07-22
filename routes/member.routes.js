import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import Member from '../models/Member.js'
import MembershipPlan from '../models/MembershipPlan.js'
import Invoice from '../models/Invoice.js'
import { protect, authorize } from '../middleware/auth.js'
import { extractTax } from '../utils/tax.js'
import { sendWelcomeEmail, sendInvoiceEmail } from '../services/email.service.js'
import { resolveGymSender } from '../utils/gymEmailSender.js'
import { sendPushToMember } from '../services/pushNotification.service.js'
import { addPlanDuration } from '../utils/planDuration.js'

const router = Router()

function validate(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) { res.status(400).json({ message: errors.array()[0].msg }); return false }
  return true
}

/** Build invoice payload — tax extracted from inclusive price */
function buildInvoicePayload(gymId, memberId, plan, invoiceDate) {
  const { baseAmount, taxAmount, totalAmount } = extractTax(plan.price, plan.taxRate ?? 18)
  return {
    gymId, memberId,
    planId: plan._id,
    baseAmount,
    taxRate: plan.taxRate ?? 18,
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

  // Resolve gym's own sender address (falls back to platform email if not set)
  const { from, replyTo, gymName } = await resolveGymSender(gymId)

  const expiryDate = member.membershipExpiryDate?.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  if (!isRenewal) {
    // Welcome email — only on first enrolment
    sendWelcomeEmail({
      to: member.email, from, replyTo,
      memberName: member.name,
      gymName, planName: plan.name, expiryDate,
    }).catch((e) => console.error('[email] Welcome email failed:', e.message))
  }

  // Invoice / receipt email — on both enrolment and renewal
  sendInvoiceEmail({
    to: member.email, from, replyTo,
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
  authorize('owner', 'manager', 'receptionist'),
  [
    body('name').notEmpty().withMessage('Name required'),
    body('phone').notEmpty().withMessage('Phone required'),
    body('planId').notEmpty().withMessage('Membership plan required'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { name, phone, email, dob, age, gender, height, planId, assignedTrainerId, source, emergencyContact, healthNotes, membershipStartDate } = req.body
      const plan = await MembershipPlan.findOne({ _id: planId, gymId: req.gymId })
      if (!plan) return res.status(404).json({ message: 'Plan not found' })

      // Admin can back-date or future-date the membership start — defaults
      // to today when not provided.
      const startDate = membershipStartDate ? new Date(membershipStartDate) : new Date()
      const expiryDate = addPlanDuration(startDate, plan)

      const member = await Member.create({
        gymId: req.gymId, name, phone, email, dob, age, gender, height,
        currentPlanId: plan._id, membershipStatus: 'active',
        membershipStartDate: startDate, membershipExpiryDate: expiryDate,
        assignedTrainerId, source: source || 'walk-in', emergencyContact, healthNotes,
      })

      const invoice = await Invoice.create(buildInvoicePayload(req.gymId, member._id, plan, startDate))

      res.status(201).json({ member, invoice })
    } catch (err) { next(err) }
  }
)

// PATCH /api/members/:id
router.patch('/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
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
router.post('/:id/renew', protect, authorize('owner', 'manager', 'receptionist'), async (req, res, next) => {
  try {
    const { planId, startDate } = req.body
    const member = await Member.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!member) return res.status(404).json({ message: 'Member not found' })

    const plan = await MembershipPlan.findOne({ _id: planId || member.currentPlanId, gymId: req.gymId })
    if (!plan) return res.status(404).json({ message: 'Plan not found' })

    // If the admin explicitly picked a start date (any date — past or
    // future), always base the new expiry off that. Otherwise fall back to
    // the normal "extend from current expiry, or from today if already
    // lapsed" behaviour.
    let base
    if (startDate) {
      base = new Date(startDate)
    } else {
      base = (member.membershipStatus === 'active' && member.membershipExpiryDate > new Date())
        ? new Date(member.membershipExpiryDate)
        : new Date()
    }
    const newExpiry = addPlanDuration(base, plan)

    member.currentPlanId = plan._id
    member.membershipStatus = 'active'
    member.membershipStartDate = startDate ? new Date(startDate) : member.membershipStartDate
    member.membershipExpiryDate = newExpiry
    await member.save()

    const invoice = await Invoice.create(buildInvoicePayload(req.gymId, member._id, plan))

    // Fire renewal invoice email (non-blocking)
    fireEnrolmentEmails({ member, invoice, plan, gymId: req.gymId, isRenewal: true })

    res.json({ member, invoice })
  } catch (err) { next(err) }
})

// DELETE /api/members/:id — soft delete
router.delete('/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    await Member.findOneAndUpdate({ _id: req.params.id, gymId: req.gymId }, { isActive: false })
    res.json({ message: 'Member archived' })
  } catch (err) { next(err) }
})

export default router