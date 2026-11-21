import { Router } from 'express'
import { protect } from '../middleware/auth.js'
import PushSubscription from '../models/PushSubscription.js'

/**
 * Web Push subscriptions for staff (admin dashboard PWA). Mirrors the
 * member-portal push routes, but ties the device to the signed-in staff user.
 */
const router = Router()
router.use(protect)

// GET /api/push/vapid-public-key
router.get('/vapid-public-key', (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null })
})

// POST /api/push/subscribe — body: the browser's PushSubscription JSON
router.post('/subscribe', async (req, res, next) => {
  try {
    const { endpoint, keys } = req.body
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ message: 'Invalid subscription payload' })
    }
    // Upsert on endpoint. A device that was previously used by someone else (a
    // member, or another staff user) now belongs to the signed-in staff user.
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      {
        $set: { endpoint, keys, gymId: req.gymId, userId: req.user._id, userAgent: req.headers['user-agent'] || '' },
        $unset: { memberId: '' },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
    res.status(201).json({ message: 'Subscribed to notifications' })
  } catch (err) { next(err) }
})

// POST /api/push/unsubscribe
router.post('/unsubscribe', async (req, res, next) => {
  try {
    const { endpoint } = req.body
    if (!endpoint) return res.status(400).json({ message: 'endpoint is required' })
    await PushSubscription.deleteOne({ endpoint, userId: req.user._id })
    res.json({ message: 'Unsubscribed' })
  } catch (err) { next(err) }
})

export default router
