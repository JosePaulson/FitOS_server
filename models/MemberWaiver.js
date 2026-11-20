import { Schema, model } from 'mongoose'

/**
 * One signed waiver + PAR-Q. A new row is created every time a member signs
 * (a new wording version, or a re-sign), never overwritten — the text the
 * member actually agreed to is snapshotted on the row.
 */
const memberWaiverSchema = new Schema(
  {
    gymId:    { type: Schema.Types.ObjectId, ref: 'Gym',    required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },

    version:      { type: Number, required: true },
    textSnapshot: { type: String, required: true },

    parq: [{ question: String, answer: Boolean }],
    parqFlagged: { type: Boolean, default: false },   // any "yes" → needs doctor clearance

    signedName:   { type: String, required: true, trim: true },
    guardianName: { type: String, trim: true },       // required when the member is under 18
    signature:    { type: String },                   // PNG data URL (optional drawn signature)
    signedAt:     { type: Date, default: Date.now },

    via:        { type: String, enum: ['member-portal', 'front-desk'], required: true },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },   // staff who collected it at the desk
    ip:         String,
    userAgent:  String,
  },
  { timestamps: true }
)

memberWaiverSchema.index({ gymId: 1, memberId: 1, signedAt: -1 })

export default model('MemberWaiver', memberWaiverSchema)
