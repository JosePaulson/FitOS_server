import { Schema, model } from 'mongoose'
import { approxDurationDays } from '../utils/planDuration.js'

const membershipPlanSchema = new Schema(
  {
    gymId:            { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    name:             { type: String, required: true, trim: true },
    description:      { type: String },

    // Validity can be authored in days OR months. `durationUnit` +
    // `durationValue` are the source of truth; `durationDays` is kept as a
    // derived/legacy field (approximate for months) so existing UI/reports
    // that read `durationDays` keep working unchanged.
    durationUnit:     { type: String, enum: ['days', 'months'], default: 'days' },
    durationValue:    { type: Number, required: true, min: 1 },
    durationDays:     { type: Number, required: true },

    // price is now the FINAL price the member pays — tax inclusive
    price:            { type: Number, required: true },
    taxRate:          { type: Number, default: 18 },   // GST % — 18 by default
    taxInclusive:     { type: Boolean, default: true }, // true = price already includes tax
    sessionsIncluded: { type: Number, default: 0 },
    isActive:         { type: Boolean, default: true },
  },
  { timestamps: true }
)

// Keep legacy `durationDays` in sync whenever unit/value change, so any
// code still reading `durationDays` (sorting, older invoices, etc.) keeps
// working. This is display/approximation only — actual expiry-date math
// for a specific member always goes through utils/planDuration.js, which
// accounts for real calendar month lengths.
membershipPlanSchema.pre('validate', function (next) {
  if (this.isModified('durationUnit') || this.isModified('durationValue') || !this.durationDays) {
    this.durationDays = approxDurationDays(this.durationUnit, this.durationValue)
  }
  next()
})

/**
 * Virtual: base amount (price before tax), rounded to 2 decimal places.
 * Formula: baseAmount = price / (1 + taxRate/100)
 */
membershipPlanSchema.virtual('baseAmount').get(function () {
  if (!this.taxInclusive || !this.taxRate) return this.price
  return Math.round((this.price / (1 + this.taxRate / 100)) * 100) / 100
})

/**
 * Virtual: tax amount extracted from the inclusive price.
 */
membershipPlanSchema.virtual('taxAmount').get(function () {
  return Math.round((this.price - this.baseAmount) * 100) / 100
})

membershipPlanSchema.set('toJSON',   { virtuals: true })
membershipPlanSchema.set('toObject', { virtuals: true })

export default model('MembershipPlan', membershipPlanSchema)
