import { Router } from 'express'
import { memberProtect } from '../middleware/memberAuth.js'
import { uploadImage, handleUploadErrors } from '../middleware/upload.js'
import { uploadImageBuffer, deleteAsset } from '../services/cloudinaryUpload.service.js'
import FoodScan from '../models/FoodScan.js'

const router = Router()
router.use(memberProtect)

// Only the member's most recent scans are kept — older ones (and their
// Cloudinary images) are purged every time a new scan is saved.
const MAX_HISTORY = 5

/**
 * Deletes every scan beyond the most recent MAX_HISTORY for this member —
 * both the Mongo document and its Cloudinary image, so nothing is orphaned.
 */
async function enforceHistoryLimit(gymId, memberId) {
  const excess = await FoodScan.find({ gymId, memberId })
    .sort({ createdAt: -1 })
    .skip(MAX_HISTORY)
    .select('_id imagePublicId')

  if (excess.length === 0) return

  await Promise.all(excess.map((s) => deleteAsset(s.imagePublicId)))
  await FoodScan.deleteMany({ _id: { $in: excess.map((s) => s._id) } })
}

/**
 * Structured-output schema — Gemini will conform its JSON to this instead of
 * us just asking nicely in the prompt. Eliminates almost all parse failures.
 */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    mealLabel: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          quantity: { type: 'STRING' },
          calories: { type: 'NUMBER' },
          protein: { type: 'NUMBER' },
          carbs: { type: 'NUMBER' },
          fat: { type: 'NUMBER' },
        },
        required: ['name', 'calories', 'protein', 'carbs', 'fat'],
      },
    },
    totalCalories: { type: 'NUMBER' },
    totalProtein: { type: 'NUMBER' },
    totalCarbs: { type: 'NUMBER' },
    totalFat: { type: 'NUMBER' },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    notes: { type: 'STRING' },
  },
  required: ['items', 'totalCalories', 'totalProtein', 'totalCarbs', 'totalFat', 'confidence', 'notes'],
}

/**
 * Prompt sent to the vision model. responseSchema (above) enforces the JSON
 * shape, so this focuses purely on estimation quality/accuracy.
 */
const VISION_PROMPT = `You are a precise nutrition estimation assistant analysing a photo of a meal for a gym member's food diary.

Identify each distinct food/drink item visible. For each one:
- Estimate portion size from visual reference cues in the frame (plate diameter ~26cm for a standard dinner plate, cutlery length, hand/finger size, cup/bowl size). State your portion estimate in "quantity".
- Estimate calories and macros (protein/carbs/fat in grams) using realistic values for that food and portion — reason as if looking up a standard nutrition database (USDA / IFCT for Indian dishes), not rough guesses. Account for visible oil, ghee, sauce, or frying which meaningfully raises calories/fat.
- Do not default to round numbers out of laziness (e.g. always 100/200/300) — vary estimates to match what's actually in the photo.

Then set:
- "totalCalories"/"totalProtein"/"totalCarbs"/"totalFat" = the sum of all items (recompute the sum yourself, don't guess it separately).
- "confidence": "high" only if portions and ingredients are clearly visible with a size reference; "medium" if reasonably clear but some guessing is needed; "low" if lighting/angle/mixed ingredients make it hard to judge.
- "notes": one short sentence on the main assumption you made (e.g. portion size, hidden oil, ambiguous ingredient).
- "mealLabel": a short human-readable name for the overall meal.

If the image does not clearly show food, return an empty "items" array, all totals as 0, "confidence": "low", and explain why in "notes".`

