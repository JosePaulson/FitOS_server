import { Schema, model } from 'mongoose'

/**
 * A single named exercise in the gym's catalog (e.g. "Barbell Bench Press"),
 * filed under a category by `categoryKey` (see ExerciseCategory.key). Powers
 * the exercise-name autocomplete suggestions when a member logs a workout
 * or a trainer logs a PT session.
 *
 * Distinct from WorkoutLibrary, which is a smaller, media-rich reference
 * catalog (photo/video demos) a trainer can attach to a PT session — this
 * model is the full name catalog used for fast entry + muscle-group tagging.
 */
const exerciseSchema = new Schema(
  {
    gymId:       { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    categoryKey: { type: String, required: true, trim: true, lowercase: true, index: true },
    name:        { type: String, required: true, trim: true },
  },
  { timestamps: true }
)

exerciseSchema.index({ gymId: 1, categoryKey: 1, name: 1 }, { unique: true })

export default model('Exercise', exerciseSchema)
