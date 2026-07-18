import { Schema, model } from 'mongoose'

const logExerciseSchema = new Schema({
  name:   { type: String, required: true },
  sets:   { type: Number },
  reps:   { type: String },   // plain number or a range like "8-12"
  weight: { type: Number },   // kg used
}, { _id: false })

/**
 * A workout a member logs themselves — separate from trainer-assigned
 * WorkoutPlans and from PTSession (which is trainer-run). Mirrors PTSession's
 * exercise/bodyweight/calorie shape so the same calorie-estimate formula and
 * body-weight progress graph can cover both.
 */
const memberWorkoutLogSchema = new Schema(
  {
    gymId:    { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },

    // Includes time-of-day — defaults to "now" client-side, editable.
    date: { type: Date, required: true, default: Date.now, index: true },

    title:           { type: String, default: 'Workout' },
    durationMinutes: { type: Number, default: 60 },

    exercises: [logExerciseSchema],
    bodyWeight: { type: Number }, // kg, optional per entry

    notes: { type: String, default: '' },

    // Estimated the same way as PTSession — see utils/calories.js
    caloriesBurned: { type: Number, default: null },
  },
  { timestamps: true }
)

memberWorkoutLogSchema.index({ gymId: 1, memberId: 1, date: -1 })

export default model('MemberWorkoutLog', memberWorkoutLogSchema)
