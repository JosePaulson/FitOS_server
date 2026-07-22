import { Schema, model } from 'mongoose'

const responseSchema = new Schema(
  {
    text: { type: String, required: true, trim: true },
    respondedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
)

const complaintSchema = new Schema(
  {
    gymId:    { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },

    type: {
      type: String,
      enum: ['complaint', 'request'],
      default: 'complaint',
      index: true,
    },
    category: {
      type: String,
      enum: ['trainer', 'staff', 'equipment', 'cleanliness', 'facility', 'billing', 'class-schedule', 'other'],
      default: 'other',
    },
    subject: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },

    status: {
      type: String,
      enum: ['open', 'in-progress', 'resolved', 'closed'],
      default: 'open',
      index: true,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },

    responses: [responseSchema],
    resolvedAt: { type: Date },
  },
  { timestamps: true }
)

complaintSchema.index({ gymId: 1, status: 1 })
complaintSchema.index({ gymId: 1, createdAt: -1 })

export default model('Complaint', complaintSchema)
