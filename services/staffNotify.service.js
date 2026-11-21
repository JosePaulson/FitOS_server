import User from '../models/User.js'
import { sendPushToUsers } from './pushNotification.service.js'

/**
 * Push a notification to staff of one gym — specific people (`userIds`) and/or
 * everyone in the given `roles` — skipping `exceptUserId` (usually whoever just
 * did the thing). Fire-and-forget: never throws, never blocks the caller; call
 * it without `await`.
 *
 *   notifyStaff(gymId, { roles: ['owner', 'manager'] }, { title, body, url, tag })
 *   notifyStaff(gymId, { userIds: [trainerId] }, { ... })
 *
 * `url` is the admin-dashboard route opened when the notification is tapped.
 */
export async function notifyStaff(gymId, { userIds = [], roles = [], exceptUserId } = {}, payload) {
  try {
    const ids = new Set(userIds.filter(Boolean).map(String))
    if (roles.length) {
      const people = await User.find({ gymId, role: { $in: roles }, isActive: true }).select('_id').lean()
      people.forEach((u) => ids.add(String(u._id)))
    }
    if (exceptUserId) ids.delete(String(exceptUserId))
    if (!ids.size) return
    await sendPushToUsers([...ids], { url: '/dashboard', tag: 'fitos-staff', ...payload })
  } catch (err) {
    console.error('[staff-notify] failed:', err.message)
  }
}

/** The people who should hear about gym-wide events. */
export const MANAGEMENT = ['owner', 'manager']
