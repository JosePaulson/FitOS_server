import AuditLog from '../models/AuditLog.js'
import Member from '../models/Member.js'
import MembershipPlan from '../models/MembershipPlan.js'
import PTPlan from '../models/PTPlan.js'
import Coupon from '../models/Coupon.js'
import User from '../models/User.js'
import Challenge from '../models/Challenge.js'

/**
 * Audit trail for sensitive staff actions.
 *
 * ONE table-driven middleware mounted at /api, rather than a call in every
 * route handler: it matches the request against RULES, and once the response
 * has finished with a 2xx/3xx it records who did it (req.user is set by
 * `protect` during the request) and — for edits — which fields changed from
 * what to what, using a snapshot of the record taken just before the handler
 * ran. Failed requests (4xx/5xx) are never logged: nothing happened.
 *
 * Anything a person may type that could be secret (PINs, passwords, tokens,
 * signature images) is dropped before it can reach the log.
 */

const ID = '([a-f0-9]{24})'
const SENSITIVE = /pin|pass|token|secret|signature|hash|photo|image/i
const loadFrom = (Model, select = '') => (id) => Model.findById(id).select(select).lean()

const ucfirst = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const names = (b, key) => b?.[key]?.name || b?.name

const RULES = [
  // Members
  { m: 'POST',   re: new RegExp('^/api/members$'),                 action: 'member.create',   entity: 'member', entityId: (b) => b?.member?._id, summary: (c) => `Enrolled ${c.body?.member?.name || c.req.body?.name || 'a member'}` },
  { m: 'PATCH',  re: new RegExp(`^/api/members/${ID}$`),           action: 'member.update',   entity: 'member', load: loadFrom(Member), summary: (c) => `Edited member ${c.before?.name || ''}`, changes: true },
  { m: 'DELETE', re: new RegExp(`^/api/members/${ID}$`),           action: 'member.archive',  entity: 'member', load: loadFrom(Member, 'name'), summary: (c) => `Archived member ${c.before?.name || ''}` },
  { m: 'POST',   re: new RegExp(`^/api/members/${ID}/renew$`),     action: 'member.renew',    entity: 'member', load: loadFrom(Member, 'name membershipExpiryDate'), summary: (c) => `Renewed ${c.before?.name || 'member'}${c.req.body?.couponCode ? ` (coupon ${c.req.body.couponCode})` : ''}` },
  { m: 'POST',   re: new RegExp(`^/api/members/${ID}/freeze$`),    action: 'member.freeze',   entity: 'member', load: loadFrom(Member, 'name'), summary: (c) => `Put ${c.before?.name || 'member'} on hold${c.req.body?.reason ? ` — ${c.req.body.reason}` : ''}${c.req.body?.fee ? ` (fee ₹${c.req.body.fee})` : ''}` },
  { m: 'POST',   re: new RegExp(`^/api/members/${ID}/unfreeze$`),  action: 'member.unfreeze', entity: 'member', load: loadFrom(Member, 'name'), summary: (c) => `Resumed ${c.before?.name || 'member'} (+${c.body?.daysAdded ?? '?'} days)` },
  { m: 'POST',   re: /^\/api\/member-portal\/auth\/set-pin$/,      action: 'member.set_pin',  entity: 'member', entityId: (b, req) => req.body?.memberId, summary: () => 'Set a member\u2019s app PIN' },

  // Money
  { m: 'PATCH',  re: new RegExp(`^/api/invoices/${ID}/mark-paid$`),      action: 'invoice.mark_paid',    entity: 'invoice', summary: (c) => `Marked invoice paid${c.req.body?.method ? ` (${c.req.body.method})` : ''}` },
  { m: 'POST',   re: new RegExp(`^/api/invoices/${ID}/payments$`),       action: 'invoice.part_payment', entity: 'invoice', summary: (c) => `Recorded ₹${c.req.body?.amount} ${c.req.body?.method || 'cash'} payment` },
  { m: 'POST',   re: new RegExp(`^/api/invoices/${ID}/payment-link$`),   action: 'invoice.payment_link', entity: 'invoice', summary: () => 'Created a payment link' },

  // Pricing & catalogue
  { m: 'POST',   re: /^\/api\/plans$/,                       action: 'plan.create', entity: 'plan', entityId: (b) => b?._id, summary: (c) => `Created membership plan ${c.req.body?.name || ''}` },
  { m: 'PATCH',  re: new RegExp(`^/api/plans/${ID}$`),       action: 'plan.update', entity: 'plan', load: loadFrom(MembershipPlan), summary: (c) => `Edited membership plan ${c.before?.name || ''}`, changes: true },
  { m: 'DELETE', re: new RegExp(`^/api/plans/${ID}$`),       action: 'plan.delete', entity: 'plan', load: loadFrom(MembershipPlan, 'name'), summary: (c) => `Deleted membership plan ${c.before?.name || ''}` },
  { m: 'POST',   re: /^\/api\/pt-plans$/,                    action: 'ptplan.create', entity: 'ptplan', entityId: (b) => b?._id, summary: (c) => `Created PT plan ${c.req.body?.name || ''}` },
  { m: 'PATCH',  re: new RegExp(`^/api/pt-plans/${ID}$`),    action: 'ptplan.update', entity: 'ptplan', load: loadFrom(PTPlan), summary: (c) => `Edited PT plan ${c.before?.name || ''}`, changes: true },
  { m: 'DELETE', re: new RegExp(`^/api/pt-plans/${ID}$`),    action: 'ptplan.delete', entity: 'ptplan', load: loadFrom(PTPlan, 'name'), summary: (c) => `Deleted PT plan ${c.before?.name || ''}` },
  { m: 'POST',   re: /^\/api\/coupons$/,                     action: 'coupon.create', entity: 'coupon', entityId: (b) => b?._id, summary: (c) => `Created coupon ${c.req.body?.code || ''}` },
  { m: 'PATCH',  re: new RegExp(`^/api/coupons/${ID}$`),     action: 'coupon.update', entity: 'coupon', load: loadFrom(Coupon), summary: (c) => `Edited coupon ${c.before?.code || ''}`, changes: true },
  { m: 'DELETE', re: new RegExp(`^/api/coupons/${ID}$`),     action: 'coupon.delete', entity: 'coupon', load: loadFrom(Coupon, 'code'), summary: (c) => `Deleted/deactivated coupon ${c.before?.code || ''}` },

  // Staff, settings & access
  { m: 'POST',   re: /^\/api\/staff$/,                       action: 'staff.create', entity: 'staff', entityId: (b) => b?._id || b?.user?._id, summary: (c) => `Added staff ${c.req.body?.name || ''} as ${c.req.body?.role || 'staff'}` },
  { m: 'PATCH',  re: new RegExp(`^/api/staff/${ID}$`),       action: 'staff.update', entity: 'staff', load: loadFrom(User, 'name email phone role isActive'), summary: (c) => `Edited staff ${c.before?.name || ''}`, changes: true },
  { m: 'DELETE', re: new RegExp(`^/api/staff/${ID}$`),       action: 'staff.delete', entity: 'staff', load: loadFrom(User, 'name'), summary: (c) => `Removed staff ${c.before?.name || ''}` },
  { m: 'PUT',    re: new RegExp(`^/api/staff-payroll/permissions/${ID}$`), action: 'payroll.permissions', entity: 'staff', summary: () => 'Changed a manager\u2019s payroll permissions' },
  { m: 'PUT',    re: new RegExp(`^/api/staff-payroll/staff/${ID}/salary$`), action: 'staff.salary', entity: 'staff', entityId: (b, req) => req.params?.staffId, summary: () => 'Changed a staff member\u2019s salary' },
  { m: 'POST',   re: /^\/api\/permissions\/reset$/,         action: 'permissions.reset', entity: 'gym', summary: () => 'Reset role permissions to defaults' },
  { m: 'PATCH',  re: /^\/api\/gym\/settings$/,               action: 'settings.update', entity: 'gym', summary: (c) => `Changed gym settings (${Object.keys(c.req.body || {}).filter((k) => !SENSITIVE.test(k)).join(', ')})` },
  { m: 'PUT',    re: /^\/api\/permissions$/,                 action: 'permissions.update', entity: 'gym', summary: () => 'Changed role permissions' },

  // Member engagement
  { m: 'POST',   re: /^\/api\/announcements$/,                  action: 'announcement.create', entity: 'announcement', entityId: (b) => b?._id, summary: (c) => `Sent announcement “${c.req.body?.title || ''}” to ${c.body?.sentTo ?? '?'} members` },
  { m: 'DELETE', re: new RegExp(`^/api/announcements/${ID}$`),    action: 'announcement.delete', entity: 'announcement', summary: () => 'Deleted an announcement' },
  { m: 'POST',   re: /^\/api\/challenges$/,                     action: 'challenge.create', entity: 'challenge', entityId: (b) => b?._id, summary: (c) => `Created challenge ${c.req.body?.title || ''}` },
  { m: 'PATCH',  re: new RegExp(`^/api/challenges/${ID}$`),      action: 'challenge.update', entity: 'challenge', load: loadFrom(Challenge), summary: (c) => `Edited challenge ${c.before?.title || ''}`, changes: true },
  { m: 'DELETE', re: new RegExp(`^/api/challenges/${ID}$`),      action: 'challenge.delete', entity: 'challenge', load: loadFrom(Challenge, 'title'), summary: (c) => `Deleted challenge ${c.before?.title || ''}` },

  // Records & data
  { m: 'POST',   re: new RegExp(`^/api/waivers/member/${ID}/sign$`), action: 'waiver.sign', entity: 'member', load: loadFrom(Member, 'name'), summary: (c) => `Collected signed waiver from ${c.before?.name || 'member'} at the front desk` },
  { m: 'DELETE', re: new RegExp(`^/api/leads/${ID}$`),       action: 'lead.delete', entity: 'lead', summary: () => 'Deleted a lead' },
  { m: 'GET',    re: /^\/api\/export\/([a-z]+)$/,            action: 'data.export', entity: 'export', summary: (c) => (c.id === 'backup' ? 'Downloaded a full data backup' : `Exported ${c.id} data as CSV`) },
]

