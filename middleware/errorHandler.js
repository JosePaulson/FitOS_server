import crypto from 'node:crypto'
import { isDev, GENERIC_MESSAGE, UNAVAILABLE_MESSAGE } from '../utils/errors.js'

/**
 * The one place every error response is built.
 *
 * Production never shows technical text (database errors, stack traces,
 * library messages, env-var names, "Cannot read properties of undefined"…).
 * Errors our own code raises *for the user* (validation, "invoice already
 * paid", …) are plain-language already and pass through; everything else is
 * replaced by a friendly message plus a short reference id — the full error is
 * logged with the same id so support can find it.
 *
 * Development returns the real message, error name/code and stack so
 * problems are obvious while building.
 */

const FIELD_LABELS = {
  phone: 'phone number', phoneKey: 'phone number', email: 'email address', emailKey: 'email address', referralCode: 'referral code',
  invoiceNumber: 'invoice number', subdomain: 'web address', memberId: 'member', pin: 'PIN',
}
const humanize = (path) => {
  const last = String(path || '').split('.').pop()
  return FIELD_LABELS[last] || last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase() || 'value'
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
// Mongoose's built-in wording — technical; anything else came from a schema author writing a message for people.
const isDefaultMongooseText = (m) => /^Path `|^Cast to |Validator failed|^Error, expected/.test(String(m || ''))

function validationMessages(err) {
  return Object.values(err.errors || {}).map((e) => {
    if (e.message && !isDefaultMongooseText(e.message)) return e.message
    const label = cap(humanize(e.path))
    const p = e.properties || {}
    switch (e.kind) {
      case 'required':  return `${label} is required`
      case 'min':       return `${label} must be at least ${p.min}`
      case 'max':       return `${label} must be at most ${p.max}`
      case 'minlength': return `${label} is too short (at least ${p.minlength} characters)`
      case 'maxlength': return `${label} is too long (at most ${p.maxlength} characters)`
      default:          return `${label} isn\u2019t valid`
    }
  })
}

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'])
const MULTER = {
  LIMIT_FILE_SIZE: 'That file is too large.',
  LIMIT_UNEXPECTED_FILE: 'That file wasn\u2019t expected. Please choose a single image.',
  LIMIT_FILE_COUNT: 'Too many files were selected.',
}

/** Work out { status, user, technical } for any thrown value. Pure — exported for tests. */
export function describeError(err) {
  // Anything thrown that isn't an object (a string, null, undefined…) — never let the handler itself crash on it.
  if (!err || typeof err !== 'object') {
    return { status: 500, technical: String(err ?? 'Unknown error'), user: GENERIC_MESSAGE }
  }
  const technical = String(err?.message || err?.error?.description || (typeof err === 'string' ? err : '') || 'Unknown error')
  const rawStatus = err?.status ?? err?.statusCode
  const status = (n) => (Number.isInteger(n) && n >= 400 && n <= 599 ? n : 500)
  const name = err?.name || ''

  // MongoDB duplicate key
  if (err?.code === 11000) {
    const keys = Object.keys(err.keyValue || {}).filter((k) => k !== 'gymId')
    return { status: 409, technical, user: keys.length ? `A record with this ${humanize(keys[0])} already exists.` : 'That already exists.' }
  }
  // Mongoose validation
  if (name === 'ValidationError' && err.errors) {
    return { status: 400, technical, user: validationMessages(err).join('. ') || 'Some of the details aren\u2019t valid.' }
  }
  // Mongoose cast (e.g. a malformed id in the URL)
  if (name === 'CastError') {
    return err.path === '_id' || err.kind === 'ObjectId'
      ? { status: 404, technical, user: 'We couldn\u2019t find what you were looking for.' }
      : { status: 400, technical, user: 'One of the values you sent isn\u2019t valid.' }
  }
  // Auth tokens
  if (name === 'JsonWebTokenError' || name === 'TokenExpiredError' || name === 'NotBeforeError') {
    return { status: 401, technical, user: 'Your session has expired. Please sign in again.' }
  }
  // Request body problems (body-parser / http-errors)
  if (err?.type === 'entity.too.large') return { status: 413, technical, user: 'That is too large to upload.' }
  if (typeof err?.type === 'string' && /^(entity|encoding|charset|request)\./.test(err.type)) {
    return { status: 400, technical, user: 'We couldn\u2019t read that request. Please refresh the page and try again.' }
  }
  // File uploads
  if (name === 'MulterError') return { status: 400, technical, user: MULTER[err.code] || 'The upload didn\u2019t work. Please try again.' }

  // Databases, other services and network failures: never show their wording.
  const thirdParty =
    !(err instanceof Error) ||                          // e.g. Razorpay rejects with a plain object
    err.isAxiosError || err.error?.description ||       // Razorpay / axios shapes
    /^Mongo|^Mongoose/.test(name) ||
    typeof err.code === 'string'                        // ECONNREFUSED, ETIMEDOUT, ERR_* …
  if (thirdParty && !err.userMessage) {
    const unreachable = NETWORK_CODES.has(err?.code) || /ServerSelection|Network/.test(name)
    return { status: unreachable ? 503 : status(rawStatus) >= 500 ? status(rawStatus) : 502, technical, user: unreachable ? UNAVAILABLE_MESSAGE : GENERIC_MESSAGE }
  }

  const s = status(rawStatus)
  // Our own errors written for people (and any error carrying an explicit userMessage).
  if (err.userMessage) return { status: s, technical, user: err.userMessage }
  if (s < 500 && rawStatus !== undefined) return { status: s, technical, user: technical }
  return { status: s, technical, user: GENERIC_MESSAGE }
}

export default function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err)

  const d = describeError(err)
  const reference = crypto.randomBytes(4).toString('hex').toUpperCase()
  const who = req.user?._id || req.memberId
  const line = `[${new Date().toISOString()}] [${reference}] ${req.method} ${req.originalUrl} -> ${d.status}${who ? ` (user ${who})` : ''}`

  // Full detail always goes to the server log (5xx: with stack). Clients only see what policy allows.
  if (d.status >= 500) console.error(line, err?.stack || err)
  else if (isDev()) console.warn(line, d.technical)

  const body = { message: isDev() ? d.technical : d.user }
  if (d.status >= 500) body.reference = reference          // quote this to support
  if (isDev()) {
    body.friendlyMessage = d.user                            // what members/staff will see in production
    body.name = err?.name
    body.code = err?.code
    body.stack = err?.stack
  }
  res.status(d.status).json(body)
}
