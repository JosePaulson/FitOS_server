import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { registrationConflicts } from '../services/registrationChecks.service.js'

const router = Router()

// Public (used before sign-up), so it has its own, tighter limit.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many checks. Please try again in a few minutes.' },
})

// GET /api/availability/subdomain?subdomain=ironzone → { available, message? }
// Only the web address is checked here: web addresses are public anyway, whereas
// "is this email registered?" is not something to hand out to anyone who asks.
router.get('/subdomain', limiter, async (req, res, next) => {
  try {
    const { fields } = await registrationConflicts({ subdomain: req.query.subdomain })
    res.json(fields.subdomain ? { available: false, message: fields.subdomain } : { available: true })
  } catch (err) { next(err) }
})

export default router
