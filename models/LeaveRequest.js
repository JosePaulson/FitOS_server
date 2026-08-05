import { Schema, model } from 'mongoose'

/**
 * A staff member's leave request — separate from day-to-day attendance
 * marking. Covers a date range (single day = fromDate === toDate) with a
 * reason, and goes through the same owner/manager (payroll "approve")
 * review flow as attendance requests.
 *
 * This does NOT automatically create StaffAttendance rows — approving a
 * leave request just records the decision here. Gyms that also want the
 * calendar/payroll math to reflect it can additionally mark attendance
 * for those days (paid/unpaid leave) via the normal attendance flow.
 */
const leaveRequestSchema = new Schema(
  {
    gymId:   { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    staffId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    fromDate: { type: Date, required: true }, // day-only (midnight UTC, IST calendar day)
    toDate:   { type: Date, required: true },
    days:     { type: Number, required: true, min: 1 }, // inclusive day count, computed on submit

    leaveType: { type: String, enum: ['paid', 'unpaid'], default: 'unpaid' }, // requested type; approver can override
    reason:    { type: String, required: true, trim: true },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
      index: true,
    },

    reviewedBy:   { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt:   { type: Date },
    reviewNote:   { type: String, default: '' },
  },
  { timestamps: true }
)

leaveRequestSchema.index({ gymId: 1, status: 1 })
leaveRequestSchema.index({ gymId: 1, staffId: 1, createdAt: -1 })

export default model('LeaveRequest', leaveRequestSchema)
