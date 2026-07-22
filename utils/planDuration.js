/**
 * Given a start date and a MembershipPlan (or any object with
 * `durationUnit` + `durationValue`), returns the resulting expiry date.
 *
 * - unit === 'months': uses calendar-month arithmetic (Date#setMonth),
 *   which correctly rolls over varying month lengths — e.g. 31 Jan + 1
 *   month lands on 2/3 Mar (not a flat "+30 days"), 31 Jan + 1 month in a
 *   non-leap Feb lands on 3 Mar, etc. This is what "automatically
 *   calculate days of upcoming months" means in practice.
 * - unit === 'days' (default / legacy plans): flat day addition.
 *
 * `startDate` can be any date — past or future — the caller decides.
 */
export function addPlanDuration(startDate, plan) {
  const date = new Date(startDate)
  const unit = plan?.durationUnit || 'days'
  const value = Number(plan?.durationValue ?? plan?.durationDays ?? 0)

  if (unit === 'months') {
    date.setMonth(date.getMonth() + value)
  } else {
    date.setDate(date.getDate() + value)
  }
  return date
}

/**
 * Approximate day-count for a plan's duration — used only for display/sort
 * fields (e.g. legacy `durationDays`), never for actual expiry math.
 */
export function approxDurationDays(durationUnit, durationValue) {
  const value = Number(durationValue) || 0
  return durationUnit === 'months' ? Math.round(value * 30.4375) : value
}
