import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import Notification from '../models/Notification.js'

const router = Router()
router.use(memberProtect)

// GET /api/member-portal/notifications?limit=30&before=<ISO date> — newest first, plus the unread count
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30))
    const filter = { memberId: req.memberId }
    if (req.query.before && !Number.isNaN(new Date(req.query.before).getTime())) filter.createdAt = { $lt: new Date(req.query.before) }
    const [items, unread] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).limit(limit + 1).lean(),
      Notification.countDocuments({ memberId: req.memberId, readAt: null }),
    ])
    const hasMore = items.length > limit
    res.json({ items: items.slice(0, limit), unread, hasMore })
  } catch (err) { next(err) }
})

// GET /api/member-portal/notifications/unread-count — cheap, for the bell badge
router.get('/unread-count', async (req, res, next) => {
  try { res.json({ unread: await Notification.countDocuments({ memberId: req.memberId, readAt: null }) }) } catch (err) { next(err) }
})

// POST /api/member-portal/notifications/read — { ids: [...] } or { all: true }
router.post('/read', async (req, res, next) => {
  try {
    const filter = { memberId: req.memberId, readAt: null }
    if (!req.body.all) {
      const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).filter((i) => /^[a-f0-9]{24}$/.test(i))
      if (!ids.length) return res.status(400).json({ message: 'Nothing to mark as read' })
      filter._id = { $in: ids }
    }
    const r = await Notification.updateMany(filter, { $set: { readAt: new Date() } })
    res.json({ ok: true, marked: r.modifiedCount ?? 0 })
  } catch (err) { next(err) }
})

// DELETE /api/member-portal/notifications — clear the inbox
router.delete('/', async (req, res, next) => {
  try { await Notification.deleteMany({ memberId: req.memberId }); res.json({ ok: true }) } catch (err) { next(err) }
})

export default router
