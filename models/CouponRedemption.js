import { Schema, model } from 'mongoose'

/** One row per invoice a coupon was applied to — drives usage limits & reporting. */
const couponRedemptionSchema = new Schema(
  {
    gymId:     { type: Schema.Types.ObjectId, ref: 'Gym',     required: true, index: true },
    couponId:  { type: Schema.Types.ObjectId, ref: 'Coupon',  required: true, index: true },
    memberId:  { type: Schema.Types.ObjectId, ref: 'Member',  required: true, index: true },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
    discountAmount: { type: Number, required: true },
  },
  { timestamps: true }
)

export default model('CouponRedemption', couponRedemptionSchema)
