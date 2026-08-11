import { Schema, model } from 'mongoose'

/**
 * One member's assignment to a PT plan. Snapshots the plan's key fields at
 * assignment time so later edits to the PTPlan template don't retroactively
 * change what a member already bought. A member can have several of these
 * over time (history), though normally only one is 'active' at once.
 */
const memberPTPlanSchema = new Schema(
  {
    gymId:    { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
    ptPlanId: { type: Schema.Types.ObjectId, ref: 'PTPlan', required: true },

    // Snapshot of the plan at assignment time
    name:         { type: String, required: true },
    target:       { type: String },
    fee:          { type: Number, required: true, min: 0 },
    classesTotal: { type: Number, required: true, min: 1 },
    classesUsed:  { type: Number, default: 0, min: 0 },
    trainerId:    { type: Schema.Types.ObjectId, ref: 'User' },

    startDate:  { type: Date, required: true, default: Date.now },
    expiryDate: { type: Date, required: true }, // startDate + plan.durationDays, snapshotted

    // active   -> in progress, still has time/classes left
    // completed-> all classes used up before expiry
    // expired  -> ran out of time before using all classes
    // cancelled-> manually cancelled by staff
    status: { type: String, enum: ['active', 'completed', 'expired', 'cancelled'], default: 'active', index: true },

    // Guards so the expiry-reminder cron never sends the same alert twice
    reminders: {
      threeDaysBefore: { type: Boolean, default: false },
      onExpiry:        { type: Boolean, default: false },
      classesFinished: { type: Boolean, default: false },
    },

    // Trainer's 50% commission payout for this plan, settled separately
    // from the plan's own lifecycle — a plan can sit 'completed' for a
    // while before the gym actually pays the trainer out for it. Only
    // meaningful once the plan is fully used (classesUsed >= classesTotal);
    // see server/services/ptEarnings.service.js for how this is surfaced
    // as a reminder to trainers and owner/manager.
    trainerPayout: {
      paid:     { type: Boolean, default: false },
      paidAt:   { type: Date },
      paidBy:   { type: Schema.Types.ObjectId, ref: 'User' },
    },
  },
  { timestamps: true }
)

memberPTPlanSchema.virtual('classesRemaining').get(function () {
  return Math.max(this.classesTotal - this.classesUsed, 0)
})

// Trainer's 50% commission for this plan overall, and per completed class —
// the two figures the whole earnings feature is built from.
memberPTPlanSchema.virtual('trainerEarning').get(function () {
  return this.fee / 2
})
memberPTPlanSchema.virtual('perClassEarning').get(function () {
  return this.classesTotal > 0 ? (this.fee / 2) / this.classesTotal : 0
})
memberPTPlanSchema.virtual('trainerEarnedSoFar').get(function () {
  return this.classesUsed * this.perClassEarning
})

memberPTPlanSchema.set('toJSON', { virtuals: true })
memberPTPlanSchema.set('toObject', { virtuals: true })

export default model('MemberPTPlan', memberPTPlanSchema)
