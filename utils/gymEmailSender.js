import Gym from '../models/Gym.js'

/**
 * Resolves everything a gym's outgoing emails need — sender address,
 * reply-to, and branding (name, logo, signature, footer text).
 *
 * Priority for sender address:
 *   1. gym.settings.emailFrom  (gym owner set their own address)
 *   2. process.env.EMAIL_FROM  (platform fallback)
 *
 * Returns { from, replyTo, gymName, logo, emailSignature, emailFooterText }
 * ready to spread into any sendXxx() call.
 *
 * @param {string|ObjectId} gymId
 */
export async function resolveGymSender(gymId) {
  const gym = await Gym.findById(gymId).select('name logo settings')

  const gymName  = gym?.name || 'Your gym'
  const emailFrom = gym?.settings?.emailFrom?.trim()
  const replyTo   = gym?.settings?.replyTo?.trim() || undefined

  // If gym has set their own email, use it.
  // Otherwise fall back to the platform address.
  const from = emailFrom || process.env.EMAIL_FROM || '"FitOS" <info@f8os.in>'

  return {
    from,
    replyTo,
    gymName,
    logo: gym?.logo || undefined,
    emailSignature: gym?.settings?.emailSignature?.trim() || undefined,
    emailFooterText: gym?.settings?.emailFooterText?.trim() || undefined,
    welcomeEmailBody: gym?.settings?.welcomeEmailBody?.trim() || undefined,
    invoiceEmailBody: gym?.settings?.invoiceEmailBody?.trim() || undefined,
    renewalEmailBody: gym?.settings?.renewalEmailBody?.trim() || undefined,
  }
}
