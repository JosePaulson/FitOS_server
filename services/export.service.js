import Gym from '../models/Gym.js'
import User from '../models/User.js'
import Member from '../models/Member.js'
import MembershipPlan from '../models/MembershipPlan.js'
import PTPlan from '../models/PTPlan.js'
import MemberPTPlan from '../models/MemberPTPlan.js'
import PTSession from '../models/PTSession.js'
import Invoice from '../models/Invoice.js'
import Attendance from '../models/Attendance.js'
import Lead from '../models/Lead.js'
import Coupon from '../models/Coupon.js'
import CouponRedemption from '../models/CouponRedemption.js'
import MemberWaiver from '../models/MemberWaiver.js'
import AuditLog from '../models/AuditLog.js'
import { toCsv } from '../utils/csv.js'

const MAX_ROWS = 200_000
const IST = 'Asia/Kolkata'
const d  = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { timeZone: IST }) : '')
const dt = (v) => (v ? new Date(v).toLocaleString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
const col = (label, get) => ({ label, get })

/** Optional ?from=&to= (YYYY-MM-DD) → a Mongo date filter, or undefined. */
function rangeFilter(from, to) {
  const r = {}
  if (from && !Number.isNaN(new Date(from).getTime())) r.$gte = new Date(from)
  if (to && !Number.isNaN(new Date(to).getTime())) { const e = new Date(to); e.setHours(23, 59, 59, 999); r.$lte = e }
  return Object.keys(r).length ? r : undefined
}

/**
 * Each dataset: `load(gymId, query)` → plain rows, `columns` → CSV layout.
 * Deliberately no passwords, PIN hashes or tokens in any of them.
 */
export const DATASETS = {
  members: {
    label: 'Members',
    load: (gymId) => Member.find({ gymId }).populate('currentPlanId', 'name').populate('assignedTrainerId', 'name')
      .sort({ createdAt: -1 }).limit(MAX_ROWS).lean(),
    columns: [
      col('Name', (m) => m.name), col('Phone', (m) => m.phone), col('Email', (m) => m.email),
      col('Gender', (m) => m.gender), col('Date of birth', (m) => d(m.dob)), col('Age', (m) => m.age),
      col('Plan', (m) => m.currentPlanId?.name), col('Status', (m) => m.membershipStatus),
      col('Start date', (m) => d(m.membershipStartDate)), col('Expiry date', (m) => d(m.membershipExpiryDate)),
      col('Trainer', (m) => m.assignedTrainerId?.name), col('Source', (m) => m.source),
      col('Referral code', (m) => m.referralCode),
      col('Waiver signed', (m) => (m.waiver?.signedAt ? d(m.waiver.signedAt) : '')),
      col('PAR-Q flagged', (m) => (m.waiver?.signedAt ? !!m.waiver.parqFlagged : '')),
      col('Health notes', (m) => m.healthNotes), col('Joined', (m) => d(m.joinDate || m.membershipStartDate || m.createdAt)),
      col('Active', (m) => m.isActive !== false),
    ],
  },

  invoices: {
    label: 'Invoices',
    load: (gymId, q) => {
      const f = { gymId }; const r = rangeFilter(q.from, q.to); if (r) f.createdAt = r
      return Invoice.find(f).populate('memberId', 'name phone').populate('planId', 'name').populate('ptPlanId', 'name')
        .sort({ createdAt: -1 }).limit(MAX_ROWS).lean({ virtuals: true })
    },
    columns: [
      col('Invoice no.', (i) => i.invoiceNumber), col('Date', (i) => d(i.createdAt)),
      col('Member', (i) => i.memberId?.name), col('Phone', (i) => i.memberId?.phone),
      col('Type', (i) => i.type), col('Plan', (i) => i.planId?.name || i.ptPlanId?.name),
      col('List price', (i) => i.listAmount ?? i.totalAmount), col('Discount', (i) => i.discountAmount || 0),
      col('Coupon', (i) => i.couponCode), col('Taxable value', (i) => i.baseAmount),
      col('GST rate %', (i) => i.taxRate), col('GST', (i) => i.taxAmount), col('Total', (i) => i.totalAmount),
      col('Paid', (i) => (i.status === 'paid' ? i.totalAmount : (i.amountPaid || 0))),
      col('Balance due', (i) => (['paid', 'cancelled', 'refunded'].includes(i.status) ? 0 : Math.max(0, (i.totalAmount || 0) - (i.amountPaid || 0)))),
      col('Status', (i) => i.status), col('Method', (i) => i.paymentMethod), col('Paid on', (i) => d(i.paidAt)),
      col('Seller GSTIN', (i) => i.seller?.gstin),
    ],
  },

  // One row per instalment/payment — what a bookkeeper reconciles against the bank.
  payments: {
    label: 'Payments received',
    load: async (gymId, q) => {
      const f = { gymId, 'payments.0': { $exists: true } }
      const invoices = await Invoice.find(f).populate('memberId', 'name phone').limit(MAX_ROWS).lean()
      const r = rangeFilter(q.from, q.to)
      const rows = []
      for (const inv of invoices) for (const p of inv.payments) {
        if (r && ((r.$gte && p.paidAt < r.$gte) || (r.$lte && p.paidAt > r.$lte))) continue
        rows.push({ inv, p })
      }
      return rows.sort((a, b) => new Date(b.p.paidAt) - new Date(a.p.paidAt))
    },
    columns: [
      col('Paid on', (r) => dt(r.p.paidAt)), col('Invoice no.', (r) => r.inv.invoiceNumber),
      col('Member', (r) => r.inv.memberId?.name), col('Phone', (r) => r.inv.memberId?.phone),
      col('Amount', (r) => r.p.amount), col('Method', (r) => r.p.method), col('Note', (r) => r.p.note),
      col('Razorpay payment id', (r) => r.p.razorpayPaymentId),
    ],
  },

  attendance: {
    label: 'Attendance',
    load: (gymId, q) => {
      const f = { gymId }; const r = rangeFilter(q.from, q.to); if (r) f.date = r
      return Attendance.find(f).populate('memberId', 'name phone').sort({ date: -1 }).limit(MAX_ROWS).lean()
    },
    columns: [
      col('Date', (a) => d(a.date)), col('Member', (a) => a.memberId?.name), col('Phone', (a) => a.memberId?.phone),
      col('Type', (a) => a.type), col('Check-in', (a) => dt(a.checkInTime)), col('Check-out', (a) => dt(a.checkOutTime)),
      col('Method', (a) => a.method), col('Notes', (a) => a.notes),
    ],
  },

  leads: {
    label: 'Leads',
    load: (gymId) => Lead.find({ gymId }).sort({ createdAt: -1 }).limit(MAX_ROWS).lean(),
    columns: [
      col('Name', (l) => l.name), col('Phone', (l) => l.phone), col('Email', (l) => l.email),
      col('Interest', (l) => l.interest), col('Source', (l) => l.source), col('Status', (l) => l.status),
      col('Message', (l) => l.message), col('Created', (l) => d(l.createdAt)),
    ],
  },

  waivers: {
    label: 'Signed waivers',
    load: (gymId) => MemberWaiver.find({ gymId }).select('-signature -textSnapshot').populate('memberId', 'name phone')
      .sort({ signedAt: -1 }).limit(MAX_ROWS).lean(),
    columns: [
      col('Signed on', (w) => dt(w.signedAt)), col('Member', (w) => w.memberId?.name), col('Phone', (w) => w.memberId?.phone),
      col('Version', (w) => w.version), col('PAR-Q flagged', (w) => !!w.parqFlagged),
      col('Signed name', (w) => w.signedName), col('Guardian', (w) => w.guardianName), col('Collected', (w) => w.via),
    ],
  },

  audit: {
    label: 'Audit log',
    load: (gymId, q) => {
      const f = { gymId }; const r = rangeFilter(q.from, q.to); if (r) f.createdAt = r
      return AuditLog.find(f).sort({ createdAt: -1 }).limit(MAX_ROWS).lean()
    },
    columns: [
      col('When', (a) => dt(a.createdAt)), col('Who', (a) => a.actorName), col('Role', (a) => a.actorRole),
      col('Action', (a) => a.action), col('What happened', (a) => a.summary), col('IP', (a) => a.ip),
    ],
  },
}

export async function buildCsv(dataset, gymId, query = {}) {
  const def = DATASETS[dataset]
  if (!def) return null
  const rows = await def.load(gymId, query)
  return { csv: toCsv(def.columns, rows), count: rows.length }
}

/* ── Full JSON backup ─────────────────────────────────────────────────────── */

const SECRET_KEY = /secret|api_?key|token|password|hash|webhook/i
function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub)
  if (v && typeof v === 'object' && !(v instanceof Date) && typeof v.toHexString !== 'function') {
    const out = {}
    for (const [k, val] of Object.entries(v)) if (!SECRET_KEY.test(k)) out[k] = scrub(val)
    return out
  }
  return v
}

