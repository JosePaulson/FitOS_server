import { Schema, model } from 'mongoose'

/**
 * A discount code a gym can hand out (festival offer, corporate/student
 * rate, win-back…). Applied to the tax-inclusive price of a membership or
 * PT purchase; GST is then computed on the discounted amount.
 */
const couponSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    code:  { type: String, required: true, uppercase: true, trim: true, maxlength: 24 },
    description: { type: String, trim: true, maxlength: 200 },

    type:  { type: String, enum: ['percent', 'flat'], required: true },
    value: { type: Number, required: true, min: 0 },       // % (0–100) or ₹ amount
    maxDiscount: { type: Number, min: 0 },                  // cap for percent coupons (₹), optional
    minAmount:   { type: Number, min: 0, default: 0 },      // minimum purchase (tax-inclusive ₹)

    appliesTo: { type: [String], enum: ['membership', 'pt'], default: ['membership', 'pt'] },
    planIds:   [{ type: Schema.Types.ObjectId }],           // optional: restrict to specific plans (membership or PT)

    validFrom: { type: Date },
    validTo:   { type: Date },
    usageLimit:     { type: Number, min: 0, default: 0 },   // total redemptions; 0 = unlimited
    perMemberLimit: { type: Number, min: 0, default: 1 },   // per member; 0 = unlimited
    usedCount:      { type: Number, default: 0 },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
)

couponSchema.index({ gymId: 1, code: 1 }, { unique: true })

export default model('Coupon', couponSchema)
