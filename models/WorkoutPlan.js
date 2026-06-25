import { Schema, model } from 'mongoose'

const exerciseSchema = new Schema({
  name:        { type: String, required: true },
  sets:        { type: Number },
  reps:        { type: String },
  durationSec: { type: Number },
  restSec:     { type: Number },
  notes:       { type: String },
}, { _id: false })

const workoutDaySchema = new Schema({
  day:       { type: String, required: true },
  focus:     { type: String },
  exercises: [exerciseSchema],
}, { _id: false })

const workoutPlanSchema = new Schema(
  {
    gymId:         { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    name:          { type: String, required: true, trim: true },
    description:   { type: String },
    goal:          { type: String, enum: ['weight-loss', 'muscle-gain', 'endurance', 'flexibility', 'general'], default: 'general' },
    durationWeeks: { type: Number, default: 4 },
    days:          [workoutDaySchema],
    assignedTo:    [{ type: Schema.Types.ObjectId, ref: 'Member' }],
    createdBy:     { type: Schema.Types.ObjectId, ref: 'User' },
    isTemplate:    { type: Boolean, default: false },
    isActive:      { type: Boolean, default: true },
  },
  { timestamps: true }
)

export default model('WorkoutPlan', workoutPlanSchema)
