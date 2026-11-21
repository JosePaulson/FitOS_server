import { Schema, model } from 'mongoose'
import { phoneKey } from '../utils/identity.js'

const memberSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },

    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    // Digits-only comparison form of `phone` (see utils/identity.js). Set automatically; powers the
    // "one active member per phone number" rule, including at the database level.
    phoneKey: { type: String, select: false },
    // The day this person joined the gym (can be back-dated at enrolment). Unlike
    // membershipStartDate it never moves when a membership is renewed.
    joinDate: { type: Date },
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

    // What the member lets the gym see of their self-kept logs. Off by default.
    // When a log type is shared, the owner and managers can always see it; trainers
    // only if the member picked them in `trainerIds`. (See utils/logSharing.js.)
    logSharing: {
      workoutLogs: { type: Boolean, default: false },
      mealLogs:    { type: Boolean, default: false },
      trainerIds:  [{ type: Schema.Types.ObjectId, ref: 'User' }],
    },

    source: {
      type: String,
      enum: ['walk-in', 'referral', 'social', 'lead', 'online', 'other'],
      default: 'walk-in',
    },
    referredBy: { type: Schema.Types.ObjectId, ref: 'Member' },

    // Latest signed waiver, denormalised so the member list can show status
    // without a join. Full signed record lives in MemberWaiver.
    waiver: {
      version:     { type: Number },
      signedAt:    { type: Date },
      parqFlagged: { type: Boolean },   // any "yes" on the PAR-Q
    },

    // Engagement: weekly visit goal for streaks, and a leaderboard opt-out.
    weeklyGoal: { type: Number, min: 1, max: 7, default: 3 },
    hideFromLeaderboard: { type: Boolean, default: false },

    // Auto-renew: when on, a renewal invoice (+ payment link) is prepared a few
    // days before expiry and the member is nudged to pay in one tap.
    // lastNoticeForExpiry stops the same expiry being notified twice.
    autoRenew: {
      enabled: { type: Boolean, default: false },
      lastNoticeForExpiry: { type: Date },
    },

    // Personal code this member can share ("Refer a friend"). Generated at
    // enrolment (or lazily for older members the first time they open the
    // referral card). Unique per gym — see index below.
    referralCode: { type: String, uppercase: true, trim: true },
    // Set once the referrer has been rewarded for THIS member's first paid
    // membership invoice, so the reward can never be granted twice.
    referralRewardGrantedAt: { type: Date },

    // Membership hold ("freeze"). While membershipStatus === 'paused',
    // `freeze` describes the current hold; on resume the days spent frozen
    // are added to membershipExpiryDate and the hold moves to freezeHistory.
    freeze: {
      startDate: { type: Date },
      endDate:   { type: Date },   // optional planned auto-resume date
      reason:    { type: String, trim: true },
      feeInvoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
    },
    freezeHistory: [{
      startDate: Date,
      endDate:   Date,             // when it actually ended
      days:      Number,           // days added back to the expiry
      reason:    String,
      feeInvoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
      by:        { type: Schema.Types.ObjectId, ref: 'User' },
    }],

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
)

memberSchema.index({ gymId: 1, phone: 1 })
// One ACTIVE member per phone number per gym. Archiving a member (isActive: false) frees the number.
memberSchema.index(
  { gymId: 1, phoneKey: 1 },
  { unique: true, partialFilterExpression: { phoneKey: { $type: 'string' }, isActive: true } }
)

memberSchema.pre('validate', function (next) {
  if (this.isNew || this.isModified('phone')) this.phoneKey = phoneKey(this.phone)
  next()
})
// PATCH /members/:id updates through findOneAndUpdate, which skips document hooks.
memberSchema.pre('findOneAndUpdate', function (next) {
  const u = this.getUpdate() || {}
  const target = u.$set || u
  if (target.phone !== undefined) target.phoneKey = phoneKey(target.phone)
  next()
})
memberSchema.index({ gymId: 1, membershipExpiryDate: 1 })
// Referral codes must be unique within a gym; members without one (older
// records) are excluded so they don't collide on "missing".
memberSchema.index(
  { gymId: 1, referralCode: 1 },
  { unique: true, partialFilterExpression: { referralCode: { $type: 'string' } } }
)

export default model('Member', memberSchema)