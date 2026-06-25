// import nodemailer from 'nodemailer'

// let transporter

// function getTransporter() {
//   if (!transporter) {
//     // If SMTP creds are missing in dev, use Ethereal (logs to console)
//     if (!process.env.SMTP_HOST) {
//       transporter = nodemailer.createTransport({ jsonTransport: true })
//       return transporter
//     }
//     transporter = nodemailer.createTransport({
//       host:   process.env.SMTP_HOST,
//       port:   Number(process.env.SMTP_PORT) || 587,
//       secure: false,
//       auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
//     })
//   }
//   return transporter
// }

// export async function sendEmail({ to, subject, html, text }) {
//   const mail = getTransporter()
//   const info  = await mail.sendMail({ from: process.env.EMAIL_FROM, to, subject, html, text })
//   if (process.env.NODE_ENV === 'development') {
//     console.log(`[email] To: ${to} | Subject: ${subject}`)
//   }
//   return info
// }

// export async function sendWelcomeEmail({ to, gymName, memberName }) {
//   await sendEmail({
//     to, subject: `Welcome to ${gymName}! 🎉`,
//     html: `<h2>Welcome, ${memberName}!</h2><p>You've been enrolled at <strong>${gymName}</strong>.</p><p style="color:#888">Powered by FitOS</p>`,
//   })
// }

// export async function sendRenewalReminder({ to, memberName, gymName, expiryDate, daysLeft }) {
//   await sendEmail({
//     to,
//     subject: `Your ${gymName} membership expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
//     html: `<h2>Hey ${memberName},</h2><p>Your membership at <strong>${gymName}</strong> expires on <strong>${expiryDate}</strong>.</p><p>Renew now!</p><p style="color:#888">Powered by FitOS</p>`,
//   })
// }

// export async function sendInvoiceEmail({ to, memberName, gymName, invoiceNumber, amount, pdfUrl }) {
//   await sendEmail({
//     to, subject: `Invoice ${invoiceNumber} from ${gymName}`,
//     html: `<h2>Hi ${memberName},</h2><p>Payment of <strong>₹${amount}</strong> received at <strong>${gymName}</strong>. Invoice: <strong>${invoiceNumber}</strong></p>${pdfUrl ? `<p><a href="${pdfUrl}">Download PDF</a></p>` : ''}<p style="color:#888">Powered by FitOS</p>`,
//   })
// }

// export async function sendLeadAckEmail({ to, name }) {
//   await sendEmail({
//     to, subject: 'Thanks for reaching out to FitOS!',
//     html: `<h2>Hi ${name},</h2><p>Thanks for your interest in FitOS! Our team will get back to you within a few hours.</p><p style="color:#888">— Team FitOS</p>`,
//   })
// }


//*#############################################################################################################################

import nodemailer from 'nodemailer'
import { google } from 'googleapis'

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'https://developers.google.com/oauthplayground'
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

async function getTransporter() {
  const accessToken = await oauth2Client.getAccessToken();

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      type: 'OAuth2',
      user: process.env.SMTP_USER,
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
      accessToken: accessToken.token,
    },
  });
}

//!#############################################################################################################################

// import nodemailer from 'nodemailer'

// let transporter

// function getTransporter() {
//   if (!transporter) {
//     if (!process.env.SMTP_HOST) {
//       // Dev fallback — logs email JSON to console instead of sending
//       transporter = nodemailer.createTransport({ jsonTransport: true })
//       return transporter
//     }
//     transporter = nodemailer.createTransport({
//       host: process.env.SMTP_HOST,
//       port: Number(process.env.SMTP_PORT) || 587,
//       secure: false,
//       auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
//     })
//   }
//   return transporter
// }

export async function sendEmail({ to, subject, html, text }) {
  if (!to) return   // silently skip if member has no email
  const mail = await getTransporter()
  const info = await mail.sendMail({ from: process.env.EMAIL_FROM || '"FitOS" <hello@fitos.in>', to, subject, html, text })
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[email] ✉️  To: ${to} | Subject: ${subject}`)
  }
  return info
}

// ── Welcome email on enrolment ────────────────────────────────────────────
export async function sendWelcomeEmail({ to, gymName, memberName, planName, expiryDate }) {
  await sendEmail({
    to,
    subject: `Welcome to ${gymName}! 🎉`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
        <div style="background:#0D0D0D;padding:28px 32px;border-radius:12px 12px 0 0">
          <span style="font-size:22px;font-weight:900;color:#F5F4EF">Fit<span style="color:#C8F135">OS</span></span>
        </div>
        <div style="background:#f9f9f9;padding:32px;border-radius:0 0 12px 12px">
          <h2 style="margin:0 0 8px">Welcome, ${memberName}! 🎉</h2>
          <p style="color:#555;margin:0 0 24px">You've been successfully enrolled at <strong>${gymName}</strong>.</p>
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
            <tr style="background:#f0f0f0">
              <td style="padding:10px 14px;font-size:13px;color:#555">Plan</td>
              <td style="padding:10px 14px;font-size:13px;font-weight:600;text-align:right">${planName}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:13px;color:#555">Valid until</td>
              <td style="padding:10px 14px;font-size:13px;font-weight:600;text-align:right">${expiryDate}</td>
            </tr>
          </table>
          <p style="color:#555;font-size:13px">See you at the gym! 💪</p>
          <p style="color:#aaa;font-size:11px;margin-top:32px;border-top:1px solid #e0e0e0;padding-top:16px">Powered by FitOS</p>
        </div>
      </div>
    `,
  })
}

