/**
 * Extract tax breakdown from a tax-inclusive price.
 *
 * @param {number} inclusivePrice  - The final price the member pays (GST included)
 * @param {number} taxRate         - GST percentage (default 18)
 * @returns {{ baseAmount, taxAmount, totalAmount }}
 *
 * Formula:
 *   baseAmount  = inclusivePrice / (1 + taxRate/100)
 *   taxAmount   = inclusivePrice - baseAmount
 *   totalAmount = inclusivePrice  (unchanged — what member actually pays)
 */
export function extractTax(inclusivePrice, taxRate = 18) {
  const totalAmount = Math.round(inclusivePrice * 100) / 100
  const baseAmount  = Math.round((totalAmount / (1 + taxRate / 100)) * 100) / 100
  const taxAmount   = Math.round((totalAmount - baseAmount) * 100) / 100
  return { baseAmount, taxAmount, totalAmount }
}
