import { Schema, model } from 'mongoose'

/**
 * One entry in a member's "My Transformation" gallery — a photo paired
 * with the date it was taken and (optionally) their weight that day, so
 * the member can visually track how they look over time alongside the
 * numbers already tracked elsewhere (workout logs, PT sessions).
 */
const transformationPhotoSchema = new Schema(
  {
    gymId:    { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },

    date:   { type: Date, required: true },
    weight: { type: Number }, // kg — optional, a member may skip logging it for a given photo

    photoUrl:      { type: String, required: true },
    photoPublicId: { type: String, required: true },

    note: { type: String, default: '', maxlength: 300 },
  },
  { timestamps: true }
)

transformationPhotoSchema.index({ gymId: 1, memberId: 1, date: 1 })

export default model('TransformationPhoto', transformationPhotoSchema)
