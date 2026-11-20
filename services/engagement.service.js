import Attendance from '../models/Attendance.js'
import MemberWorkoutLog from '../models/MemberWorkoutLog.js'
import PTSession from '../models/PTSession.js'
import Member from '../models/Member.js'
import MemberBadge from '../models/MemberBadge.js'
import Challenge from '../models/Challenge.js'
import { sendPushToMember } from './pushNotification.service.js'
import { istStartOfDay, istEndOfDay } from '../utils/dateIST.js'

const IST = 'Asia/Kolkata'
const DAY = 86_400_000
const MAX_DOCS = 200_000

/** The calendar day (YYYY-MM-DD) an instant falls on in India — independent of the server's own timezone. */
export const istDay = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: IST })
/** A date stored as a plain day (UTC midnight) back to its YYYY-MM-DD. */
export const dayStr = (d) => new Date(d).toISOString().slice(0, 10)

const addDays = (str, n) => new Date(new Date(`${str}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10)
/** Monday of the week containing `str` (weeks run Mon–Sun). */
export function weekStart(str) {
  const d = new Date(`${str}T00:00:00Z`)
  return addDays(str, -((d.getUTCDay() + 6) % 7))
}
export function monthBounds(todayStr) {
  const [y, m] = todayStr.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${todayStr.slice(0, 8)}01`, to: `${todayStr.slice(0, 8)}${String(last).padStart(2, '0')}` }
}

/**
 * Weekly-goal streaks. A week "counts" when the member visited on at least
 * `goal` different days. The current week is still in progress, so it only
 * extends the streak once the goal is met — until then the streak continues
 * from last week rather than being reset on Monday morning.
 */
export function computeStreaks(days, goal = 3, today = istDay(new Date())) {
  const uniq = [...new Set(days)].sort()
  const perWeek = new Map()
  for (const d of uniq) { const w = weekStart(d); perWeek.set(w, (perWeek.get(w) || 0) + 1) }

  const qualifying = [...perWeek.entries()].filter(([, c]) => c >= goal).map(([w]) => w).sort()
  let best = 0, run = 0, prev = null
  for (const w of qualifying) {
    run = prev && addDays(w, -7) === prev ? run + 1 : 1
    best = Math.max(best, run); prev = w
  }

  const thisWeek = weekStart(today)
  const thisCount = perWeek.get(thisWeek) || 0
  let current = 0
  let w = thisCount >= goal ? thisWeek : addDays(thisWeek, -7)
  while ((perWeek.get(w) || 0) >= goal) { current++; w = addDays(w, -7) }

  return {
    currentStreak: current, bestStreak: Math.max(best, current),
    thisWeek: thisCount, goal, weeklyMet: thisCount >= goal,
    totalVisits: uniq.length, lastVisit: uniq[uniq.length - 1] || null,
  }
}


/* ── Visit days ───────────────────────────────────────────────────────────── */

/**
 * The single definition of "the member showed up that day": ANY of a gym
 * attendance record, a COMPLETED PT session, or a self-logged workout. The
 * result is a Set of IST day strings per member, so a day with two or all
 * three of those still counts exactly once. Streaks, challenges, badges,
 * the leaderboard and the monthly counts all build on this.
 *
 * Scope with `memberId` (one member) or `gymId` (everyone); `range` is an
 * optional {$gte,$lte} on `date`. Returns Map<memberIdString, Set<YYYY-MM-DD>>.
 */
async function visitDayMap({ memberId, gymId, range }) {
  const q = { ...(memberId ? { memberId } : { gymId }), ...(range ? { date: range } : {}) }
  const [att, pts, logs] = await Promise.all([
    Attendance.find(q).select('memberId date').limit(MAX_DOCS).lean(),
    PTSession.find({ ...q, status: 'completed' }).select('memberId date').limit(MAX_DOCS).lean(),   // booked/pending/cancelled never happened
    MemberWorkoutLog.find(q).select('memberId date').limit(MAX_DOCS).lean(),
  ])
  const map = new Map()
  for (const r of [...att, ...pts, ...logs]) {
    const k = String(r.memberId)
    if (!map.has(k)) map.set(k, new Set())
    map.get(k).add(istDay(r.date))
  }
  return map
}


