import { Schema, model } from 'mongoose'
import bcrypt from 'bcryptjs'

const userSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String },
    passwordHash: { type: String, required: true, select: false },

    role: {
      type: String,
      enum: ['owner', 'manager', 'trainer', 'receptionist'],
      default: 'receptionist',
    },

    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    refreshToken: { type: String, select: false },

    // Granular feature access an owner can grant a manager beyond the
    // default role-based access — currently just Payroll, since that's
    // the one module with data (salaries) an owner may not want every
    // manager to see/touch by default. Owners and, implicitly, staff
    // acting on their own records always have access regardless of this.
    permissions: {
      payroll: {
        view:    { type: Boolean, default: false }, // see other staff's salary/attendance
        edit:    { type: Boolean, default: false }, // set salaries, off-schedules
        approve: { type: Boolean, default: false }, // approve/reject attendance & leave requests
        delete:  { type: Boolean, default: false }, // delete attendance records
      },
    },

    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
  },
  { timestamps: true }
)

userSchema.index({ gymId: 1, email: 1 }, { unique: true })

// Hash passwordHash automatically whenever it's set/changed, whether that's
// a brand-new user, a staff record created by an owner, or a password
// change/reset. Every call site can just assign the plain password to this
// field and let this run — nothing downstream needs to remember to hash it
// itself, which is what caused staff logins to fail ("invalid email or
// password" even with the right password): a couple of creation routes
// were storing the raw plaintext password since there was no hook doing
// this centrally, so comparePassword's bcrypt.compare() against a
// non-bcrypt string always came back false.
userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next()
  // Guard against double-hashing if something upstream already hashed it —
  // bcrypt hashes always start with one of these version prefixes.
  if (/^\$2[aby]\$/.test(this.passwordHash)) return next()
  this.passwordHash = await bcrypt.hash(this.passwordHash, 10)
  next()
})

userSchema.methods.comparePassword = async function (plain) {
  // Normal path: passwordHash is a real bcrypt hash.
  if (/^\$2[aby]\$/.test(this.passwordHash)) {
    return bcrypt.compare(plain, this.passwordHash)
  }

  // Legacy fallback: accounts created before the pre-save hook above
  // existed have their password stored as plain text, so bcrypt.compare
  // would always fail for them even with the right password. If the
  // plaintext matches, transparently rehash it here so this only ever
  // has to happen once per account, then let the caller's normal
  // save() (e.g. updating lastLoginAt on login) persist it.
  if (plain !== this.passwordHash) return false
  this.passwordHash = await bcrypt.hash(plain, 10)
  return true
}

export default model('User', userSchema)
