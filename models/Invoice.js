import { Schema, model } from 'mongoose'
import Gym from './Gym.js'

const invoiceSchema = new Schema(
  {
    gymId:    { type: Schema.Types.ObjectId, ref: 'Gym',    required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
    planId:   { type: Schema.Types.ObjectId, ref: 'MembershipPlan' },

    // What this invoice is for. 'membership' covers enrolment/renewal
    // (the original/only case); 'pt' is a personal-training package
    // purchase, billed independently of any membership plan.
    type:       { type: String, enum: ['membership', 'pt', 'fee'], default: 'membership', index: true }, // 'fee' = one-off charge, e.g. membership-freeze fee
    ptPlanId:   { type: Schema.Types.ObjectId, ref: 'PTPlan' },        // catalog template, when type === 'pt'
    memberPTPlanId: { type: Schema.Types.ObjectId, ref: 'MemberPTPlan' }, // the assignment created once this invoice is paid

    /**
     * Invoice number format: <SUBDOMAIN>-<SEQ>
     * e.g.  IRONZONE-00001  FLEXFIT-00003
     *
     * Unique per gym (compound index on gymId + invoiceNumber).
     * The sequence is atomically incremented on the Gym document,
     * so concurrent invoice creation never produces duplicates.
     */
    invoiceNumber: { type: String, index: true },

    // Pricing. When a coupon / referral discount is applied, baseAmount,
    // taxAmount and totalAmount are all computed from the DISCOUNTED price
    // (GST is charged on what the member actually pays); listAmount keeps
    // the pre-discount, tax-inclusive price for display on the PDF.
    listAmount:     { type: Number },
    discountAmount: { type: Number, default: 0 },
    couponId:       { type: Schema.Types.ObjectId, ref: 'Coupon' },
    couponCode:     { type: String },   // also 'REFERRAL' for the referral discount

    baseAmount:  { type: Number, required: true },
    taxRate:     { type: Number, default: 18 },
    taxAmount:   { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },

    status: {
      type: String,
      enum: ['pending', 'partial', 'paid', 'overdue', 'cancelled', 'refunded'],
      default: 'pending',
      index: true,
    },

    paymentMethod: {
      type: String,
      enum: ['cash', 'upi', 'card', 'netbanking', 'wallet', 'emi', 'paylater', 'online', 'other'],
    },

    // Part payments: every instalment received is a row here; amountPaid is
    // their running total. The invoice flips to 'paid' once it reaches
    // totalAmount (that's also when membership/PT side-effects fire).
    payments: [{
      amount: { type: Number, required: true },
      method: String,
      paidAt: { type: Date, default: Date.now },
      note:   String,
      razorpayPaymentId: String,
      receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    }],
    amountPaid: { type: Number, default: 0 },

    // Razorpay hosted payment link the front desk can send (WhatsApp etc.)
    paymentLink: {
      id:        String,
      url:       String,
      amount:    Number,   // balance the link was created for
      createdAt: Date,
    },

    // Seller details frozen at invoice creation (from Gym.settings.gst).
    seller: {
      legalName: String,
      gstin:     String,
      address:   String,
      sac:       String,
      footerNote:String,
    },

    razorpayOrderId:   { type: String },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },

    // Whether the real-world effect of this invoice (extending the
    // member's plan / activating a PT plan assignment) has already been
    // applied. Invoices created by staff (enrol/renew) apply immediately
    // and default this to true — payment there is just bookkeeping.
    // Invoices created by a member's own online checkout default this to
    // false at creation and flip to true only once payment is confirmed,
    // so an abandoned checkout never grants membership/PT time for free.
    fulfilled: { type: Boolean, default: true },

    paidAt:  { type: Date },
    dueDate: { type: Date },
    pdfUrl:  { type: String },
    notes:   { type: String },
  },
  { timestamps: true }
)

// What is still owed. Paid invoices always owe nothing (this also keeps
// invoices created before part-payments existed — amountPaid 0, status
// 'paid' — from showing a phantom balance).
invoiceSchema.virtual('balanceDue').get(function () {
  if (this.status === 'paid' || this.status === 'cancelled' || this.status === 'refunded') return 0
  return Math.max(0, Math.round(((this.totalAmount || 0) - (this.amountPaid || 0)) * 100) / 100)
})
invoiceSchema.set('toJSON',   { virtuals: true })
invoiceSchema.set('toObject', { virtuals: true })

/**
 * Compound unique index:
 *   (gymId, invoiceNumber) must be unique — not invoiceNumber alone.
 *   This means IRONZONE-00001 and FLEXFIT-00001 can both exist globally,
 *   but IRONZONE cannot have two INV-00001s.
 */
invoiceSchema.index({ gymId: 1, invoiceNumber: 1 }, { unique: true })

/**
 * Atomically increment Gym.invoiceSeq and build the invoice number.
 *
 * Using $inc inside findOneAndUpdate is atomic in MongoDB — even if two
 * invoice documents are created simultaneously for the same gym, each gets
 * a different sequence number because MongoDB processes the $inc as a
 * single atomic operation at the document level.
 */
invoiceSchema.pre('save', async function (next) {
  if (!this.isNew || this.invoiceNumber) return next()

  try {
    const gym = await Gym.findByIdAndUpdate(
      this.gymId,
      { $inc: { invoiceSeq: 1 } },
      { new: true, select: 'invoiceSeq subdomain settings.gst' }
    )

    if (!gym) return next(new Error('Gym not found when generating invoice number'))

    // Prefix: first 8 chars of subdomain, uppercased
    const prefix = gym.subdomain.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    const seq    = String(gym.invoiceSeq).padStart(5, '0')

    this.invoiceNumber = `${prefix}-${seq}`

    // Freeze the seller's GST details onto the invoice.
    const g = gym.settings?.gst
    if (g && (g.gstin || g.legalName) && !this.seller?.gstin && !this.seller?.legalName) {
      this.seller = {
        legalName: g.legalName, gstin: g.gstin, address: g.address,
        sac: g.sac, footerNote: g.footerNote,
      }
    }
    next()
  } catch (err) {
    next(err)
  }
})

export default model('Invoice', invoiceSchema)
