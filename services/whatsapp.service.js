const BASE_URL    = () => process.env.WATI_API_URL
const AUTH_HEADER = () => ({ Authorization: `Bearer ${process.env.WATI_ACCESS_TOKEN}` })

async function sendWhatsApp(phone, template, parameters = []) {
  if (!process.env.WATI_API_URL || !process.env.WATI_ACCESS_TOKEN) {
    console.warn('[WhatsApp] WATI credentials not set — skipping')
    return null
  }

  try {
    const res = await fetch(`${BASE_URL()}/api/v1/sendTemplateMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...AUTH_HEADER() },
      body: JSON.stringify({
        whatsappNumber: phone.replace(/\D/g, ''),
        template_name:  template,
        broadcast_name: template,
        parameters,
      }),
    })
    const data = await res.json()
    if (!res.ok) console.error('[WhatsApp] WATI error:', data)
    return data
  } catch (err) {
    console.error('[WhatsApp] fetch error:', err.message)
    return null
  }
}

export async function sendRenewalReminderWA({ phone, memberName, gymName, daysLeft, expiryDate }) {
  return sendWhatsApp(phone, 'fitos_renewal_reminder', [
    { name: '1', value: memberName },
    { name: '2', value: gymName },
    { name: '3', value: String(daysLeft) },
    { name: '4', value: expiryDate },
  ])
}

export async function sendWelcomeWA({ phone, memberName, gymName }) {
  return sendWhatsApp(phone, 'fitos_member_welcome', [
    { name: '1', value: gymName },
    { name: '2', value: memberName },
  ])
}

export async function sendPaymentReceiptWA({ phone, memberName, amount, gymName, invoiceNumber }) {
  return sendWhatsApp(phone, 'fitos_payment_receipt', [
    { name: '1', value: memberName },
    { name: '2', value: String(amount) },
    { name: '3', value: gymName },
    { name: '4', value: invoiceNumber },
  ])
}

export async function sendBirthdayWA({ phone, memberName, gymName }) {
  return sendWhatsApp(phone, 'fitos_birthday_greeting', [
    { name: '1', value: memberName },
    { name: '2', value: gymName },
  ])
}
