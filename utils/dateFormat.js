// Display formatting for server-generated text (emails, push bodies, PDFs, exports): dd/mm/yyyy in IST.
const IST = 'Asia/Kolkata'
const parts = new Intl.DateTimeFormat('en-GB', { timeZone: IST, day: '2-digit', month: '2-digit', year: 'numeric', weekday: 'short' })

/** dd/mm/yyyy. `{ weekday: true }` prefixes "Sat, ". Accepts a Date / ISO string / timestamp. */
export function fmtDate(d, opts = {}) {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  const o = {}
  for (const { type, value } of parts.formatToParts(dt)) o[type] = value
  const out = `${o.day}/${o.month}/${o.year}`
  return opts.weekday ? `${o.weekday}, ${out}` : out
}

/** "3:45 pm" */
export function fmtTime(d) {
  if (!d) return ''
  return new Date(d).toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit' })
}

/** dd/mm/yyyy, 3:45 pm */
export function fmtDateTime(d) {
  if (!d) return '—'
  return `${fmtDate(d)}, ${fmtTime(d)}`
}
