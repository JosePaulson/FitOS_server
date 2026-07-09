/**
 * Prebuilt workout & diet plan library.
 *
 * These are deliberately conservative, mainstream programs — the kind of
 * thing you'd find recommended by NSCA/ACSM-certified strength coaches and
 * ISSN-aligned sports dietitians as a sensible starting point, not a fad or
 * an aggressive/extreme protocol. Rep ranges, rest periods, and macro
 * splits follow widely-cited, broadly-agreed guidelines:
 *
 *  - Strength work: 3–5 reps, 3–5 sets, 90–180s rest (neural/strength
 *    adaptation range — Rippetoe "Starting Strength", NSCA guidelines)
 *  - Hypertrophy work: 8–12 reps, 3–4 sets, 60–90s rest (ACSM hypertrophy
 *    rep-range recommendation)
 *  - Metabolic/circuit work: 12–15 reps, shorter 30–45s rest to keep heart
 *    rate elevated (ACSM guidance: resistance + conditioning combined
 *    outperforms cardio alone for fat-loss body composition outcomes)
 *  - Protein targets: ~1.6–2.4 g/kg/day depending on goal, per the ISSN
 *    Position Stand on protein and exercise
 *  - Diet macros are deliberately moderate, not aggressive deficits/
 *    surpluses (~300–500 kcal from maintenance) per NSCA/ISSN bulking &
 *    cutting guidance to protect long-term adherence and lean mass
 *
 * Every plan/diet here is a *starting template* — description text makes
 * clear it should be individualised by the member's trainer, not treated
 * as prescriptive medical or dietetic advice.
 */

