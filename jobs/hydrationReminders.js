import cron from 'node-cron'
import HydrationSchedule from '../models/HydrationSchedule.js'
import { sendPushToMember } from '../services/pushNotification.service.js'

/**
 * "HH:mm" for right now, in IST — regardless of the server's own
 * timezone/locale, so this matches the wall-clock times members picked in
 * the UI (which are always shown/entered as IST, same as the rest of the app).
 */
function currentISTHHMM() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date())
}

export function startHydrationRemindersJob() {
  // Every minute — member-configured times are arbitrary, so (unlike the
  // other jobs in this folder, which fire once a day at one fixed hour)
  // there's no single fixed cron expression that covers them all. The
  // query itself is cheap: both fields are indexed together.
  cron.schedule('* * * * *', async () => {
    const hhmm = currentISTHHMM()
    const due = await HydrationSchedule.find({ enabled: true, times: hhmm }).select('memberId')
    if (due.length === 0) return

    for (const schedule of due) {
      sendPushToMember(schedule.memberId, {
        title: '🥛 Hydrate!',
        body: 'Time to drink a glass of water 💧',
        tag: 'hydration-reminder',
        url: '/profile#hydration',
      }).catch((e) => console.error('[cron:hydration] push error:', e.message))
    }
  })

  console.log('✅ Hydration reminders cron job scheduled')
}
