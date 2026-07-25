import { Schema, model } from 'mongoose'

/**
 * A muscle-group / category used to organize the gym's exercise catalog
 * (e.g. "Chest", "Back", "Legs"). Each gym gets its own editable copy —
 * seeded from a sane default set on first use (see
 * utils/exerciseCatalogDefaults.js) — so an admin can rename, reorder,
 * add, or remove categories without affecting other gyms.
 *
 * `key` is a stable slug used elsewhere in the app (e.g. a workout log's
 * `exercises[].muscleGroup`, or Exercise.categoryKey below) so renaming a
 * category's display label doesn't break existing logged data.
 */
const exerciseCategorySchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    key:   { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
)

exerciseCategorySchema.index({ gymId: 1, key: 1 }, { unique: true })

export default model('ExerciseCategory', exerciseCategorySchema)
