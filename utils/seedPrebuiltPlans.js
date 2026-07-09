import WorkoutPlan from '../models/WorkoutPlan.js'
import DietPlan    from '../models/DietPlan.js'
import { PREBUILT_WORKOUT_PLANS, PREBUILT_DIET_PLANS } from '../data/prebuiltPlans.js'

/**
 * Seeds the curated prebuilt workout & diet plan library into a gym, as
 * normal isTemplate:true documents owned by that gym (not shared/global —
 * this keeps every gym's data fully tenant-isolated, and lets a gym freely
 * edit or delete its own copy without affecting anyone else).
 *
 * Matches by plan name per gym rather than an all-or-nothing "does this gym
 * have ANY templates" check — that matters because it means adding a new
 * plan to PREBUILT_WORKOUT_PLANS / PREBUILT_DIET_PLANS later (as this
 * library grows) automatically backfills to gyms that already seeded an
 * earlier version, the next time seeding runs (registration of a new gym
 * doesn't re-run this for existing gyms, but the "Load starter plans"
 * button and the standalone script both call this and will correctly only
 * add what's missing, never duplicating what's already there).
 *
 * @param {string|ObjectId} gymId
 * @returns {Promise<{ workoutsAdded: number, dietsAdded: number }>}
 */
export async function seedPrebuiltPlansForGym(gymId) {
  const [existingWorkoutNames, existingDietNames] = await Promise.all([
    WorkoutPlan.find({ gymId, isTemplate: true }).distinct('name'),
    DietPlan.find({ gymId, isTemplate: true }).distinct('name'),
  ])

  const workoutsToAdd = PREBUILT_WORKOUT_PLANS.filter((p) => !existingWorkoutNames.includes(p.name))
  const dietsToAdd    = PREBUILT_DIET_PLANS.filter((p) => !existingDietNames.includes(p.name))

  if (workoutsToAdd.length) {
    await WorkoutPlan.insertMany(workoutsToAdd.map((p) => ({ ...p, gymId, isTemplate: true })))
  }
  if (dietsToAdd.length) {
    await DietPlan.insertMany(dietsToAdd.map((p) => ({ ...p, gymId, isTemplate: true })))
  }

  return { workoutsAdded: workoutsToAdd.length, dietsAdded: dietsToAdd.length }
}
