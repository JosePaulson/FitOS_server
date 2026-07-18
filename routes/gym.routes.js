import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import Gym from '../models/Gym.js'
import { protect, authorize } from '../middleware/auth.js'
import { sendEmail } from '../services/email.service.js'

const router = Router()

// GET /api/gym/settings — get current gym profile + settings
router.get('/settings', protect, async (req, res, next) => {
  try {
    const gym = await Gym.findById(req.gymId).select('-razorpaySubscriptionId')
    if (!gym) return res.status(404).json({ message: 'Gym not found' })
    res.json(gym)
  } catch (err) { next(err) }
})

// PATCH /api/gym/settings — update gym profile and settings
router.patch('/settings',
  protect,
  authorize('owner'),
  [
    body('name').optional().notEmpty().withMessage('Gym name cannot be empty'),
    body('settings.emailFrom')
      .optional()
      .custom((val) => {
        if (!val) return true   // empty = use platform default, which is fine
        // Accept either plain email or "Name <email>" format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        const namedRegex = /^.+<[^\s@]+@[^\s@]+\.[^\s@]+>$/
        if (!emailRegex.test(val) && !namedRegex.test(val)) {
          throw new Error('Invalid email format. Use "email@domain.com" or "Name <email@domain.com>"')
        }
        return true
      }),
    body('settings.replyTo')
      .optional()
      .custom((val) => {
        if (!val) return true
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(val)) throw new Error('Invalid reply-to email address')
        return true
      }),
    body('location.lat').optional({ nullable: true }).isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
    body('location.lng').optional({ nullable: true }).isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
    body('location.radiusMeters').optional({ nullable: true }).isInt({ min: 10, max: 1000 }).withMessage('Radius must be between 10 and 1000 meters'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg })

    try {
      const ALLOWED_TOP = ['name', 'phone', 'address', 'city', 'state']
      const ALLOWED_SETTINGS = ['currency', 'timezone', 'brandColor', 'emailFrom', 'replyTo']
      const ALLOWED_LOCATION = ['lat', 'lng', 'radiusMeters']

      const updates = {}
      ALLOWED_TOP.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k] })

      if (req.body.settings) {
        ALLOWED_SETTINGS.forEach((k) => {
          if (req.body.settings[k] !== undefined) {
            updates[`settings.${k}`] = req.body.settings[k]
          }
        })
      }

      if (req.body.location) {
        ALLOWED_LOCATION.forEach((k) => {
          if (req.body.location[k] !== undefined) {
            updates[`location.${k}`] = req.body.location[k]
          }
        })
      }

      const gym = await Gym.findByIdAndUpdate(req.gymId, { $set: updates }, { new: true, runValidators: true })
      res.json(gym)
    } catch (err) { next(err) }
  }
)

// POST /api/gym/settings/test-email — send a test email to verify sender config
router.post('/settings/test-email', protect, authorize('owner'), async (req, res, next) => {
  try {
    const gym = await Gym.findById(req.gymId).select('name settings')
    if (!gym) return res.status(404).json({ message: 'Gym not found' })

    const emailFrom = gym.settings?.emailFrom?.trim()
    const replyTo   = gym.settings?.replyTo?.trim() || undefined
    const from      = emailFrom || process.env.EMAIL_FROM || '"FitOS" <hello@fitos.in>'

    // Send to the owner's own email (from req.user, populated by protect middleware)
    const to = req.user.email
    if (!to) return res.status(400).json({ message: 'Your account has no email address' })

    await sendEmail({
      to, from, replyTo,
      subject: `✅ Test email from ${gym.name}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
          <div style="background:#0D0D0D;padding:24px 28px;border-radius:12px 12px 0 0">
            <span style="font-size:18px;font-weight:900;color:#F5F4EF">${gym.name}</span>
          </div>
          <div style="background:#f9f9f9;padding:28px;border-radius:0 0 12px 12px">
            <h2 style="margin:0 0 12px">Your email sender is working! ✅</h2>
            <p style="color:#555;margin:0 0 16px">This test email was sent from <strong>${from}</strong>.</p>
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <tr style="background:#f0f0f0">
                <td style="padding:8px 12px;color:#555">From</td>
                <td style="padding:8px 12px;font-weight:600">${from}</td>
              </tr>
              ${replyTo ? `<tr><td style="padding:8px 12px;color:#555">Reply-to</td><td style="padding:8px 12px;font-weight:600">${replyTo}</td></tr>` : ''}
              <tr style="background:#f0f0f0">
                <td style="padding:8px 12px;color:#555">Sent to</td>
                <td style="padding:8px 12px;font-weight:600">${to}</td>
              </tr>
            </table>
            <p style="color:#aaa;font-size:11px;margin-top:24px;border-top:1px solid #e0e0e0;padding-top:16px">
              Sent via SendGrid · Powered by FitOS
            </p>
          </div>
        </div>
      `,
    })

    res.json({ message: `Test email sent to ${to}` })
  } catch (err) {
    // Surface the SendGrid error detail so the owner can debug
    res.status(500).json({
      message: 'Failed to send test email',
      detail:  err.message,
      hint:    !process.env.SENDGRID_API_KEY
        ? 'SENDGRID_API_KEY is not set in server/.env'
        : 'Check that your sender domain is verified in SendGrid → Sender Authentication',
    })
  }
})

export default router
