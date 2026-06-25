import { Schema, model } from 'mongoose'

const invoiceSchema = new Schema(
  {
    gymId:    { type: Schema.Types.ObjectId, ref: 'Gym',    required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
    planId:   { type: Schema.Types.ObjectId, ref: 'MembershipPlan' },

    invoiceNumber: { type: String, unique: true },

    // Price breakdown — all tax-inclusive
    // totalAmount = baseAmount + taxAmount  (= plan.price)
    baseAmount:  { type: Number, required: true },  // price excl. tax
    taxRate:     { type: Number, default: 18 },     // GST %
    taxAmount:   { type: Number, default: 0 },      // tax portion
    totalAmount: { type: Number, required: true },  // what member pays (tax incl.)

    status: {
      type: String,
      enum: ['pending', 'paid', 'overdue', 'cancelled', 'refunded'],
      default: 'pending',
      index: true,
    },

    paymentMethod: {
      type: String,
      enum: ['cash', 'upi', 'card', 'netbanking', 'online', 'other'],
    },

    razorpayOrderId:   { type: String },
    razorpayPaymentId: { type: String },

    paidAt:  { type: Date },
    dueDate: { type: Date },
    pdfUrl:  { type: String },
    notes:   { type: String },
  },
  { timestamps: true }
)

invoiceSchema.pre('save', async function (next) {
  if (this.isNew && !this.invoiceNumber) {
    const count = await this.constructor.countDocuments({ gymId: this.gymId })
    this.invoiceNumber = `INV-${String(count + 1).padStart(5, '0')}`
  }
  next()
})

export default model('Invoice', invoiceSchema)
