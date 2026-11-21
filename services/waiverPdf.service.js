import PDFDocument from 'pdfkit'
import { fmtDate, fmtDateTime } from '../utils/dateFormat.js'

const fmt = (d) => (d ? fmtDateTime(d) : '-')

/** Streams the signed waiver + PAR-Q as a PDF record into `res`. */
export function streamWaiverPdf({ waiver, member, gym }, res) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Signed waiver - ${member?.name || ''}` } })
  doc.pipe(res)
  const L = 50, W = doc.page.width - 100
  const ensure = (h) => { if (doc.y + h > doc.page.height - 60) doc.addPage() }

  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111827').text(gym?.name || 'Gym', L, 50, { width: W })
  doc.font('Helvetica').fontSize(10).fillColor('#6b7280').text('Membership waiver & health questionnaire (signed record)')
  doc.moveDown(0.8)

  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text('Member')
  doc.font('Helvetica').fillColor('#374151')
    .text(`${member?.name || '-'}   |   ${member?.phone || '-'}${member?.email ? `   |   ${member.email}` : ''}`)
  doc.text(`Waiver version ${waiver.version}   |   Signed ${fmt(waiver.signedAt)}   |   ${waiver.via === 'front-desk' ? 'Signed at the front desk' : 'Signed in the member app'}`)
  doc.moveDown(0.8)

  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text('Health questionnaire (PAR-Q)')
  doc.moveDown(0.3)
  ;(waiver.parq || []).forEach((q, i) => {
    ensure(40)
    doc.font('Helvetica').fontSize(9.5).fillColor('#374151').text(`${i + 1}. ${q.question}`, { width: W - 50 })
    doc.font('Helvetica-Bold').fillColor(q.answer ? '#b91c1c' : '#15803d').text(q.answer ? 'YES' : 'NO', L + W - 40, doc.y - 12, { width: 40, align: 'right' })
    doc.moveDown(0.4)
  })
  if (waiver.parqFlagged) {
    ensure(30)
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#b91c1c')
      .text('One or more answers were "Yes" - the member should get a doctor\u2019s clearance before starting.', L, doc.y + 4, { width: W })
  }
  doc.moveDown(1)

  ensure(60)
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text('Waiver text agreed to', L)
  doc.moveDown(0.3)
  doc.font('Helvetica').fontSize(9).fillColor('#374151').text(waiver.textSnapshot || '', { width: W, align: 'left' })
  doc.moveDown(1.2)

  ensure(130)
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text('Signed by')
  doc.font('Helvetica').fillColor('#374151').text(waiver.signedName)
  if (waiver.guardianName) doc.text(`Parent / guardian: ${waiver.guardianName}`)
  if (waiver.signature) {
    try {
      const buf = Buffer.from(waiver.signature.split(',')[1], 'base64')
      doc.moveDown(0.4)
      doc.image(buf, L, doc.y, { fit: [220, 80] })
      doc.moveDown(5.5)
    } catch { /* an unreadable signature image must not break the record */ }
  }
  doc.font('Helvetica').fontSize(8).fillColor('#9ca3af')
    .text(`Recorded ${fmt(waiver.signedAt)}${waiver.ip ? `  |  IP ${waiver.ip}` : ''}  |  Electronic signature`, L, doc.y + 4, { width: W })
  doc.end()
}
