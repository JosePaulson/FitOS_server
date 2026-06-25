import crypto from 'crypto'
import Razorpay from 'razorpay'
import Gym from '../models/Gym.js'

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

export function verifyWebhookSignature(rawBody, signature) {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex')
  return expected === signature
}

export async function handleWebhookEvent(event, payload) {
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
