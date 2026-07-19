import { Schema, model } from 'mongoose'

/**
 * A specific day (or date range) a trainer is unavailable — leave, holiday,
 * a one-off commitment, etc. Distinct from TrainerAvailability's standing
 * weekly hours; this layers exceptions on top of it.
 */
const trainerTimeOffSchema = new Schema(
  {
    gymId:     { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    trainerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Inclusive date range, IST calendar days (time-of-day ignored — the
    // whole day is blocked).
    startDate: { type: Date, required: true },
    endDate:   { type: Date, required: true },

    reason: { type: String, default: '' },
  },
  { timestamps: true }
)

trainerTimeOffSchema.index({ trainerId: 1, startDate: 1, endDate: 1 })

export default model('TrainerTimeOff', trainerTimeOffSchema)
