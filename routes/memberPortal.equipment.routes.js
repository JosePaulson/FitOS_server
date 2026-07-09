import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import Equipment from '../models/Equipment.js'

const router = Router()
router.use(memberProtect)

// GET /api/member-portal/equipment — read-only, for the member's "Equipment" page
router.get('/', async (req, res, next) => {
  try {
    const { category } = req.query
    const filter = { gymId: req.gymId, isActive: true }
    if (category) filter.category = category
    const equipment = await Equipment.find(filter).sort({ name: 1 })
    res.json(equipment)
  } catch (err) { next(err) }
})

export default router
