import { Schema, model } from 'mongoose'

const attendanceSchema = new Schema(
  {
    gymId:    { type: Schema.Types.ObjectId, ref: 'Gym',    required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },

    date:         { type: Date, required: true, index: true },
    checkInTime:  { type: Date },
    checkOutTime: { type: Date },

    type:      { type: String, enum: ['gym', 'class', 'pt'], default: 'gym' },
    classId:   { type: Schema.Types.ObjectId, ref: 'Class' },
    trainerId: { type: Schema.Types.ObjectId, ref: 'User' },
    notes:     { type: String },

    // How this record was created — staff marking it manually vs a member
    // self-checking-in from the portal because they were within the gym's
    // geofence radius.
    method: { type: String, enum: ['manual', 'geofence'], default: 'manual' },
  },
  { timestamps: true }
)

attendanceSchema.index({ gymId: 1, memberId: 1, date: 1, type: 1 }, { unique: true })

export default model('Attendance', attendanceSchema)