/**
 * Everyone who showed up on one IST calendar day (YYYY-MM-DD), one entry per
 * member no matter how many of attendance / completed PT / workout log they
 * have that day. Used by the admin dashboard tile and attendance log so they
 * agree with the member app. Each entry: { memberId, sources: ['gym'|'class'|'pt'|'workout'...], time }
 * where `time` is the earliest known time-of-day that member showed up (or null).
 */
export async function visitsOnDay({ gymId, day }) {
  const q = { gymId, date: { $gte: istStartOfDay(day), $lte: istEndOfDay(day) } }
  const [att, pts, logs] = await Promise.all([
    Attendance.find(q).select('memberId date checkInTime type').limit(MAX_DOCS).lean(),
    PTSession.find({ ...q, status: 'completed' }).select('memberId date').limit(MAX_DOCS).lean(),
    MemberWorkoutLog.find(q).select('memberId date').limit(MAX_DOCS).lean(),
  ])
  const per = new Map()
  const touch = (memberId, source, time) => {
    const k = String(memberId)
    if (!per.has(k)) per.set(k, { memberId: k, sources: new Set(), time: null })
    const e = per.get(k)
    e.sources.add(source)
    if (time && (!e.time || new Date(time) < new Date(e.time))) e.time = time
  }
  for (const a of att) touch(a.memberId, a.type || 'gym', a.checkInTime || null)
  for (const t of pts) touch(t.memberId, 'pt', t.date)
  for (const l of logs) touch(l.memberId, 'workout', l.date)
  return [...per.values()].map((e) => ({ ...e, sources: [...e.sources] }))
}

/** Every distinct IST day this member has a visit (attendance / PT / workout log), sorted ascending. */
export async function visitDaysFor(memberId) {
  const map = await visitDayMap({ memberId })
  return [...(map.get(String(memberId)) || [])].sort()
}

/** Distinct visit days per IST calendar month, newest first — [{ _id: { year, month }, count }]. */
export async function monthlyVisitCounts(memberId, limit = 6) {
  const per = new Map()
  for (const d of await visitDaysFor(memberId)) { const k = d.slice(0, 7); per.set(k, (per.get(k) || 0) + 1) }
  return [...per.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, limit)
    .map(([k, count]) => ({ _id: { year: Number(k.slice(0, 4)), month: Number(k.slice(5, 7)) }, count }))
}

/** Consecutive-day streak ending today (IST) over the given visit days. */
export function dailyStreak(days, today = istDay(new Date())) {
  const set = new Set(days)
  let n = 0, d = today
  while (set.has(d)) { n++; d = addDays(d, -1) }
  return n
}

/* ── Badges ───────────────────────────────────────────────────────────────── */

export const BADGE_DEFS = [
  ...[1, 10, 25, 50, 100, 250, 500].map((n) => ({
    key: `visits_${n}`, icon: n === 1 ? '👟' : n >= 100 ? '🏆' : '🏅', label: n === 1 ? 'First visit' : `${n} visits`,
    desc: n === 1 ? 'Visit the gym for the first time' : `Visit the gym on ${n} different days`,
    test: (s) => s.visits >= n, progress: (s) => [s.visits, n],
  })),
  ...[2, 4, 8, 12, 26, 52].map((n) => ({
    key: `streak_${n}`, icon: '🔥', label: `${n}-week streak`,
    desc: `Hit your weekly goal ${n} weeks in a row`,
    test: (s) => s.bestStreak >= n, progress: (s) => [s.bestStreak, n],
  })),
  ...[1, 10, 50].map((n) => ({
    key: `logs_${n}`, icon: '📝', label: n === 1 ? 'First workout logged' : `${n} workouts logged`,
    desc: n === 1 ? 'Log your first workout' : `Log ${n} workouts`,
    test: (s) => s.logs >= n, progress: (s) => [s.logs, n],
  })),
]

