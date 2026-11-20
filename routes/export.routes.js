import { Router } from 'express'
import Gym from '../models/Gym.js'
import { protect, authorize } from '../middleware/auth.js'
import { DATASETS, buildCsv, streamBackup } from '../services/export.service.js'

const router = Router()
// Owner only, and not configurable: these files contain every member's personal data.
router.use(protect, authorize('owner'))

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) // YYYY-MM-DD

// GET /api/export — which datasets can be downloaded
router.get('/', (req, res) => {
  res.json({ datasets: Object.entries(DATASETS).map(([key, d]) => ({ key, label: d.label })) })
})

// GET /api/export/backup — everything, as one JSON file (streamed)
router.get('/backup', async (req, res, next) => {
  try {
    const gym = await Gym.findById(req.gymId).select('name subdomain').lean()
    const slug = String(gym?.subdomain || gym?.name || 'gym').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="fitos-backup-${slug}-${today()}.json"`)
    await streamBackup(req.gymId, res)
  } catch (err) {
    if (res.headersSent) { console.error('[export] backup failed mid-stream:', err.message); res.end() } else next(err)
  }
})

// GET /api/export/:dataset?from=YYYY-MM-DD&to=YYYY-MM-DD — one dataset as CSV
router.get('/:dataset', async (req, res, next) => {
  try {
    const out = await buildCsv(req.params.dataset, req.gymId, req.query)
    if (!out) return res.status(404).json({ message: 'Unknown dataset' })
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="fitos-${req.params.dataset}-${today()}.csv"`)
    res.send(out.csv)
  } catch (err) { next(err) }
})

export default router
