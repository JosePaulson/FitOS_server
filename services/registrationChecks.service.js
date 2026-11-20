import Gym from '../models/Gym.js'
import User from '../models/User.js'
import { emailKey, normalizeSubdomain, subdomainProblem } from '../utils/identity.js'

export const MSG = {
  subdomainFormat: 'The web address must be 3\u201340 characters: lowercase letters, numbers and hyphens, and it can\u2019t start or end with a hyphen.',
  subdomainReserved: 'That web address isn\u2019t available. Please choose another.',
  subdomainTaken: 'That web address is already taken. Please choose another.',
  emailTaken: 'An account with this email address already exists. Sign in instead, or use a different email.',
}

/**
 * Everything wrong with a proposed gym registration, per field, so the form can
 * point at each problem at once instead of one failure per attempt.
 * `email` may be omitted (the web-address availability check has no email).
 * Returns { fields, status } — status 400 for a malformed value, 409 for a clash.
 */
export async function registrationConflicts({ email, subdomain }) {
  const fields = {}
  let status = 409

  const sub = normalizeSubdomain(subdomain)
  const problem = subdomainProblem(sub)
  if (problem === 'format') { fields.subdomain = MSG.subdomainFormat; status = 400 }
  else if (problem === 'reserved') fields.subdomain = MSG.subdomainReserved
  else if (await Gym.exists({ subdomain: sub })) fields.subdomain = MSG.subdomainTaken

  if (email !== undefined) {
    // emailKey catches aliases (name+gym@gmail.com, n.ame@gmail.com); the exact-email clause covers
    // accounts created before keys existed. Across ALL gyms: login finds a user by email alone.
    const lower = String(email).trim().toLowerCase()
    if (await User.exists({ $or: [{ emailKey: emailKey(lower) }, { email: lower }] })) fields.email = MSG.emailTaken
  }
  return { fields, status }
}
