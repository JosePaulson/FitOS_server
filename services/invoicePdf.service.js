import PDFDocument from 'pdfkit'
import { extractTax } from '../utils/tax.js'
import { splitGst, amountInWordsINR } from '../utils/pricing.js'
import { fmtDate as formatDateIST } from '../utils/dateFormat.js'

// pdfkit's built-in Helvetica has no ₹ glyph, so amounts are printed as "Rs."
const money = (n) => `Rs. ${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (d) => (d ? formatDateIST(d) : '-')
const METHOD = { cash: 'Cash', upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', emi: 'EMI', paylater: 'Pay later', online: 'Online', other: 'Other' }

const INK = '#111827', MUTED = '#6b7280', LINE = '#d1d5db', ACCENT = '#1f2937'

/**
 * Streams a GST invoice PDF into `res` (an Express response or any writable).
 *
 * @param invoice  Invoice doc, with planId / ptPlanId populated when present
 * @param member   Member doc
 * @param gym      Gym doc (fallback seller details for invoices that predate the seller snapshot)
 */
export function streamInvoicePdf({ invoice, member, gym }, res) {
  const inv = invoice.toObject ? invoice.toObject({ virtuals: true }) : invoice
  const seller = (inv.seller?.legalName || inv.seller?.gstin) ? inv.seller : (gym?.settings?.gst || {})
  const hasGstin = !!seller.gstin
  const sellerName = seller.legalName || gym?.name || 'Gym'
  const sellerAddress = seller.address || [gym?.address, gym?.city, gym?.state].filter(Boolean).join(', ')

  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Invoice ${inv.invoiceNumber}`, Author: sellerName } })
  doc.pipe(res)

  const L = 40, R = doc.page.width - 40, W = R - L

  // ── Header ──────────────────────────────────────────────────────────────
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text(sellerName, L, 40, { width: W * 0.58 })
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
  if (sellerAddress) doc.text(sellerAddress, { width: W * 0.58 })
  if (gym?.phone) doc.text(`Phone: ${gym.phone}`, { width: W * 0.58 })
  if (hasGstin) doc.fillColor(INK).font('Helvetica-Bold').text(`GSTIN: ${seller.gstin}`, { width: W * 0.58 })
  const leftBottom = doc.y

  doc.font('Helvetica-Bold').fontSize(18).fillColor(ACCENT)
    .text(hasGstin ? 'TAX INVOICE' : 'INVOICE', L + W * 0.55, 40, { width: W * 0.45, align: 'right' })
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text(`Invoice no: ${inv.invoiceNumber}`, L + W * 0.55, doc.y + 2, { width: W * 0.45, align: 'right' })
    .text(`Date: ${fmtDate(inv.createdAt)}`, { width: W * 0.45, align: 'right' })
  if (inv.dueDate && inv.status !== 'paid') doc.text(`Due: ${fmtDate(inv.dueDate)}`, { width: W * 0.45, align: 'right' })
  const statusLabel = inv.status === 'partial' ? 'PARTIALLY PAID' : String(inv.status || '').toUpperCase()
  doc.font('Helvetica-Bold').fillColor(inv.status === 'paid' ? '#15803d' : '#b45309')
    .text(statusLabel, { width: W * 0.45, align: 'right' })

  let y = Math.max(leftBottom, doc.y) + 14
  doc.moveTo(L, y).lineTo(R, y).strokeColor(LINE).lineWidth(1).stroke()
  y += 12

  // ── Bill to ─────────────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('BILL TO', L, y)
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(member?.name || '-', L, doc.y + 2)
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
  if (member?.phone) doc.text(`Phone: ${member.phone}`)
  if (member?.email) doc.text(`Email: ${member.email}`)
  y = doc.y + 16

  // ── Line items ──────────────────────────────────────────────────────────
  const cDesc = L, cSac = L + W * 0.62, cAmt = L + W * 0.78, wAmt = R - cAmt
  doc.rect(L, y, W, 20).fill('#f3f4f6')
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK)
  doc.text('DESCRIPTION', cDesc + 8, y + 6)
  if (hasGstin) doc.text('SAC', cSac, y + 6)
  doc.text('TAXABLE VALUE', cAmt, y + 6, { width: wAmt - 8, align: 'right' })
  y += 26

  const rate = inv.taxRate ?? 0
  const listBase = inv.listAmount ? extractTax(inv.listAmount, rate).baseAmount : inv.baseAmount
  const discountTaxable = Math.max(0, Math.round((listBase - inv.baseAmount) * 100) / 100)

  const planName = inv.planId?.name || inv.ptPlanId?.name
  const description =
    inv.type === 'pt' ? `Personal training - ${planName || 'PT package'}`
    : inv.type === 'fee' ? (inv.notes || 'Membership fee')
    : `Gym membership - ${planName || 'Membership'}`

  const row = (label, amount, { bold = false, color = INK, sac = '' } = {}) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(color)
    const h = doc.heightOfString(label, { width: cSac - cDesc - 16 })
    doc.text(label, cDesc + 8, y, { width: cSac - cDesc - 16 })
    if (hasGstin && sac) doc.text(sac, cSac, y)
    doc.text(amount, cAmt, y, { width: wAmt - 8, align: 'right' })
    y += Math.max(h, 12) + 8
  }
  row(description, money(listBase), { sac: seller.sac || '' })
  if (discountTaxable > 0) row(`Discount${inv.couponCode ? ` (${inv.couponCode})` : ''}`, `- ${money(discountTaxable)}`, { color: '#15803d' })

  doc.moveTo(L, y).lineTo(R, y).strokeColor(LINE).stroke()
  y += 10

  // ── Totals ──────────────────────────────────────────────────────────────
  const tLabel = L + W * 0.5, tW = R - tLabel
  const total = (label, amount, opts = {}) => {
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.big ? 11 : 9.5).fillColor(opts.color || INK)
    doc.text(label, tLabel, y, { width: tW * 0.55 })
    doc.text(amount, tLabel + tW * 0.55, y, { width: tW * 0.45 - 8, align: 'right' })
    y += (opts.big ? 18 : 15)
  }
  total('Taxable value', money(inv.baseAmount))
  if (inv.taxAmount > 0) {
    if (hasGstin) {
      const { cgst, sgst } = splitGst(inv.taxAmount)
      total(`CGST @ ${rate / 2}%`, money(cgst))
      total(`SGST @ ${rate / 2}%`, money(sgst))
    } else {
      total(`Tax @ ${rate}%`, money(inv.taxAmount))
    }
  }
  doc.moveTo(tLabel, y).lineTo(R, y).strokeColor(LINE).stroke(); y += 6
  total('Total', money(inv.totalAmount), { bold: true, big: true })
  if ((inv.amountPaid || 0) > 0) total('Amount paid', `- ${money(inv.amountPaid)}`, { color: '#15803d' })
  if (inv.balanceDue > 0) total('Balance due', money(inv.balanceDue), { bold: true, color: '#b45309' })

  y += 6
  doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED)
    .text(`Amount in words: ${amountInWordsINR(inv.totalAmount)}`, L, y, { width: W })
  y = doc.y + 14

  // ── Payments received ──────────────────────────────────────────────────
  if (inv.payments?.length) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('PAYMENTS RECEIVED', L, y)
    y = doc.y + 4
    inv.payments.forEach((p) => {
      if (y > doc.page.height - 120) { doc.addPage(); y = 40 }
      doc.font('Helvetica').fontSize(9).fillColor(INK)
      doc.text(`${fmtDate(p.paidAt)}  -  ${METHOD[p.method] || 'Other'}${p.note ? `  (${p.note})` : ''}`, L, y, { width: W * 0.7 })
      doc.text(money(p.amount), L + W * 0.7, y, { width: W * 0.3, align: 'right' })
      y += 14
    })
    y += 6
  }

  // ── Footer ──────────────────────────────────────────────────────────────
  if (seller.footerNote) {
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(seller.footerNote, L, y, { width: W })
  }
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text('This is a computer-generated invoice and does not require a signature.', L, doc.page.height - 60, { width: W, align: 'center' })

  doc.end()
}
