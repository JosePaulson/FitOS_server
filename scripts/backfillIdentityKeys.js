/**
 * One-time (safe to re-run) data step for the "unique phone / unique email" rules.
 *
 *   • Gives every user an emailKey and every ACTIVE member a phoneKey, so the database can enforce
 *     uniqueness (including against two people submitting at the same instant).
 *   • Sets joinDate on members that don't have one (from their start date, else the day they were added).
 *   • Does NOT change or delete anything that clashes. If two users share an email (across gyms) or
 *     two active members in a gym share a phone number, the OLDEST keeps the key and the others are
 *     listed so you can fix them by hand (change the email/number, or archive the extra record).
 *     Re-run afterwards to key the ones you fixed.
 *
 * Usage:
 *   cd server
 *   node scripts/backfillIdentityKeys.js --dry   # report only, writes nothing
 *   node scripts/backfillIdentityKeys.js         # apply
 */

import '../config/env.js'
import mongoose from 'mongoose'
import User from '../models/User.js'
import Member from '../models/Member.js'
import Gym from '../models/Gym.js'
import { emailKey, phoneKey } from '../utils/identity.js'
import { assignFirstKeys } from '../utils/duplicateKeys.js'

const DRY = process.argv.includes('--dry')
await mongoose.connect(process.env.MONGO_URI)
console.log(DRY ? '— DRY RUN: nothing will be written —\n' : '')

const gyms = new Map((await Gym.find({}).select('name subdomain').lean()).map((g) => [String(g._id), g]))
const gymLabel = (id) => { const g = gyms.get(String(id)); return g ? `${g.name} (${g.subdomain})` : String(id) }

/* Users: email must be unique across ALL gyms */
const users = await User.find({}).select('+emailKey name email role gymId createdAt').lean()
const u = assignFirstKeys(users, { keyOf: (x) => emailKey(x.email) })
let uWrites = 0
for (const { id, key } of u.assign) {
  const current = users.find((x) => String(x._id) === String(id))
  if (current.emailKey === key) continue
  uWrites++
  if (!DRY) await User.updateOne({ _id: id }, { $set: { emailKey: key } })
}
console.log(`Users:   ${users.length} checked, ${uWrites} ${DRY ? 'would be' : ''} keyed, ${u.duplicates.length} email clash group(s)`)
for (const group of u.duplicates) {
  console.log(`\n  ⚠ Same email (${emailKey(group[0].email)}):`)
  group.forEach((x, i) => console.log(`     ${i === 0 ? 'keeps it ' : 'CLASHES  '} ${x.name} <${x.email}> — ${x.role} at ${gymLabel(x.gymId)}`))
}

/* Members: phone must be unique among ACTIVE members of the same gym */
const members = await Member.find({}).select('+phoneKey name phone gymId isActive joinDate membershipStartDate createdAt').lean()
const active = members.filter((m) => m.isActive !== false)
const m = assignFirstKeys(active, { keyOf: (x) => phoneKey(x.phone), scopeOf: (x) => String(x.gymId) })
let mWrites = 0
for (const { id, key } of m.assign) {
  const current = active.find((x) => String(x._id) === String(id))
  if (current.phoneKey === key) continue
  mWrites++
  if (!DRY) await Member.updateOne({ _id: id }, { $set: { phoneKey: key } })
}
console.log(`\nMembers: ${active.length} active checked, ${mWrites} ${DRY ? 'would be' : ''} keyed, ${m.duplicates.length} phone clash group(s)`)
for (const group of m.duplicates) {
  console.log(`\n  ⚠ Same phone (${phoneKey(group[0].phone)}) in ${gymLabel(group[0].gymId)}:`)
  group.forEach((x, i) => console.log(`     ${i === 0 ? 'keeps it ' : 'CLASHES  '} ${x.name} — ${x.phone}`))
}

/* Join dates */
const needJoin = members.filter((x) => !x.joinDate)
if (!DRY) for (const x of needJoin) await Member.updateOne({ _id: x._id }, { $set: { joinDate: x.membershipStartDate || x.createdAt } })
console.log(`\nJoin dates: ${needJoin.length} member(s) ${DRY ? 'would get' : 'got'} a join date (from their start date, else the day they were added).`)

if (u.duplicates.length || m.duplicates.length) {
  console.log('\nFix the clashes above (change the email/number, or archive the extra member), then run this again.')
}
await mongoose.disconnect()