/**
 * Calls Google Gemini's vision-capable model with the image and returns the
 * parsed JSON result. Gemini is used because it offers a genuinely free
 * tier (Google AI Studio) with strong multimodal food-recognition accuracy —
 * unlike OpenAI/Anthropic vision, which are pay-as-you-go only.
 *
 * Model is configurable via GEMINI_VISION_MODEL. Defaults to the full
 * "gemini-3.5-flash" — Google's current default Flash-tier model (GA since
 * May 2026). Older families (2.5-flash, 2.0-flash, 2.0-flash-lite) have been
 * progressively retired/closed to new users, so we no longer default to
 * them — set GEMINI_VISION_MODEL to override if you're on an older/newer
 * family. Avoid "-lite" variants specifically: they're faster/cheaper but
 * noticeably less accurate at portion/calorie estimation from a photo.
 *
 * IMPORTANT — thinking tokens: Gemini models reason internally before
 * answering, and those "thinking" tokens are deducted from maxOutputTokens.
 * Left unmanaged, a model can burn its entire token budget reasoning and
 * get cut off before writing any visible JSON — which shows up as an empty
 * or truncated response ("could not parse AI response"). How you control
 * this differs by generation, so buildThinkingConfig() below picks the
 * right knob for whichever model is configured:
 *   - Gemini 3.x  → thinkingConfig.thinkingLevel: 'minimal'/'low'/'medium'/'high'
 *                   (thinkingBudget is rejected/unreliable on Gemini 3 —
 *                   mixing the two params is a hard 400 error)
 *   - Gemini 2.5  → thinkingConfig.thinkingBudget: 0 disables it entirely
 *   - Gemini 2.0/1.5 → no thinking support; omit thinkingConfig
 * We use the lowest level for this task since it's structured extraction,
 * not multi-step reasoning — keeps it fast, cheap, and reliable.
 */
function buildThinkingConfig(model) {
  if (/^gemini-3/.test(model)) {
    // "minimal" isn't accepted by every Gemini 3 Pro variant (thinking can't
    // be fully disabled on Pro) — fall back to "low" for those.
    return { thinkingLevel: model.includes('pro') ? 'low' : 'minimal' }
  }
  if (/^gemini-2\.5/.test(model)) {
    return { thinkingBudget: 0 }
  }
  return null // 2.0 / 1.5 families don't support thinking — leave unset
}

async function analyzeWithGemini(base64Image, mimeType) {
  if (!process.env.GEMINI_API_KEY) {
    const err = new Error('AI vision service not configured. Set GEMINI_API_KEY in server/.env')
    err.statusCode = 503
    throw err
  }

  const model = process.env.GEMINI_VISION_MODEL || 'gemini-3.5-flash'
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`

  const generationConfig = {
    temperature: 0.2,
    maxOutputTokens: 3072,
    responseMimeType: 'application/json',
    responseSchema: RESPONSE_SCHEMA,
  }
  const thinkingConfig = buildThinkingConfig(model)
  if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: VISION_PROMPT },
          { inline_data: { mime_type: mimeType, data: base64Image } },
        ],
      }],
      generationConfig,
    }),
  })

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}))
    const err = new Error(errBody.error?.message || `Gemini vision API error (${response.status})`)
    err.statusCode = 502
    throw err
  }

  const data = await response.json()

  // Blocked by safety filters — no candidates at all
  if (data.promptFeedback?.blockReason) {
    const err = new Error(`Image was blocked by AI safety filters (${data.promptFeedback.blockReason}) — try a different photo`)
    err.statusCode = 422
    throw err
  }

  const candidate = data.candidates?.[0]
  const text = candidate?.content?.parts?.map((p) => p.text || '').join('') || ''

  if (!text) {
    // Most common cause: the model hit MAX_TOKENS (often while "thinking")
    // before writing any output text — surface that specifically.
    console.error('[food-scan] empty text from Gemini. finishReason:', candidate?.finishReason, JSON.stringify(data).slice(0, 800))
    const hint = candidate?.finishReason === 'MAX_TOKENS'
      ? ' (response was cut off — try again, or increase GEMINI_VISION model budget)'
      : ''
    const err = new Error(`Empty response from AI vision service${hint}`)
    err.statusCode = 502
    throw err
  }

  let parsed
  try {
    // Defensive: strip markdown fences if the model added them anyway
    const cleaned = text.trim().replace(/^```json\s*|^```\s*|```$/g, '')
    parsed = JSON.parse(cleaned)
  } catch {
    // Second attempt: some models prepend/append stray prose even in JSON
    // mode — pull out the first {...} block and try again before giving up.
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      try { parsed = JSON.parse(match[0]) } catch { /* fall through */ }
    }
    if (!parsed) {
      console.error('[food-scan] JSON parse failed. finishReason:', candidate?.finishReason, 'raw text:', text.slice(0, 800))
      const err = new Error('Could not parse AI response — try another photo')
      err.statusCode = 502
      throw err
    }
  }

  return parsed
}

