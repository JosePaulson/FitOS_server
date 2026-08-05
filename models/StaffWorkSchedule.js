import { Schema, model } from 'mongoose'

/**
 * A staff member's off-day pattern, set by an owner/manager — used to
 * compute which calendar days are "weekly off" (not worked, not counted
 * as absent) without needing to store an explicit attendance record for
 * every single one of them.
 */
const staffWorkScheduleSchema = new Schema(
  {
    gymId:   { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    staffId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    // Days of the week that are always off for this staff member.
    // 0 = Sunday … 6 = Saturday.
    weeklyOffDays: { type: [Number], default: [0] },

    // One-off additional off days within a specific month (e.g. a
    // festival day, a manually granted day off) — stored as day-only
    // dates (midnight UTC) so they compare cleanly against attendance.
    customOffDates: { type: [Date], default: [] },

    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
)

staffWorkScheduleSchema.index({ gymId: 1, staffId: 1 }, { unique: true })

export default model('StaffWorkSchedule', staffWorkScheduleSchema)
