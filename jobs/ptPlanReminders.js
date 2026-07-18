import cron from 'node-cron'
import MemberPTPlan from '../models/MemberPTPlan.js'
import Gym from '../models/Gym.js'
import { sendPushToMember } from '../services/pushNotification.service.js'

export function startPTPlanReminderJob() {
  // 9 AM IST = 3:30 AM UTC — same slot as the membership renewal reminders
  cron.schedule('30 3 * * *', async () => {
    console.log('[cron] Running PT plan reminders...')
    const now = new Date()

    const active = await MemberPTPlan.find({ status: 'active' })

    for (const plan of active) {
      const gym = await Gym.findById(plan.gymId)
      if (!gym || !['active', 'trialing'].includes(gym.planStatus)) continue

      const classesFinished = plan.classesUsed >= plan.classesTotal
      const daysToExpiry = Math.ceil((plan.expiryDate - now) / 86400000)
      const isExpiryDayOrPast = daysToExpiry <= 0
      const isThreeDaysOut = daysToExpiry === 3

      // Only ONE of these fires per run — whichever condition is met first,
      // in priority order: classes finished > expiry day > 3-days-before.
      if (classesFinished && !plan.reminders.classesFinished) {
        sendPushToMember(plan.memberId, {
          title: 'PT plan classes completed 🎉',
          body: `You've used all ${plan.classesTotal} classes in "${plan.name}". Ask your trainer about renewing.`,
          url: '/workouts',
          tag: 'pt-plan-classes-finished',
        }).catch((e) => console.error('[cron:pt-plan] Push error:', e.message))
        plan.reminders.classesFinished = true
        plan.status = 'completed'

      } else if (isExpiryDayOrPast && !plan.reminders.onExpiry) {
        const remaining = plan.classesTotal - plan.classesUsed
        sendPushToMember(plan.memberId, {
          title: 'PT plan expires today',
          body: `"${plan.name}" expires today${remaining > 0 ? ` — ${remaining} class${remaining === 1 ? '' : 'es'} left, use them before they lapse` : ''}.`,
          url: '/workouts',
          tag: 'pt-plan-expiry',
        }).catch((e) => console.error('[cron:pt-plan] Push error:', e.message))
        plan.reminders.onExpiry = true
        plan.status = 'expired'

      } else if (isThreeDaysOut && !plan.reminders.threeDaysBefore) {
        const remaining = plan.classesTotal - plan.classesUsed
        sendPushToMember(plan.memberId, {
          title: 'PT plan expiring in 3 days',
          body: `"${plan.name}" expires on ${plan.expiryDate.toLocaleDateString('en-IN')}. ${remaining} class${remaining === 1 ? '' : 'es'} left.`,
          url: '/workouts',
          tag: 'pt-plan-expiry-3day',
        }).catch((e) => console.error('[cron:pt-plan] Push error:', e.message))
        plan.reminders.threeDaysBefore = true
      }

      // Safety net — if the server was down on the exact expiry day, this
      // still catches it and closes the plan out on the next run.
      if (plan.expiryDate < now && plan.status === 'active') {
        plan.status = 'expired'
      }

      if (plan.isModified()) await plan.save()
    }
  })

  console.log('✅ PT plan reminder cron job scheduled')
}
