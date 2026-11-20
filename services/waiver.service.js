import Gym from '../models/Gym.js'
import Member from '../models/Member.js'
import MemberWaiver from '../models/MemberWaiver.js'

/** Standard 7-question PAR-Q (Physical Activity Readiness Questionnaire). */
export const PARQ_QUESTIONS = [
  'Has your doctor ever said that you have a heart condition and that you should only do physical activity recommended by a doctor?',
  'Do you feel pain in your chest when you do physical activity?',
  'In the past month, have you had chest pain when you were not doing physical activity?',
  'Do you lose your balance because of dizziness, or do you ever lose consciousness?',
  'Do you have a bone or joint problem (for example back, knee or hip) that could be made worse by a change in your physical activity?',
  'Is your doctor currently prescribing drugs (for example water pills) for your blood pressure or a heart condition?',
  'Do you know of any other reason why you should not do physical activity?',
]

// A starting point only — owners can replace it in Settings, and should have
// it reviewed by a lawyer. {{gymName}} is filled in automatically.
export const DEFAULT_WAIVER_TEXT = `MEMBERSHIP WAIVER AND RELEASE OF LIABILITY — {{gymName}}

1. Assumption of risk. I understand that exercise and the use of gym equipment, classes and personal training involve a risk of injury, including serious injury. I take part voluntarily and at my own risk.

2. Health declaration. I confirm that the health information I give on the health questionnaire is true and complete, and that I will tell the gym of any change in my health. I understand I should consult a doctor before starting an exercise programme if I answered "Yes" to any question.

3. Following instructions. I will use equipment correctly, follow the instructions of the staff and trainers, and stop exercising and seek help if I feel unwell.

4. Release. To the fullest extent permitted by law, I release {{gymName}}, its owners and staff from liability for any injury, loss or damage arising from my use of the facilities, except where caused by their negligence or wilful misconduct.

5. Personal belongings. I am responsible for my own belongings; the gym is not liable for loss or theft.

6. Rules. I agree to follow the gym's rules and understand my membership may be ended if I do not.

7. Minors. If the member is under 18, a parent or guardian confirms they have read and agree to this waiver on the member's behalf.

By signing below I confirm I have read, understood and agree to this waiver.`

/** Waiver settings for a gym, with the built-in text when the owner hasn't set one. */
export async function getWaiverConfig(gymId) {
  const gym = await Gym.findById(gymId).select('name settings.waiver').lean()
  const w = gym?.settings?.waiver || {}
  const gymName = gym?.name || 'the gym'
  const raw = (w.text && w.text.trim()) ? w.text : DEFAULT_WAIVER_TEXT
  return {
    enabled: !!w.enabled,
    version: w.version || 1,
    gymName,
    text: raw.replace(/\{\{\s*gymName\s*\}\}/g, gymName),
    questions: PARQ_QUESTIONS,
  }
}

export function memberAge(member) {
  if (member?.dob) {
    const d = new Date(member.dob)
    if (!Number.isNaN(d.getTime())) {
      const now = new Date()
      let age = now.getFullYear() - d.getFullYear()
      if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) age--
      return age
    }
  }
  return Number.isFinite(member?.age) ? member.age : null
}

/** Where a member stands: { signed, current, signedAt, parqFlagged, needsGuardian }. */
export function waiverStatus(member, cfg) {
  const w = member?.waiver
  const signed = !!w?.signedAt
  const age = memberAge(member)
  return {
    signed,
    current: signed && w.version === cfg.version,
    signedAt: w?.signedAt,
    parqFlagged: !!w?.parqFlagged,
    needsGuardian: age !== null && age < 18,
  }
}

/**
 * Validates and stores a signed waiver + PAR-Q. Throws Error with `.status` 400
 * and a message that's safe to show the person signing.
 */
export async function signWaiver({
  gymId, member, answers, signedName, guardianName, signature, agreed, via, receivedBy, ip, userAgent,
}) {
  const fail = (m) => Object.assign(new Error(m), { status: 400 })
  const cfg = await getWaiverConfig(gymId)

  if (!cfg.enabled) throw fail('The waiver isn\u2019t switched on for this gym')
  if (agreed !== true) throw fail('Please confirm that you have read and agree to the waiver')
  if (!Array.isArray(answers) || answers.length !== PARQ_QUESTIONS.length || answers.some((a) => typeof a !== 'boolean')) {
    throw fail('Please answer every health question with Yes or No')
  }
  const name = String(signedName || '').trim()
  if (name.length < 2) throw fail('Type your full name to sign')

  const age = memberAge(member)
  const guardian = String(guardianName || '').trim()
  if (age !== null && age < 18 && !guardian) throw fail('A parent or guardian must sign for members under 18')

  let sig
  if (signature) {
    if (typeof signature !== 'string' || signature.length > 250_000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature)) {
      throw fail('The signature image isn\u2019t valid \u2014 please sign again')
    }
    sig = signature
  }

  const parqFlagged = answers.some(Boolean)
  const waiver = await MemberWaiver.create({
    gymId, memberId: member._id,
    version: cfg.version, textSnapshot: cfg.text,
    parq: PARQ_QUESTIONS.map((question, i) => ({ question, answer: answers[i] })),
    parqFlagged,
    signedName: name, guardianName: guardian || undefined, signature: sig,
    via, receivedBy, ip, userAgent: userAgent ? String(userAgent).slice(0, 300) : undefined,
  })

  await Member.updateOne(
    { _id: member._id },
    { $set: { waiver: { version: cfg.version, signedAt: waiver.signedAt, parqFlagged } } }
  )
  return waiver
}
