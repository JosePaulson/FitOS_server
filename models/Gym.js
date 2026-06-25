import { Schema, model } from 'mongoose'

const gymSchema = new Schema(
  {
    name:      { type: String, required: true, trim: true },
    subdomain: { type: String, required: true, unique: true, lowercase: true, trim: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User' },

    plan:       { type: String, enum: ['lite', 'basic', 'pro'], default: 'lite' },
    planStatus: {
      type: String,
      enum: ['trialing', 'active', 'past_due', 'cancelled', 'paused'],
      default: 'trialing',
    },
    trialEndsAt: { type: Date },
    renewsAt:    { type: Date },
    razorpaySubscriptionId: { type: String },

    phone:   { type: String },
    address: { type: String },
    city:    { type: String },
    state:   { type: String },
    logo:    { type: String },

    settings: {
      currency:   { type: String, default: 'INR' },
      timezone:   { type: String, default: 'Asia/Kolkata' },
      brandColor: { type: String, default: '#C8F135' },
    },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export default model('Gym', gymSchema)