// ── Invoice / receipt email ───────────────────────────────────────────────
export async function sendInvoiceEmail({
  to, memberName, gymName,
  invoiceNumber, planName,
  baseAmount, taxRate, taxAmount, totalAmount,
  paymentMethod, pdfUrl,
}) {
  await sendEmail({
    to,
    subject: `Receipt: Invoice ${invoiceNumber} from ${gymName}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
        <div style="background:#0D0D0D;padding:28px 32px;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:22px;font-weight:900;color:#F5F4EF">Fit<span style="color:#C8F135">OS</span></span>
          <span style="color:#888;font-size:12px">RECEIPT</span>
        </div>
        <div style="background:#f9f9f9;padding:32px;border-radius:0 0 12px 12px">
          <h2 style="margin:0 0 4px">Payment received ✅</h2>
          <p style="color:#555;margin:0 0 24px;font-size:14px">Hi ${memberName}, here's your receipt from <strong>${gymName}</strong>.</p>

          <table style="width:100%;border-collapse:collapse;margin-bottom:8px;border-radius:8px;overflow:hidden">
            <tr style="background:#f0f0f0">
              <td style="padding:10px 14px;font-size:13px;color:#555">Invoice number</td>
              <td style="padding:10px 14px;font-size:13px;font-weight:600;text-align:right;font-family:monospace">${invoiceNumber}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:13px;color:#555">Plan</td>
              <td style="padding:10px 14px;font-size:13px;font-weight:600;text-align:right">${planName}</td>
            </tr>
            ${paymentMethod ? `
            <tr style="background:#f0f0f0">
              <td style="padding:10px 14px;font-size:13px;color:#555">Payment method</td>
              <td style="padding:10px 14px;font-size:13px;font-weight:600;text-align:right;text-transform:capitalize">${paymentMethod}</td>
            </tr>` : ''}
          </table>

          <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
            <tr>
              <td style="padding:8px 14px;font-size:13px;color:#777">Base amount</td>
              <td style="padding:8px 14px;font-size:13px;text-align:right">₹${Number(baseAmount).toLocaleString('en-IN')}</td>
            </tr>
            <tr>
              <td style="padding:8px 14px;font-size:13px;color:#777">GST (${taxRate}%)</td>
              <td style="padding:8px 14px;font-size:13px;text-align:right">₹${Number(taxAmount).toLocaleString('en-IN')}</td>
            </tr>
            <tr style="border-top:2px solid #e0e0e0">
              <td style="padding:12px 14px;font-size:16px;font-weight:700">Total paid</td>
              <td style="padding:12px 14px;font-size:16px;font-weight:700;text-align:right;color:#0D0D0D">₹${Number(totalAmount).toLocaleString('en-IN')}</td>
            </tr>
          </table>

          ${pdfUrl ? `<a href="${pdfUrl}" style="display:inline-block;background:#C8F135;color:#0D0D0D;font-weight:700;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px;margin-bottom:24px">Download PDF invoice</a>` : ''}

          <p style="color:#aaa;font-size:11px;margin-top:24px;border-top:1px solid #e0e0e0;padding-top:16px">
            This is an automated receipt from FitOS · ${gymName}<br/>
            If you have questions, contact your gym directly.
          </p>
        </div>
      </div>
    `,
  })
}

// ── Renewal reminder ──────────────────────────────────────────────────────
export async function sendRenewalReminder({ to, memberName, gymName, expiryDate, daysLeft }) {
  await sendEmail({
    to,
    subject: `Your ${gymName} membership expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
        <div style="background:#0D0D0D;padding:28px 32px;border-radius:12px 12px 0 0">
          <span style="font-size:22px;font-weight:900;color:#F5F4EF">Fit<span style="color:#C8F135">OS</span></span>
        </div>
        <div style="background:#f9f9f9;padding:32px;border-radius:0 0 12px 12px">
          <h2 style="margin:0 0 8px">⏰ Membership expiring soon</h2>
          <p style="color:#555;margin:0 0 16px">Hey ${memberName}, your membership at <strong>${gymName}</strong> expires on <strong>${expiryDate}</strong> — that's ${daysLeft} day${daysLeft === 1 ? '' : 's'} away.</p>
          <p style="color:#555;margin:0 0 24px">Contact your gym to renew and keep your progress going!</p>
          <p style="color:#aaa;font-size:11px;border-top:1px solid #e0e0e0;padding-top:16px">Powered by FitOS</p>
        </div>
      </div>
    `,
  })
}

// ── Lead acknowledgement ──────────────────────────────────────────────────
export async function sendLeadAckEmail({ to, name }) {
  await sendEmail({
    to,
    subject: 'Thanks for reaching out to FitOS!',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
        <div style="background:#0D0D0D;padding:28px 32px;border-radius:12px 12px 0 0">
          <span style="font-size:22px;font-weight:900;color:#F5F4EF">Fit<span style="color:#C8F135">OS</span></span>
        </div>
        <div style="background:#f9f9f9;padding:32px;border-radius:0 0 12px 12px">
          <h2 style="margin:0 0 8px">We got your message 👋</h2>
          <p style="color:#555;margin:0 0 16px">Hi ${name}, thanks for your interest in FitOS! Our team will get back to you within a few hours.</p>
          <p style="color:#555;margin:0 0 24px">In the meantime, feel free to reply to this email with any questions.</p>
          <p style="color:#aaa;font-size:11px;border-top:1px solid #e0e0e0;padding-top:16px">— Team FitOS</p>
        </div>
      </div>
    `,
  })
}