/**
 * POST /api/member-portal/food-scan
 * Multipart form field "image". Runs the photo through the AI vision model,
 * saves the result to the member's scan history, and returns it.
 */
router.post('/', handleUploadErrors(uploadImage), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No image uploaded' })

    const base64Image = req.file.buffer.toString('base64')

    // Run the AI analysis and the Cloudinary upload in parallel — independent
    // of each other, so no reason to wait on one before starting the other.
    // The image upload is best-effort: if Cloudinary fails, we still want to
    // return the calorie estimate rather than fail the whole scan.
    const [result, uploaded] = await Promise.all([
      analyzeWithGemini(base64Image, req.file.mimetype),
      uploadImageBuffer(req.file.buffer, 'fitos/food-scans').catch((err) => {
        console.error('[food-scan] Cloudinary upload failed:', err.message)
        return null
      }),
    ])

    const items = Array.isArray(result.items) ? result.items.slice(0, 20).map((it) => ({
      name: String(it.name || 'Item').slice(0, 120),
      quantity: it.quantity ? String(it.quantity).slice(0, 60) : '',
      calories: Number(it.calories) || 0,
      protein: Number(it.protein) || 0,
      carbs: Number(it.carbs) || 0,
      fat: Number(it.fat) || 0,
    })) : []

    const round = (n) => Math.round(Number(n) || 0)
    const totalCalories = result.totalCalories != null ? round(result.totalCalories) : round(items.reduce((s, i) => s + i.calories, 0))
    const totalProtein = result.totalProtein != null ? round(result.totalProtein) : round(items.reduce((s, i) => s + i.protein, 0))
    const totalCarbs = result.totalCarbs != null ? round(result.totalCarbs) : round(items.reduce((s, i) => s + i.carbs, 0))
    const totalFat = result.totalFat != null ? round(result.totalFat) : round(items.reduce((s, i) => s + i.fat, 0))

    const scan = await FoodScan.create({
      gymId: req.gymId,
      memberId: req.memberId,
      imageUrl: uploaded?.url || '',
      imagePublicId: uploaded?.publicId || '',
      items,
      totalCalories,
      totalProtein,
      totalCarbs,
      totalFat,
      confidence: ['high', 'medium', 'low'].includes(result.confidence) ? result.confidence : 'medium',
      notes: result.notes ? String(result.notes).slice(0, 500) : '',
      mealLabel: result.mealLabel ? String(result.mealLabel).slice(0, 150) : '',
      provider: 'gemini',
    })

    // Keep only the last MAX_HISTORY scans — purge anything older (DB + Cloudinary).
    enforceHistoryLimit(req.gymId, req.memberId).catch((err) =>
      console.error('[food-scan] history cleanup failed:', err.message)
    )

    res.status(201).json({
      scan,
      disclaimer: 'These values are estimated by AI from your photo and are only approximate. They are not a substitute for precise nutrition tracking or medical/dietary advice.',
    })
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message })
    console.error('[food-scan]', err.message)
    next(err)
  }
})

/** GET /api/member-portal/food-scan — recent scan history (at most the last MAX_HISTORY) */
router.get('/', async (req, res, next) => {
  try {
    const { limit = MAX_HISTORY } = req.query
    const scans = await FoodScan.find({ gymId: req.gymId, memberId: req.memberId })
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || MAX_HISTORY, MAX_HISTORY))
    res.json({ scans })
  } catch (err) { next(err) }
})

/** GET /api/member-portal/food-scan/:id — single scan detail */
router.get('/:id', async (req, res, next) => {
  try {
    const scan = await FoodScan.findOne({ _id: req.params.id, gymId: req.gymId, memberId: req.memberId })
    if (!scan) return res.status(404).json({ message: 'Scan not found' })
    res.json(scan)
  } catch (err) { next(err) }
})

/** DELETE /api/member-portal/food-scan/:id — remove a scan (DB + Cloudinary) from history */
router.delete('/:id', async (req, res, next) => {
  try {
    const scan = await FoodScan.findOneAndDelete({ _id: req.params.id, gymId: req.gymId, memberId: req.memberId })
    if (!scan) return res.status(404).json({ message: 'Scan not found' })
    await deleteAsset(scan.imagePublicId)
    res.json({ message: 'Deleted' })
  } catch (err) { next(err) }
})

export default router
