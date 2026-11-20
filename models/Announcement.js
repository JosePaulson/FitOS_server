import { Schema, model } from 'mongoose'

/** A broadcast from the gym to its members (holiday closure, new class, offer…). */
const announcementSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    body:  { type: String, required: true, trim: true, maxlength: 500 },
    audience: { type: String, enum: ['all', 'active', 'expiring', 'expired'], default: 'active' },
    sentTo:   { type: Number, default: 0 },
    createdBy:     { type: Schema.Types.ObjectId, ref: 'User' },
    createdByName: String,
  },
  { timestamps: true }
)
announcementSchema.index({ gymId: 1, createdAt: -1 })

export default model('Announcement', announcementSchema)
