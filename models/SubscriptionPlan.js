import { Schema, model } from 'mongoose'

/**
 * A platform subscription tier (lite/basic/pro, or any custom tier a
 * super-admin creates), editable from the super-admin console instead of
 * being hardcoded. See middleware/planGate.js for how these drive
 * feature-gating, and services/razorpay.service.js for how the Razorpay
 * plan IDs here (when set) take precedence over the RAZORPAY_PLAN_*_*
 * env vars for actual billing.
 *
 * Until any SubscriptionPlan documents exist, planGate.js falls back to
 * its own built-in defaults — so this is purely additive and never
 * breaks a gym that predates this feature.
 */
const subscriptionPlanSchema = new Schema(
  {
    key:  { type: String, required: true, unique: true, lowercase: true, trim: true }, // 'lite', 'basic', 'pro', ...
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', maxlength: 300 },

    // Display pricing shown to gym owners in the Subscribe screen. The
    // amount actually charged is whatever the linked Razorpay plan bills
    // — keep these in sync manually when editing either side.
    priceMonthly: { type: Number, default: 0 },
    priceYearly:  { type: Number, default: 0 },

    // Optional — when set, these override the RAZORPAY_PLAN_<TIER>_<INTERVAL>
    // env vars for this tier (see razorpay.service.js). Leave blank to
    // keep using the env-var-configured plan ID.
    razorpayPlanIdMonthly: { type: String, default: '', trim: true },
    razorpayPlanIdYearly:  { type: String, default: '', trim: true },

    memberLimit: { type: Number, default: null }, // null = unlimited
    features: [{ type: String, trim: true }], // freeform — shown to gym owners, also used by planGate's feature→tier gating

    isActive:  { type: Boolean, default: true }, // whether this tier is currently offered to gyms
    sortOrder: { type: Number, default: 0 },      // ascending = lowest tier first; controls gating comparisons too
  },
  { timestamps: true }
)

export default model('SubscriptionPlan', subscriptionPlanSchema)
