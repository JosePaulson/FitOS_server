import { Schema, model } from 'mongoose'

/**
 * A PT plan is a personal-training package a gym offers — independent of
 * membership plans (a member doesn't need any particular membership, or
 * even an active one, to be assigned a PT plan; it's entirely optional).
 * This is the catalog/template; actual purchases are `MemberPTPlan` docs
 * that snapshot these values at assignment time.
 */
const ptPlanSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },

    name:        { type: String, required: true, trim: true },
    description: { type: String },

    numberOfClasses: { type: Number, required: true, min: 1 },
    // Validity window in days from the day it's assigned to a member,
    // e.g. 40 — NOT related to a membership's own expiry.
    durationDays:    { type: Number, required: true, min: 1 },
    fee:             { type: Number, required: true, min: 0 },
    // Free-text goal, e.g. "Weight loss", "Muscle gain", "General fitness"
    target:          { type: String, trim: true },

    // The trainer this package is normally run by. Can be overridden
    // per-member at assignment time (see MemberPTPlan.trainerId).
    trainerId: { type: Schema.Types.ObjectId, ref: 'User' },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export default model('PTPlan', ptPlanSchema)
