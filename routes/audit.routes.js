import { Router } from 'express'
import AuditLog from '../models/AuditLog.js'
import { protect, authorize } from '../middleware/auth.js'

const router = Router()
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * GET /api/audit-logs — owner only.
 * ?page &limit(≤100) &action (exact, or a prefix ending in '.') &actorId &entityType &from &to &q (text in the summary)
 */
router.get('/', protect, authorize('owner'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50))
    const filter = { gymId: req.gymId }

    const { action, actorId, entityType, from, to, q } = req.query
    if (action) filter.action = String(action).endsWith('.') ? new RegExp(`^${escapeRe(String(action))}`) : String(action)
    if (actorId && /^[a-f0-9]{24}$/.test(actorId)) filter.actorId = actorId
    if (entityType) filter.entityType = String(entityType)
    if (q) filter.summary = new RegExp(escapeRe(String(q).slice(0, 80)), 'i')
    if (from || to) {
      filter.createdAt = {}
      if (from && !Number.isNaN(new Date(from).getTime())) filter.createdAt.$gte = new Date(from)
      if (to && !Number.isNaN(new Date(to).getTime())) { const e = new Date(to); e.setHours(23, 59, 59, 999); filter.createdAt.$lte = e }
      if (!Object.keys(filter.createdAt).length) delete filter.createdAt
    }

    const [logs, total, actions, actors] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AuditLog.countDocuments(filter),
      AuditLog.distinct('action', { gymId: req.gymId }),
      AuditLog.aggregate([
        { $match: { gymId: req.gymId, actorId: { $exists: true } } },
        { $group: { _id: '$actorId', name: { $last: '$actorName' } } },
        { $sort: { name: 1 } },
      ]),
    ])
    res.json({ logs, total, page, pages: Math.max(1, Math.ceil(total / limit)), actions: actions.sort(), actors })
  } catch (err) { next(err) }
})

export default router
