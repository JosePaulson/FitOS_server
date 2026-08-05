import { Schema, model } from 'mongoose'

/**
 * A staff member's current base salary, plus a light history trail of
 * past changes. One document per staff member (upserted on change)
 * rather than a document-per-month — payroll summaries for a given month
 * just use whatever the base salary is at calculation time, since gyms
 * don't typically need to reconstruct "what was the salary in March"
 * once it's changed.
 */
const staffSalarySchema = new Schema(
  {
    gymId:   { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    staffId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    monthlyBaseSalary: { type: Number, required: true, min: 0 },
    effectiveFrom:     { type: Date, default: Date.now },
    updatedBy:         { type: Schema.Types.ObjectId, ref: 'User' },

    history: [{
      monthlyBaseSalary: Number,
      changedAt:         { type: Date, default: Date.now },
      changedBy:          { type: Schema.Types.ObjectId, ref: 'User' },
    }],
  },
  { timestamps: true }
)

staffSalarySchema.index({ gymId: 1, staffId: 1 }, { unique: true })

export default model('StaffSalary', staffSalarySchema)
