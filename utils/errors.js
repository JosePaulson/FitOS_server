/**
 * Error-message policy
 *
 *   development (NODE_ENV=development)  → technical detail: real error text, name, code, stack
 *   anything else, incl. NODE_ENV unset → plain-language messages only
 *
 * "Anything else" is deliberately the safe default: forgetting to set
 * NODE_ENV on a server must never expose internals to members or staff.
 */
export const isDev = () => process.env.NODE_ENV === 'development'

/** Technical text while developing, friendly text everywhere else. */
export const devOr = (technical, friendly) => (isDev() ? technical : friendly)

export const GENERIC_MESSAGE = 'Something went wrong on our side. Please try again in a moment.'
export const UNAVAILABLE_MESSAGE = 'We couldn\u2019t complete that right now. Please try again in a moment.'

/**
 * Attach a message that is safe to show people in production to an Error
 * (the error's own `message` stays technical, for logs and development).
 */
export function withUserMessage(err, userMessage, status) {
  err.userMessage = userMessage
  if (status) err.status = status
  return err
}
