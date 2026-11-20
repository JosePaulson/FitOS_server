/**
 * Canonical forms used to decide "is this the same phone / email / web address?".
 * The original text is always kept as typed; these keys exist only for comparison
 * and for the database's unique indexes.
 */

export const digitsOf = (v) => String(v ?? '').replace(/\D/g, '')

/** Phone → last 10 digits, so "+91 98765 43210", "098765-43210" and "9876543210" are one number. */
export function phoneKey(phone) {
  const d = digitsOf(phone)
  return d.length > 10 ? d.slice(-10) : d
}

/** 7–15 digits (E.164 allows up to 15). Rejects "abc", "12", pasted junk. */
export function isValidPhone(phone) {
  const n = digitsOf(phone).length
  return n >= 7 && n <= 15
}

/** Matches stored phone strings in ANY formatting that end with these digits — for older rows that have no phoneKey yet. */
export function phoneRegex(key) {
  return new RegExp(`${String(key).split('').join('\\D*')}\\D*$`)
}

/**
 * Email → comparison key. Lower-case, ignores "+tag" (name+gym@x.com delivers to name@x.com)
 * and, for Gmail, dots in the name and the googlemail.com alias — all of which reach the same inbox.
 */
export function emailKey(email) {
  const e = String(email ?? '').trim().toLowerCase()
  const at = e.lastIndexOf('@')
  if (at < 1) return e
  let local = e.slice(0, at).split('+')[0]
  let domain = e.slice(at + 1)
  if (domain === 'googlemail.com') domain = 'gmail.com'
  if (domain === 'gmail.com') local = local.replace(/\./g, '')
  return local ? `${local}@${domain}` : e
}

export const normalizeSubdomain = (s) => String(s ?? '').trim().toLowerCase()
export const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/ // 3–40 chars, no hyphen at either end
export const RESERVED_SUBDOMAINS = new Set([
  'www', 'api', 'app', 'admin', 'mail', 'email', 'smtp', 'ftp', 'static', 'cdn', 'assets', 'img', 'images', 'support', 'help',
  'billing', 'dashboard', 'login', 'logout', 'register', 'signup', 'signin', 'account', 'accounts', 'status', 'blog', 'docs',
  'demo', 'test', 'staging', 'dev', 'root', 'superadmin', 'saas', 'fitos', 'f8os', 'portal', 'member', 'members', 'web', 'ns1', 'ns2',
])

/** null when fine, otherwise 'format' | 'reserved'. */
export function subdomainProblem(sub) {
  if (!SUBDOMAIN_RE.test(sub)) return 'format'
  if (RESERVED_SUBDOMAINS.has(sub)) return 'reserved'
  return null
}
