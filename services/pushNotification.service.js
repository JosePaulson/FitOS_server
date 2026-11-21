import webpush from '../config/webpush.js'
import PushSubscription from '../models/PushSubscription.js'
import Member from '../models/Member.js'
import Notification from '../models/Notification.js'

/**
 * Sends a push notification to every device a member has subscribed on.
 *
 * Fire-and-forget by design — call sites should NOT await this in the
 * critical path of an API response (a slow or unreachable push service
 * should never delay the actual admin action). Every call site in this
 * codebase calls this without awaiting and lets it run in the background.
 *
 * @param {string} memberId
 * @param {object} payload
 * @param {string} payload.title
 * @param {string} payload.body
 * @param {string} [payload.url]   deep link opened when the notification is tapped
 * @param {string} [payload.tag]   groups/replaces notifications of the same kind
 */
// Chatty, low-value reminders that would only bury real notifications in the inbox.
const NO_INBOX_TAG = /^hydration/

/** Saves the notification to the member's in-app inbox. Never throws. */
async function recordInbox(memberId, payload) {
  try {
    if (payload.inbox === false || NO_INBOX_TAG.test(payload.tag || '')) return
    const id = memberId?._id || memberId
    const member = await Member.findById(id).select('gymId')
    if (!member) return
    await Notification.create({
      gymId: member.gymId, memberId: id,
      title: String(payload.title || '').slice(0, 120), body: String(payload.body || '').slice(0, 600),
      url: payload.url || '/', tag: payload.tag, type: payload.type || 'general',
    })
  } catch (err) {
    console.error('[inbox] failed to record notification:', err.message)
  }
}

/**
 * Notify a member: always saved to their in-app inbox, and pushed to their
 * devices if push is set up. (Use pushToDevices alone when the inbox rows are
 * created separately, e.g. announcements.)
 */
export async function sendPushToMember(memberId, payload) {
  await recordInbox(memberId, payload)
  return pushToDevices(memberId, payload)
}

/** Push only — no inbox row. */
export async function pushToDevices(memberId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    // Push isn't configured — silently no-op rather than spamming logs on
    // every single triggering action in an environment that hasn't set it up.
    return
  }

  const subscriptions = await PushSubscription.find({ memberId: memberId?._id || memberId })
  await deliver(subscriptions, payload)
}

/** Push to every device a staff user has subscribed on (admin dashboard PWA). */
export async function sendPushToUsers(userIds, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return
  const ids = [...new Set((userIds || []).map((u) => String(u?._id || u)))]
  if (!ids.length) return
  const subscriptions = await PushSubscription.find({ userId: { $in: ids } })
  await deliver(subscriptions, payload)
}

async function deliver(subscriptions, payload) {
  if (subscriptions.length === 0) return

  const body = JSON.stringify({
    title: payload.title,
    body:  payload.body,
    url:   payload.url || '/',
    tag:   payload.tag || 'fitos-general',
  })

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
          body
        )
      } catch (err) {
        // 404/410 = the subscription is dead (browser data cleared, uninstalled,
        // permission revoked) — clean it up so we stop wasting sends on it.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: sub._id }).catch(() => {})
        } else {
          console.error('[push] Failed to send to subscription:', err.message)
        }
      }
    })
  )
}

/**
 * Same as sendPushToMember but for a list of member ids — used when an
 * update affects several members at once (e.g. a workout plan template
 * assigned to a whole group).
 */
export async function sendPushToMembers(memberIds, payload) {
  await Promise.all(memberIds.map((id) => sendPushToMember(id, payload)))
}
