import Gym from '../models/Gym.js'
import Member from '../models/Member.js'
import { sendPushToMember } from './pushNotification.service.js'

// No 0/O/1/I/L — codes get read out over the phone and typed on small screens.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function randomCode(len = 6) {
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return out
}

/** A referral code not yet used by any member of this gym. */
export async function generateReferralCode(gymId) {
  for (let i = 0; i < 8; i++) {
    const code = randomCode()
    if (!(await Member.exists({ gymId, referralCode: code }))) return code
  }
  return randomCode(8) // astronomically unlikely to need this
}

/** Returns the member's code, creating (and saving) one for older members that lack it. */
export async function ensureReferralCode(member) {
  if (member.referralCode) return member.referralCode
  member.referralCode = await generateReferralCode(member.gymId)
  await member.save({ validateBeforeSave: false })
  return member.referralCode
}

/** The gym's referral programme settings, with safe defaults. */
export async function getReferralSettings(gymId) {
  const gym = await Gym.findById(gymId).select('settings.referral')
  const r = gym?.settings?.referral || {}
  return {
    enabled: !!r.enabled,
    referrerRewardDays: r.referrerRewardDays ?? 7,
    refereeDiscountPercent: r.refereeDiscountPercent ?? 10,
  }
}

/** Finds the member who owns `code` in this gym (must be an active record). */
export async function findReferrer(gymId, code) {
  const norm = String(code || '').trim().toUpperCase()
  if (!norm) return null
  return Member.findOne({ gymId, referralCode: norm, isActive: true })
}

/**
 * Rewards the referrer — once — when the referred member's FIRST membership
 * invoice is paid (paying, not merely signing up, so fake sign-ups earn
 * nothing). The reward is free days added to the referrer's expiry.
 * Never throws: a reward problem must not break a payment.
 */
export async function grantReferralReward(member, invoice) {
  try {
    if (!member?.referredBy || member.referralRewardGrantedAt) return
    if (invoice.type !== 'membership') return

    const settings = await getReferralSettings(member.gymId)
    if (!settings.enabled || !(settings.referrerRewardDays > 0)) return

    // Claim the reward atomically so two simultaneous payments can't both grant it.
    const claimed = await Member.findOneAndUpdate(
      { _id: member._id, referralRewardGrantedAt: { $exists: false } },
      { $set: { referralRewardGrantedAt: new Date() } }
    )
    if (!claimed) return

    const referrer = await Member.findOne({ _id: member.referredBy, gymId: member.gymId })
    if (!referrer) return

    const days = settings.referrerRewardDays
    const now = new Date()
    const base = referrer.membershipExpiryDate && referrer.membershipExpiryDate > now
      ? new Date(referrer.membershipExpiryDate)
      : now
    base.setDate(base.getDate() + days)
    referrer.membershipExpiryDate = base
    // A lapsed referrer is reactivated by the reward; a frozen one stays frozen.
    if (referrer.membershipStatus === 'expired') referrer.membershipStatus = 'active'
    await referrer.save({ validateBeforeSave: false })

    sendPushToMember(referrer._id, {
      title: 'Referral reward 🎁',
      body: `${member.name} joined using your code — ${days} free day${days === 1 ? '' : 's'} added to your membership!`,
      url: '/',
      tag: 'referral-reward',
    }).catch((e) => console.error('[referral] push failed:', e.message))
  } catch (e) {
    console.error('[referral] reward failed:', e.message)
  }
}
