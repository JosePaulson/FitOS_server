import { Schema, model } from 'mongoose'

/**
 * A gym-run challenge, e.g. "20 visits this month". Progress is computed live
 * from attendance / workout logs inside the date window — nothing to sync.
 */
const challengeSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 300 },
    metric: { type: String, enum: ['visits', 'workouts'], required: true }, // distinct days with a gym visit / a logged workout
    target: { type: Number, required: true, min: 1, max: 1000 },
    startDate: { type: Date, required: true },   // stored as YYYY-MM-DD at UTC midnight; compared as day strings
    endDate:   { type: Date, required: true },
    reward:    { type: String, trim: true, maxlength: 120 },  // e.g. "Free protein shake" — fulfilled by the gym
    isActive:  { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
)
challengeSchema.index({ gymId: 1, endDate: -1 })

export default model('Challenge', challengeSchema)