/* ── helpers ──────────────────────────────────────────────────────────────── */

function clip(v) {
  if (v && typeof v === 'object') { try { v = JSON.stringify(v) } catch { return '[object]' } }
  const s = String(v)
  return s.length > 200 ? `${s.slice(0, 200)}…` : s
}

// Make a stored value and a submitted value comparable (dates arrive as
// "2026-12-01" but are stored as full timestamps; numbers arrive as strings).
function norm(v) {
  if (v === undefined || v === null || v === '') return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10)
  if (typeof v === 'object') { try { return typeof v.toHexString === 'function' ? String(v) : JSON.stringify(v) } catch { return null } }
  return String(v)
}

function safeBody(body) {
  const out = {}
  for (const [k, v] of Object.entries(body || {})) if (!SENSITIVE.test(k)) out[k] = clip(v)
  return out
}

function diff(before, body) {
  const changes = {}
  if (!before) return changes
  for (const [k, v] of Object.entries(body || {})) {
    if (SENSITIVE.test(k)) continue
    const a = norm(before[k]); const b = norm(v)
    if (a !== b) changes[k] = { from: a === null ? null : clip(a), to: b === null ? null : clip(b) }
  }
  return changes
}

const describe = (changes) => Object.entries(changes).slice(0, 6)
  .map(([k, { from, to }]) => `${k}: ${from ?? '—'} → ${to ?? '—'}`).join('; ')

