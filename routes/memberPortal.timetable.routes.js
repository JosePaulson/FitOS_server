import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import TimetableSlot from '../models/TimetableSlot.js'
import MemberPTPlan from '../models/MemberPTPlan.js'
import { isPastCancellationDeadline } from '../utils/dateIST.js'

const router = Router()
router.use(memberProtect)

const TRAINER_POPULATE = { path: 'trainerId', select: 'name' }
const MEMBER_POPULATE = { path: 'memberId', select: 'name' }
const PLAN_POPULATE = { path: 'memberPTPlanId', select: 'name' }

// "All members with active pt-plan can see timetable" — every route below
// is gated on this.
async function requireActivePTPlans(req, res) {
  const plans = await MemberPTPlan.find({ gymId: req.gymId, memberId: req.memberId, status: 'active' })
    .select('name trainerId')
    .populate('trainerId', 'name')
  if (plans.length === 0) {
    res.status(403).json({ message: 'You need an active PT plan to view the timetable.' })
    return null
  }
  return plans
}

// Shapes a slot for a member's eyes — hides who else requested an open
// slot (just flags that it's taken), but tells the member plainly whether
// the booked slot or pending request is their own.
function toMemberView(slot, memberId) {
  const isMine = slot.memberId && String(slot.memberId._id) === String(memberId)
  const myRequest = slot.pendingRequest?.memberId && String(slot.pendingRequest.memberId) === String(memberId)
  return {
    _id: slot._id,
    trainerId: slot.trainerId,
    weekday: slot.weekday,
    startTime: slot.startTime,
    endTime: slot.endTime,
    status: slot.status,
    member: slot.status === 'booked'
      ? { name: slot.memberId?.name, isMine, plan: slot.memberPTPlanId?.name || null }
      : null,
    hasPendingRequest: !!slot.pendingRequest?.memberId,
    myPendingRequest: myRequest,
  }
}

// ── GET /api/member-portal/timetable ────────────────────────────────────────
// Only ever returns the member's OWN booked slots plus open slots — other
// members' bookings are never sent to this client at all (not just hidden
// in the UI), both for privacy and so the day-tab open-slot counts add up
// correctly without extra client-side filtering.
router.get('/', async (req, res, next) => {
  try {
    const activePlans = await requireActivePTPlans(req, res)
    if (!activePlans) return

    const slots = await TimetableSlot.find({ gymId: req.gymId })
      .sort({ weekday: 1, startTime: 1 })
      .populate(TRAINER_POPULATE)
      .populate(MEMBER_POPULATE)
      .populate(PLAN_POPULATE)

    const visible = slots
      .map((s) => toMemberView(s, req.memberId))
      .filter((s) => s.status === 'empty' || s.member?.isMine)

    res.json({
      slots: visible,
      myActivePlans: activePlans.map((p) => ({ _id: p._id, name: p.name, trainerId: p.trainerId })),
    })
  } catch (err) { next(err) }
})

// ── POST /api/member-portal/timetable/:id/request ───────────────────────────
// Request an open slot elsewhere in the timetable — "other members to
// request slot if empty slots available".
router.post('/:id/request', async (req, res, next) => {
  try {
    const activePlans = await requireActivePTPlans(req, res)
    if (!activePlans) return

    const slot = await TimetableSlot.findOne({ _id: req.params.id, gymId: req.gymId })
    if (!slot) return res.status(404).json({ message: 'Slot not found' })
    if (slot.status !== 'empty') {
      return res.status(400).json({ message: 'This slot is no longer open' })
    }
    if (slot.pendingRequest?.memberId) {
      return res.status(409).json({ message: 'Someone already requested this slot — try another' })
    }

    let memberPTPlanId = req.body.memberPTPlanId || null
    if (memberPTPlanId) {
      const owns = activePlans.some((p) => String(p._id) === String(memberPTPlanId))
      if (!owns) return res.status(400).json({ message: "That PT plan isn't yours or isn't active" })
    } else if (activePlans.length === 1) {
      memberPTPlanId = activePlans[0]._id
    } else {
      return res.status(400).json({ message: 'Choose which of your PT plans this session is for' })
    }

    slot.pendingRequest = { memberId: req.memberId, memberPTPlanId, requestedAt: new Date() }
    await slot.save()
    await slot.populate([TRAINER_POPULATE, MEMBER_POPULATE, PLAN_POPULATE])

    res.json(toMemberView(slot, req.memberId))
  } catch (err) { next(err) }
})

// ── POST /api/member-portal/timetable/:id/cancel-request ───────────────────
// Withdraw a request that hasn't been decided on yet.
router.post('/:id/cancel-request', async (req, res, next) => {
  try {
    const slot = await TimetableSlot.findOne({
      _id: req.params.id,
      gymId: req.gymId,
      'pendingRequest.memberId': req.memberId,
    })
    if (!slot) return res.status(404).json({ message: 'Request not found' })

    slot.pendingRequest = undefined
    await slot.save()
    await slot.populate([TRAINER_POPULATE, MEMBER_POPULATE, PLAN_POPULATE])

    res.json(toMemberView(slot, req.memberId))
  } catch (err) { next(err) }
})

// ── POST /api/member-portal/timetable/:id/empty ─────────────────────────────
// A member gives up their own recurring slot — "members to mark slot
// empty (their own slots)", subject to the same 2-hour cutoff as a trainer
// clearing it.
router.post('/:id/empty', async (req, res, next) => {
  try {
    const activePlans = await requireActivePTPlans(req, res)
    if (!activePlans) return

    const slot = await TimetableSlot.findOne({ _id: req.params.id, gymId: req.gymId, memberId: req.memberId })
    if (!slot) return res.status(404).json({ message: 'Slot not found or not yours' })

    if (isPastCancellationDeadline(slot.weekday, slot.startTime)) {
      return res.status(400).json({ message: 'You can only cancel a slot at least 2 hours before it starts' })
    }

    slot.memberId = null
    slot.memberPTPlanId = null
    slot.status = 'empty'
    await slot.save()
    await slot.populate([TRAINER_POPULATE, MEMBER_POPULATE, PLAN_POPULATE])

    res.json(toMemberView(slot, req.memberId))
  } catch (err) { next(err) }
})

export default router
