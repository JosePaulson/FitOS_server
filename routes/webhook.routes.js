import { Router, raw } from 'express'
import { verifyWebhookSignature, handleWebhookEvent } from '../services/razorpay.service.js'

const router = Router()

/**
 * POST /api/webhooks/razorpay
 * Must receive raw body — mounted with express.raw() in app.js
 * BEFORE express.json() so the signature check works.
 */
router.post('/', raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-razorpay-signature']

  if (!verifyWebhookSignature(req.body, signature)) {
    console.warn('[Razorpay webhook] Invalid signature')
    return res.status(400).json({ message: 'Invalid signature' })
  }

  let payload
  try {
    payload = JSON.parse(req.body.toString())
  } catch {
    return res.status(400).json({ message: 'Invalid JSON' })
  }

  const event = payload.event
  console.log(`[Razorpay webhook] Event: ${event}`)

  try {
    await handleWebhookEvent(event, payload.payload)
    res.json({ received: true })
  } catch (err) {
    console.error('[Razorpay webhook] Handler error:', err)
    res.status(500).json({ message: 'Webhook handler failed' })
  }
})

export default router
