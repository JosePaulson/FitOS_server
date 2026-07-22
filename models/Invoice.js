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
    type:       { type: String, enum: ['membership', 'pt'], default: 'membership', index: true },
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

    baseAmount:  { type: Number, required: true },
    taxRate:     { type: Number, default: 18 },
    taxAmount:   { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },

    status: {
      type: String,
      enum: ['pending', 'paid', 'overdue', 'cancelled', 'refunded'],
      default: 'pending',
      index: true,
    },

    paymentMethod: {
      type: String,
      enum: ['cash', 'upi', 'card', 'netbanking', 'wallet', 'emi', 'paylater', 'online', 'other'],
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
      { new: true, select: 'invoiceSeq subdomain' }
    )

    if (!gym) return next(new Error('Gym not found when generating invoice number'))

    // Prefix: first 8 chars of subdomain, uppercased
    const prefix = gym.subdomain.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    const seq    = String(gym.invoiceSeq).padStart(5, '0')

    this.invoiceNumber = `${prefix}-${seq}`
    next()
  } catch (err) {
    next(err)
  }
})

export default model('Invoice', invoiceSchema)
