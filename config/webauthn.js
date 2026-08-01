/**
 * Resolves the WebAuthn Relying Party ID and expected origin for the
 * current request. Reads the actual `Origin` header rather than assuming
 * one fixed production domain, so this works correctly whether the
 * member portal is served from a custom domain, a Vercel preview URL, or
 * localhost during development — WebAuthn just needs `rpID` to be a
 * valid domain suffix of whatever origin the page was actually loaded
 * from. Set WEBAUTHN_RP_ID explicitly in production if you want to pin
 * it rather than trust the incoming Origin header.
 */
export function getRpIdAndOrigin(req) {
  const origin = req.headers.origin || process.env.MEMBER_PORTAL_URL || 'http://localhost:5173'
  let rpID = process.env.WEBAUTHN_RP_ID
  if (!rpID) {
    try { rpID = new URL(origin).hostname } catch { rpID = 'localhost' }
  }
  return { rpID, origin, rpName: process.env.WEBAUTHN_RP_NAME || 'FitOS' }
}

// A registration/login ceremony must complete within this window.
export const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000
