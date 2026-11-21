import Member from '../models/Member.js'
import Invoice from '../models/Invoice.js'
import { priceInvoice } from '../utils/pricing.js'
import { sendPushToMember } from './pushNotification.service.js'
import { fmtDate } from '../utils/dateFormat.js'

const DAY_MS = 24 * 60 * 60 * 1000
export const MAX_FREEZE_DAYS = 180

/**
 * Puts an ACTIVE membership on hold. Throws an Error with `.status` (400)
 * and a staff-friendly message when the hold isn't allowed.
 *
 * Optional `fee` (tax-inclusive ₹) creates a pending 'fee' invoice — it's
 * already "fulfilled" (nothing to activate), so marking it paid is pure
 * bookkeeping.
 */
export async function freezeMembership(member, { endDate, reason, fee = 0, by } = {}) {
  const fail = (m) => Object.assign(new Error(m), { status: 400 })
  const now = new Date()

  if (member.membershipStatus === 'paused') throw fail('This membership is already on hold')
  if (member.membershipStatus !== 'active' || !member.membershipExpiryDate || member.membershipExpiryDate <= now) {
    throw fail('Only an active membership can be put on hold')
  }

  let planned
  if (endDate) {
    planned = new Date(endDate)
    if (Number.isNaN(planned.getTime()) || planned <= now) throw fail('Resume date must be in the future')
    if ((planned - now) / DAY_MS > MAX_FREEZE_DAYS) throw fail(`A hold can be at most ${MAX_FREEZE_DAYS} days`)
  }
  const feeAmount = Number(fee) || 0
  if (feeAmount < 0) throw fail('Fee can\u2019t be negative')

  let feeInvoice = null
  if (feeAmount > 0) {
    const taxRate = 18
    const amounts = priceInvoice(feeAmount, taxRate, 0)
    feeInvoice = await Invoice.create({
      gymId: member.gymId, memberId: member._id, type: 'fee',
      ...amounts, taxRate, status: 'pending', dueDate: now, fulfilled: true,
      notes: 'Membership freeze fee',
    })
  }

  member.membershipStatus = 'paused'
  member.freeze = {
    startDate: now, endDate: planned,
    reason: reason?.trim() || undefined,
    feeInvoiceId: feeInvoice?._id,
  }
  await member.save()

  sendPushToMember(member._id, {
    title: 'Membership on hold ⏸️',
    body: planned
      ? `Your membership is on hold until ${fmtDate(planned)}. The days you\u2019re away will be added back.`
      : 'Your membership is on hold. The days you\u2019re away will be added back when you resume.',
    url: '/', tag: 'membership-freeze',
  }).catch((e) => console.error('[freeze] push failed:', e.message))

  return { member, feeInvoice }
}

/**
 * Resumes a paused membership: adds the days actually spent on hold to the
 * expiry date and archives the hold in freezeHistory. `auto` (the scheduled
 * resume) counts days only up to the planned end date, so a cron that runs
 * late never hands out extra days.
 */
export async function resumeMembership(member, { by, auto = false } = {}) {
  if (member.membershipStatus !== 'paused' || !member.freeze?.startDate) {
    throw Object.assign(new Error('This membership isn\u2019t on hold'), { status: 400 })
  }
  const now = new Date()
  const start = member.freeze.startDate
  const end = auto && member.freeze.endDate ? new Date(Math.min(now, member.freeze.endDate)) : now
  const days = Math.max(0, Math.ceil((end - start) / DAY_MS))

  if (member.membershipExpiryDate) {
    const expiry = new Date(member.membershipExpiryDate)
    expiry.setDate(expiry.getDate() + days)
    member.membershipExpiryDate = expiry
  }
  member.freezeHistory.push({
    startDate: start, endDate: end, days, reason: member.freeze.reason,
    feeInvoiceId: member.freeze.feeInvoiceId, by,
  })
  member.membershipStatus = 'active'
  member.freeze = undefined
  await member.save()

  sendPushToMember(member._id, {
    title: 'Welcome back 💪',
    body: `Your membership is active again — ${days} day${days === 1 ? '' : 's'} added back. New expiry: ${fmtDate(member.membershipExpiryDate)}.`,
    url: '/', tag: 'membership-resume',
  }).catch((e) => console.error('[freeze] push failed:', e.message))

  return { member, days }
}

/** Resumes every hold whose planned end date has passed. Returns how many. */
export async function autoResumeDueFreezes() {
  const due = await Member.find({ membershipStatus: 'paused', 'freeze.endDate': { $lte: new Date() } })
  let n = 0
  for (const m of due) {
    try { await resumeMembership(m, { auto: true }); n++ }
    catch (e) { console.error('[freeze] auto-resume failed for', m._id.toString(), e.message) }
  }
  return n
}
