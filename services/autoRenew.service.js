import Member from '../models/Member.js'
import MembershipPlan from '../models/MembershipPlan.js'
import Invoice from '../models/Invoice.js'
import { priceInvoice } from '../utils/pricing.js'
import { createPaymentLink, isRazorpayConfigured } from './razorpay.service.js'
import { sendPushToMember } from './pushNotification.service.js'
import { fmtDate } from '../utils/dateFormat.js'

export const RENEWAL_LEAD_DAYS = 3
const DAY = 86_400_000

/**
 * "Assisted" auto-renew. For members who switched it on, a few days before
 * their membership ends we prepare the renewal invoice (same plan, no
 * discount), attach a Razorpay payment link when online payments are set up,
 * and nudge them to pay in one tap. This does NOT debit anyone automatically —
 * a true card/UPI mandate (Razorpay Subscriptions) is a separate piece of work.
 *
 * Safe to run repeatedly: each expiry is only handled once (lastNoticeForExpiry),
 * and an existing unpaid renewal invoice for the plan is reused, never duplicated.
 */
export async function runAutoRenewInvoices(now = new Date()) {
  const horizon = new Date(now.getTime() + RENEWAL_LEAD_DAYS * DAY)
  const members = await Member.find({
    'autoRenew.enabled': true, membershipStatus: 'active', isActive: { $ne: false },
    membershipExpiryDate: { $gt: now, $lte: horizon },
  })

  let prepared = 0
  for (const member of members) {
    try {
      const expiry = member.membershipExpiryDate
      if (member.autoRenew?.lastNoticeForExpiry && member.autoRenew.lastNoticeForExpiry.getTime() === expiry.getTime()) continue

      const plan = member.currentPlanId && await MembershipPlan.findOne({ _id: member.currentPlanId, gymId: member.gymId, isActive: true })
      if (!plan) continue

      let invoice = await Invoice.findOne({
        gymId: member.gymId, memberId: member._id, type: 'membership', planId: plan._id, status: 'pending', fulfilled: false,
      })
      if (!invoice) {
        const taxRate = plan.taxRate ?? 18
        invoice = await Invoice.create({
          gymId: member.gymId, memberId: member._id, type: 'membership', planId: plan._id,
          ...priceInvoice(plan.price, taxRate, 0), taxRate,
          status: 'pending', dueDate: expiry, fulfilled: false, notes: 'Auto-generated renewal invoice',
        })
      }

      if (isRazorpayConfigured() && !invoice.paymentLink?.url) {
        try {
          const link = await createPaymentLink({
            amount: invoice.balanceDue, referenceId: `${invoice._id}-${Date.now().toString(36)}`,
            description: `Renewal ${invoice.invoiceNumber}`,
            customer: { name: member.name, phone: member.phone, email: member.email },
            notes: { invoiceId: invoice._id.toString(), gymId: String(member.gymId) },
          })
          invoice.paymentLink = { id: link.id, url: link.short_url, amount: invoice.balanceDue, createdAt: new Date() }
          await invoice.save()
        } catch (e) { console.error('[auto-renew] payment link failed:', e.message) } // the in-app pay button still works
      }

      const when = fmtDate(expiry)
      sendPushToMember(member._id, {
        title: 'Time to renew 💪',
        body: `Your ${plan.name} membership ends on ${when}. Renew in one tap — ₹${invoice.totalAmount.toLocaleString('en-IN')}.`,
        url: '/', tag: 'auto-renew', type: 'renewal',
      }).catch((e) => console.error('[auto-renew] push failed:', e.message))

      member.autoRenew.lastNoticeForExpiry = expiry
      await member.save({ validateBeforeSave: false })
      prepared++
    } catch (err) {
      console.error('[auto-renew] failed for member', String(member._id), err.message)
    }
  }
  return prepared
}
