import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import Invoice from '../models/Invoice.js'
import MembershipPlan from '../models/MembershipPlan.js'
import PTPlan from '../models/PTPlan.js'
import { extractTax } from '../utils/tax.js'
import {
  isRazorpayConfigured,
  createOrder,
  fetchPayment,
  verifyPaymentSignature,
} from '../services/razorpay.service.js'
import { fulfillInvoicePayment } from '../services/paymentFulfillment.service.js'

const router = Router()
router.use(memberProtect)

function notConfigured(res) {
  return res.status(503).json({
    message: 'Online payments aren\u2019t set up for this gym yet — please pay at the front desk.',
  })
}

/** Builds a pending, not-yet-fulfilled invoice for a member-initiated checkout. */
function buildPendingInvoice({ gymId, memberId, price, taxRate = 18, type, planId, ptPlanId }) {
  const { baseAmount, taxAmount, totalAmount } = extractTax(price, taxRate)
  return {
    gymId, memberId, type, planId, ptPlanId,
    baseAmount, taxRate, taxAmount, totalAmount,
    status: 'pending',
    dueDate: new Date(),
    fulfilled: false,
  }
}

/** Creates a fresh Razorpay order for a pending invoice and responds with what Checkout needs. */
async function respondWithOrder(res, invoice) {
  const order = await createOrder({
    amount: invoice.totalAmount,
    receipt: invoice.invoiceNumber,
    notes: {
      invoiceId: invoice._id.toString(),
      memberId: invoice.memberId.toString(),
      gymId: invoice.gymId.toString(),
      type: invoice.type,
    },
  })
  invoice.razorpayOrderId = order.id
  await invoice.save()

  res.json({
    orderId: order.id,
    amount: order.amount,     // paise — pass straight through to Checkout
    currency: order.currency,
    keyId: process.env.RAZORPAY_KEY_ID,
    invoiceId: invoice._id,
    invoiceNumber: invoice.invoiceNumber,
  })
}

/** GET /api/member-portal/payments/config — whether online payment is available */
router.get('/config', (req, res) => {
  res.json({ enabled: isRazorpayConfigured() })
})

/**
 * POST /api/member-portal/payments/invoices/:id/order
 * Pay an existing pending invoice — covers invoices staff already created
 * (enrolment/renewal at the front desk) that the member wants to settle
 * online instead of in person.
 */
router.post('/invoices/:id/order', async (req, res, next) => {
  try {
    if (!isRazorpayConfigured()) return notConfigured(res)

    const invoice = await Invoice.findOne({ _id: req.params.id, memberId: req.memberId, gymId: req.gymId })
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' })
    if (invoice.status !== 'pending') {
      return res.status(400).json({ message: `This invoice is already ${invoice.status}.` })
    }

    await respondWithOrder(res, invoice)
  } catch (err) { next(err) }
})

/**
 * POST /api/member-portal/payments/membership/checkout
 * Self-serve buy or renew a membership plan. Reuses an existing
 * pending+unfulfilled invoice for the same plan if the member already
 * started (and abandoned) this exact checkout, instead of piling up
 * duplicate pending invoices on every retry.
 */
router.post('/membership/checkout', async (req, res, next) => {
  try {
    if (!isRazorpayConfigured()) return notConfigured(res)

    const { planId } = req.body
    if (!planId) return res.status(400).json({ message: 'Plan required' })

    const plan = await MembershipPlan.findOne({ _id: planId, gymId: req.gymId, isActive: true })
    if (!plan) return res.status(404).json({ message: 'Plan not found' })

    let invoice = await Invoice.findOne({
      memberId: req.memberId, gymId: req.gymId, type: 'membership',
      planId: plan._id, status: 'pending', fulfilled: false,
    })
    if (!invoice) {
      invoice = await Invoice.create(buildPendingInvoice({
        gymId: req.gymId, memberId: req.memberId,
        price: plan.price, taxRate: plan.taxRate,
        type: 'membership', planId: plan._id,
      }))
    }

    await respondWithOrder(res, invoice)
  } catch (err) { next(err) }
})

/**
 * POST /api/member-portal/payments/pt/checkout
 * Self-serve buy a PT plan from the catalog.
 */
router.post('/pt/checkout', async (req, res, next) => {
  try {
    if (!isRazorpayConfigured()) return notConfigured(res)

    const { ptPlanId } = req.body
    if (!ptPlanId) return res.status(400).json({ message: 'PT plan required' })

    const plan = await PTPlan.findOne({ _id: ptPlanId, gymId: req.gymId, isActive: true })
    if (!plan) return res.status(404).json({ message: 'PT plan not found' })

    let invoice = await Invoice.findOne({
      memberId: req.memberId, gymId: req.gymId, type: 'pt',
      ptPlanId: plan._id, status: 'pending', fulfilled: false,
    })
    if (!invoice) {
      // PT plan fees aren't modelled with a tax rate on the catalog (unlike
      // membership plans) — treat the fee as the flat total, no GST split.
      invoice = await Invoice.create(buildPendingInvoice({
        gymId: req.gymId, memberId: req.memberId,
        price: plan.fee, taxRate: 0,
        type: 'pt', ptPlanId: plan._id,
      }))
    }

    await respondWithOrder(res, invoice)
  } catch (err) { next(err) }
})

/**
 * POST /api/member-portal/payments/verify
 * Called right after Razorpay Checkout's success handler fires client-side.
 * Verifies the signature, then fulfils the invoice. The webhook
 * (payment.captured) is a backstop for this same step in case the client
 * never gets to call it.
 */
router.post('/verify', async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: 'Missing payment verification fields' })
    }

    const valid = verifyPaymentSignature({
      orderId: razorpay_order_id, paymentId: razorpay_payment_id, signature: razorpay_signature,
    })
    if (!valid) return res.status(400).json({ message: 'Payment verification failed' })

    const invoice = await Invoice.findOne({
      razorpayOrderId: razorpay_order_id, memberId: req.memberId, gymId: req.gymId,
    })
    if (!invoice) return res.status(404).json({ message: 'Invoice not found for this payment' })

    let method
    try {
      const payment = await fetchPayment(razorpay_payment_id)
      method = payment?.method
    } catch (e) {
      console.error('[payments/verify] fetchPayment failed:', e.message)
    }

    const result = await fulfillInvoicePayment({
      invoiceId: invoice._id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      method,
    })

    res.json({
      invoice: result.invoice,
      member: result.member,
      ptPlan: result.assignment || null,
    })
  } catch (err) { next(err) }
})

export default router
