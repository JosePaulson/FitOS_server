import { Schema, model } from 'mongoose'

/**
 * A reusable catalog of workouts/exercises with demo media (e.g. "Barbell
 * Back Squat", "Treadmill HIIT Intervals"), maintained by gym staff.
 *
 * This is deliberately separate from WorkoutPlan.js, which stores the
 * per-member assigned weekly plan (a plan's "days" reference exercises by
 * name only, as free text). WorkoutLibrary is the shared, gym-wide catalog
 * that a trainer can optionally attach to a PT session so a member can see
 * exactly what a given exercise looks like.
 */
const workoutLibrarySchema = new Schema(
  {
    gymId:       { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    name:        { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ['strength', 'cardio', 'mobility', 'hiit', 'core', 'other'],
      default: 'other',
    },
    description: { type: String, default: '' },

    // Cloudinary — both optional, a workout can have either, both, or neither
    imageUrl:      { type: String, default: '' },
    imagePublicId: { type: String, default: '' },

    videoUrl:         { type: String, default: '' },
    videoPublicId:    { type: String, default: '' },
    videoDurationSec: { type: Number },   // populated from Cloudinary's own metadata on upload

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export default model('WorkoutLibrary', workoutLibrarySchema)
