import { Schema, model } from 'mongoose'

/**
 * A member's hydration ("drink water") reminder schedule.
 *
 * This is what makes reminders fire even when the PWA is fully closed:
 * jobs/hydrationReminders.js polls this collection every minute and sends
 * a real Web Push notification for anyone whose time matches — Web Push
 * wakes the service worker independently of whether any tab is open,
 * unlike a purely client-side setInterval loop (which only runs while a
 * FitOS tab is open, foreground or background).
 */
const hydrationScheduleSchema = new Schema(
  {
    gymId:    { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, unique: true, index: true },

    enabled: { type: Boolean, default: false },
    // "HH:mm", 24-hour, IST wall-clock — same convention the rest of the
    // app uses for schedules (gym timetable slots, PT sessions, etc).
    times: { type: [String], default: [] },
  },
  { timestamps: true }
)

// The cron job's core query is `{ enabled: true, times: hhmm }` every
// minute — index both fields together so that stays cheap regardless of
// how many members turn this on.
hydrationScheduleSchema.index({ enabled: 1, times: 1 })

export default model('HydrationSchedule', hydrationScheduleSchema)