/* ── middleware ───────────────────────────────────────────────────────────── */

export async function auditTrail(req, res, next) {
  const path = req.originalUrl.split('?')[0].replace(/\/+$/, '')
  const rule = RULES.find((r) => r.m === req.method && r.re.test(path))
  if (!rule) return next()

  const id = path.match(rule.re)?.[1]

  // Capture the JSON the handler responds with (new ids, resulting names…).
  let responseBody
  const json = res.json.bind(res)
  res.json = (b) => { responseBody = b; return json(b) }

  // Snapshot of the record before the handler changes it (for before→after).
  let before = null
  if (rule.load && id) {
    try { before = await rule.load(id) } catch { before = null }
  }

  res.on('finish', async () => {
    try {
      if (res.statusCode >= 400 || !req.user || !req.gymId) return
      // A record from another gym must never leak into this gym's log.
      if (before?.gymId && String(before.gymId) !== String(req.gymId)) before = null

      const changes = rule.changes ? diff(before, req.body) : undefined
      const ctx = { req, body: responseBody, before, id }
      let summary = rule.summary(ctx)
      if (changes && Object.keys(changes).length) summary += ` — ${describe(changes)}`
      else if (rule.changes) summary += ' — no field values changed'

      await AuditLog.create({
        gymId: req.gymId,
        actorId: req.user._id, actorName: req.user.name, actorRole: req.user.role,
        action: rule.action, entityType: rule.entity,
        entityId: id || rule.entityId?.(responseBody, req) || undefined,
        summary: summary.slice(0, 500),
        details: {
          ...(changes && Object.keys(changes).length ? { changes } : {}),
          ...(['POST', 'PATCH', 'PUT'].includes(req.method) ? { request: safeBody(req.body) } : {}),
        },
        ip: req.ip,
      })
    } catch (err) {
      // Auditing must never break (or even slow) the action it describes.
      console.error('[audit] failed to record', rule.action, err.message)
    }
  })

  next()
}
