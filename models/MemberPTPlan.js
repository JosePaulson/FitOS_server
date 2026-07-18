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
  },
  { timestamps: true }
)

memberPTPlanSchema.virtual('classesRemaining').get(function () {
  return Math.max(this.classesTotal - this.classesUsed, 0)
})

memberPTPlanSchema.set('toJSON', { virtuals: true })
memberPTPlanSchema.set('toObject', { virtuals: true })

export default model('MemberPTPlan', memberPTPlanSchema)
