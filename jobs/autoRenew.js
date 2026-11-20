import cron from 'node-cron'
import { runAutoRenewInvoices } from '../services/autoRenew.service.js'

/** Daily, ~8:00 AM IST: prepare renewal invoices for members with auto-renew on. */
export function startAutoRenewJob() {
  cron.schedule('30 2 * * *', async () => {
    try {
      const n = await runAutoRenewInvoices()
      if (n > 0) console.log(`[cron] Prepared ${n} auto-renewal invoice(s)`)
    } catch (e) { console.error('[cron:auto-renew] failed:', e.message) }
  })
  console.log('\u2705 Auto-renew invoice cron job scheduled')
}
