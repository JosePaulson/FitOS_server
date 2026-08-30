import { Schema, model } from 'mongoose'

export const MEAL_TYPE_OPTIONS = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Other']

/**
 * A member's simple meal photo diary — one photo per meal, tagged with a
 * meal name and the moment it was eaten. Unlike FoodScan, this is not
 * AI-analysed; it's just a lightweight visual log a member keeps for
 * themselves (and can optionally show their trainer), similar in spirit to
 * TransformationPhoto but for meals instead of progress shots.
 */
const mealLogSchema = new Schema(
  {
    gymId:    { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },

    mealType: { type: String, enum: MEAL_TYPE_OPTIONS, default: 'Snack' },

    // The moment this meal was eaten — defaults to "now" when logged, but
    // the member can back-date or change it (e.g. logging breakfast late).
    eatenAt: { type: Date, required: true },

    photoUrl:      { type: String, required: true },
    photoPublicId: { type: String, required: true },

    note: { type: String, default: '', maxlength: 300 },
  },
  { timestamps: true }
)

mealLogSchema.index({ gymId: 1, memberId: 1, eatenAt: -1 })

export default model('MealLog', mealLogSchema)
