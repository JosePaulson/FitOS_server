import crypto from 'crypto'
import Razorpay from 'razorpay'
import Gym from '../models/Gym.js'
import Invoice from '../models/Invoice.js'
import { fulfillInvoicePayment } from './paymentFulfillment.service.js'

let _razorpay
function getRazorpay() {
  if (!_razorpay) {
    _razorpay = new Razorpay({
      key_id:     process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    })
  }
  return _razorpay
}

/**
 * There's a single, platform-level Razorpay account for now (same one used
 * for gym SaaS subscriptions above) — it also collects member payments for
 * membership/PT across every gym on FitOS. Routes should check this before
 * offering online payment, and degrade to "pay at the front desk" if unset.
 */
export function isRazorpayConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
}

export const RAZORPAY_PLAN_IDS = {
  lite_monthly:  process.env.RZPY_PLAN_LITE_MONTHLY  || '',
  basic_monthly: process.env.RZPY_PLAN_BASIC_MONTHLY || '',
  pro_monthly:   process.env.RZPY_PLAN_PRO_MONTHLY   || '',
  lite_yearly:   process.env.RZPY_PLAN_LITE_YEARLY   || '',
  basic_yearly:  process.env.RZPY_PLAN_BASIC_YEARLY  || '',
  pro_yearly:    process.env.RZPY_PLAN_PRO_YEARLY    || '',
}

export async function createSubscription(plan, interval = 'monthly', gymId) {
  const planId = RAZORPAY_PLAN_IDS[`${plan}_${interval}`]
  if (!planId) throw new Error(`No Razorpay plan ID configured for ${plan}_${interval}`)

  return getRazorpay().subscriptions.create({
    plan_id:     planId,
    total_count: interval === 'yearly' ? 1 : 12,
    quantity:    1,
    notes:       { gymId: gymId.toString(), plan, interval },
  })
}

export async function cancelSubscription(subscriptionId, atCycleEnd = true) {
  return getRazorpay().subscriptions.cancel(subscriptionId, atCycleEnd)
}

export async function fetchSubscription(subscriptionId) {
  return getRazorpay().subscriptions.fetch(subscriptionId)
}

/* ── One-time payments (member → gym: membership & PT plan purchases) ──────
 * Separate from the subscriptions API above, which is gym → FitOS SaaS
 * billing. Both currently run through the same Razorpay account. */

/**
 * Creates a Razorpay Order for a single invoice payment.
 * `amount` is in rupees (as stored on Invoice.totalAmount) — converted to
 * paise here, since that's the unit Razorpay's API expects.
 */
export async function createOrder({ amount, currency = 'INR', receipt, notes = {} }) {
  return getRazorpay().orders.create({
    amount: Math.round(amount * 100),
    currency,
    receipt,
    notes,
    payment_capture: 1, // auto-capture — no separate manual capture step
  })
}

export async function fetchPayment(paymentId) {
  return getRazorpay().payments.fetch(paymentId)
}

/**
 * Verifies the signature Razorpay Checkout returns to the client on
 * success. Per Razorpay's docs: HMAC-SHA256 of "order_id|payment_id",
 * signed with the key secret, must match razorpay_signature.
 */
export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex')
  return expected === signature
}

export function verifyWebhookSignature(rawBody, signature) {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex')
  return expected === signature
}

/**
 * Safety net for one-time invoice payments (membership/PT bought from the
 * member portal): the client already confirms payment via POST
 * /member-portal/payments/verify right after Checkout succeeds, but if the
 * member closes the tab before that call lands, this webhook still fulfils
 * the invoice. fulfillInvoicePayment() is idempotent, so it's harmless if
 * both paths fire for the same payment.
 *
 * Looked up by razorpay_order_id (which we set on the Invoice ourselves at
 * order-creation time) rather than payment notes — order_id is guaranteed
 * present on every payment entity, whereas note propagation from order to
 * payment isn't guaranteed by Razorpay for plain Orders.
 */
async function handleOneTimePaymentCaptured(payload) {
  const payment = payload?.payment?.entity
  const invoice = payment?.order_id
    ? await Invoice.findOne({ razorpayOrderId: payment.order_id })
    : null

  if (!invoice) {
    // Not one of ours — most likely a SaaS-subscription charge, which
    // Razorpay also reports as payment.captured alongside
    // subscription.charged (handled below).
    console.log('[Razorpay webhook] payment.captured with no matching invoice — ignored')
    return
  }

  await fulfillInvoicePayment({
    invoiceId: invoice._id,
    razorpayPaymentId: payment.id,
    method: payment.method,
  })
}

export async function handleWebhookEvent(event, payload) {
  if (event === 'payment.captured') {
    await handleOneTimePaymentCaptured(payload)
    return
  }

  const sub   = payload?.subscription?.entity || payload?.payment?.entity
  if (!sub) return

  const gymId = sub.notes?.gymId
  if (!gymId) return

  switch (event) {
    case 'subscription.activated':
      await Gym.findByIdAndUpdate(gymId, {
        planStatus: 'active',
        razorpaySubscriptionId: sub.id,
        renewsAt: sub.current_end ? new Date(sub.current_end * 1000) : undefined,
      })
      break
    case 'subscription.charged': {
      const days     = payload?.payment?.entity?.description?.includes('yearly') ? 365 : 30
      const renewsAt = new Date()
      renewsAt.setDate(renewsAt.getDate() + days)
      await Gym.findByIdAndUpdate(gymId, { planStatus: 'active', renewsAt })
      break
    }
    case 'subscription.halted':
      await Gym.findByIdAndUpdate(gymId, { planStatus: 'past_due' })
      break
    case 'subscription.cancelled':
      await Gym.findByIdAndUpdate(gymId, { planStatus: 'cancelled' })
      break
    default:
      console.log(`[Razorpay webhook] Unhandled event: ${event}`)
  }
}
