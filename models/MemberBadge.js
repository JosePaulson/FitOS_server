import { Schema, model } from 'mongoose'

/** A badge a member has earned. (memberId, key) is unique, so a badge can only be awarded once. */
const memberBadgeSchema = new Schema(
  {
    gymId:    { type: Schema.Types.ObjectId, ref: 'Gym',    required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
    key:      { type: String, required: true },   // 'visits_10', 'streak_4', 'challenge_<id>' …
    label:    String,                              // stored for dynamic badges (challenges)
    icon:     String,
    earnedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
)
memberBadgeSchema.index({ memberId: 1, key: 1 }, { unique: true })

export default model('MemberBadge', memberBadgeSchema)
