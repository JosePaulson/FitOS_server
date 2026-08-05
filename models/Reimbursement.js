import { Schema, model } from 'mongoose'

/**
 * A staff member's request to be reimbursed for something they paid for
 * out of pocket on the gym's behalf (a purchase or a service payment).
 * Goes through the same owner/manager (payroll "approve") review flow as
 * attendance and leave requests.
 */
const reimbursementSchema = new Schema(
  {
    gymId:   { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    staffId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    item:   { type: String, required: true, trim: true }, // what was purchased / which service was paid for
    date:   { type: Date, required: true },                 // date of purchase/payment
    amount: { type: Number, required: true, min: 0 },
    note:   { type: String, default: '', trim: true },       // optional

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'paid'],
      default: 'pending',
      index: true,
    },

    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewNote: { type: String, default: '' },

    paidAt: { type: Date }, // owner/manager can mark as actually paid out, separate from "approved"
  },
  { timestamps: true }
)

reimbursementSchema.index({ gymId: 1, status: 1 })
reimbursementSchema.index({ gymId: 1, staffId: 1, createdAt: -1 })

export default model('Reimbursement', reimbursementSchema)
