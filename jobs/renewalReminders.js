import cron   from 'node-cron'
import Member from '../models/Member.js'
import Gym    from '../models/Gym.js'
import { sendRenewalReminder }   from '../services/email.service.js'
import { resolveGymSender }       from '../utils/gymEmailSender.js'
import { sendRenewalReminderWA } from '../services/whatsapp.service.js'
import { sendPushToMember }      from '../services/pushNotification.service.js'

export function startRenewalReminderJob() {
  // 9 AM IST = 3:30 AM UTC
  cron.schedule('30 3 * * *', async () => {
    console.log('[cron] Running renewal reminders...')
    const now        = new Date()
    const CHECK_DAYS = [7, 3, 1]

    for (const days of CHECK_DAYS) {
      const target   = new Date(now)
      target.setDate(target.getDate() + days)
      const dayStart = new Date(target); dayStart.setHours(0, 0, 0, 0)
      const dayEnd   = new Date(target); dayEnd.setHours(23, 59, 59, 999)

      const expiring = await Member.find({
        membershipStatus:     'active',
        membershipExpiryDate: { $gte: dayStart, $lte: dayEnd },
      })

      for (const member of expiring) {
        const gym = await Gym.findById(member.gymId)
        if (!gym || !['active', 'trialing'].includes(gym.planStatus)) continue

        const expiryDate = member.membershipExpiryDate.toLocaleDateString('en-IN')

        // Resolve gym's own sender address for the reminder email
        const { from, replyTo, gymName } = await resolveGymSender(member.gymId)

        if (member.email) {
          sendRenewalReminder({ to: member.email, from, replyTo, memberName: member.name, gymName, expiryDate, daysLeft: days })
            .catch((e) => console.error('[cron:renewal] Email error:', e.message))
        }
        if (member.phone) {
          sendRenewalReminderWA({ phone: member.phone, memberName: member.name, gymName, expiryDate, daysLeft: days })
            .catch((e) => console.error('[cron:renewal] WA error:', e.message))
        }
        sendPushToMember(member._id, {
          title: `Membership expires in ${days} day${days === 1 ? '' : 's'}`,
          body:  `Your membership expires on ${expiryDate}. Renew soon to keep your access.`,
          url:   '/plans',
          tag:   'renewal-reminder',
        }).catch((e) => console.error('[cron:renewal] Push error:', e.message))
      }
    }

    const { modifiedCount } = await Member.updateMany(
      { membershipStatus: 'active', membershipExpiryDate: { $lt: now } },
      { $set: { membershipStatus: 'expired' } }
    )
    if (modifiedCount > 0) console.log(`[cron] Marked ${modifiedCount} memberships as expired`)
  })

  console.log('✅ Renewal reminder cron job scheduled')
}
