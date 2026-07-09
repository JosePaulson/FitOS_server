import { Schema, model } from 'mongoose'

/**
 * A single browser/device's Web Push subscription for a member.
 *
 * A member can have more than one (e.g. phone + laptop), since each browser
 * install generates its own subscription — that's why this is its own
 * collection rather than a single field on Member.
 */
const pushSubscriptionSchema = new Schema(
  {
    gymId:    { type: Schema.Types.ObjectId, ref: 'Gym',    required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },

    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth:   { type: String, required: true },
    },

    // Helpful for debugging which device a subscription belongs to
    userAgent: { type: String, default: '' },
  },
  { timestamps: true }
)

export default model('PushSubscription', pushSubscriptionSchema)
