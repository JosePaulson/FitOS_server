// Calorie-burn estimate for a PT session, based on the member's height and
// bodyweight, how long the session ran, and the volume of work logged
// (sets × reps × weight across the session's exercises).
//
// This is a heuristic, not a medical-grade measurement — there's no way to
// know true energy expenditure without a metabolic cart or wearable. The
// approach follows the standard MET (Metabolic Equivalent of Task) method
// used across fitness apps:
//
//   calories = MET × bodyweight(kg) × duration(hours)
//
// MET for resistance training runs roughly 3.5 (light effort) to 6.0
// (vigorous effort) per the Compendium of Physical Activities. We scale
// within that band using the training volume logged for the session,
// normalised per minute and per kg of bodyweight, so a heavier/longer/more
// voluminous session is rated more vigorous than a light one.

/** Average out a reps value that might be a plain number or a range like "8-12". */
function parseRepsAverage(reps) {
	if (reps === undefined || reps === null || reps === '') return 0
	const nums = String(reps).match(/\d+(\.\d+)?/g)
	if (!nums) return 0
	const values = nums.map(Number)
	return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * @param {Object} params
 * @param {number} [params.heightCm]        Member's height in cm (optional — small modifier only)
 * @param {number} [params.weightKg]        Member's bodyweight in kg (required — no estimate without it)
 * @param {number} [params.durationMinutes] Session duration in minutes (required)
 * @param {Array}  [params.exercises]       Session exercises: [{ sets, reps, weight }]
 * @returns {number|null} Estimated calories burned, or null if there isn't enough data
 */
export function estimateCaloriesBurned({ heightCm, weightKg, durationMinutes, exercises = [] } = {}) {
	const weight = Number(weightKg)
	const duration = Number(durationMinutes)
	if (!weight || weight <= 0 || !duration || duration <= 0) return null

	let totalReps = 0
	let totalVolume = 0 // kg lifted, summed across sets × reps × load
	for (const ex of exercises || []) {
		const sets = Number(ex?.sets) || 0
		const repsAvg = parseRepsAverage(ex?.reps)
		const load = Number(ex?.weight) || 0
		totalReps += sets * repsAvg
		totalVolume += sets * repsAvg * load
	}

	// Training volume per minute, relative to the member's own bodyweight —
	// a simple, unit-independent proxy for how intense the session was.
	const volumePerMinutePerKgBW = totalVolume / duration / weight

	let met = 3.5                                    // light-effort baseline
	met += Math.min(2.5, volumePerMinutePerKgBW * 8)  // scale up with logged load
	if (totalVolume === 0 && totalReps > 0) met += 1  // bodyweight-only work still counts
	met = Math.min(6.5, met)

	// Height is a very minor modifier (taller frame ⇒ marginally more mass to
	// move at the same bodyweight-relative intensity) — capped at ±5%.
	const heightModifier = heightCm && heightCm > 0
		? Math.min(1.05, Math.max(0.95, 1 + ((heightCm - 170) / 170) * 0.3))
		: 1

	const calories = met * weight * (duration / 60) * heightModifier
	return Math.round(calories)
}