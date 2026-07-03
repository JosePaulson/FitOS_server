import { Schema, model } from 'mongoose'

const ptExerciseSchema = new Schema({
  name:        { type: String, required: true },
  sets:        { type: Number },
  reps:        { type: String },
  weight:      { type: Number },  // kg — what was actually lifted this session
  durationSec: { type: Number },
  restSec:     { type: Number },
  notes:       { type: String },
}, { _id: false })

const ptSessionSchema = new Schema(
  {
    gymId:     { type: Schema.Types.ObjectId, ref: 'Gym',    required: true, index: true },
    memberId:  { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
    trainerId: { type: Schema.Types.ObjectId, ref: 'User',   required: true },

    // Scheduled / actual date of the session
    date:      { type: Date, required: true, index: true },

    // Title / focus for this session
    title:     { type: String, default: '' },
    notes:     { type: String, default: '' },

    // Exercises planned / performed
    exercises: [ptExerciseSchema],

    // Body metrics recorded this session
    bodyWeight: { type: Number },     // kg
    bodyFat:    { type: Number },     // % (optional)

    // Status
    status: {
      type:    String,
      enum:    ['scheduled', 'completed', 'missed', 'cancelled'],
      default: 'scheduled',
      index:   true,
    },

    // Member acknowledgement — did the member confirm they attended?
    acknowledgedByMember:   { type: Boolean, default: false },
    acknowledgedAt:         { type: Date },
  },
  { timestamps: true }
)

// One session per member per trainer per date (prevent accidental duplicates)
ptSessionSchema.index({ gymId: 1, memberId: 1, date: 1, trainerId: 1 })

export default model('PTSession', ptSessionSchema)
