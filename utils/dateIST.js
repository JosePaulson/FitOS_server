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

/** "Now", as an IST calendar-day key — the IST equivalent of `new Date().toISOString().split('T')[0]`. */
export function todayISTKey() {
  return istDateKey(new Date())
}
