/**
 * One-time migration: re-numbers existing invoices to the new
 * <SUBDOMAIN>-<SEQ> format and sets Gym.invoiceSeq correctly.
 *
 * Safe to run multiple times — skips invoices already in the new format.
 *
 * Usage:
 *   cd server && node scripts/migrateInvoiceNumbers.js
 */

import '../config/env.js'
import mongoose from 'mongoose'
import Gym     from '../models/Gym.js'
import Invoice from '../models/Invoice.js'

await mongoose.connect(process.env.MONGO_URI)
console.log('✅ Connected to MongoDB')

const gyms = await Gym.find({}).select('_id subdomain invoiceSeq')
console.log(`Found ${gyms.length} gym(s)\n`)

for (const gym of gyms) {
  const prefix   = gym.subdomain.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  const oldFormat = /^INV-\d+$/

  // Find invoices for this gym that still use the old INV-XXXXX format
  const invoices = await Invoice.find({ gymId: gym._id }).sort({ createdAt: 1 })
  const toMigrate = invoices.filter((inv) => !inv.invoiceNumber || oldFormat.test(inv.invoiceNumber))

  if (toMigrate.length === 0) {
    console.log(`  ${gym.subdomain}: already migrated (${invoices.length} invoices)`)

    // Make sure invoiceSeq is at least as high as the current count
    if (gym.invoiceSeq < invoices.length) {
      await Gym.findByIdAndUpdate(gym._id, { invoiceSeq: invoices.length })
      console.log(`    ↳ Fixed invoiceSeq to ${invoices.length}`)
    }
    continue
  }

  console.log(`  ${gym.subdomain}: migrating ${toMigrate.length} invoice(s)...`)

  let seq = gym.invoiceSeq || 0

  for (const inv of toMigrate) {
    seq++
    const newNumber = `${prefix}-${String(seq).padStart(5, '0')}`
    await Invoice.findByIdAndUpdate(inv._id, { invoiceNumber: newNumber })
    console.log(`    ${inv.invoiceNumber || '(none)'} → ${newNumber}`)
  }

  // Update the gym's counter to the final seq value
  await Gym.findByIdAndUpdate(gym._id, { invoiceSeq: seq })
  console.log(`    ✓ invoiceSeq set to ${seq}\n`)
}

console.log('\n✅ Migration complete')
await mongoose.disconnect()
