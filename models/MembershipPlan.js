import { Schema, model } from 'mongoose'

const membershipPlanSchema = new Schema(
  {
    gymId:            { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    name:             { type: String, required: true, trim: true },
    description:      { type: String },
    // Validity can be authored either in days or in calendar months.
    // durationType/durationValue is the source of truth an admin edits;
    // durationDays is kept in sync (approximate for 'months', see below)
    // purely so older screens/emails that only know about durationDays
    // keep working without changes.
    durationType:     { type: String, enum: ['days', 'months'], default: 'days' },
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

/**
 * Keep durationDays in sync with durationType/durationValue whenever a plan
 * is saved. For 'months' this is only an approximation (30.4375 days/month
 * on average) — it exists so legacy displays (member portal, invoice
 * emails) that just read plan.durationDays keep showing a sensible number.
 * The real, calendar-accurate day count for a specific enrolment/renewal is
 * always computed at the time it happens via addPlanDuration() below, which
 * accounts for the actual number of days in the upcoming month(s).
 */
membershipPlanSchema.pre('validate', function (next) {
  if (this.durationType === 'months') {
    this.durationDays = Math.round(this.durationValue * 30.4375)
  } else {
    this.durationDays = this.durationValue
  }
  next()
})

/** Virtual: human-readable validity, e.g. "3 months" or "45 days" */
membershipPlanSchema.virtual('durationLabel').get(function () {
  if (this.durationType === 'months') {
    return `${this.durationValue} month${this.durationValue === 1 ? '' : 's'}`
  }
  return `${this.durationValue} day${this.durationValue === 1 ? '' : 's'}`
})

/**
 * Add a plan's validity period to a given start date, returning the
 * resulting expiry date. Any date can be passed in — past or future —
 * so this works equally for "start today", back-dated joins, or
 * future-dated renewals.
 *
 * For 'months', calendar months are added (not a flat 30-day multiple),
 * so a month with 28, 29, 30 or 31 days is accounted for correctly. If
 * the start day-of-month doesn't exist in the target month (e.g. 31 Jan
 * + 1 month), the date is clamped to the last day of that month instead
 * of silently rolling over into the following month.
 */
export function addPlanDuration(startDate, plan) {
  const start = new Date(startDate)
  if (plan.durationType === 'months') {
    const day = start.getDate()
    const result = new Date(start)
    result.setDate(1) // avoid month-overflow while adding months
    result.setMonth(result.getMonth() + plan.durationValue)
    const daysInTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()
    result.setDate(Math.min(day, daysInTargetMonth))
    return result
  }
  const result = new Date(start)
  result.setDate(result.getDate() + plan.durationValue)
  return result
}

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

