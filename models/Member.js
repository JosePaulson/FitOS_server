import { Schema, model } from 'mongoose'

const memberSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },

    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    dob: { type: Date },     // optional — also powers birthday greetings
    age: { type: Number },   // optional — for members who'd rather not share a DOB
    gender: { type: String, enum: ['male', 'female', 'other'] },
    height: { type: Number },   // cm, optional — used for calorie-burn estimates on PT sessions
    photo: { type: String },
    photoPublicId: { type: String }, // Cloudinary public_id, so a replaced/removed photo can be cleaned up

    emergencyContact: {
      name: String,
      phone: String,
      relation: String,
    },
    healthNotes: { type: String }, // free text — editable by staff, and by the member themselves (medical conditions) in the member portal

    currentPlanId: { type: Schema.Types.ObjectId, ref: 'MembershipPlan' },
    membershipStatus: { type: String, enum: ['active', 'expired', 'paused', 'cancelled'], default: 'active' },
    membershipStartDate: { type: Date },
    membershipExpiryDate: { type: Date, index: true },
    assignedTrainerId: { type: Schema.Types.ObjectId, ref: 'User' },

    source: {
      type: String,
      enum: ['walk-in', 'referral', 'social', 'lead', 'online', 'other'],
      default: 'walk-in',
    },
    referredBy: { type: Schema.Types.ObjectId, ref: 'Member' },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
)

memberSchema.index({ gymId: 1, phone: 1 })
memberSchema.index({ gymId: 1, membershipExpiryDate: 1 })

export default model('Member', memberSchema)