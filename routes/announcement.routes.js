import { Router } from 'express'
import Announcement from '../models/Announcement.js'
import Notification from '../models/Notification.js'
import { protect } from '../middleware/auth.js'
import { permit } from '../services/permissions.service.js'
import { createAnnouncement, AUDIENCES } from '../services/announcement.service.js'

const router = Router()

// GET /api/announcements — recent broadcasts
router.get('/', protect, async (req, res, next) => {
  try { res.json(await Announcement.find({ gymId: req.gymId }).sort({ createdAt: -1 }).limit(50)) } catch (err) { next(err) }
})

// POST /api/announcements — { title, body, audience: all|active|expiring|expired }
router.post('/', protect, permit('engagement.manage'), async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim(), body = String(req.body.body || '').trim()
    if (!title || !body) return res.status(400).json({ message: 'A title and a message are required' })
    if (title.length > 80) return res.status(400).json({ message: 'Keep the title under 80 characters' })
    if (body.length > 500) return res.status(400).json({ message: 'Keep the message under 500 characters' })
    const audience = AUDIENCES.includes(req.body.audience) ? req.body.audience : 'active'

    const ann = await createAnnouncement({ gymId: req.gymId, title, body, audience, createdBy: req.user._id, createdByName: req.user.name })
    res.status(201).json(ann)
  } catch (err) { next(err) }
})

// DELETE /api/announcements/:id — retracts it from members' inboxes too
router.delete('/:id', protect, permit('engagement.manage'), async (req, res, next) => {
  try {
    const ann = await Announcement.findOneAndDelete({ _id: req.params.id, gymId: req.gymId })
    if (!ann) return res.status(404).json({ message: 'Announcement not found' })
    await Notification.deleteMany({ gymId: req.gymId, announcementId: ann._id })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

export default router
