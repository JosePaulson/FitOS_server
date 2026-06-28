/**
 * MemberAuth — login credentials for gym members.
 *
 * Separate from the staff User model:
 *   - Members log in with phone + PIN (4-6 digits) or email + PIN
 *   - No role — all members have the same access level
 *   - Scoped to a gym via gymId
 *   - Linked 1:1 to the Member document
 */
import { Schema, model } from 'mongoose'
import bcrypt from 'bcryptjs'

const memberAuthSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true },

    // Login identifier — phone is primary (most Indian members don't have email on file)
    phone: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },

    pinHash: { type: String, required: true, select: false },  // 4–6 digit PIN, bcrypt hashed

    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    refreshToken: { type: String, select: false },
  },
  { timestamps: true }
)

// One auth record per member
memberAuthSchema.index({ gymId: 1, memberId: 1 }, { unique: true })
// Fast lookup by phone within a gym
memberAuthSchema.index({ gymId: 1, phone: 1 }, { unique: true })

// memberAuthSchema.pre('save', async function (next) {
//   if (!this.isModified('pinHash')) return next()
//   this.pinHash = await bcrypt.hash(this.pinHash, 10)
//   next()
// })

memberAuthSchema.methods.comparePin = function (plain) {
  return bcrypt.compare(plain, this.pinHash)
}

export default model('MemberAuth', memberAuthSchema)
