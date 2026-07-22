import Invoice from '../models/Invoice.js'
import Member from '../models/Member.js'
import MemberPTPlan from '../models/MemberPTPlan.js'
import { addPlanDuration } from '../utils/planDuration.js'
import { sendInvoiceEmail } from './email.service.js'
import { resolveGymSender } from '../utils/gymEmailSender.js'
import { sendPushToMember } from './pushNotification.service.js'
import { syncMemberPTPlans } from './ptPlanSync.service.js'

const VALID_PAYMENT_METHODS = ['cash', 'upi', 'card', 'netbanking', 'wallet', 'emi', 'paylater', 'online', 'other']

function normalizeMethod(method) {
  return VALID_PAYMENT_METHODS.includes(method) ? method : 'other'
}

/**
 * Marks an invoice paid and — the first time only — applies its
 * real-world effect:
 *   - type 'membership': extends/activates the member's plan & dates,
 *     same logic as the staff-facing renew flow (extends from current
 *     expiry if still active, otherwise from today).
 *   - type 'pt': creates the MemberPTPlan assignment from the PT plan
 *     catalog snapshot, same as the staff-facing assign flow.
 *
 * Idempotent by design — safe to call twice for the same invoiceId (e.g.
 * the client-side verify call *and* the webhook both firing for one
 * payment, or staff marking paid something a member already paid online):
 * once `invoice.status === 'paid'`, later calls are a no-op that just
 * returns the existing invoice.
 *
 * `fulfilled` gates the side effects specifically, separately from
 * `status`, so this same function safely handles admin-created invoices
 * too (which are already fulfilled at creation — payment here is pure
 * bookkeeping, no double-extension of membership/PT time).
 */
export async function fulfillInvoicePayment({ invoiceId, razorpayPaymentId, razorpaySignature, method }) {
  const invoice = await Invoice.findById(invoiceId).populate('planId').populate('ptPlanId')
  if (!invoice) return null

  if (invoice.status === 'paid') {
    return { invoice, member: await Member.findById(invoice.memberId), assignment: null, alreadyProcessed: true }
  }

  invoice.status = 'paid'
  invoice.paidAt = new Date()
  invoice.paymentMethod = normalizeMethod(method)
  if (razorpayPaymentId) invoice.razorpayPaymentId = razorpayPaymentId
  if (razorpaySignature) invoice.razorpaySignature = razorpaySignature

  const member = await Member.findOne({ _id: invoice.memberId, gymId: invoice.gymId })
  let assignment = null

  if (!invoice.fulfilled && member) {
    if (invoice.type === 'pt' && invoice.ptPlanId) {
      const template = invoice.ptPlanId
      const start  = new Date()
      const expiry = new Date(start)
      expiry.setDate(expiry.getDate() + template.durationDays)

      assignment = await MemberPTPlan.create({
        gymId: invoice.gymId,
        memberId: invoice.memberId,
        ptPlanId: template._id,
        name: template.name,
        target: template.target,
        fee: template.fee,
        classesTotal: template.numberOfClasses,
        trainerId: template.trainerId || undefined,
        startDate: start,
        expiryDate: expiry,
      })
      invoice.memberPTPlanId = assignment._id

      syncMemberPTPlans(invoice.gymId, invoice.memberId)
        .catch((e) => console.error('[payment-fulfillment] pt-plan-sync failed:', e.message))
    } else if (invoice.planId) {
      const plan = invoice.planId
      const base = (member.membershipStatus === 'active' && member.membershipExpiryDate && member.membershipExpiryDate > new Date())
        ? new Date(member.membershipExpiryDate)
        : new Date()

      member.currentPlanId = plan._id
      member.membershipStatus = 'active'
      if (!member.membershipStartDate) member.membershipStartDate = new Date()
      member.membershipExpiryDate = addPlanDuration(base, plan)
      await member.save()
    }
    invoice.fulfilled = true
  }

  await invoice.save()

  // Fire-and-forget notifications — never block the payment response on
  // email/push delivery.
  if (member) {
    const planName = invoice.type === 'pt'
      ? (assignment?.name || invoice.ptPlanId?.name || 'PT plan')
      : (invoice.planId?.name || 'Membership')

    sendPushToMember(member._id, {
      title: invoice.type === 'pt' ? 'PT plan activated 💪' : 'Payment received 🎉',
      body: `₹${invoice.totalAmount.toLocaleString('en-IN')} received for ${planName}.`,
      url: invoice.type === 'pt' ? '/plans' : '/billing',
      tag: 'invoice-paid',
    }).catch((e) => console.error('[payment-fulfillment] push failed:', e.message))

    if (member.email) {
      const { from, replyTo, gymName } = await resolveGymSender(invoice.gymId)
      sendInvoiceEmail({
        to: member.email, from, replyTo,
        memberName: member.name,
        gymName,
        invoiceNumber: invoice.invoiceNumber,
        planName,
        paymentMethod: invoice.paymentMethod,
        baseAmount: invoice.baseAmount,
        taxRate: invoice.taxRate,
        taxAmount: invoice.taxAmount,
        totalAmount: invoice.totalAmount,
      }).catch((e) => console.error('[payment-fulfillment] email failed:', e.message))
    }
  }

  return { invoice, member, assignment }
}
