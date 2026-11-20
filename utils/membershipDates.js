/**
 * Dates for a renewal / first payment.
 *
 *  - Extending a membership that is still running: the new period begins when the
 *    old one ends, and the membership keeps its ORIGINAL start (it's one continuous membership).
 *  - Renewing after it lapsed (or choosing an explicit start date): a fresh period begins
 *    at that date, so the start date must move with it. Leaving the old start in place
 *    made the member app's progress bar wrong after every late renewal.
 */
export function renewalPeriod({ explicitStart, status, expiry, existingStart, now = new Date() }) {
  const extending = !explicitStart && status === 'active' && !!expiry && new Date(expiry) > now
  const base = explicitStart ? new Date(explicitStart) : extending ? new Date(expiry) : new Date(now)
  const start = explicitStart ? new Date(explicitStart) : extending ? new Date(existingStart || base) : base
  return { base, start, extending }
}

/** A membership whose period has already ended must not be stored as active (e.g. a back-dated enrolment). */
export const statusForExpiry = (expiry, now = new Date()) => (new Date(expiry) > now ? 'active' : 'expired')
