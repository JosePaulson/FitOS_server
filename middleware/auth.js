import jwt from 'jsonwebtoken'
import User from '../models/User.js'

export async function protect(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' })
  }

  const token = header.split(' ')[1]

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const user    = await User.findById(decoded.id).select('-passwordHash -refreshToken')

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'User not found or deactivated' })
    }

    req.user  = user
    req.gymId = user.gymId
    next()
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
}

export function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Role '${req.user.role}' is not allowed to access this resource`,
      })
    }
    next()
  }
}