export const PREBUILT_WORKOUT_PLANS = [
  {
    name: 'Beginner Full Body Strength',
    goal: 'muscle-gain',
    durationWeeks: 8,
    description:
      'A classic 3-day full-body strength foundation built around the big compound lifts. ' +
      'Widely recommended as the standard starting point for new lifters (in the tradition of ' +
      'Starting Strength / StrongLifts-style programming) — low exercise count, high focus on ' +
      'technique, and straightforward progressive overload (add a little weight each session ' +
      'once all sets are completed with good form). Train 3 non-consecutive days per week.',
    days: [
      {
        day: 'Day A',
        focus: 'Squat-based full body',
        exercises: [
          { name: 'Barbell Back Squat',   sets: 3, reps: '5',  restSec: 150, notes: 'Prioritise depth and bar path over load' },
          { name: 'Flat Barbell Bench Press', sets: 3, reps: '5', restSec: 150 },
          { name: 'Barbell Bent-Over Row', sets: 3, reps: '5', restSec: 120 },
          { name: 'Plank',                sets: 3, reps: '', durationSec: 30, restSec: 45 },
        ],
      },
      {
        day: 'Day B',
        focus: 'Deadlift-based full body',
        exercises: [
          { name: 'Barbell Back Squat',   sets: 3, reps: '5',  restSec: 150 },
          { name: 'Overhead Press',       sets: 3, reps: '5',  restSec: 120 },
          { name: 'Barbell Deadlift',     sets: 1, reps: '5',  restSec: 180, notes: 'Single work set — deadlift is taxing, no need to repeat sets' },
          { name: 'Hanging Knee Raise',   sets: 3, reps: '10', restSec: 45 },
        ],
      },
    ],
  },

  {
    name: 'Push / Pull / Legs (Intermediate)',
    goal: 'general',
    durationWeeks: 8,
    description:
      'A 6-day hypertrophy split grouping muscles by movement pattern (push, pull, legs), ' +
      'repeated twice per week — one of the most widely used intermediate structures in strength ' +
      'and physique coaching because it balances volume evenly across all major muscle groups. ' +
      'Moderate rep ranges (8–12) in the hypertrophy zone. Suitable once a lifter has built a ' +
      'base of technique on the fundamental beginner program.',
    days: [
      {
        day: 'Push',
        focus: 'Chest, shoulders, triceps',
        exercises: [
          { name: 'Flat Barbell Bench Press', sets: 4, reps: '8-10', restSec: 90 },
          { name: 'Seated Overhead Dumbbell Press', sets: 3, reps: '8-10', restSec: 90 },
          { name: 'Incline Dumbbell Press', sets: 3, reps: '10-12', restSec: 75 },
          { name: 'Cable Lateral Raise',    sets: 3, reps: '12-15', restSec: 60 },
          { name: 'Tricep Rope Pushdown',   sets: 3, reps: '12-15', restSec: 60 },
        ],
      },
      {
        day: 'Pull',
        focus: 'Back, biceps',
        exercises: [
          { name: 'Barbell Deadlift',      sets: 3, reps: '6-8',  restSec: 150 },
          { name: 'Pull-up or Lat Pulldown', sets: 4, reps: '8-10', restSec: 90 },
          { name: 'Seated Cable Row',      sets: 3, reps: '10-12', restSec: 75 },
          { name: 'Face Pull',             sets: 3, reps: '12-15', restSec: 60, notes: 'Rear delt & shoulder health — do not skip' },
          { name: 'Barbell or Dumbbell Curl', sets: 3, reps: '10-12', restSec: 60 },
        ],
      },
      {
        day: 'Legs',
        focus: 'Quads, hamstrings, glutes, calves',
        exercises: [
          { name: 'Barbell Back Squat',    sets: 4, reps: '8-10', restSec: 120 },
          { name: 'Romanian Deadlift',     sets: 3, reps: '10-12', restSec: 90 },
          { name: 'Leg Press',             sets: 3, reps: '10-12', restSec: 90 },
          { name: 'Leg Curl',              sets: 3, reps: '12-15', restSec: 60 },
          { name: 'Standing Calf Raise',   sets: 4, reps: '15-20', restSec: 45 },
        ],
      },
    ],
  },

  {
    name: 'Fat Loss Metabolic Circuit',
    goal: 'weight-loss',
    durationWeeks: 6,
    description:
      'A 4-day resistance-based circuit style program. Research consistently shows resistance ' +
      'training combined with a calorie deficit preserves more lean muscle during fat loss than ' +
      'cardio alone (ACSM position on weight management). Shorter rest periods keep heart rate ' +
      'elevated for an added conditioning effect. Pair with a moderate calorie deficit, not this ' +
      'plan alone.',
    days: [
      {
        day: 'Day 1',
        focus: 'Upper body circuit',
        exercises: [
          { name: 'Dumbbell Bench Press', sets: 3, reps: '12-15', restSec: 45 },
          { name: 'Dumbbell Row',         sets: 3, reps: '12-15', restSec: 45 },
          { name: 'Seated Shoulder Press', sets: 3, reps: '12-15', restSec: 45 },
          { name: 'Assisted or Band Pull-up', sets: 3, reps: '10-12', restSec: 45 },
          { name: 'Mountain Climbers',    sets: 3, reps: '', durationSec: 30, restSec: 30 },
        ],
      },
      {
        day: 'Day 2',
        focus: 'Lower body circuit',
        exercises: [
          { name: 'Goblet Squat',         sets: 3, reps: '15',   restSec: 45 },
          { name: 'Walking Lunge',        sets: 3, reps: '12 each leg', restSec: 45 },
          { name: 'Kettlebell Deadlift',  sets: 3, reps: '12-15', restSec: 45 },
          { name: 'Glute Bridge',         sets: 3, reps: '15',   restSec: 45 },
          { name: 'Jump Rope',            sets: 3, reps: '', durationSec: 45, restSec: 30 },
        ],
      },
      {
        day: 'Day 3',
        focus: 'Full body metabolic',
        exercises: [
          { name: 'Kettlebell Swing',     sets: 4, reps: '15-20', restSec: 40 },
          { name: 'Push-up',              sets: 3, reps: '12-15', restSec: 40 },
          { name: 'Dumbbell Thruster',    sets: 3, reps: '12',    restSec: 45 },
          { name: 'Plank to Shoulder Tap', sets: 3, reps: '16 total', restSec: 40 },
          { name: 'Battle Ropes or Burpees', sets: 3, reps: '', durationSec: 30, restSec: 40 },
        ],
      },
      {
        day: 'Day 4',
        focus: 'Core & conditioning',
        exercises: [
          { name: 'Hanging Knee Raise',   sets: 3, reps: '12-15', restSec: 40 },
          { name: 'Russian Twist',        sets: 3, reps: '20 total', restSec: 40 },
          { name: 'Farmer\'s Carry',      sets: 3, reps: '', durationSec: 40, restSec: 45 },
          { name: 'Incline Treadmill Walk', sets: 1, reps: '', durationSec: 900, notes: '15 min brisk incline walk to close out the session' },
        ],
      },
    ],
  },

  {
    name: 'Couch to 5K Endurance Runner',
    goal: 'endurance',
    durationWeeks: 8,
    description:
      'A progressive run/walk interval structure based on the widely-used "Couch to 5K" method ' +
      '(popularised by the NHS and countless running coaches) — the standard, safe way to build ' +
      'running endurance from a low base without overloading joints and connective tissue too ' +
      'quickly. Run 3 non-consecutive days per week; the run:walk ratio increases gradually week ' +
      'to week as printed below for the first few sessions.',
    days: [
      {
        day: 'Week 1-2 Session',
        focus: 'Run/walk intervals — building the habit',
        exercises: [
          { name: 'Brisk Walk Warm-up',   sets: 1, reps: '', durationSec: 300, notes: '5 min easy pace' },
          { name: 'Run Interval',         sets: 8, reps: '', durationSec: 60, restSec: 90, notes: '1 min jog, 1.5 min walk — repeat 8 rounds' },
          { name: 'Cool-down Walk',       sets: 1, reps: '', durationSec: 300, notes: '5 min easy pace + light stretching' },
        ],
      },
      {
        day: 'Week 3-5 Session',
        focus: 'Extending run intervals',
        exercises: [
          { name: 'Brisk Walk Warm-up',   sets: 1, reps: '', durationSec: 300 },
          { name: 'Run Interval',         sets: 6, reps: '', durationSec: 180, restSec: 90, notes: '3 min jog, 1.5 min walk — repeat 6 rounds' },
          { name: 'Cool-down Walk',       sets: 1, reps: '', durationSec: 300 },
        ],
      },
      {
        day: 'Week 6-8 Session',
        focus: 'Continuous running toward 5K',
        exercises: [
          { name: 'Brisk Walk Warm-up',   sets: 1, reps: '', durationSec: 300 },
          { name: 'Continuous Run',       sets: 1, reps: '', durationSec: 1500, notes: 'Build to 25 continuous minutes at an easy, conversational pace' },
          { name: 'Cool-down Walk',       sets: 1, reps: '', durationSec: 300 },
        ],
      },
    ],
  },

  {
    name: 'Mobility & Flexibility Foundations',
    goal: 'flexibility',
    durationWeeks: 4,
    description:
      'A simple, ongoing mobility routine following ACSM flexibility guidelines — stretch major ' +
      'muscle groups at least 2–3x/week, holding each static stretch 15–30 seconds. Useful as a ' +
      'standalone recovery day or tacked onto the end of any other training session. Especially ' +
      'valuable for members who sit a lot during the day.',
    days: [
      {
        day: 'Full Body Mobility',
        focus: 'Joint mobility + static stretching',
        exercises: [
          { name: 'Cat-Cow Stretch',        sets: 2, reps: '10', restSec: 15 },
          { name: 'World\'s Greatest Stretch', sets: 2, reps: '5 each side', restSec: 20 },
          { name: 'Hip Flexor Stretch',     sets: 2, reps: '', durationSec: 30, restSec: 15, notes: 'Each side' },
          { name: 'Hamstring Stretch',      sets: 2, reps: '', durationSec: 30, restSec: 15, notes: 'Each side' },
          { name: 'Thoracic Spine Rotation', sets: 2, reps: '8 each side', restSec: 15 },
          { name: 'Shoulder Cross-body Stretch', sets: 2, reps: '', durationSec: 30, restSec: 15, notes: 'Each side' },
          { name: 'Child\'s Pose',          sets: 1, reps: '', durationSec: 60 },
        ],
      },
    ],
  },

  {
    name: 'Body-Part Split (Chest/Tri, Back/Bi/Abs, Shoulders/Legs)',
    goal: 'muscle-gain',
    durationWeeks: 10,
    description:
      'A classic 3-day body-part split — each day pairs a large muscle group with a smaller ' +
      'synergist (chest+triceps, back+biceps+abs, shoulders+legs), a structure long used in ' +
      'bodybuilding-style coaching to hit each muscle with higher single-session volume. Four ' +
      'exercise variations are listed per muscle group as a rotation menu — most trainees should ' +
      'pick 2–3 of the 4 per session rather than doing all four every time, saving the rest for ' +
      'variety in later weeks. Research on training frequency (e.g. Schoenfeld et al. meta-' +
      'analyses) generally favours hitting each muscle twice a week for hypertrophy, so ' +
      'intermediate/advanced lifters get the most out of this by repeating the 3-day rotation ' +
      'twice across the week (6 sessions); those newer to a split or with fewer training days can ' +
      'run it straight 3x/week (e.g. Mon/Wed/Fri), training each muscle once weekly.',
    days: [
      {
        day: 'Day 1 — Chest & Triceps',
        focus: 'Chest and triceps, 4 variations each',
        exercises: [
          { name: 'Flat Barbell Bench Press',   sets: 4, reps: '8-10',  restSec: 120, notes: 'Chest variation 1 — primary mass builder' },
          { name: 'Incline Dumbbell Press',     sets: 3, reps: '10-12', restSec: 90,  notes: 'Chest variation 2 — upper chest emphasis' },
          { name: 'Cable or Pec-Deck Fly',      sets: 3, reps: '12-15', restSec: 60,  notes: 'Chest variation 3 — stretch & squeeze isolation' },
          { name: 'Chest-Focused Dips',         sets: 3, reps: '10-12', restSec: 75,  notes: 'Chest variation 4 — lean forward to bias chest over triceps' },
          { name: 'Close-Grip Bench Press',     sets: 3, reps: '8-10',  restSec: 90,  notes: 'Triceps variation 1 — heaviest triceps movement' },
          { name: 'Overhead Dumbbell Tricep Extension', sets: 3, reps: '10-12', restSec: 60, notes: 'Triceps variation 2 — long-head stretch emphasis' },
          { name: 'Rope Tricep Pushdown',       sets: 3, reps: '12-15', restSec: 45,  notes: 'Triceps variation 3 — isolation, constant tension' },
          { name: 'Diamond Push-ups',           sets: 2, reps: 'AMRAP', restSec: 45,  notes: 'Triceps variation 4 — bodyweight finisher' },
        ],
      },
      {
        day: 'Day 2 — Back, Biceps & Abs',
        focus: 'Back, biceps and abs, 4 variations each',
        exercises: [
          { name: 'Conventional Deadlift',      sets: 3, reps: '6-8',   restSec: 150, notes: 'Back variation 1 — posterior chain & overall back mass' },
          { name: 'Pull-up or Lat Pulldown',    sets: 4, reps: '8-10',  restSec: 90,  notes: 'Back variation 2 — width' },
          { name: 'Barbell Bent-Over Row',      sets: 3, reps: '8-10',  restSec: 90,  notes: 'Back variation 3 — thickness' },
          { name: 'Seated Cable Row',           sets: 3, reps: '10-12', restSec: 75,  notes: 'Back variation 4 — mid-back squeeze' },
          { name: 'Barbell Curl',               sets: 3, reps: '8-10',  restSec: 60,  notes: 'Biceps variation 1 — heaviest bicep movement' },
          { name: 'Incline Dumbbell Curl',      sets: 3, reps: '10-12', restSec: 60,  notes: 'Biceps variation 2 — long-head stretch' },
          { name: 'Hammer Curl',                sets: 3, reps: '10-12', restSec: 60,  notes: 'Biceps variation 3 — brachialis/forearm' },
          { name: 'Cable or Concentration Curl', sets: 2, reps: '12-15', restSec: 45, notes: 'Biceps variation 4 — peak-contraction isolation' },
          { name: 'Hanging Leg Raise',          sets: 3, reps: '12-15', restSec: 45,  notes: 'Abs variation 1 — lower abs' },
          { name: 'Cable Crunch',               sets: 3, reps: '15',    restSec: 45,  notes: 'Abs variation 2 — loaded, upper abs' },
          { name: 'Russian Twist',              sets: 3, reps: '20 total', restSec: 40, notes: 'Abs variation 3 — obliques' },
          { name: 'Plank',                      sets: 3, reps: '', durationSec: 45, restSec: 40, notes: 'Abs variation 4 — anti-extension core stability' },
        ],
      },
      {
        day: 'Day 3 — Shoulders & Legs',
        focus: 'Shoulders and legs, 4 variations each',
        exercises: [
          { name: 'Seated Barbell or Dumbbell Overhead Press', sets: 4, reps: '8-10', restSec: 120, notes: 'Shoulders variation 1 — primary mass builder' },
          { name: 'Cable or Dumbbell Lateral Raise', sets: 3, reps: '12-15', restSec: 60, notes: 'Shoulders variation 2 — side delt width' },
          { name: 'Reverse Pec-Deck or Bent-Over Rear Delt Fly', sets: 3, reps: '12-15', restSec: 60, notes: 'Shoulders variation 3 — rear delt & posture' },
          { name: 'Front Raise',                sets: 2, reps: '12-15', restSec: 45,  notes: 'Shoulders variation 4 — front delt isolation' },
          { name: 'Barbell Back Squat',          sets: 4, reps: '8-10',  restSec: 120, notes: 'Legs variation 1 — primary mass builder' },
          { name: 'Romanian Deadlift',          sets: 3, reps: '10-12', restSec: 90,  notes: 'Legs variation 2 — hamstrings & glutes' },
          { name: 'Leg Press',                  sets: 3, reps: '12-15', restSec: 90,  notes: 'Legs variation 3 — quad volume, lower back friendly' },
          { name: 'Walking Lunge',              sets: 3, reps: '12 each leg', restSec: 75, notes: 'Legs variation 4 — unilateral strength & balance' },
        ],
      },
    ],
  },
]

