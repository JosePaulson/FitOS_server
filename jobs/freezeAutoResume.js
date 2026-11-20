import cron from 'node-cron'
import { autoResumeDueFreezes } from '../services/membershipFreeze.service.js'

/**
 * Resumes memberships whose planned hold end date has passed, adding the days
 * spent on hold back to their expiry. Hourly, so a member returning on their
 * planned date is active again that morning rather than the next day.
 */
export function startFreezeAutoResumeJob() {
  cron.schedule('10 * * * *', async () => {
    try {
      const n = await autoResumeDueFreezes()
      if (n > 0) console.log(`[cron] Auto-resumed ${n} membership hold(s)`)
    } catch (e) {
      console.error('[cron:freeze] failed:', e.message)
    }
  })
  console.log('\u2705 Membership hold auto-resume cron job scheduled')
}
