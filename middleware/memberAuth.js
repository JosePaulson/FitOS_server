import jwt from 'jsonwebtoken'
import MemberAuth from '../models/MemberAuth.js'

/**
 * Middleware for member portal routes.
 * Verifies a member JWT (signed with MEMBER_JWT_SECRET)
 * and attaches { memberAuth, memberId, gymId } to req.
 */
export async function memberProtect(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' })
  }

  const token = header.split(' ')[1]

  try {
    const secret  = process.env.MEMBER_JWT_SECRET || process.env.JWT_SECRET
    const decoded = jwt.verify(token, secret)

    const auth = await MemberAuth.findById(decoded.id).select('-pinHash -refreshToken')
    if (!auth || !auth.isActive) {
      return res.status(401).json({ message: 'Session expired. Please log in again.' })
    }

    req.memberAuth = auth
    req.memberId   = auth.memberId
    req.gymId      = auth.gymId
    next()
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
}
