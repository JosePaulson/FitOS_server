import PTSession from '../models/PTSession.js'
import MemberPTPlan from '../models/MemberPTPlan.js'
import { sendPushToMember } from './pushNotification.service.js'

/**
 * Recomputes classesUsed for a member's PT plan assignments from actual
 * confirmed (status: 'completed') PT sessions whose date falls within the
 * plan's [startDate, expiryDate] window — instead of relying on manual
 * "+1 class" logging. Call this any time a session's status or date
 * changes, or a session is created/deleted, for a given member.
 *
 * Scoped to 'active' and 'completed' plans (not 'cancelled' — those are
 * done for good; not 'expired' — those are locked by date, not usage).
 */
export async function syncMemberPTPlans(gymId, memberId) {
  const plans = await MemberPTPlan.find({
    gymId, memberId, status: { $in: ['active', 'completed'] },
  })
  if (plans.length === 0) return

  for (const plan of plans) {
    const count = await PTSession.countDocuments({
      gymId,
      memberId,
      status: 'completed',
      date: { $gte: plan.startDate, $lte: plan.expiryDate },
    })
    const nextUsed = Math.min(count, plan.classesTotal)
    const wasFinished = plan.status === 'completed'
    const isFinished = nextUsed >= plan.classesTotal

    if (plan.classesUsed !== nextUsed) plan.classesUsed = nextUsed

    if (isFinished && !wasFinished) {
      plan.status = 'completed'
      if (!plan.reminders.classesFinished) {
        plan.reminders.classesFinished = true
        sendPushToMember(plan.memberId, {
          title: 'PT plan classes completed 🎉',
          body: `You've used all ${plan.classesTotal} classes in "${plan.name}". Ask your trainer about renewing.`,
          url: '/workouts',
          tag: 'pt-plan-classes-finished',
        }).catch((e) => console.error('[pt-plan-sync] Push error:', e.message))
      }
    } else if (!isFinished && wasFinished) {
      // A completed session was edited/deleted and this plan is no longer
      // fully used up — reopen it (unless it's already past its expiry).
      plan.status = plan.expiryDate < new Date() ? 'expired' : 'active'
      plan.reminders.classesFinished = false
    }

    if (plan.isModified()) await plan.save()
  }
}