// What a gym can't recreate by hand. Credentials (staff passwords, member PINs,
// refresh tokens) are never included.
const COLLECTIONS = [
  ['members', Member], ['membershipPlans', MembershipPlan], ['ptPlans', PTPlan], ['memberPtPlans', MemberPTPlan],
  ['ptSessions', PTSession], ['invoices', Invoice], ['attendance', Attendance], ['leads', Lead],
  ['coupons', Coupon], ['couponRedemptions', CouponRedemption], ['memberWaivers', MemberWaiver], ['auditLogs', AuditLog],
]

/**
 * Streams one JSON document, a collection at a time, so a large gym doesn't
 * have to fit in server memory. Stops cleanly if the owner cancels the download.
 */
export async function streamBackup(gymId, res) {
  let closed = false
  res.on('close', () => { closed = true })

  const [gym, staff] = await Promise.all([
    Gym.findById(gymId).lean(),
    User.find({ gymId }).select('name email phone role isActive createdAt').lean(), // no passwordHash/refreshToken
  ])
  res.write(
    `{"app":"FitOS","format":1,"exportedAt":${JSON.stringify(new Date())},` +
    `"note":"Data backup. Passwords, PINs and tokens are never included.",` +
    `"gym":${JSON.stringify(scrub(gym))},"staff":${JSON.stringify(staff)},"collections":{`
  )

  let first = true
  for (const [name, Model] of COLLECTIONS) {
    if (closed) return
    res.write(`${first ? '' : ','}${JSON.stringify(name)}:[`)
    first = false
    let n = 0
    const cursor = Model.find({ gymId }).lean().cursor()
    for await (const doc of cursor) {
      if (closed) { await cursor.close(); return }
      res.write(`${n++ ? ',' : ''}${JSON.stringify(doc)}`)
    }
    res.write(']')
  }
  res.write('}}')
  res.end()
}
