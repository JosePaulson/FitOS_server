import { extractTax } from './tax.js'

const round2 = (n) => Math.round(n * 100) / 100

/**
 * Discount a coupon gives on a tax-inclusive `amount`.
 * Percent coupons honour `maxDiscount`; no discount ever exceeds the amount.
 */
export function computeDiscount(coupon, amount) {
  if (!coupon || !(amount > 0)) return 0
  let d = coupon.type === 'percent'
    ? (amount * coupon.value) / 100
    : coupon.value
  if (coupon.type === 'percent' && coupon.maxDiscount > 0) d = Math.min(d, coupon.maxDiscount)
  return round2(Math.min(Math.max(d, 0), amount))
}

/**
 * Invoice amounts for a tax-inclusive list price and an optional discount.
 * GST is extracted from what the member actually pays (the discounted price),
 * which is how a pre-supply discount works under GST.
 */
export function priceInvoice(listPrice, taxRate = 18, discount = 0) {
  const listAmount = round2(listPrice)
  const discountAmount = round2(Math.min(Math.max(discount, 0), listAmount))
  const { baseAmount, taxAmount, totalAmount } = extractTax(listAmount - discountAmount, taxRate)
  return { listAmount, discountAmount, baseAmount, taxAmount, totalAmount }
}

/** Intra-state supply: GST splits evenly into CGST + SGST. */
export function splitGst(taxAmount) {
  const cgst = round2(taxAmount / 2)
  return { cgst, sgst: round2(taxAmount - cgst) }
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
  'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function below1000(n) {
  let out = ''
  if (n >= 100) { out += `${ONES[Math.floor(n / 100)]} Hundred `; n %= 100 }
  if (n >= 20) { out += `${TENS[Math.floor(n / 10)]} `; n %= 10 }
  if (n > 0) out += `${ONES[n]} `
  return out
}

/** "Rupees One Thousand One Hundred Eighty Only" — Indian numbering (lakh/crore). */
export function amountInWordsINR(amount) {
  const total = Math.round(Math.abs(amount) * 100)
  let rupees = Math.floor(total / 100)
  const paise = total % 100
  if (rupees === 0 && paise === 0) return 'Rupees Zero Only'

  let words = ''
  const crore = Math.floor(rupees / 10000000); rupees %= 10000000
  const lakh = Math.floor(rupees / 100000);    rupees %= 100000
  const thousand = Math.floor(rupees / 1000);  rupees %= 1000
  if (crore) words += `${below1000(crore)}Crore `
  if (lakh) words += `${below1000(lakh)}Lakh `
  if (thousand) words += `${below1000(thousand)}Thousand `
  if (rupees) words += below1000(rupees)

  words = words.trim()
  let out = words ? `Rupees ${words}` : 'Rupees Zero'
  if (paise) out += ` and ${below1000(paise).trim()} Paise`
  return `${out} Only`
}
