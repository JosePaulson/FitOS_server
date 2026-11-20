import { Schema, model } from 'mongoose'

/**
 * A member's in-app notification inbox. Every push that goes out through
 * sendPushToMember is also recorded here (so members can re-read what they
 * missed), plus gym announcements. Old rows expire automatically.
 */
const notificationSchema = new Schema(
  {
    gymId:    { type: Schema.Types.ObjectId, ref: 'Gym',    required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
    title:    { type: String, required: true, maxlength: 120 },
    body:     { type: String, maxlength: 600 },
    url:      { type: String, default: '/' },
    tag:      String,
    type:     { type: String, default: 'general' },   // general | announcement | badge | challenge | renewal | pr
    announcementId: { type: Schema.Types.ObjectId, ref: 'Announcement', index: true },
    readAt:   { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

notificationSchema.index({ memberId: 1, createdAt: -1 })
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 120 }) // keep ~4 months

export default model('Notification', notificationSchema)
