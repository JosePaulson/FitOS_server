import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import PushSubscription from '../models/PushSubscription.js'

const router = Router()
router.use(memberProtect)

// GET /api/member-portal/push/vapid-public-key
// The client needs this to call registration.pushManager.subscribe(). It's
// safe to expose — the public key alone can't be used to send notifications,
// only to create a subscription that the server's private key later signs.
router.get('/vapid-public-key', (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null })
})

// POST /api/member-portal/push/subscribe
// Body: the PushSubscription object from the browser's Push API, as-is —
// { endpoint, keys: { p256dh, auth } }
router.post('/subscribe', async (req, res, next) => {
  try {
    const { endpoint, keys } = req.body
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ message: 'Invalid subscription payload' })
    }

    // Upsert — re-subscribing (e.g. after clearing site data) just refreshes
    // the same endpoint's keys rather than creating a duplicate row.
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      {
        endpoint,
        keys,
        gymId:     req.gymId,
        memberId:  req.memberId,
        userAgent: req.headers['user-agent'] || '',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )

    res.status(201).json({ message: 'Subscribed to notifications' })
  } catch (err) { next(err) }
})

// POST /api/member-portal/push/unsubscribe
router.post('/unsubscribe', async (req, res, next) => {
  try {
    const { endpoint } = req.body
    if (!endpoint) return res.status(400).json({ message: 'endpoint is required' })
    await PushSubscription.deleteOne({ endpoint, memberId: req.memberId })
    res.json({ message: 'Unsubscribed' })
  } catch (err) { next(err) }
})

export default router
