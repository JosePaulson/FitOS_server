import { Router } from 'express'
import Gym from '../models/Gym.js'
import { protect, authorize } from '../middleware/auth.js'
import { getRolePermissions, getEffectivePermissions, invalidatePermissions } from '../services/permissions.service.js'
import { PERMISSIONS, CONFIGURABLE_ROLES, defaultsFor, sanitizeKeys } from '../utils/permissionCatalog.js'

const router = Router()

// GET /api/permissions/me — what the signed-in staff member can do (drives the UI)
router.get('/me', protect, async (req, res, next) => {
  try { res.json({ access: await getEffectivePermissions(req.gymId, req.user.role) }) } catch (err) { next(err) }
})

// GET /api/permissions — owner: the catalogue plus each role's current permissions
router.get('/', protect, authorize('owner'), async (req, res, next) => {
  try {
    res.json({
      catalog: PERMISSIONS.map(({ key, label, description }) => ({ key, label, description })),
      roles: await getRolePermissions(req.gymId),
      defaults: Object.fromEntries(CONFIGURABLE_ROLES.map((r) => [r, defaultsFor(r)])),
      configurableRoles: CONFIGURABLE_ROLES,
    })
  } catch (err) { next(err) }
})

// PUT /api/permissions — owner: { roles: { manager: [keys], receptionist: [keys], trainer: [keys] } }
router.put('/', protect, authorize('owner'), async (req, res, next) => {
  try {
    const incoming = req.body?.roles
    if (!incoming || typeof incoming !== 'object') return res.status(400).json({ message: 'roles required' })
    const $set = {}
    for (const role of CONFIGURABLE_ROLES) {
      if (incoming[role] !== undefined) $set[`settings.rolePermissions.${role}`] = sanitizeKeys(incoming[role])
    }
    if (!Object.keys($set).length) return res.status(400).json({ message: 'Nothing to update' })
    await Gym.updateOne({ _id: req.gymId }, { $set })
    invalidatePermissions(req.gymId)
    res.json({ roles: await getRolePermissions(req.gymId) })
  } catch (err) { next(err) }
})

// POST /api/permissions/reset — owner: back to the built-in defaults
router.post('/reset', protect, authorize('owner'), async (req, res, next) => {
  try {
    await Gym.updateOne({ _id: req.gymId }, { $unset: { 'settings.rolePermissions': '' } })
    invalidatePermissions(req.gymId)
    res.json({ roles: await getRolePermissions(req.gymId) })
  } catch (err) { next(err) }
})

export default router
