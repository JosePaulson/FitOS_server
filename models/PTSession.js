import { Schema, model } from 'mongoose'

const ptExerciseSchema = new Schema({
  name: { type: String, required: true },
  sets: { type: Number },
  reps: { type: String },
  weight: { type: Number },  // kg — what was actually lifted this session
  durationSec: { type: Number },
  restSec: { type: Number },
  notes: { type: String },
  muscleGroup: { type: String, trim: true }, // chest/back/shoulders/biceps/triceps/legs/core/other
}, { _id: false })

const ptSessionSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
    // Not required — a member-initiated booking request may not have a
    // trainer assigned yet; a trainer/owner/manager assigns one on confirm.
    trainerId: { type: Schema.Types.ObjectId, ref: 'User' },

    // Scheduled / actual date (and, for bookings, time) of the session
    date: { type: Date, required: true, index: true },
    // Session duration in minutes — used both for the booking calendar's
    // time block and, together with bodyweight/exercises, to estimate
    // calories burned below.
    durationMinutes: { type: Number, default: 60 },

    // Title / focus for this session
    title: { type: String, default: '' },
    notes: { type: String, default: '' },

    // Who created this session, and how:
    //  - 'trainer': staff scheduled it directly (default, original behaviour)
    //  - 'member':  the member requested it via the booking calendar and it
    //               needs a trainer to confirm before it's actually on
    bookingSource: { type: String, enum: ['trainer', 'member'], default: 'trainer' },
    // The trainer the member asked for when booking (optional — "no
    // preference" is allowed). Kept even after a trainer is assigned so
    // the admin dashboard can show what the member originally requested.
    requestedTrainerId: { type: Schema.Types.ObjectId, ref: 'User' },
    // Set when a trainer/manager declines a pending booking request
    declineReason: { type: String, default: '' },

    // Exercises planned / performed
    exercises: [ptExerciseSchema],

    // Body metrics recorded this session
    bodyWeight: { type: Number },     // kg
    bodyFat: { type: Number },     // % (optional)

    // Auto-calculated estimate — see server/utils/calories.js. Recomputed
    // whenever bodyweight, duration, or exercises change; null until there's
    // enough data (needs at least a bodyweight, from this session or a
    // previous one, plus a duration).
    caloriesBurned: { type: Number, default: null },

    // Optional links into the gym's shared catalogs — lets a trainer show
    // the member exactly which equipment and/or reference workouts (with
    // demo image/video) this session used, without re-entering that media
    // per session. Entirely optional; most sessions can leave these empty.
    equipment: [{ type: Schema.Types.ObjectId, ref: 'Equipment' }],
    workouts: [{ type: Schema.Types.ObjectId, ref: 'WorkoutLibrary' }],

    // Status
    status: {
      type: String,
      // 'pending'  — member requested this slot, awaiting trainer confirmation
      // 'declined' — trainer/manager turned down the request
      enum: ['pending', 'scheduled', 'completed', 'missed', 'cancelled', 'declined'],
      default: 'scheduled',
      index: true,
    },

    // Member acknowledgement — did the member confirm they attended?
    acknowledgedByMember: { type: Boolean, default: false },
    acknowledgedAt: { type: Date },
  },
  { timestamps: true }
)

// One session per member per trainer per date (prevent accidental duplicates)
ptSessionSchema.index({ gymId: 1, memberId: 1, date: 1, trainerId: 1 })

export default model('PTSession', ptSessionSchema)