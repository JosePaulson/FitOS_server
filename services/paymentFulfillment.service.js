import Invoice from '../models/Invoice.js'
import Member from '../models/Member.js'
import MemberPTPlan from '../models/MemberPTPlan.js'
import { addPlanDuration } from '../utils/planDuration.js'
import { sendInvoiceEmail } from './email.service.js'
import { resolveGymSender } from '../utils/gymEmailSender.js'
import { sendPushToMember } from './pushNotification.service.js'
import { syncMemberPTPlans } from './ptPlanSync.service.js'
import { resumeMembership } from './membershipFreeze.service.js'
import { grantReferralReward } from './referral.service.js'
import { renewalPeriod } from '../utils/membershipDates.js'

const VALID_PAYMENT_METHODS = ['cash', 'upi', 'card', 'netbanking', 'wallet', 'emi', 'paylater', 'online', 'other']

function normalizeMethod(method) {
  return VALID_PAYMENT_METHODS.includes(method) ? method : 'other'
}

const round2 = (n) => Math.round(n * 100) / 100
const EPS = 0.005

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

  // Whatever hasn't been recorded yet is settled by this payment — keeps the
  // payments ledger summing to totalAmount whether the invoice was paid in
  // one go or finished off after part payments.
  const remaining = round2(invoice.totalAmount - (invoice.amountPaid || 0))
  if (remaining > EPS) {
    invoice.payments.push({
      amount: remaining, method: normalizeMethod(method), paidAt: new Date(),
      razorpayPaymentId: razorpayPaymentId || undefined,
    })
  }
  invoice.amountPaid = invoice.totalAmount

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
      // Renewing while on hold: end the hold first so the frozen days are
      // added back, then extend from the corrected expiry.
      if (member.membershipStatus === 'paused') {
        try { await resumeMembership(member) } catch (e) { console.error('[payment-fulfillment] auto-resume failed:', e.message) }
      }
      const { base, start } = renewalPeriod({
        status: member.membershipStatus, expiry: member.membershipExpiryDate, existingStart: member.membershipStartDate,
      })

      member.currentPlanId = plan._id
      member.membershipStatus = 'active'
      member.membershipStartDate = start // a lapsed membership starts a fresh period today
      member.membershipExpiryDate = addPlanDuration(base, plan)
      await member.save()
    }
    invoice.fulfilled = true
  }

  await invoice.save()

  // Referral reward (no-op unless this member was referred, the gym has the
  // programme on, and this is their first paid membership invoice).
  if (member) await grantReferralReward(member, invoice)

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

/**
 * Records one instalment against an invoice (front-desk part payment, or an
 * online payment of the balance via a payment link).
 *
 *  - Idempotent per razorpayPaymentId (webhooks can be delivered twice).
 *  - Amounts above the balance are clamped to it.
 *  - The instalment that brings amountPaid up to totalAmount finalises the
 *    invoice through fulfillInvoicePayment(), so membership/PT activation,
 *    referral rewards and receipts behave exactly as for a single payment.
 *
 * Throws Error with `.status` for problems staff should see.
 */
export async function recordInvoicePayment({ invoiceId, amount, method, razorpayPaymentId, note, receivedBy }) {
  const fail = (m, status = 400) => Object.assign(new Error(m), { status })

  const invoice = await Invoice.findById(invoiceId)
  if (!invoice) throw fail('Invoice not found', 404)
  if (invoice.status === 'paid') throw fail('Invoice is already paid')
  if (['cancelled', 'refunded'].includes(invoice.status)) throw fail(`Invoice is ${invoice.status}`)

  if (razorpayPaymentId && invoice.payments.some((p) => p.razorpayPaymentId === razorpayPaymentId)) {
    return { invoice, duplicate: true }
  }

  const balance = round2(invoice.totalAmount - (invoice.amountPaid || 0))
  let credited = round2(Number(amount))
  if (!(credited > 0)) throw fail('Enter an amount greater than zero')
  if (credited > balance + EPS) {
    if (razorpayPaymentId) credited = balance // money already received online — credit what's owed
    else throw fail(`Amount is more than the balance due (\u20B9${balance.toLocaleString('en-IN')})`)
  }

  invoice.payments.push({
    amount: credited, method: normalizeMethod(method), paidAt: new Date(),
    note: note?.trim() || undefined, razorpayPaymentId: razorpayPaymentId || undefined, receivedBy,
  })
  invoice.amountPaid = round2((invoice.amountPaid || 0) + credited)

  if (invoice.amountPaid >= invoice.totalAmount - EPS) {
    await invoice.save()
    return fulfillInvoicePayment({ invoiceId: invoice._id, razorpayPaymentId, method })
  }

  invoice.status = 'partial'
  invoice.paymentMethod = normalizeMethod(method)
  await invoice.save()

  const left = round2(invoice.totalAmount - invoice.amountPaid)
  sendPushToMember(invoice.memberId, {
    title: 'Payment received',
    body: `\u20B9${credited.toLocaleString('en-IN')} received for invoice ${invoice.invoiceNumber}. Balance due: \u20B9${left.toLocaleString('en-IN')}.`,
    url: '/billing', tag: 'invoice-partial',
  }).catch((e) => console.error('[payment-fulfillment] push failed:', e.message))

  return { invoice, partial: true }
}
