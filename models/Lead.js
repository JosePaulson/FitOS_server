import { Schema, model } from 'mongoose'

const noteSchema = new Schema(
  {
    text:      { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
)

const leadSchema = new Schema(
  {
    gymId:    { type: Schema.Types.ObjectId, ref: 'Gym', default: null, index: true },
    name:     { type: String, required: true, trim: true },
    phone:    { type: String, required: true, trim: true },
    email:    { type: String, lowercase: true, trim: true },
    gymName:  { type: String },

    interest: {
      type: String,
      enum: ['free-trial', 'product-demo', 'pricing-info', 'migration-help', 'other'],
      default: 'free-trial',
    },
    memberRange: { type: String },
    source: {
      type: String,
      enum: ['landing-page', 'walk-in', 'referral', 'social', 'ad', 'other'],
      default: 'landing-page',
    },
    message: { type: String },

    stage: {
      type: String,
      enum: ['new', 'contacted', 'demo-scheduled', 'converted', 'lost'],
      default: 'new',
      index: true,
    },

    notes:      [noteSchema],
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },

    convertedGymId: { type: Schema.Types.ObjectId, ref: 'Gym' },
    convertedAt:    { type: Date },
  },
  { timestamps: true }
)

export default model('Lead', leadSchema)
