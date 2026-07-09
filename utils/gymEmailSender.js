import Gym from '../models/Gym.js'

/**
 * Resolves the correct "from" and "replyTo" addresses for a gym's outgoing emails.
 *
 * Priority:
 *   1. gym.settings.emailFrom  (gym owner set their own address)
 *   2. process.env.EMAIL_FROM  (platform fallback)
 *
 * Returns { from, replyTo, gymName } ready to spread into any sendXxx() call.
 *
 * @param {string|ObjectId} gymId
 * @returns {Promise<{ from: string, replyTo: string|undefined, gymName: string }>}
 */
export async function resolveGymSender(gymId) {
  const gym = await Gym.findById(gymId).select('name settings')

  const gymName  = gym?.name || 'Your gym'
  const emailFrom = gym?.settings?.emailFrom?.trim()
  const replyTo   = gym?.settings?.replyTo?.trim() || undefined

  // If gym has set their own email, use it.
  // Otherwise fall back to the platform address.
  const from = emailFrom || process.env.EMAIL_FROM || '"FitOS" <hello@fitos.in>'

  return { from, replyTo, gymName }
}
