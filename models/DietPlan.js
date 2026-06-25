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
    assignedTo:     [{ type: Schema.Types.ObjectId, ref: 'Member' }],
    createdBy:      { type: Schema.Types.ObjectId, ref: 'User' },
    isTemplate:     { type: Boolean, default: false },
    isActive:       { type: Boolean, default: true },
  },
  { timestamps: true }
)

export default model('DietPlan', dietPlanSchema)
