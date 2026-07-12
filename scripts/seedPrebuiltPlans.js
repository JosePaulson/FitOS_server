/**
 * One-time (but safe to re-run) script: seeds the curated prebuilt
 * workout & diet plan library into every existing gym that doesn't
 * already have one. New gyms get this automatically at registration —
 * this script is for gyms that signed up before this feature existed.
 *
 * Safe to run multiple times — skips any gym that already has templates.
 *
 * Usage:
 *   cd server && node scripts/seedPrebuiltPlans.js
 */

import '../config/env.js'
import mongoose from 'mongoose'
import Gym from '../models/Gym.js'
import { seedPrebuiltPlansForGym } from '../utils/seedPrebuiltPlans.js'

await mongoose.connect(process.env.MONGO_URI)
console.log('✅ Connected to MongoDB')

const gyms = await Gym.find({}).select('_id name subdomain')
console.log(`Found ${gyms.length} gym(s)\n`)

for (const gym of gyms) {
  const { workoutsAdded, dietsAdded } = await seedPrebuiltPlansForGym(gym._id)
  if (workoutsAdded || dietsAdded) {
    console.log(`  ${gym.name} (${gym.subdomain}): +${workoutsAdded} workout plans, +${dietsAdded} diet plans`)
  } else {
    console.log(`  ${gym.name} (${gym.subdomain}): already has starter plans, skipped`)
  }
}

console.log('\n✅ Done')
await mongoose.disconnect()
