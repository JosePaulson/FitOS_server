import MemberPTPlan from '../models/MemberPTPlan.js'
import PTSession from '../models/PTSession.js'
import { istStartOfDay, istEndOfDay, istStartOfWeek, istStartOfMonth } from '../utils/dateIST.js'

/**
 * Trainer commission is 50% of a PT plan's fee, spread evenly across the
 * plan's classes. There's no direct link from a PTSession to the specific
 * MemberPTPlan it was delivered under (a member usually has one active
 * plan at a time) — so, exactly like ptPlanSync.service.js already does
 * for classesUsed, a session counts toward a plan if it's COMPLETED and
 * its date falls inside that plan's [startDate, expiryDate] window.
 * Earnings-by-period reuses that same idea, just intersected with the
 * requested period too.
 */

const PERIODS = ['total', 'monthly', 'weekly', 'daily']

/** [start, end] Date instants for a named period, or [null, null] for 'total' (unbounded). */
export function periodBounds(period, from = new Date()) {
  switch (period) {
    case 'daily':   return [istStartOfDay(from), istEndOfDay(from)]
    case 'weekly': {
      const start = istStartOfWeek(from)
      return [start, new Date(start.getTime() + 7 * 86400000 - 1)]
    }
    case 'monthly': {
      const start = istStartOfMonth(from)
      const nextMonth = new Date(start)
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
      return [start, new Date(nextMonth.getTime() - 1)]
    }
    case 'total':
    default:
      return [null, null]
  }
}

function overlap(aStart, aEnd, bStart, bEnd) {
  const start = bStart ? new Date(Math.max(aStart.getTime(), bStart.getTime())) : aStart
  const end = bEnd ? new Date(Math.min(aEnd.getTime(), bEnd.getTime())) : aEnd
  if (start > end) return null
  return [start, end]
}

/**
 * Earnings for one trainer within a period. Walks every plan ever assigned
 * to this trainer (any status — classes already delivered are still owed,
 * even if the plan was later cancelled) and counts completed sessions that
 * fall inside both the plan's own window and the requested period.
 */
export async function computeTrainerEarnings(gymId, trainerId, period = 'total') {
  const [periodStart, periodEnd] = periodBounds(period)
  const plans = await MemberPTPlan.find({ gymId, trainerId }).populate('memberId', 'name')

  let periodEarning = 0
  let classesInPeriod = 0
  const byMember = new Map()

  for (const plan of plans) {
    if (!plan.memberId) continue // member record was deleted — nothing sensible to attribute this to
    const perClass = plan.classesTotal > 0 ? (plan.fee / 2) / plan.classesTotal : 0
    const window = overlap(plan.startDate, plan.expiryDate, periodStart, periodEnd)
    let count = 0
    if (window) {
      count = await PTSession.countDocuments({
        gymId,
        memberId: plan.memberId._id || plan.memberId,
        trainerId,
        status: 'completed',
        date: { $gte: window[0], $lte: window[1] },
      })
    }
    const earning = count * perClass
    periodEarning += earning
    classesInPeriod += count

    const memberId = String(plan.memberId._id || plan.memberId)
    const prev = byMember.get(memberId) || { memberId, memberName: plan.memberId.name, earning: 0, classes: 0 }
    prev.earning += earning
    prev.classes += count
    byMember.set(memberId, prev)
  }

  return { period, periodEarning, classesInPeriod, byMember: [...byMember.values()] }
}

/**
 * Plans belonging to this trainer that are fully used up (classesUsed >=
 * classesTotal) but haven't been paid out yet — the "amount pending" set
 * both a trainer and owner/manager see as a reminder.
 */
export async function getPendingPayouts(gymId, trainerId) {
  const plans = await MemberPTPlan.find({
    gymId,
    trainerId,
    status: 'completed',
    'trainerPayout.paid': false,
  }).populate('memberId', 'name')

  const items = plans
    .filter((p) => p.memberId)
    .map((p) => ({
    planId: p._id,
    memberId: p.memberId._id,
    memberName: p.memberId.name,
    planName: p.name,
    amount: p.trainerEarning,
  }))
  const total = items.reduce((sum, i) => sum + i.amount, 0)
  return { items, total }
}

/**
 * Full history of this trainer's no-longer-active plans (completed,
 * expired, or cancelled) — the "Previous earnings" ledger, with whatever
 * the trainer actually earned from each (proportional to classes
 * delivered, not necessarily the full plan fee) and its payment status.
 */
export async function getPreviousPlans(gymId, trainerId) {
  const plans = await MemberPTPlan.find({
    gymId,
    trainerId,
    status: { $in: ['completed', 'expired', 'cancelled'] },
  })
    .populate('memberId', 'name')
    .sort({ startDate: -1 })

  return plans
    .filter((p) => p.memberId)
    .map((p) => ({
      planId: p._id,
      memberId: p.memberId._id,
      memberName: p.memberId.name,
      planName: p.name,
      status: p.status,
      startDate: p.startDate,
      endDate: p.expiryDate,
      classesUsed: p.classesUsed,
      classesTotal: p.classesTotal,
      amount: p.trainerEarnedSoFar,
      paid: !!p.trainerPayout?.paid,
    }))
}

/**
 * Per-member breakdown for one trainer — lifetime earned-so-far across
 * every plan that member has ever had with this trainer, plus their
 * single most relevant (latest-started) plan's own class/earning detail.
 */
export async function getMemberBreakdown(gymId, trainerId) {
  const plans = await MemberPTPlan.find({ gymId, trainerId })
    .populate('memberId', 'name phone')
    .sort({ startDate: -1 })

  const byMember = new Map()
  for (const plan of plans) {
    if (!plan.memberId) continue // member record was deleted
    const memberId = String(plan.memberId._id)
    let entry = byMember.get(memberId)
    if (!entry) {
      entry = {
        memberId,
        memberName: plan.memberId.name,
        memberPhone: plan.memberId.phone,
        totalEarnedTillNow: 0,
        currentPlan: null, // first plan seen = latest, since sorted desc
      }
      byMember.set(memberId, entry)
    }
    entry.totalEarnedTillNow += plan.trainerEarnedSoFar
    if (!entry.currentPlan) {
      entry.currentPlan = {
        planId: plan._id,
        name: plan.name,
        status: plan.status,
        classesUsed: plan.classesUsed,
        classesTotal: plan.classesTotal,
        classesRemaining: plan.classesRemaining,
        totalPotentialEarning: plan.trainerEarning,
        perClassEarning: plan.perClassEarning,
        earnedSoFar: plan.trainerEarnedSoFar,
        pendingPayout: plan.status === 'completed' && !plan.trainerPayout?.paid,
      }
    }
  }

  return [...byMember.values()]
}

export { PERIODS }
