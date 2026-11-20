import Member from '../models/Member.js'
import Announcement from '../models/Announcement.js'
import Notification from '../models/Notification.js'
import { pushToDevices } from './pushNotification.service.js'

export const AUDIENCES = ['all', 'active', 'expiring', 'expired']
const DAY = 86_400_000

/** Which members an announcement goes to. */
export async function memberIdsFor(gymId, audience, now = new Date()) {
  const filter = { gymId, isActive: { $ne: false } }
  if (audience === 'active') filter.membershipStatus = 'active'
  else if (audience === 'expiring') {
    filter.membershipStatus = 'active'
    filter.membershipExpiryDate = { $gte: now, $lte: new Date(now.getTime() + 7 * DAY) }
  } else if (audience === 'expired') filter.membershipStatus = 'expired'
  const rows = await Member.find(filter).select('_id').lean()
  return rows.map((r) => r._id)
}

/**
 * Creates the announcement, drops it in every target member's inbox, then
 * pushes to their devices in the background (so a big gym doesn't make the
 * owner wait on thousands of push calls).
 */
export async function createAnnouncement({ gymId, title, body, audience = 'active', createdBy, createdByName }) {
  if (!AUDIENCES.includes(audience)) audience = 'active'
  const ann = await Announcement.create({ gymId, title, body, audience, createdBy, createdByName })
  const ids = await memberIdsFor(gymId, audience)

  for (let i = 0; i < ids.length; i += 500) {
    await Notification.insertMany(
      ids.slice(i, i + 500).map((memberId) => ({
        gymId, memberId, title, body, url: '/notifications', tag: `announcement-${ann._id}`,
        type: 'announcement', announcementId: ann._id,
      })),
      { ordered: false }
    )
  }
  ann.sentTo = ids.length
  await ann.save()

  setImmediate(async () => {
    for (let i = 0; i < ids.length; i += 10) {
      await Promise.all(ids.slice(i, i + 10).map((id) =>
        pushToDevices(id, { title, body, url: '/notifications', tag: `announcement-${ann._id}` }).catch(() => {})))
    }
  })
  return ann
}
