import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import Member      from '../models/Member.js'
import WorkoutPlan from '../models/WorkoutPlan.js'
import DietPlan    from '../models/DietPlan.js'
import Gym         from '../models/Gym.js'

const router = Router()

// All chat routes require member JWT
router.use(memberProtect)

/**
 * Builds a rich system prompt with the member's real data so the AI
 * gives personalised, contextually accurate responses.
 */
async function buildSystemPrompt(memberId, gymId) {
  const [member, gym, workoutPlans, dietPlans] = await Promise.all([
    Member.findById(memberId)
      .populate('currentPlanId', 'name durationDays price sessionsIncluded')
      .populate('assignedTrainerId', 'name')
      .select('name membershipStatus membershipExpiryDate healthNotes'),
    Gym.findById(gymId).select('name'),
    WorkoutPlan.find({ gymId, assignedTo: memberId, isActive: true }).select('name goal days'),
    DietPlan.find({ gymId, assignedTo: memberId, isActive: true })
      .select('name goal targetCalories targetProtein targetCarbs targetFat'),
  ])

  const workoutSummary = workoutPlans.map((p) =>
    `- ${p.name} (goal: ${p.goal}, ${p.days?.length || 0} training days)`
  ).join('\n') || 'None assigned'

  const dietSummary = dietPlans.map((p) => {
    const macros = [
      p.targetCalories && `${p.targetCalories} kcal`,
      p.targetProtein  && `${p.targetProtein}g protein`,
      p.targetCarbs    && `${p.targetCarbs}g carbs`,
      p.targetFat      && `${p.targetFat}g fat`,
    ].filter(Boolean).join(', ')
    return `- ${p.name} (goal: ${p.goal}${macros ? `, targets: ${macros}` : ''})`
  }).join('\n') || 'None assigned'

  return `You are FitBot, an expert AI fitness coach embedded in the FitOS gym management app.

You are currently speaking with ${member?.name || 'a gym member'} at ${gym?.name || 'their gym'}.

MEMBER PROFILE:
- Name: ${member?.name}
- Membership status: ${member?.membershipStatus}
- Membership expires: ${member?.membershipExpiryDate ? new Date(member.membershipExpiryDate).toLocaleDateString('en-IN') : 'N/A'}
- Current plan: ${member?.currentPlanId?.name || 'No active plan'}
- Assigned trainer: ${member?.assignedTrainerId?.name || 'None'}
- Health notes: ${member?.healthNotes || 'None on file'}

ASSIGNED WORKOUT PLANS:
${workoutSummary}

ASSIGNED DIET PLANS:
${dietSummary}

YOUR ROLE:
- Answer fitness questions with clear, safe, evidence-based advice
- Help with exercise form, technique and injury prevention
- Create personalised diet plan suggestions based on the member's goals and current plan
- Explain nutrition concepts (macros, calories, meal timing) in simple terms
- Motivate and support the member's fitness journey
- Reference the member's assigned plans when relevant
- If asked about serious medical conditions or injuries, recommend consulting a doctor

GUIDELINES:
- Keep responses concise and practical — the member is on a mobile app
- Use bullet points for exercise instructions and meal plans
- Always prioritise safety — never recommend exercises that could cause injury
- Be warm, encouraging and professional
- If you don't know something, say so rather than guessing
- For diet plans, consider common Indian food preferences and availability
- Measurements: use kg, cm, and kcal unless the member specifies otherwise`
}

/**
 * POST /api/member-portal/chat
 *
 * Body:
 *   messages: [{ role: 'user'|'assistant', content: string }]  — full conversation history
 *
 * The server appends the system prompt (with member context) and calls the AI API.
 * Supports OpenAI (default), Anthropic Claude, and Google Gemini — set AI_PROVIDER env var.
 */
router.post('/', async (req, res, next) => {
  try {
    const { messages } = req.body
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ message: 'messages array required' })
    }

    const systemPrompt = await buildSystemPrompt(req.memberId, req.gymId)
    const provider     = (process.env.AI_PROVIDER || 'openai').toLowerCase()

    let reply

    // ── OpenAI ────────────────────────────────────────────────────────────
    if (provider === 'openai') {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({ message: 'AI service not configured. Set OPENAI_API_KEY in server/.env' })
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model:       process.env.OPENAI_MODEL || 'gpt-4o-mini',
          max_tokens:  1000,
          temperature: 0.7,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages,
          ],
        }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error?.message || 'OpenAI API error')
      }

      const data = await response.json()
      reply = data.choices[0]?.message?.content

    // ── Anthropic Claude ──────────────────────────────────────────────────
    } else if (provider === 'anthropic') {
      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(503).json({ message: 'AI service not configured. Set ANTHROPIC_API_KEY in server/.env' })
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          system:     systemPrompt,
          messages,
        }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error?.message || 'Anthropic API error')
      }

      const data = await response.json()
      reply = data.content?.[0]?.text

    // ── Google Gemini ─────────────────────────────────────────────────────
    } else if (provider === 'gemini') {
      if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({ message: 'AI service not configured. Set GEMINI_API_KEY in server/.env' })
      }

      const model    = process.env.GEMINI_MODEL || 'gemini-1.5-flash'
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`

      // Gemini uses a different message format
      const geminiMessages = messages.map((m) => ({
        role:  m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

      const response = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: geminiMessages,
          generationConfig: { maxOutputTokens: 1000, temperature: 0.7 },
        }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error?.message || 'Gemini API error')
      }

      const data = await response.json()
      reply = data.candidates?.[0]?.content?.parts?.[0]?.text

    } else {
      return res.status(400).json({ message: `Unknown AI_PROVIDER: ${provider}. Use 'openai', 'anthropic', or 'gemini'` })
    }

    if (!reply) throw new Error('Empty response from AI provider')

    res.json({ reply })
  } catch (err) {
    console.error('[AI chat]', err.message)
    next(err)
  }
})

/**
 * GET /api/member-portal/chat/suggestions
 * Returns context-aware quick-start prompts based on the member's data.
 */
router.get('/suggestions', async (req, res, next) => {
  try {
    const member = await Member.findById(req.memberId)
      .populate('currentPlanId', 'name sessionsIncluded')

    const hasPT   = (member?.currentPlanId?.sessionsIncluded || 0) > 0
    const expired = member?.membershipStatus === 'expired'

    const suggestions = [
      'Create a personalised meal plan for me',
      'What should I eat before and after my workout?',
      'How do I do a proper squat?',
      'Explain the correct form for a deadlift',
      'How many calories should I eat to lose weight?',
      'What are the best exercises for building a stronger core?',
      'How much protein do I need daily?',
      'Create a 7-day workout plan for me',
      ...(hasPT ? ['What should I prepare for my PT session?'] : []),
      ...(expired ? [] : ['Help me track my progress this month']),
    ]

    res.json(suggestions.slice(0, 6))
  } catch (err) { next(err) }
})

export default router
