import { Schema, model } from 'mongoose'

/**
 * One day's attendance record for one staff member. Weekly-off days are
 * NOT stored here — they're derived on read from StaffWorkSchedule — so
 * this collection only ever holds days someone actually reported
 * something for: present, absent, or a leave request.
 *
 * A staff member submits their own record (source: 'staff'), which
 * starts as requestStatus 'pending' until an owner/manager (with payroll
 * approve access) approves or rejects it. An owner/manager can also set
 * a record directly (source: 'admin'), which is auto-approved.
 */
const staffAttendanceSchema = new Schema(
  {
    gymId:   { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    staffId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date:    { type: Date, required: true }, // day-only (midnight UTC)

    status: {
      type: String,
      enum: ['present', 'absent', 'half-day', 'leave-paid', 'leave-unpaid'],
      required: true,
    },

    source: { type: String, enum: ['staff', 'admin'], default: 'staff' },
    requestStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },

    notes: { type: String, default: '' },

    submittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    submittedAt: { type: Date, default: Date.now },
    approvedBy:  { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt:  { type: Date },
    rejectionReason: { type: String, default: '' },
  },
  { timestamps: true }
)

staffAttendanceSchema.index({ gymId: 1, staffId: 1, date: 1 }, { unique: true })
staffAttendanceSchema.index({ gymId: 1, requestStatus: 1 })

export default model('StaffAttendance', staffAttendanceSchema)
