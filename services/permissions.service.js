import Gym from '../models/Gym.js'
import {
  PERMISSIONS, PERMISSION_KEYS, CONFIGURABLE_ROLES, defaultsFor, sanitizeKeys,
} from '../utils/permissionCatalog.js'

// Short-lived cache so every guarded request doesn't re-read the Gym. A change
// saved through this process is visible immediately (invalidatePermissions);
// on a multi-server deployment other servers pick it up within TTL.
const TTL_MS = 30_000
const cache = new Map() // gymId -> { at, roles }

/** { manager: [keys], receptionist: [keys], trainer: [keys] } for this gym. */
export async function getRolePermissions(gymId) {
  const id = String(gymId)
  const hit = cache.get(id)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.roles

  const gym = await Gym.findById(gymId).select('settings.rolePermissions').lean()
  const stored = gym?.settings?.rolePermissions || {}
  const roles = {}
  for (const role of CONFIGURABLE_ROLES) {
    // Never customised → built-in defaults. Customised (even to nothing) → exactly what was saved.
    roles[role] = Array.isArray(stored[role]) ? sanitizeKeys(stored[role]) : defaultsFor(role)
  }
  cache.set(id, { at: Date.now(), roles })
  return roles
}

/** Everything `role` may do in this gym. The owner always has everything. */
export async function getEffectivePermissions(gymId, role) {
  if (role === 'owner') return [...PERMISSION_KEYS]
  const roles = await getRolePermissions(gymId)
  return roles[role] || []
}

export function invalidatePermissions(gymId) { cache.delete(String(gymId)) }

/** Route guard: use after `protect`, in place of a hard-coded authorize(...). */
export function permit(key) {
  const label = PERMISSIONS.find((p) => p.key === key)?.label?.toLowerCase() || key
  return async (req, res, next) => {
    try {
      const allowed = await getEffectivePermissions(req.gymId, req.user.role)
      if (allowed.includes(key)) return next()
      return res.status(403).json({
        message: `Your role isn\u2019t allowed to ${label}. The gym owner can change this under Security \u2192 Permissions.`,
      })
    } catch (err) { next(err) }
  }
}
