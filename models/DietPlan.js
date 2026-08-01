import { Schema, model } from 'mongoose'

const mealItemSchema = new Schema({
  food:     { type: String, required: true },
  quantity: { type: String },
  calories: { type: Number },
  protein:  { type: Number },
  carbs:    { type: Number },
  fat:      { type: Number },
}, { _id: false })

const mealSchema = new Schema({
  name:  { type: String, required: true },
  time:  { type: String },
  items: [mealItemSchema],
  notes: { type: String },
}, { _id: false })

const dietPlanSchema = new Schema(
  {
    gymId:          { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    name:           { type: String, required: true, trim: true },
    description:    { type: String },
    goal:           { type: String, enum: ['weight-loss', 'muscle-gain', 'maintenance', 'general'], default: 'general' },
    targetCalories: { type: Number },
    targetProtein:  { type: Number },
    targetCarbs:    { type: Number },
    targetFat:      { type: Number },
    meals:          [mealSchema],

    // Optional file attachment (PDF, Word, Excel, image) — lets a
    // trainer hand a member a diet plan as a document instead of (or in
    // addition to) building it out meal-by-meal above. Downloadable from
    // the member portal's Diet tab.
    fileUrl:       { type: String, default: null },
    fileName:      { type: String, default: null },
    fileType:      { type: String, default: null }, // original mimetype
    fileSizeBytes: { type: Number, default: null },
    filePublicId:  { type: String, default: null },  // Cloudinary asset id, for cleanup
    fileResourceType: { type: String, default: null }, // 'image' | 'raw' — Cloudinary needs this to delete correctly

    assignedTo:     [{ type: Schema.Types.ObjectId, ref: 'Member' }],
    createdBy:      { type: Schema.Types.ObjectId, ref: 'User' },
    isTemplate:     { type: Boolean, default: false },
    isActive:       { type: Boolean, default: true },
  },
  { timestamps: true }
)

export default model('DietPlan', dietPlanSchema)
