import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import Gym from '../models/Gym.js'
import { protect, authorize } from '../middleware/auth.js'
import { sendEmail } from '../services/email.service.js'
import { devOr, isDev } from '../utils/errors.js'

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
    body('settings.emailSignature').optional({ nullable: true }).isLength({ max: 500 }).withMessage('Signature is too long'),
    body('settings.emailFooterText').optional({ nullable: true }).isLength({ max: 500 }).withMessage('Footer text is too long'),
    body('settings.welcomeEmailBody').optional({ nullable: true }).isLength({ max: 1000 }).withMessage('Welcome message is too long'),
    body('settings.invoiceEmailBody').optional({ nullable: true }).isLength({ max: 1000 }).withMessage('Invoice message is too long'),
    body('settings.renewalEmailBody').optional({ nullable: true }).isLength({ max: 1000 }).withMessage('Renewal message is too long'),
    body('location.lat').optional({ nullable: true }).isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
    body('location.lng').optional({ nullable: true }).isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
    body('location.radiusMeters').optional({ nullable: true }).isInt({ min: 10, max: 1000 }).withMessage('Radius must be between 10 and 1000 meters'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg })

    try {
      const ALLOWED_TOP = ['name', 'phone', 'address', 'city', 'state', 'logo']
      const ALLOWED_SETTINGS = ['currency', 'timezone', 'brandColor', 'emailFrom', 'replyTo', 'emailSignature', 'emailFooterText', 'welcomeEmailBody', 'invoiceEmailBody', 'renewalEmailBody']
      const ALLOWED_LOCATION = ['lat', 'lng', 'radiusMeters']
      const ALLOWED_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

      const updates = {}
      ALLOWED_TOP.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k] })

      if (req.body.settings) {
        ALLOWED_SETTINGS.forEach((k) => {
          if (req.body.settings[k] !== undefined) {
            updates[`settings.${k}`] = req.body.settings[k]
          }
        })
      }

      // Waiver: on/off + wording. Changing the wording bumps the version, which
      // is how members who signed the old text get asked to sign again.
      const waiver = req.body.settings?.waiver
      if (waiver) {
        if (waiver.enabled !== undefined) updates['settings.waiver.enabled'] = !!waiver.enabled
        if (waiver.text !== undefined) {
          const text = String(waiver.text ?? '').trim().slice(0, 8000)
          const current = await Gym.findById(req.gymId).select('settings.waiver').lean()
          if (text !== (current?.settings?.waiver?.text || '').trim()) {
            updates['settings.waiver.text'] = text
            updates['settings.waiver.version'] = (current?.settings?.waiver?.version || 1) + 1
          }
        }
      }

      // GST details (printed on invoices) and the referral programme.
      const gst = req.body.settings?.gst
      if (gst) {
        for (const k of ['legalName', 'address', 'sac', 'footerNote']) {
          if (gst[k] !== undefined) updates[`settings.gst.${k}`] = String(gst[k] ?? '').trim().slice(0, k === 'address' || k === 'footerNote' ? 300 : 120)
        }
        if (gst.gstin !== undefined) {
          const g = String(gst.gstin ?? '').trim().toUpperCase()
          // Standard 15-character GSTIN: 2-digit state, 10-char PAN, entity no., 'Z', checksum.
          if (g && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) {
            return res.status(400).json({ message: 'GSTIN doesn\u2019t look right \u2014 it should be 15 characters, e.g. 29ABCDE1234F1Z5' })
          }
          updates['settings.gst.gstin'] = g
        }
      }
      const referral = req.body.settings?.referral
      if (referral) {
        if (referral.enabled !== undefined) updates['settings.referral.enabled'] = !!referral.enabled
        const num = (v, max) => Math.min(max, Math.max(0, Math.round(Number(v) || 0)))
        if (referral.referrerRewardDays !== undefined) updates['settings.referral.referrerRewardDays'] = num(referral.referrerRewardDays, 365)
        if (referral.refereeDiscountPercent !== undefined) updates['settings.referral.refereeDiscountPercent'] = num(referral.refereeDiscountPercent, 100)
      }

      if (req.body.location) {
        ALLOWED_LOCATION.forEach((k) => {
          if (req.body.location[k] !== undefined) {
            updates[`location.${k}`] = req.body.location[k]
          }
        })
      }

      if (req.body.openingHours) {
        ALLOWED_DAYS.forEach((day) => {
          if (req.body.openingHours[day] !== undefined) {
            updates[`openingHours.${day}`] = String(req.body.openingHours[day]).slice(0, 60)
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
    const from      = emailFrom || process.env.EMAIL_FROM || '"FitOS" <info@f8os.in>'

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
    // Details (provider message, env-var names) are for developers — owners just get a clear next step.
    console.error('[test-email] failed:', err.message)
    res.status(500).json({
      message: 'We couldn\u2019t send the test email. Please check your email settings and try again.',
      ...(isDev() && {
        detail: err.message,
        hint: !process.env.SENDGRID_API_KEY
          ? 'SENDGRID_API_KEY is not set in server/.env'
          : 'Check that your sender domain is verified in SendGrid \u2192 Sender Authentication',
      }),
    })
  }
})

export default router
