import { Router } from 'express'
import Challenge from '../models/Challenge.js'
import { protect } from '../middleware/auth.js'
import { permit } from '../services/permissions.service.js'
import { leaderboard, dayStr } from '../services/engagement.service.js'
import { createAnnouncement } from '../services/announcement.service.js'

const router = Router()
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const toDay = (v) => { const s = String(v || '').slice(0, 10); return DAY_RE.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) ? s : null }

// GET /api/challenges
router.get('/', protect, async (req, res, next) => {
  try { res.json(await Challenge.find({ gymId: req.gymId }).sort({ endDate: -1 }).limit(100)) } catch (err) { next(err) }
})

// POST /api/challenges — { title, description?, metric: visits|workouts, target, startDate, endDate, reward?, announce?: boolean }
router.post('/', protect, permit('engagement.manage'), async (req, res, next) => {
  try {
    const { title, description, metric, reward } = req.body
    const target = Number(req.body.target)
    const start = toDay(req.body.startDate), end = toDay(req.body.endDate)
    if (!String(title || '').trim()) return res.status(400).json({ message: 'A title is required' })
    if (!['visits', 'workouts'].includes(metric)) return res.status(400).json({ message: 'Choose what to count: gym visits or logged workouts' })
    if (!Number.isInteger(target) || target < 1) return res.status(400).json({ message: 'The target must be a whole number of 1 or more' })
    if (!start || !end) return res.status(400).json({ message: 'Start and end dates are required' })
    if (end < start) return res.status(400).json({ message: 'The end date must be on or after the start date' })

    const c = await Challenge.create({
      gymId: req.gymId, title: String(title).trim(), description: description?.trim() || undefined, metric, target,
      startDate: new Date(`${start}T00:00:00Z`), endDate: new Date(`${end}T00:00:00Z`),
      reward: reward?.trim() || undefined, createdBy: req.user._id,
    })

    if (req.body.announce) {
      await createAnnouncement({
        gymId: req.gymId, audience: 'active', createdBy: req.user._id, createdByName: req.user.name,
        title: `New challenge: ${c.title}`.slice(0, 80),
        body: `${target} ${metric === 'visits' ? 'gym visits' : 'logged workouts'} between ${start} and ${end}.${c.reward ? ` Reward: ${c.reward}.` : ''}`.slice(0, 500),
      }).catch((e) => console.error('[challenge] announce failed:', e.message))
    }
    res.status(201).json(c)
  } catch (err) { next(err) }
})

// PATCH /api/challenges/:id — title, description, target, endDate, reward, isActive (the metric and start date are fixed once created)
router.patch('/:id', protect, permit('engagement.manage'), async (req, res, next) => {
  try {
    const c = await Challenge.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!c) return res.status(404).json({ message: 'Challenge not found' })
    for (const k of ['title', 'description', 'reward']) if (req.body[k] !== undefined) c[k] = String(req.body[k]).trim() || undefined
    if (req.body.target !== undefined) {
      const t = Number(req.body.target)
      if (!Number.isInteger(t) || t < 1) return res.status(400).json({ message: 'The target must be a whole number of 1 or more' })
      c.target = t
    }
    if (req.body.endDate !== undefined) {
      const e = toDay(req.body.endDate)
      if (!e || e < dayStr(c.startDate)) return res.status(400).json({ message: 'The end date must be on or after the start date' })
      c.endDate = new Date(`${e}T00:00:00Z`)
    }
    if (req.body.isActive !== undefined) c.isActive = !!req.body.isActive
    await c.save()
    res.json(c)
  } catch (err) { next(err) }
})

// DELETE /api/challenges/:id — badges members already earned stay with them
router.delete('/:id', protect, permit('engagement.manage'), async (req, res, next) => {
  try {
    const c = await Challenge.findOneAndDelete({ _id: req.params.id, gymId: req.gymId })
    if (!c) return res.status(404).json({ message: 'Challenge not found' })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// GET /api/challenges/:id/leaderboard — full names, including members who opted out of the member-facing board
router.get('/:id/leaderboard', protect, async (req, res, next) => {
  try {
    const c = await Challenge.findOne({ _id: req.params.id, gymId: req.gymId }).lean()
    if (!c) return res.status(404).json({ message: 'Challenge not found' })
    const board = await leaderboard({ gymId: req.gymId, metric: c.metric, from: dayStr(c.startDate), to: dayStr(c.endDate), limit: 20, anonymize: false })
    res.json({ challenge: { _id: c._id, title: c.title, target: c.target, metric: c.metric }, ...board })
  } catch (err) { next(err) }
})

export default router
