import { Router } from 'express'
import { protect } from '../middleware/auth.js'
import Gym from '../models/Gym.js'
import { createSubscription, cancelSubscription, fetchSubscription } from '../services/razorpay.service.js'

const router = Router()

router.post('/create', protect, async (req, res, next) => {
  try {
    const { plan = 'basic', interval = 'monthly' } = req.body
    const gym = await Gym.findById(req.gymId)
    if (!gym) return res.status(404).json({ message: 'Gym not found' })
    if (gym.planStatus === 'active') return res.status(400).json({ message: 'You already have an active subscription' })

    const subscription = await createSubscription(plan, interval, gym._id)
    gym.razorpaySubscriptionId = subscription.id
    await gym.save()

    res.json({ subscriptionId: subscription.id, keyId: process.env.RAZORPAY_KEY_ID })
  } catch (err) { next(err) }
})

router.post('/cancel', protect, async (req, res, next) => {
  try {
    const { atCycleEnd = true } = req.body
    const gym = await Gym.findById(req.gymId)
    if (!gym?.razorpaySubscriptionId) return res.status(400).json({ message: 'No active subscription found' })

    await cancelSubscription(gym.razorpaySubscriptionId, atCycleEnd)
    gym.planStatus = atCycleEnd ? 'active' : 'cancelled'
    await gym.save()

    res.json({ message: atCycleEnd ? 'Subscription will cancel at end of billing period.' : 'Subscription cancelled immediately.' })
  } catch (err) { next(err) }
})

router.get('/status', protect, async (req, res, next) => {
  try {
    const gym = await Gym.findById(req.gymId).select('plan planStatus razorpaySubscriptionId renewsAt trialEndsAt')
    if (!gym?.razorpaySubscriptionId) return res.json({ plan: gym?.plan, planStatus: gym?.planStatus, subscription: null })
    const subscription = await fetchSubscription(gym.razorpaySubscriptionId)
    res.json({ plan: gym.plan, planStatus: gym.planStatus, renewsAt: gym.renewsAt, subscription })
  } catch (err) { next(err) }
})

export default router
