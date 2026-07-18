import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import Gym from '../models/Gym.js'
import Attendance from '../models/Attendance.js'

const router = Router()
router.use(memberProtect)

/** Haversine distance between two lat/lng points, in meters. */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000 // Earth radius in meters
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * GET /api/member-portal/attendance/today
 * Lightweight status check the app can use to decide whether the global
 * "mark your attendance" prompt is even relevant, without needing GPS yet.
 */
router.get('/today', async (req, res, next) => {
  try {
    const existing = await Attendance.findOne({
      gymId: req.gymId, memberId: req.memberId, date: startOfToday(), type: 'gym',
    })
    const gym = await Gym.findById(req.gymId).select('location')
    res.json({
      alreadyMarked: !!existing,
      gymLocationSet: !!(gym?.location?.lat != null && gym?.location?.lng != null),
    })
  } catch (err) { next(err) }
})

/**
 * POST /api/member-portal/attendance/checkin
 * Body: { lat, lng } — the member's current device coordinates.
 * Marks today's gym attendance IF the member is within the gym's geofence
 * radius. Distance is always verified server-side — the client-side check
 * is only used to decide whether to show the prompt, never trusted alone.
 */
router.post('/checkin', async (req, res, next) => {
  try {
    const { lat, lng } = req.body
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ message: 'Device location (lat, lng) required' })
    }

    const gym = await Gym.findById(req.gymId).select('location')
    if (!gym?.location?.lat || !gym?.location?.lng) {
      return res.status(400).json({ message: 'Gym location has not been set up yet — ask staff to add it in settings' })
    }

    const radius = gym.location.radiusMeters || 50
    const distance = distanceMeters(lat, lng, gym.location.lat, gym.location.lng)

    if (distance > radius) {
      return res.status(403).json({
        message: `You're ${Math.round(distance)}m from the gym — get within ${radius}m to check in`,
        distance: Math.round(distance),
        radius,
      })
    }

    const today = startOfToday()
    const existing = await Attendance.findOne({ gymId: req.gymId, memberId: req.memberId, date: today, type: 'gym' })
    if (existing) {
      return res.json({ record: existing, alreadyMarked: true, distance: Math.round(distance) })
    }

    const record = await Attendance.create({
      gymId: req.gymId,
      memberId: req.memberId,
      date: today,
      checkInTime: new Date(),
      type: 'gym',
      method: 'geofence',
    })

    res.status(201).json({ record, alreadyMarked: false, distance: Math.round(distance) })
  } catch (err) {
    // Unique index (gymId, memberId, date, type) races to a duplicate-key
    // error under rapid double-taps — treat that as "already marked" rather
    // than a hard failure.
    if (err.code === 11000) {
      const existing = await Attendance.findOne({ gymId: req.gymId, memberId: req.memberId, date: startOfToday(), type: 'gym' })
      return res.json({ record: existing, alreadyMarked: true })
    }
    next(err)
  }
})

export default router
