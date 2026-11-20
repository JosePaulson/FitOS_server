import { Schema, model } from 'mongoose'

const gymSchema = new Schema(
  {
    name:      { type: String, required: true, trim: true },
    subdomain: { type: String, required: true, unique: true, lowercase: true, trim: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User' },

    plan:       { type: String, enum: ['lite', 'basic', 'pro'], default: 'lite' },
    planStatus: {
      type: String,
      enum: ['trialing', 'active', 'past_due', 'cancelled', 'paused'],
      default: 'trialing',
    },
    trialEndsAt: { type: Date },
    renewsAt:    { type: Date },
    razorpaySubscriptionId: { type: String },

    phone:   { type: String },
    address: { type: String },
    city:    { type: String },
    state:   { type: String },
    logo:    { type: String },

    // Gym's physical location, set by dragging a pin on a map in the admin
    // dashboard. Used to geofence member self check-in — a member can only
    // mark their own attendance from the member portal when their device is
    // within `radiusMeters` of this point.
    location: {
      lat:          { type: Number },
      lng:          { type: Number },
      radiusMeters: { type: Number, default: 50 },
    },

    // Operating hours, shown to members. Simple per-day text rather than a
    // strict schema — gyms often just want to say "6 AM – 10 PM" or
    // "Closed" without modeling exact time slots.
    openingHours: {
      monday:    { type: String, default: '' },
      tuesday:   { type: String, default: '' },
      wednesday: { type: String, default: '' },
      thursday:  { type: String, default: '' },
      friday:    { type: String, default: '' },
      saturday:  { type: String, default: '' },
      sunday:    { type: String, default: '' },
    },

    /**
     * Atomic invoice sequence counter.
     * Incremented via findOneAndUpdate($inc) — never read-then-write.
     * This guarantees no two invoices for the same gym share a number,
     * even under concurrent requests.
     */
    invoiceSeq: { type: Number, default: 0 },

    settings: {
      currency:   { type: String, default: 'INR' },
      timezone:   { type: String, default: 'Asia/Kolkata' },
      brandColor: { type: String, default: '#C8F135' },
      emailFrom:  { type: String, default: '' },
      replyTo:    { type: String, default: '' },
      // Customizable branding applied to outgoing transactional emails
      // (welcome, birthday greetings, etc.) — kept as reusable
      // signature/footer blocks rather than per-template bodies, so a
      // gym sets its voice once and it's consistent everywhere.
      emailSignature: { type: String, default: '', maxlength: 500 },
      emailFooterText: { type: String, default: '', maxlength: 500 },
      // Per-template custom message bodies — {{variable}} placeholders,
      // filled in and HTML-escaped at send time (see renderEmailBody in
      // email.service.js). Empty = use the built-in default copy.
      welcomeEmailBody: { type: String, default: '', maxlength: 1000 },
      invoiceEmailBody: { type: String, default: '', maxlength: 1000 },
      renewalEmailBody: { type: String, default: '', maxlength: 1000 },

      // GST details printed on invoice PDFs. Copied onto each invoice at
      // creation (Invoice.seller) so later edits never rewrite history.
      gst: {
        legalName: { type: String, default: '', trim: true, maxlength: 120 },
        gstin:     { type: String, default: '', trim: true, uppercase: true, maxlength: 15 },
        address:   { type: String, default: '', trim: true, maxlength: 300 },
        sac:       { type: String, default: '999723', trim: true, maxlength: 10 }, // fitness / physical well-being services
        footerNote:{ type: String, default: '', trim: true, maxlength: 300 },
      },

      // Liability waiver + PAR-Q health form. `text` blank = use the built-in
      // template (see services/waiver.service.js). `version` bumps whenever
      // the text changes, so members who signed an older wording can be
      // asked to sign again.
      waiver: {
        enabled: { type: Boolean, default: false },
        text:    { type: String, default: '', maxlength: 8000 },
        version: { type: Number, default: 1 },
      },

      // Owner-chosen permissions per staff role. `undefined` (never set) means
      // "use the built-in defaults" — an empty array means "nothing".
      rolePermissions: {
        manager:      { type: [String], default: undefined },
        receptionist: { type: [String], default: undefined },
        trainer:      { type: [String], default: undefined },
      },

      // "Refer a friend" programme. Disabled until the owner turns it on.
      referral: {
        enabled:               { type: Boolean, default: false },
        referrerRewardDays:    { type: Number, default: 7,  min: 0, max: 365 }, // free days for the referrer
        refereeDiscountPercent:{ type: Number, default: 10, min: 0, max: 100 }, // off the new member's first invoice
      },
    },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
)

export default model('Gym', gymSchema)
