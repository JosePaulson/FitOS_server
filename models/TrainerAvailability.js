import { Schema, model } from 'mongoose'

const shiftSchema = new Schema({
  start: { type: String, default: '06:00' }, // "HH:mm", 24h, IST wall-clock time
  end:   { type: String, default: '20:00' },
}, { _id: false })

const dayHoursSchema = new Schema({
  isOff: { type: Boolean, default: false },
  // A day can have more than one shift, e.g. a morning slot and an evening
  // slot with a break in between — common for gyms with split trainer hours.
  shifts: { type: [shiftSchema], default: () => [{ start: '06:00', end: '20:00' }] },
}, { _id: false })

/**
 * A trainer's standing weekly working hours — one document per trainer.
 * Used together with TrainerTimeOff (specific-day exceptions) and existing
 * PTSession bookings to compute what slots a member can actually book.
 * All times are IST wall-clock ("HH:mm"), matching how the whole app treats
 * time — never stored as UTC-shifted values.
 */
const trainerAvailabilitySchema = new Schema(
  {
    gymId:     { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    trainerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

    weeklyHours: {
      monday:    { type: dayHoursSchema, default: () => ({}) },
      tuesday:   { type: dayHoursSchema, default: () => ({}) },
      wednesday: { type: dayHoursSchema, default: () => ({}) },
      thursday:  { type: dayHoursSchema, default: () => ({}) },
      friday:    { type: dayHoursSchema, default: () => ({}) },
      saturday:  { type: dayHoursSchema, default: () => ({}) },
      sunday:    { type: dayHoursSchema, default: () => ({ isOff: true }) },
    },

    // Granularity used when generating bookable slot start-times within the
    // working window, e.g. 60 -> slots on the hour.
    slotDurationMinutes: { type: Number, default: 60 },
  },
  { timestamps: true }
)

export default model('TrainerAvailability', trainerAvailabilitySchema)
