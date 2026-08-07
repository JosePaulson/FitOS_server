import { Schema, model } from 'mongoose'

// Monday-first, since that's how the feature is presented to users (a
// standard weekly timetable). Unrelated to dateIST.js's Sunday-first
// DAY_NAMES, which exists purely to index JS's own Date#getDay().
export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

/**
 * One hour-long cell in a trainer's standing WEEKLY timetable — e.g. "every
 * Monday 6:00–7:00am, Trainer Alex, member Priya (Weight Loss plan)".
 *
 * This is distinct from PTSession, which logs actual date-specific
 * bookings/workouts: a TimetableSlot is the recurring weekly grid that
 * members and trainers see and manage slot-by-slot, one row per
 * trainer + weekday + start time. It doesn't itself track attendance or
 * exercises — trainers still log the real session (PTSession) when it
 * happens.
 *
 * The grid is generated from the trainer's TrainerAvailability working
 * hours (see POST /api/timetable/:trainerId/generate) — one document per
 * hour-long working slot, starting out empty. A trainer then fills cells
 * directly, or a member's request to take an open cell gets approved.
 */
const timetableSlotSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    trainerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    weekday: { type: String, enum: WEEKDAYS, required: true },
    // "HH:mm", 24h, IST wall-clock — matches TrainerAvailability's convention.
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },

    // Current occupant of this recurring slot. null = open/empty, and can
    // be requested by any other member with an active PT plan.
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', default: null },
    // Which of the member's PT plans this weekly slot is running under —
    // shown alongside their name on the timetable.
    memberPTPlanId: { type: Schema.Types.ObjectId, ref: 'MemberPTPlan', default: null },

    status: { type: String, enum: ['empty', 'booked'], default: 'empty', index: true },

    // A member's outstanding ask to take an open slot. Only one at a time —
    // a second member trying to request an already-requested slot is
    // turned away rather than queued, and the trainer/owner/manager
    // approves (fills memberId) or declines (clears this, slot stays open).
    pendingRequest: {
      memberId: { type: Schema.Types.ObjectId, ref: 'Member' },
      memberPTPlanId: { type: Schema.Types.ObjectId, ref: 'MemberPTPlan' },
      requestedAt: { type: Date },
    },

    notes: { type: String, default: '' },
  },
  { timestamps: true }
)

// One row per trainer per weekly time cell.
timetableSlotSchema.index({ gymId: 1, trainerId: 1, weekday: 1, startTime: 1 }, { unique: true })

export default model('TimetableSlot', timetableSlotSchema)
