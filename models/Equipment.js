import { Schema, model } from 'mongoose'

const equipmentSchema = new Schema(
  {
    gymId:       { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    name:        { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ['cardio', 'strength', 'free-weights', 'machines', 'accessories', 'other'],
      default: 'other',
    },
    description: { type: String, default: '' },

    // Cloudinary
    imageUrl:      { type: String, default: '' },
    imagePublicId: { type: String, default: '' },   // needed to delete/replace the asset later

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export default model('Equipment', equipmentSchema)
