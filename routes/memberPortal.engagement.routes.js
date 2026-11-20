import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import Member from '../models/Member.js'
import Challenge from '../models/Challenge.js'
import { overviewFor, challengeProgress, challengeIsLive, leaderboard, istDay, dayStr, monthBounds } from '../services/engagement.service.js'

const router = Router()
router.use(memberProtect)

const loadMember = (req) => Member.findOne({ _id: req.memberId, gymId: req.gymId }).select('gymId name weeklyGoal hideFromLeaderboard')

// GET /api/member-portal/engagement/overview — streak, weekly goal, badges, this month's visits
router.get('/overview', async (req, res, next) => {
  try {
    const member = await loadMember(req)
    if (!member) return res.status(404).json({ message: 'Member not found' })
    res.json({ ...(await overviewFor(member)), settings: { weeklyGoal: member.weeklyGoal || 3, hideFromLeaderboard: !!member.hideFromLeaderboard } })
  } catch (err) { next(err) }
})

// PATCH /api/member-portal/engagement/settings — { weeklyGoal?: 1–7, hideFromLeaderboard?: boolean }
router.patch('/settings', async (req, res, next) => {
  try {
    const $set = {}
    if (req.body.weeklyGoal !== undefined) {
      const n = Number(req.body.weeklyGoal)
      if (!Number.isInteger(n) || n < 1 || n > 7) return res.status(400).json({ message: 'Weekly goal must be between 1 and 7 days' })
      $set.weeklyGoal = n
    }
    if (req.body.hideFromLeaderboard !== undefined) $set.hideFromLeaderboard = !!req.body.hideFromLeaderboard
    if (!Object.keys($set).length) return res.status(400).json({ message: 'Nothing to update' })
    await Member.updateOne({ _id: req.memberId, gymId: req.gymId }, { $set })
    res.json({ ok: true, ...$set })
  } catch (err) { next(err) }
})

// GET /api/member-portal/engagement/challenges — live, upcoming, and recently ended, with my progress
router.get('/challenges', async (req, res, next) => {
  try {
    const today = istDay(new Date())
    const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    const list = await Challenge.find({ gymId: req.gymId, isActive: true, endDate: { $gte: cutoff } }).sort({ endDate: 1 }).lean()
    const out = []
    for (const c of list) {
      const start = dayStr(c.startDate), end = dayStr(c.endDate)
      const status = today < start ? 'upcoming' : today > end ? 'ended' : 'live'
      const progress = status === 'upcoming' ? { count: 0, target: c.target, percent: 0, completed: false } : await challengeProgress(c, req.memberId)
      const daysLeft = status === 'live' ? Math.max(0, Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86_400_000)) : null
      out.push({ _id: c._id, title: c.title, description: c.description, metric: c.metric, target: c.target, reward: c.reward, startDate: start, endDate: end, status, daysLeft, ...progress })
    }
    const rank = { live: 0, upcoming: 1, ended: 2 }
    res.json(out.sort((a, b) => rank[a.status] - rank[b.status]))
  } catch (err) { next(err) }
})

// GET /api/member-portal/engagement/leaderboard[?challengeId=] — this month's visits, or a challenge's board
router.get('/leaderboard', async (req, res, next) => {
  try {
    let metric = 'visits', title = 'This month', { from, to } = monthBounds(istDay(new Date()))
    if (req.query.challengeId) {
      const c = /^[a-f0-9]{24}$/.test(req.query.challengeId) && await Challenge.findOne({ _id: req.query.challengeId, gymId: req.gymId }).lean()
      if (!c) return res.status(404).json({ message: 'Challenge not found' })
      metric = c.metric; title = c.title; from = dayStr(c.startDate); to = dayStr(c.endDate)
    }
    const board = await leaderboard({ gymId: req.gymId, metric, from, to, limit: 10, anonymize: true, meId: req.memberId })
    res.json({ title, metric, from, to, ...board })
  } catch (err) { next(err) }
})

export default router
