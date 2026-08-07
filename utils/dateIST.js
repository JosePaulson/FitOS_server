// India Standard Time is a fixed UTC+5:30 offset — India does not observe
// daylight saving, so this never needs adjusting. Using this instead of the
// server's local Date methods means these functions give the same answer
// whether the server itself runs in UTC (typical for hosting) or anything
// else, which matters because "today", "which weekday", and "office hours"
// are all inherently IST concepts for this app.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** IST calendar-day key "YYYY-MM-DD" for any Date/date-like input. */
export function istDateKey(d) {
  const ist = new Date(new Date(d).getTime() + IST_OFFSET_MS)
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`
}

/** IST day-of-week name ('monday'..'sunday') for any Date/date-like input. */
export function istDayName(d) {
  const ist = new Date(new Date(d).getTime() + IST_OFFSET_MS)
  return DAY_NAMES[ist.getUTCDay()]
}

/** IST wall-clock "HH:mm" for any Date/date-like input. */
export function istTimeOfDay(d) {
  const ist = new Date(new Date(d).getTime() + IST_OFFSET_MS)
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`
}

/** Builds the true UTC Date instant for an IST calendar date + "HH:mm" wall-clock time. */
export function istDateTime(dateKey, hhmm = '00:00') {
  const [y, m, d] = dateKey.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MS)
}

/** Start of the IST calendar day (00:00 IST) containing `d`, as a UTC Date instant. */
export function istStartOfDay(d) {
  return istDateTime(istDateKey(d), '00:00')
}

/**
 * End of the IST calendar day (23:59:59.999 IST) containing `d`, as a UTC
 * Date instant. Use this (not istStartOfDay of the same date) whenever a
 * date field represents the LAST day something is valid/included — e.g. a
 * PT plan's expiryDate — so anything that happened later that same day
 * still counts as "within range" instead of being cut off at midnight.
 */
export function istEndOfDay(d) {
  return new Date(istStartOfDay(d).getTime() + 24 * 60 * 60 * 1000 - 1)
}

/** IST calendar-date key `days` days after `dateKey` (negative to go back). */
export function istAddDays(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

/** "Now", as an IST calendar-day key — the IST equivalent of `new Date().toISOString().split('T')[0]`. */
export function todayISTKey() {
  return istDateKey(new Date())
}

// Sunday-first, matching istDayName()/DAY_NAMES above — used to walk
// forward from "today" to the next matching weekday below.
const DAY_ORDER = DAY_NAMES

/**
 * The next upcoming instant (as a UTC Date) at which a recurring WEEKLY IST
 * slot — identified by weekday name ('monday'..'sunday') + "HH:mm" wall-clock
 * start time — occurs. Returns today's occurrence if it hasn't started yet,
 * otherwise next week's. Used by the weekly Timetable feature, where a slot
 * isn't a single date but a standing weekly booking, so "2 hours before the
 * slot" has to be resolved against whichever occurrence is coming up next.
 */
export function nextWeekdayOccurrence(weekday, hhmm, from = new Date()) {
  const targetIdx = DAY_ORDER.indexOf(weekday)
  if (targetIdx === -1) throw new Error(`Invalid weekday: ${weekday}`)

  const todayKey = istDateKey(from)
  const todayIdx = DAY_ORDER.indexOf(istDayName(from))
  const daysAhead = (targetIdx - todayIdx + 7) % 7

  let candidate = istDateTime(istAddDays(todayKey, daysAhead), hhmm)
  // Same weekday as today but that time has already passed (or is exactly
  // now) — the next occurrence is a full week out, not "today" again.
  if (candidate.getTime() <= from.getTime()) {
    candidate = istDateTime(istAddDays(todayKey, daysAhead + 7), hhmm)
  }
  return candidate
}

/**
 * True once it's too late to cancel a recurring weekly slot — i.e. the
 * next occurrence of that weekday/time is less than `hoursBefore` hours
 * away. Shared by both the trainer- and member-facing Timetable cancel
 * endpoints so the cutoff behaves identically for everyone.
 */
export function isPastCancellationDeadline(weekday, hhmm, hoursBefore = 2, from = new Date()) {
  const occurrence = nextWeekdayOccurrence(weekday, hhmm, from)
  return occurrence.getTime() - from.getTime() < hoursBefore * 60 * 60 * 1000
}
