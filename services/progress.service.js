import MemberWorkoutLog from '../models/MemberWorkoutLog.js'
import { sendPushToMember } from './pushNotification.service.js'

/** "8-12" → 8, "5" → 5, blank → null. A range counts at its lower end (the conservative number). */
export function parseReps(r) {
  const m = String(r ?? '').match(/\d+/)
  return m ? parseInt(m[0], 10) : null
}

/** Estimated one-rep max (Epley). A single rep is its own 1RM. */
export const epley = (weight, reps) => (reps <= 1 ? weight : weight * (1 + reps / 30))

const keyOf = (name) => String(name || '').trim().toLowerCase()
const round1 = (n) => Math.round(n * 10) / 10

/** Flatten logs into [{ key, name, weight, reps, e1rm, date }] — only entries that have a weight. */
function entriesOf(logs) {
  const out = []
  for (const log of logs) {
    for (const ex of log.exercises || []) {
      const weight = Number(ex.weight)
      if (!ex.name || !(weight > 0)) continue          // bodyweight / unweighted: no PR to track
      const reps = parseReps(ex.reps) ?? 1
      out.push({ key: keyOf(ex.name), name: String(ex.name).trim(), weight, reps, e1rm: epley(weight, reps), date: new Date(log.date) })
    }
  }
  return out
}

/**
 * Personal records per exercise, judged by estimated 1RM so "100kg × 3" can
 * beat "105kg × 1". Walks the history in order, so `improvement` is how much
 * the latest record beat the previous best by.
 *
 * Returns most-recently-broken first:
 *   [{ name, weight, reps, e1rm, date, improvement, prCount, sessions }]
 */
export function computePRs(logs) {
  const entries = entriesOf(logs).sort((a, b) => a.date - b.date)
  const byEx = new Map()
  for (const e of entries) {
    let s = byEx.get(e.key)
    if (!s) { s = { name: e.name, best: null, prevE1rm: null, prCount: 0, sessions: new Set() }; byEx.set(e.key, s) }
    s.sessions.add(e.date.toISOString().slice(0, 10))
    if (!s.best || e.e1rm > s.best.e1rm + 1e-9) {
      s.prevE1rm = s.best ? s.best.e1rm : null
      s.best = e
      s.prCount += 1
    }
  }
  return [...byEx.values()]
    .map((s) => ({
      name: s.name, weight: s.best.weight, reps: s.best.reps, e1rm: round1(s.best.e1rm), date: s.best.date,
      improvement: s.prevE1rm === null ? null : round1(s.best.e1rm - s.prevE1rm),
      prCount: s.prCount, sessions: s.sessions.size,
    }))
    .sort((a, b) => b.date - a.date)
}

/**
 * Exercises in `newLog` that beat everything in `previousLogs`.
 * The first time an exercise is ever logged is NOT a PR (nothing to beat).
 */
export function detectNewPRs(previousLogs, newLog) {
  const prevBest = new Map()
  for (const e of entriesOf(previousLogs)) prevBest.set(e.key, Math.max(prevBest.get(e.key) || 0, e.e1rm))
  const bestNew = new Map()
  for (const e of entriesOf([newLog])) if (!bestNew.has(e.key) || e.e1rm > bestNew.get(e.key).e1rm) bestNew.set(e.key, e)
  const prs = []
  for (const [key, e] of bestNew) {
    if (prevBest.has(key) && e.e1rm > prevBest.get(key) + 1e-9) prs.push({ name: e.name, weight: e.weight, reps: e.reps })
  }
  return prs
}

/** After a workout is logged: tell the member about any new PRs. Never throws. */
export async function notifyNewPRs(log) {
  try {
    const previous = await MemberWorkoutLog.find({ memberId: log.memberId, _id: { $ne: log._id } })
      .select('exercises date').sort({ date: -1 }).limit(1000).lean()
    const prs = detectNewPRs(previous, log)
    for (const pr of prs.slice(0, 3)) {
      await sendPushToMember(log.memberId, {
        title: 'New personal record 🏆',
        body: `${pr.name}: ${pr.weight} kg × ${pr.reps}. Keep it up!`,
        url: '/progress', tag: `pr-${String(pr.name).toLowerCase()}`, type: 'pr',
      })
    }
    return prs
  } catch (err) {
    console.error('[progress] PR notification failed:', err.message)
    return []
  }
}

/** Latest-vs-first change for each metric that has at least two readings. */
export const METRICS = ['weightKg', 'bodyFatPct', 'chestCm', 'waistCm', 'hipsCm', 'armCm', 'thighCm']
export function metricChanges(measurements) {
  const sorted = [...measurements].sort((a, b) => new Date(a.date) - new Date(b.date))
  const out = {}
  for (const m of METRICS) {
    const pts = sorted.filter((x) => typeof x[m] === 'number')
    if (!pts.length) continue
    const first = pts[0][m], latest = pts[pts.length - 1][m]
    out[m] = { latest, first, change: pts.length > 1 ? round1(latest - first) : null, readings: pts.length }
  }
  return out
}
