import { Schema, model } from 'mongoose'

const staffRatingSchema = new Schema(
  {
    gymId:    { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    staffId:  { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },

    rating: { type: Number, required: true, min: 1, max: 5 },
    remark: { type: String, trim: true },
  },
  { timestamps: true }
)

// A member can rate a given staff member once — submitting again updates
// their existing rating/remark rather than creating a duplicate.
staffRatingSchema.index({ gymId: 1, staffId: 1, memberId: 1 }, { unique: true })

export default model('StaffRating', staffRatingSchema)