async function memberStats(memberId, goal) {
  const [days, logs] = await Promise.all([
    visitDaysFor(memberId),
    MemberWorkoutLog.countDocuments({ memberId }),   // "workouts logged" badges still count logs themselves
  ])
  const streaks = computeStreaks(days, goal)
  return { days, streaks, stats: { visits: streaks.totalVisits, bestStreak: streaks.bestStreak, logs } }
}

/** Inserts the badge if new. Returns true only for the call that actually awarded it. */
async function award(member, { key, label, icon }, notifyBody, type = 'badge') {
  try {
    await MemberBadge.create({ gymId: member.gymId, memberId: member._id, key, label, icon })
  } catch (err) {
    if (err.code === 11000) return false   // already earned (or a concurrent call beat us to it)
    throw err
  }
  sendPushToMember(member._id, {
    title: `${icon} ${type === 'challenge' ? 'Challenge complete!' : 'New badge unlocked!'}`,
    body: notifyBody, url: '/challenges', tag: `badge-${key}`, type,
  }).catch((e) => console.error('[engagement] push failed:', e.message))
  return true
}

/* ── Challenges ───────────────────────────────────────────────────────────── */

/** Days (YYYY-MM-DD) a member counted toward a challenge's metric, inside its window. */
async function challengeDays(challenge, memberId) {
  const from = dayStr(challenge.startDate), to = dayStr(challenge.endDate)
  // Pad the DB query by a day each side; the exact bounds are applied on IST day strings
  // (stored attendance instants can fall a day either side depending on server timezone).
  const range = { $gte: new Date(new Date(`${from}T00:00:00Z`).getTime() - DAY), $lte: new Date(new Date(`${to}T00:00:00Z`).getTime() + 2 * DAY) }
  if (challenge.metric === 'workouts') {
    // A "workouts" challenge is specifically about logged workouts.
    const rows = await MemberWorkoutLog.find({ memberId, date: range }).select('date').limit(MAX_DOCS).lean()
    return new Set(rows.map((r) => istDay(r.date)).filter((d) => d >= from && d <= to))
  }
  // A "visits" challenge counts any attendance / completed PT / logged workout, once per day.
  const days = (await visitDayMap({ memberId, range })).get(String(memberId)) || new Set()
  return new Set([...days].filter((d) => d >= from && d <= to))
}

export async function challengeProgress(challenge, memberId) {
  const count = (await challengeDays(challenge, memberId)).size
  return { count, target: challenge.target, percent: Math.min(100, Math.round((count / challenge.target) * 100)), completed: count >= challenge.target }
}

export const challengeIsLive = (c, today = istDay(new Date())) => c.isActive && dayStr(c.startDate) <= today && today <= dayStr(c.endDate)

/**
 * Call after anything that could earn something (a visit, a logged workout).
 * Awards newly-reached badges and completed challenges. Never throws.
 */
export async function evaluateEngagement(memberId) {
  try {
    const member = await Member.findById(memberId).select('gymId name weeklyGoal')
    if (!member) return { badges: [], challenges: [] }
    const { stats } = await memberStats(member._id, member.weeklyGoal || 3)

    const earned = []
    for (const def of BADGE_DEFS) {
      if (def.test(stats) && (await award(member, def, `${def.label} — ${def.desc}.`))) earned.push(def.key)
    }

    const completed = []
    const live = await Challenge.find({ gymId: member.gymId, isActive: true }).lean()
    for (const c of live) {
      if (!challengeIsLive(c)) continue
      const { completed: done } = await challengeProgress(c, member._id)
      if (done && (await award(member, { key: `challenge_${c._id}`, label: c.title, icon: '🎯' },
        `You finished “${c.title}”${c.reward ? ` — claim your reward: ${c.reward}` : ''}.`, 'challenge'))) completed.push(String(c._id))
    }
    return { badges: earned, challenges: completed }
  } catch (err) {
    console.error('[engagement] evaluate failed:', err.message)
    return { badges: [], challenges: [] }
  }
}

