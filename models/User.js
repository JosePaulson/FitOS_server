import { Schema, model } from 'mongoose'
import bcrypt from 'bcryptjs'

const userSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    name:  { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String },
    passwordHash: { type: String, required: true, select: false },

    role: {
      type: String,
      enum: ['owner', 'manager', 'trainer', 'receptionist'],
      default: 'receptionist',
    },

    isActive:    { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    refreshToken: { type: String, select: false },

    resetPasswordToken:   { type: String, select: false },
    resetPasswordExpires: { type: Date,   select: false },
  },
  { timestamps: true }
)

userSchema.index({ gymId: 1, email: 1 }, { unique: true })

userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next()
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12)
  next()
})

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash)
}

export default model('User', userSchema)
