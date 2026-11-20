/**
 * Minimal, safe CSV writer (opens cleanly in Excel / Google Sheets).
 *
 *  - UTF-8 BOM so Excel reads ₹, names in Hindi/Tamil etc. correctly.
 *  - Quotes/commas/newlines escaped per RFC 4180.
 *  - Formula-injection guard: a text cell starting with = + - @ (or a tab/CR)
 *    would be executed as a formula when the file is opened in a spreadsheet,
 *    and member-supplied fields (names, notes) end up in these exports — so
 *    such cells are prefixed with an apostrophe. Real numbers are untouched.
 */
export function csvCell(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString()
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

/** columns: [{ label, get: (row) => value }] */
export function toCsv(columns, rows) {
  const lines = [columns.map((c) => csvCell(c.label)).join(',')]
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.get(row))).join(','))
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
