import { Schema, model } from 'mongoose'

/** One body-measurement check-in by a member (any subset of the metrics). */
const bodyMeasurementSchema = new Schema(
  {
    gymId:    { type: Schema.Types.ObjectId, ref: 'Gym',    required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
    date:     { type: Date, required: true, default: Date.now },
    weightKg:    { type: Number, min: 20,  max: 400 },
    bodyFatPct:  { type: Number, min: 2,   max: 70 },
    chestCm:     { type: Number, min: 20,  max: 250 },
    waistCm:     { type: Number, min: 20,  max: 250 },
    hipsCm:      { type: Number, min: 20,  max: 250 },
    armCm:       { type: Number, min: 10,  max: 100 },
    thighCm:     { type: Number, min: 10,  max: 150 },
    notes:       { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true }
)
bodyMeasurementSchema.index({ memberId: 1, date: -1 })

export default model('BodyMeasurement', bodyMeasurementSchema)
