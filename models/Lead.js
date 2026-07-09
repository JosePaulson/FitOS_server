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
    // null  = platform-level pre-signup lead (gym owners enquiring about FitOS itself)
    // set   = a lead scoped to a specific gym (a prospective MEMBER — walk-in,
    //         referral, etc. captured by that gym's own staff)
    gymId:    { type: Schema.Types.ObjectId, ref: 'Gym', default: null, index: true },
    name:     { type: String, required: true, trim: true },
    phone:    { type: String, required: true, trim: true },
    email:    { type: String, lowercase: true, trim: true },
    gymName:  { type: String },   // only meaningful for platform-level leads

    interest: {
      type: String,
      enum: [
        // Platform-level (SaaS) enquiry types
        'free-trial', 'product-demo', 'pricing-info', 'migration-help',
        // Gym-level (prospective member) enquiry types
        'membership', 'personal-training', 'group-class', 'day-pass',
        'other',
      ],
      default: 'free-trial',
    },
    memberRange: { type: String },   // only meaningful for platform-level leads
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

    // Staff member who manually logged this lead (walk-in, referral, etc.)
    // Left unset for leads submitted through a public enquiry form.
    createdBy:  { type: Schema.Types.ObjectId, ref: 'User' },

    convertedGymId: { type: Schema.Types.ObjectId, ref: 'Gym' },
    convertedAt:    { type: Date },
  },
  { timestamps: true }
)

export default model('Lead', leadSchema)
