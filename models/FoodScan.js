import { Schema, model } from 'mongoose'

const foodItemSchema = new Schema({
  name:     { type: String, required: true },
  quantity: { type: String },      // e.g. "1 bowl (~200g)" — AI's best estimate
  calories: { type: Number, default: 0 },
  protein:  { type: Number, default: 0 }, // g
  carbs:    { type: Number, default: 0 }, // g
  fat:      { type: Number, default: 0 }, // g
}, { _id: false })

const foodScanSchema = new Schema(
  {
    gymId:    { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },

    // The scanned photo itself, stored in Cloudinary. imagePublicId is kept
    // so we can delete the asset again once this scan ages out of history
    // (only the member's last 5 scans are retained — see the route).
    imageUrl:      { type: String, default: '' },
    imagePublicId: { type: String, default: '' },

    // What the AI thought was in the photo
    items:         [foodItemSchema],
    totalCalories: { type: Number, default: 0 },
    totalProtein:  { type: Number, default: 0 },
    totalCarbs:    { type: Number, default: 0 },
    totalFat:      { type: Number, default: 0 },

    // How sure the model was, plus any assumptions it made (e.g. "assumed
    // medium portion size — no reference object in frame")
    confidence: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
    notes:      { type: String, default: '' },

    mealLabel: { type: String, default: '' }, // AI's guess at meal name, e.g. "Chicken salad bowl"
    provider:  { type: String, default: 'gemini' }, // which AI vision service produced this
  },
  { timestamps: true }
)

export default model('FoodScan', foodScanSchema)
