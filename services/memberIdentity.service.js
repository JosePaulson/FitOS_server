import Member from '../models/Member.js'
import { phoneKey, phoneRegex } from '../utils/identity.js'

/**
 * The ACTIVE member in this gym who already uses `phone` (any formatting), or null.
 * Matches on the stored phoneKey, and — for rows saved before keys existed — on the
 * digits of the raw phone, so it works before AND after the one-time backfill script.
 * Archived members don't count, which lets a returning member be added again.
 */
export async function findActiveMemberByPhone(gymId, phone, excludeId) {
  const key = phoneKey(phone)
  if (!key) return null
  const query = {
    gymId, isActive: { $ne: false },
    $or: [{ phoneKey: key }, { phoneKey: { $exists: false }, phone: phoneRegex(key) }],
  }
  if (excludeId) query._id = { $ne: excludeId }
  return Member.findOne(query).select('name phone membershipStatus')
}

export function duplicatePhoneMessage(m) {
  const status = m.membershipStatus === 'paused' ? 'on hold' : (m.membershipStatus || 'active')
  return `This phone number is already registered to ${m.name} (${status} member). Each member needs their own phone number.`
}
