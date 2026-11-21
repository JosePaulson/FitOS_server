/**
 * Who on staff may see a member's self-kept workout / meal logs.
 *
 * The member decides (Member.logSharing): each log type is either shared or
 * not. If shared, the owner and managers ("the gym") can see it, plus any
 * trainer the member explicitly picked. If not shared, nobody on staff can.
 */
export const GYM_ROLES = ['owner', 'manager']
export const SHARE_FIELD = { workout: 'workoutLogs', meal: 'mealLogs' }

/** kind: 'workout' | 'meal'. `user` is the signed-in staff user. */
export function canViewLogs(member, user, kind) {
  const sharing = member?.logSharing || {}
  if (!sharing[SHARE_FIELD[kind]]) return false
  if (GYM_ROLES.includes(user.role)) return true
  if (user.role === 'trainer') return (sharing.trainerIds || []).some((id) => String(id) === String(user._id))
  return false
}
