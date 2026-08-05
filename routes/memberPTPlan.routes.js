import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import MemberPTPlan from '../models/MemberPTPlan.js'
import PTPlan from '../models/PTPlan.js'
import { protect, authorize } from '../middleware/auth.js'
import { syncMemberPTPlans } from '../services/ptPlanSync.service.js'
import { istDateKey, istDateTime, istEndOfDay, istAddDays, todayISTKey } from '../utils/dateIST.js'

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

      const startKey = startDate ? istDateKey(startDate) : todayISTKey()
      const expiryKey = istAddDays(startKey, template.durationDays)
      // Store whole IST calendar days: 00:00:00.000 on the start date through
      // 23:59:59.999 on the expiry date. If we instead stored exact clock
      // instants (e.g. "now"), a session completed later in the day than
      // that instant — on the very same calendar date — would fall outside
      // this window and silently not count toward the plan's classes used.
      const start = istDateTime(startKey, '00:00')
      const expiry = istEndOfDay(istDateTime(expiryKey, '00:00'))

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

/** PATCH /api/member-pt-plans/:id — reassign trainer / adjust start & expiry dates */
router.patch('/:id', protect, authorize('owner', 'manager'), async (req, res, next) => {
  try {
    const allowed = ['trainerId', 'startDate', 'expiryDate', 'status']
    const updates = {}
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k] })
    // Dates come from a plain <input type="date"> (date-only string), which
    // Mongoose would otherwise cast to 00:00:00 UTC of that date — 5:30am
    // IST, not IST midnight. Anchor both ends to whole IST calendar days
    // (expiryDate through end-of-day) so a session that happened any time
    // on the expiry date still falls inside the window used for counting
    // classes used.
    if (updates.startDate) updates.startDate = istDateTime(istDateKey(updates.startDate), '00:00')
    if (updates.expiryDate) updates.expiryDate = istEndOfDay(istDateTime(istDateKey(updates.expiryDate), '00:00'))

    const assignment = await MemberPTPlan.findOneAndUpdate({ _id: req.params.id, gymId: req.gymId }, updates, { new: true, runValidators: true })
      .populate('memberId', 'name phone photo')
      .populate('trainerId', 'name')
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' })

    // Changing the window can bring previously out-of-range sessions back
    // in (or push in-range ones out), so re-derive classesUsed to match.
    // This must be awaited — the frontend uses this response directly to
    // update the progress bar, so a fire-and-forget sync here would leave
    // the caller looking at the pre-edit count until their next full reload.
    let responseBody = assignment
    if (updates.startDate || updates.expiryDate || updates.status) {
      try {
        await syncMemberPTPlans(req.gymId, assignment.memberId._id)
        responseBody = await MemberPTPlan.findById(assignment._id)
          .populate('memberId', 'name phone photo')
          .populate('trainerId', 'name')
      } catch (e) {
        console.error('[pt-plan-sync] date edit failed:', e.message)
      }
    }

    res.json(responseBody)
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