/** The member's engagement overview: streaks, this-month visits and every badge (earned or not). */
export async function overviewFor(member) {
  const { days, streaks, stats } = await memberStats(member._id, member.weeklyGoal || 3)
  const earnedDocs = await MemberBadge.find({ memberId: member._id }).lean()
  const earnedMap = new Map(earnedDocs.map((b) => [b.key, b]))

  const badges = BADGE_DEFS.map((d) => {
    const [cur, target] = d.progress(stats)
    const e = earnedMap.get(d.key)
    return { key: d.key, icon: d.icon, label: d.label, desc: d.desc, earned: !!e, earnedAt: e?.earnedAt, progress: Math.min(cur, target), target }
  })
  for (const b of earnedDocs.filter((x) => x.key.startsWith('challenge_'))) {
    badges.push({ key: b.key, icon: b.icon || '🎯', label: b.label || 'Challenge', desc: 'Challenge completed', earned: true, earnedAt: b.earnedAt, progress: 1, target: 1 })
  }

  const { from, to } = monthBounds(istDay(new Date()))
  const monthVisits = new Set(days.filter((d) => d >= from && d <= to)).size
  return { ...streaks, monthVisits, badges, earnedCount: badges.filter((b) => b.earned).length }
}

/* ── Leaderboard ──────────────────────────────────────────────────────────── */

export function displayName(name, anonymize = true) {
  const full = String(name || 'Member').trim()
  if (!anonymize) return full                       // staff see the whole name
  const parts = full.split(/\s+/)
  if (parts.length < 2) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}

/**
 * Ranks members by distinct active days in [from, to] (YYYY-MM-DD).
 * Members who opted out are left off the board (members can still see their own number).
 * `anonymize` shortens names to "Ravi K." for the member app; staff see everything.
 */
export async function leaderboard({ gymId, metric = 'visits', from, to, limit = 10, anonymize = true, meId }) {
  const range = { $gte: new Date(new Date(`${from}T00:00:00Z`).getTime() - DAY), $lte: new Date(new Date(`${to}T00:00:00Z`).getTime() + 2 * DAY) }
  let perMember
  if (metric === 'workouts') {
    const rows = await MemberWorkoutLog.find({ gymId, date: range }).select('memberId date').limit(MAX_DOCS).lean()
    perMember = new Map()
    for (const r of rows) {
      const d = istDay(r.date)
      if (d < from || d > to) continue
      const k = String(r.memberId)
      if (!perMember.has(k)) perMember.set(k, new Set())
      perMember.get(k).add(d)
    }
  } else {
    perMember = new Map()
    for (const [k, set] of await visitDayMap({ gymId, range })) {
      const inRange = new Set([...set].filter((d) => d >= from && d <= to))
      if (inRange.size) perMember.set(k, inRange)
    }
  }

  const members = await Member.find({ _id: { $in: [...perMember.keys()] }, gymId }).select('name hideFromLeaderboard isActive').lean()
  const all = members
    .filter((m) => m.isActive !== false)
    .map((m) => ({ id: String(m._id), name: m.name, hidden: !!m.hideFromLeaderboard, count: perMember.get(String(m._id)).size }))
    .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)))

  const rankOf = (count) => 1 + all.filter((x) => x.count > count && (!anonymize || !x.hidden)).length
  const visible = anonymize ? all.filter((x) => !x.hidden) : all
  const entries = visible.slice(0, limit).map((x) => ({
    rank: rankOf(x.count), name: displayName(x.name, anonymize), count: x.count,
    isMe: !!meId && x.id === String(meId), ...(anonymize ? {} : { hidden: x.hidden }),
  }))

  let me = null
  if (meId) {
    const mine = all.find((x) => x.id === String(meId))
    me = { count: mine?.count || 0, rank: mine && !mine.hidden ? rankOf(mine.count) : null, hidden: !!mine?.hidden }
  }
  return { entries, me, totalParticipants: visible.length }
}
