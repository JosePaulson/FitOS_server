import { Types } from 'mongoose'
import MemberWorkoutLog from '../models/MemberWorkoutLog.js'
import PTSession from '../models/PTSession.js'
import Member from '../models/Member.js'
import ExerciseCategory from '../models/ExerciseCategory.js'
import { estimateCaloriesBurned } from '../utils/calories.js'
import { istStartOfDay, istEndOfDay } from '../utils/dateIST.js'
import { notifyNewPRs } from './progress.service.js'
import { evaluateEngagement } from './engagement.service.js'

/**
 * Estimate calories the same way PT sessions do — filling in a bodyweight
 * from the member's most recent logged entry (across BOTH self-logged
 * workouts and PT sessions) if this one doesn't have one yet.
 */
export async function resolveCalories({ gymId, memberId, excludeId, bodyWeight, durationMinutes, exercises }) {
  let weightKg = Number(bodyWeight) || null

  if (!weightKg) {
    const [lastLog, lastSession] = await Promise.all([
      MemberWorkoutLog.findOne({
        gymId, memberId, bodyWeight: { $exists: true, $ne: null },
        ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      }).sort({ date: -1 }).select('bodyWeight date'),
      PTSession.findOne({
        gymId, memberId, bodyWeight: { $exists: true, $ne: null },
      }).sort({ date: -1 }).select('bodyWeight date'),
    ])
    const candidates = [lastLog, lastSession].filter(Boolean).sort((a, b) => new Date(b.date) - new Date(a.date))
    weightKg = candidates[0]?.bodyWeight || null
  }
  if (!weightKg) return null

  const member = await Member.findOne({ _id: memberId, gymId }).select('height')
  return estimateCaloriesBurned({ heightCm: member?.height, weightKg, durationMinutes, exercises })
}

/** Same sanitising the workout-log routes apply to client-sent exercises. */
export function cleanExercises(exercises) {
  if (!Array.isArray(exercises)) return []
  return exercises.filter((e) => e?.name?.trim()).map((e) => ({
    name: String(e.name).slice(0, 120),
    sets: e.sets !== undefined && e.sets !== null && e.sets !== '' ? Number(e.sets) : undefined,
    reps: e.reps !== undefined && e.reps !== null && e.reps !== '' ? String(e.reps).slice(0, 20) : undefined,
    weight: e.weight !== undefined && e.weight !== null && e.weight !== '' ? Number(e.weight) : undefined,
    muscleGroup: e.muscleGroup ? String(e.muscleGroup).slice(0, 30) : undefined,
  }))
}

/** key → display label for the gym's categories (falls back to a capitalised key). */
export async function categoryLabelMap(gymId) {
  const cats = await ExerciseCategory.find({ gymId }).select('key label').lean()
  return new Map(cats.map((c) => [c.key, c.label]))
}

const labelOf = (key, labels) => labels?.get(key) || (key ? key.charAt(0).toUpperCase() + key.slice(1) : '')

/** Category labels in first-appearance order: ['Chest', 'Shoulders']. */
export function categoryLabels(exercises, labels) {
  const keys = []
  for (const e of exercises || []) if (e?.muscleGroup && !keys.includes(e.muscleGroup)) keys.push(e.muscleGroup)
  return keys.map((k) => labelOf(k, labels))
}

/** "Chest", "Chest/Shoulders", … — or plain "Workout" when nothing is tagged. */
export function autoTitle(exercises, labels) {
  return categoryLabels(exercises, labels).join('/') || 'Workout'
}

/**
 * Turns a finished Workout Videos session (kept on the member's device until
 * they chose to log it) into a real workout log — WITHOUT ever creating a
 * second log for the same day:
 *   • if the member already has a log on the workout's IST calendar day, the
 *     session's exercises are appended to it (earliest log of that day if
 *     there are several), its duration grows by the session's, and body
 *     weight is set when one was entered;
 *   • otherwise a new log is created, dated at the workout's start.
 * The title is regenerated from every category in the log ("Chest/Shoulders")
 * unless the member gave the existing log a custom title, which is kept.
 *
 * `sessionId` makes this safe to retry: if the same session was already
 * merged (first request landed, response got lost), the existing log is
 * returned untouched instead of appending the exercises again.
 */
export async function logOrAppendWorkout({
  gymId, memberId, sessionId, exercises: rawExercises, startedAt, lastActivityAt, bodyWeight,
}) {
  const exercises = cleanExercises(rawExercises)

  if (sessionId) {
    const already = await MemberWorkoutLog.findOne({ gymId, memberId, videoSessionIds: sessionId })
    if (already) return { log: already, appended: true, duplicate: true }
  }

  const draftMinutes = Math.min(180, Math.max(5, Math.round((new Date(lastActivityAt) - new Date(startedAt)) / 60000) || 5))
  const labels = await categoryLabelMap(gymId)

  const existing = await MemberWorkoutLog.findOne({
    gymId, memberId,
    date: { $gte: istStartOfDay(startedAt), $lte: istEndOfDay(startedAt) },
  }).sort({ date: 1 })

  let log
  let appended = false
  if (existing) {
    appended = true
    const wasAuto = !existing.title || existing.title === 'Workout' ||
      existing.title === autoTitle(existing.exercises, labels)
    existing.exercises.push(...exercises)
    if (wasAuto) existing.title = autoTitle(existing.exercises, labels)
    existing.durationMinutes = (existing.durationMinutes || 0) + draftMinutes
    if (bodyWeight) existing.bodyWeight = bodyWeight
    if (sessionId) existing.videoSessionIds = [...(existing.videoSessionIds || []), sessionId]
    existing.caloriesBurned = await resolveCalories({
      gymId, memberId, excludeId: existing._id,
      bodyWeight: existing.bodyWeight, durationMinutes: existing.durationMinutes, exercises: existing.exercises,
    })
    await existing.save()
    log = existing
  } else {
    const caloriesBurned = await resolveCalories({
      gymId, memberId, bodyWeight, durationMinutes: draftMinutes, exercises,
    })
    log = await MemberWorkoutLog.create({
      gymId, memberId, date: new Date(startedAt),
      title: autoTitle(exercises, labels),
      durationMinutes: draftMinutes,
      exercises, bodyWeight, notes: '', caloriesBurned,
      videoSessionIds: sessionId ? [sessionId] : undefined,
    })
  }

  // New-PR alert, then badges/challenges (fire-and-forget; never delays the response).
  // When appending, check only the NEW exercises against everything before them —
  // a throwaway _id so the day's existing log still counts as history.
  const prCheck = appended ? { _id: new Types.ObjectId(), memberId, exercises } : log
  notifyNewPRs(prCheck).finally(() => evaluateEngagement(memberId))

  return { log, appended }
}
