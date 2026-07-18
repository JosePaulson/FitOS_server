import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import MemberPTPlan from '../models/MemberPTPlan.js'
import PTPlan from '../models/PTPlan.js'
import { protect, authorize } from '../middleware/auth.js'
import { syncMemberPTPlans } from '../services/ptPlanSync.service.js'

const router = Router()

function validate(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) { res.status(400).json({ message: errors.array()[0].msg }); return false }
  return true
}

/** GET /api/member-pt-plans?memberId=... — assignments (optionally filtered to one member) */
router.get('/', protect, async (req, res, next) => {
  try {
    const filter = { gymId: req.gymId }
    if (req.query.memberId) filter.memberId = req.query.memberId
    if (req.query.status) filter.status = req.query.status
    const assignments = await MemberPTPlan.find(filter)
      .populate('memberId', 'name phone photo')
      .populate('trainerId', 'name')
      .sort({ createdAt: -1 })
      .limit(Number(req.query.limit) || 200)
    res.json(assignments)
  } catch (err) { next(err) }
})

/** POST /api/member-pt-plans — assign a catalog PT plan to a member */
router.post('/', protect, authorize('owner', 'manager', 'trainer'),
  [
    body('memberId').notEmpty().withMessage('Member required'),
    body('ptPlanId').notEmpty().withMessage('PT plan required'),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return
    try {
      const { memberId, ptPlanId, trainerId, startDate } = req.body
      const template = await PTPlan.findOne({ _id: ptPlanId, gymId: req.gymId })
      if (!template) return res.status(404).json({ message: 'PT plan not found' })

      const start = startDate ? new Date(startDate) : new Date()
      const expiry = new Date(start)
      expiry.setDate(expiry.getDate() + template.durationDays)

      const assignment = await MemberPTPlan.create({
        gymId: req.gymId,
        memberId,
        ptPlanId: template._id,
        name: template.name,
        target: template.target,
        fee: template.fee,
        classesTotal: template.numberOfClasses,
        trainerId: trainerId || template.trainerId || undefined,
        startDate: start,
        expiryDate: expiry,
      })
      await assignment.populate('memberId', 'name phone photo')
      await assignment.populate('trainerId', 'name')

      // Covers assigning a plan retroactively over sessions that were
      // already completed within its date window.
      syncMemberPTPlans(req.gymId, memberId).catch((e) => console.error('[pt-plan-sync] assign failed:', e.message))

      res.status(201).json(assignment)
    } catch (err) { next(err) }
  }
)

/** PATCH /api/member-pt-plans/:id — reassign trainer / adjust dates */
router.patch('/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const allowed = ['trainerId', 'expiryDate', 'status']
    const updates = {}
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k] })
    const assignment = await MemberPTPlan.findOneAndUpdate({ _id: req.params.id, gymId: req.gymId }, updates, { new: true, runValidators: true })
      .populate('memberId', 'name phone photo')
      .populate('trainerId', 'name')
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' })
    res.json(assignment)
  } catch (err) { next(err) }
})

/** DELETE /api/member-pt-plans/:id — cancel an assignment */
router.delete('/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const assignment = await MemberPTPlan.findOneAndUpdate(
      { _id: req.params.id, gymId: req.gymId },
      { status: 'cancelled' },
      { new: true }
    )
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' })
    res.json({ message: 'PT plan cancelled' })
  } catch (err) { next(err) }
})

export default router