export const PREBUILT_DIET_PLANS = [
  {
    name: 'Balanced Maintenance',
    goal: 'maintenance',
    targetCalories: 2000,
    targetProtein: 130,
    targetCarbs: 225,
    targetFat: 65,
    description:
      'A general, well-rounded macro split (~26% protein / 45% carbs / 29% fat) suitable as a ' +
      'starting point for a member simply looking to maintain their current weight while eating ' +
      'nutritiously. Calorie/macro targets are illustrative for an average adult — a trainer ' +
      'should adjust based on the individual member\'s size, activity level and goals.',
    meals: [
      {
        name: 'Breakfast', time: '8:00 AM',
        items: [
          { food: 'Oats cooked with milk', quantity: '60g dry oats', calories: 300, protein: 12, carbs: 45, fat: 8 },
          { food: 'Boiled eggs', quantity: '2 whole', calories: 140, protein: 12, carbs: 1, fat: 10 },
          { food: 'Banana', quantity: '1 medium', calories: 105, protein: 1, carbs: 27, fat: 0 },
        ],
      },
      {
        name: 'Lunch', time: '1:00 PM',
        items: [
          { food: 'Grilled chicken breast or paneer', quantity: '150g', calories: 250, protein: 35, carbs: 0, fat: 10 },
          { food: 'Steamed rice or 2 rotis', quantity: '1 cup / 2 pcs', calories: 220, protein: 5, carbs: 45, fat: 2 },
          { food: 'Mixed vegetable sabzi', quantity: '1 cup', calories: 120, protein: 4, carbs: 15, fat: 5 },
          { food: 'Dal', quantity: '1 cup', calories: 150, protein: 9, carbs: 22, fat: 3 },
        ],
      },
      {
        name: 'Evening Snack', time: '5:00 PM',
        items: [
          { food: 'Greek yogurt or curd', quantity: '200g', calories: 130, protein: 15, carbs: 8, fat: 4 },
          { food: 'Mixed nuts', quantity: '20g', calories: 120, protein: 4, carbs: 4, fat: 10 },
        ],
      },
      {
        name: 'Dinner', time: '8:00 PM',
        items: [
          { food: 'Grilled fish or tofu', quantity: '150g', calories: 220, protein: 30, carbs: 2, fat: 9 },
          { food: 'Quinoa or 1 roti', quantity: '3/4 cup / 1 pc', calories: 130, protein: 4, carbs: 24, fat: 2 },
          { food: 'Sautéed greens/salad', quantity: '1.5 cups', calories: 90, protein: 3, carbs: 10, fat: 3 },
        ],
      },
    ],
  },

  {
    name: 'High Protein Fat Loss',
    goal: 'weight-loss',
    targetCalories: 1800,
    targetProtein: 160,
    targetCarbs: 150,
    targetFat: 55,
    description:
      'A moderate calorie deficit (roughly 400–500 kcal below typical maintenance) with a higher ' +
      'protein target (~35% of calories) — the ISSN position stand on protein supports higher ' +
      'intakes during a cut to protect lean muscle mass while losing fat. Avoid going much lower ' +
      'than this without professional supervision; aggressive deficits are harder to sustain and ' +
      'risk excess muscle loss.',
    meals: [
      {
        name: 'Breakfast', time: '7:30 AM',
        items: [
          { food: 'Egg white omelette + 1 whole egg', quantity: '4 whites + 1 whole', calories: 180, protein: 24, carbs: 2, fat: 7 },
          { food: 'Sautéed spinach & tomato', quantity: '1 cup', calories: 40, protein: 2, carbs: 6, fat: 1 },
          { food: 'Black coffee or green tea', quantity: '1 cup', calories: 0, protein: 0, carbs: 0, fat: 0 },
        ],
      },
      {
        name: 'Lunch', time: '12:30 PM',
        items: [
          { food: 'Grilled chicken breast', quantity: '180g', calories: 300, protein: 45, carbs: 0, fat: 12 },
          { food: 'Brown rice', quantity: '3/4 cup cooked', calories: 165, protein: 4, carbs: 34, fat: 1 },
          { food: 'Large mixed salad', quantity: '2 cups', calories: 100, protein: 3, carbs: 12, fat: 5 },
        ],
      },
      {
        name: 'Snack', time: '4:00 PM',
        items: [
          { food: 'Whey protein shake', quantity: '1 scoop + water', calories: 120, protein: 24, carbs: 3, fat: 1 },
          { food: 'Apple', quantity: '1 medium', calories: 95, protein: 0, carbs: 25, fat: 0 },
        ],
      },
      {
        name: 'Dinner', time: '7:30 PM',
        items: [
          { food: 'Grilled fish or paneer', quantity: '180g', calories: 260, protein: 38, carbs: 2, fat: 10 },
          { food: 'Steamed vegetables', quantity: '2 cups', calories: 100, protein: 4, carbs: 18, fat: 2 },
          { food: 'Small portion dal', quantity: '1/2 cup', calories: 75, protein: 5, carbs: 11, fat: 1 },
        ],
      },
    ],
  },

  {
    name: 'Lean Muscle Gain',
    goal: 'muscle-gain',
    targetCalories: 2600,
    targetProtein: 165,
    targetCarbs: 300,
    targetFat: 80,
    description:
      'A modest calorie surplus (~300–400 kcal above typical maintenance) — deliberately not an ' +
      'aggressive "dirty bulk". NSCA and ISSN guidance both favour a smaller, controlled surplus ' +
      'to build muscle while minimising unnecessary fat gain. Protein stays high (~1.6–2.2 g/kg ' +
      'for most trainees) to support the higher training volume.',
    meals: [
      {
        name: 'Breakfast', time: '7:30 AM',
        items: [
          { food: 'Oats with peanut butter & banana', quantity: '80g oats + 1 tbsp PB', calories: 480, protein: 16, carbs: 65, fat: 16 },
          { food: 'Whole eggs', quantity: '3', calories: 210, protein: 18, carbs: 1, fat: 15 },
        ],
      },
      {
        name: 'Lunch', time: '1:00 PM',
        items: [
          { food: 'Chicken/paneer curry', quantity: '200g', calories: 350, protein: 40, carbs: 8, fat: 16 },
          { food: 'Rice', quantity: '1.5 cups cooked', calories: 330, protein: 7, carbs: 68, fat: 2 },
          { food: 'Dal', quantity: '1 cup', calories: 150, protein: 9, carbs: 22, fat: 3 },
        ],
      },
      {
        name: 'Pre/Post-Workout', time: '5:30 PM',
        items: [
          { food: 'Whey protein shake with milk', quantity: '1 scoop + 300ml milk', calories: 280, protein: 32, carbs: 20, fat: 7 },
          { food: 'Banana', quantity: '1 large', calories: 120, protein: 1, carbs: 31, fat: 0 },
        ],
      },
      {
        name: 'Dinner', time: '8:30 PM',
        items: [
          { food: 'Grilled meat, fish or tofu', quantity: '200g', calories: 320, protein: 42, carbs: 2, fat: 14 },
          { food: 'Sweet potato or roti', quantity: '200g / 3 pcs', calories: 220, protein: 5, carbs: 45, fat: 2 },
          { food: 'Sautéed vegetables', quantity: '1.5 cups', calories: 110, protein: 4, carbs: 15, fat: 4 },
        ],
      },
    ],
  },

  {
    name: 'Vegetarian Balanced',
    goal: 'general',
    targetCalories: 2000,
    targetProtein: 105,
    targetCarbs: 260,
    targetFat: 65,
    description:
      'A fully vegetarian balanced template combining legumes, dairy and paneer/tofu to reach a ' +
      'solid protein intake without meat or fish — built for the many members who train ' +
      'vegetarian. Varying protein sources across the day (dal + dairy + paneer/tofu/nuts) is the ' +
      'simplest way to cover the full amino acid profile that any single plant source may lack on ' +
      'its own.',
    meals: [
      {
        name: 'Breakfast', time: '8:00 AM',
        items: [
          { food: 'Vegetable poha or upma', quantity: '1.5 cups', calories: 280, protein: 6, carbs: 50, fat: 8 },
          { food: 'Curd', quantity: '150g', calories: 90, protein: 8, carbs: 7, fat: 4 },
        ],
      },
      {
        name: 'Lunch', time: '1:00 PM',
        items: [
          { food: 'Paneer or chana curry', quantity: '200g', calories: 320, protein: 22, carbs: 18, fat: 18 },
          { food: 'Rice or 2 rotis', quantity: '1 cup / 2 pcs', calories: 220, protein: 5, carbs: 45, fat: 2 },
          { food: 'Dal', quantity: '1 cup', calories: 150, protein: 9, carbs: 22, fat: 3 },
          { food: 'Salad', quantity: '1 cup', calories: 40, protein: 2, carbs: 7, fat: 0 },
        ],
      },
      {
        name: 'Evening Snack', time: '5:00 PM',
        items: [
          { food: 'Roasted chana or peanuts', quantity: '30g', calories: 150, protein: 8, carbs: 12, fat: 8 },
          { food: 'Buttermilk', quantity: '1 glass', calories: 40, protein: 3, carbs: 4, fat: 1 },
        ],
      },
      {
        name: 'Dinner', time: '8:00 PM',
        items: [
          { food: 'Tofu or soya chunk curry', quantity: '180g', calories: 250, protein: 24, carbs: 12, fat: 12 },
          { food: 'Quinoa or 2 rotis', quantity: '3/4 cup / 2 pcs', calories: 180, protein: 6, carbs: 32, fat: 3 },
          { food: 'Mixed vegetable sabzi', quantity: '1 cup', calories: 120, protein: 4, carbs: 15, fat: 5 },
        ],
      },
    ],
  },

  {
    name: 'Indian Vegetarian Thali',
    goal: 'general',
    targetCalories: 2100,
    targetProtein: 95,
    targetCarbs: 300,
    targetFat: 62,
    description:
      'A traditional Indian vegetarian thali-style template spanning both North and South Indian ' +
      'staples — idli/sambar or poha for breakfast, a full thali (roti or rice + dal + sabzi + ' +
      'curd) for lunch and dinner, with sprouts or roasted chana for snacking. Built around dishes ' +
      'a member will actually recognise and find in most Indian kitchens, rather than substituting ' +
      'in oats/quinoa-style "diet food". Protein comes from dal, curd, paneer and sprouts spread ' +
      'across the day — swap in an extra glass of milk or a scoop of whey if a higher protein ' +
      'target is needed for muscle-building goals.',
    meals: [
      {
        name: 'Breakfast', time: '7:30 AM',
        items: [
          { food: 'Idli with sambar', quantity: '4 idli + 1 cup sambar', calories: 320, protein: 12, carbs: 58, fat: 5 },
          { food: 'Coconut chutney', quantity: '2 tbsp', calories: 60, protein: 1, carbs: 3, fat: 5 },
          { food: 'Masala chai (less sugar)', quantity: '1 cup', calories: 60, protein: 2, carbs: 8, fat: 2 },
        ],
      },
      {
        name: 'Mid-Morning Snack', time: '10:30 AM',
        items: [
          { food: 'Seasonal fruit', quantity: '1 bowl (200g)', calories: 100, protein: 1, carbs: 25, fat: 0 },
          { food: 'Soaked almonds & walnuts', quantity: '8-10 pcs', calories: 100, protein: 3, carbs: 3, fat: 9 },
        ],
      },
      {
        name: 'Lunch Thali', time: '1:00 PM',
        items: [
          { food: 'Roti', quantity: '3 medium', calories: 240, protein: 8, carbs: 48, fat: 3 },
          { food: 'Steamed rice', quantity: '1/2 cup', calories: 110, protein: 2, carbs: 24, fat: 0 },
          { food: 'Dal tadka', quantity: '1.5 cups', calories: 220, protein: 13, carbs: 32, fat: 5 },
          { food: 'Mixed vegetable sabzi', quantity: '1 cup', calories: 130, protein: 4, carbs: 16, fat: 6 },
          { food: 'Curd', quantity: '1 small bowl (150g)', calories: 90, protein: 8, carbs: 7, fat: 4 },
          { food: 'Cucumber-onion salad + pickle', quantity: '1 small plate', calories: 40, protein: 1, carbs: 8, fat: 0 },
        ],
      },
      {
        name: 'Evening Snack', time: '5:30 PM',
        items: [
          { food: 'Sprouts chaat (moong/chana)', quantity: '1 cup', calories: 180, protein: 11, carbs: 26, fat: 4 },
          { food: 'Masala chai or green tea', quantity: '1 cup', calories: 40, protein: 1, carbs: 6, fat: 1 },
        ],
      },
      {
        name: 'Dinner Thali', time: '8:30 PM',
        items: [
          { food: 'Roti', quantity: '2 medium', calories: 160, protein: 5, carbs: 32, fat: 2 },
          { food: 'Paneer bhurji or paneer sabzi', quantity: '150g', calories: 280, protein: 18, carbs: 10, fat: 19 },
          { food: 'Palak or lauki sabzi', quantity: '1 cup', calories: 90, protein: 3, carbs: 10, fat: 4 },
          { food: 'Curd', quantity: '1 small bowl (150g)', calories: 90, protein: 8, carbs: 7, fat: 4 },
        ],
      },
    ],
  },
]
