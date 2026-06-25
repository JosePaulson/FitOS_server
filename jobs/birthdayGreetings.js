import cron   from 'node-cron'
import Member from '../models/Member.js'
import Gym    from '../models/Gym.js'
import { sendEmail }      from '../services/email.service.js'
import { sendBirthdayWA } from '../services/whatsapp.service.js'

export function startBirthdayJob() {
  // 8 AM IST = 2:30 AM UTC
  cron.schedule('30 2 * * *', async () => {
    console.log('[cron] Running birthday greetings...')
    const now   = new Date()
    const month = now.getMonth() + 1
    const day   = now.getDate()

    const members = await Member.find({
      isActive: true,
      dob:      { $exists: true },
      $expr: {
        $and: [
          { $eq: [{ $month: '$dob' }, month] },
          { $eq: [{ $dayOfMonth: '$dob' }, day] },
        ],
      },
    })

    console.log(`[cron] ${members.length} birthday(s) today`)

    for (const member of members) {
      const gym = await Gym.findById(member.gymId).select('name planStatus')
      if (!gym || !['active', 'trialing'].includes(gym.planStatus)) continue

      if (member.phone) {
        sendBirthdayWA({ phone: member.phone, memberName: member.name, gymName: gym.name })
          .catch((e) => console.error('[cron:birthday] WA error:', e.message))
      }
      if (member.email) {
        sendEmail({
          to:      member.email,
          subject: `Happy Birthday ${member.name}! 🎂`,
          html:    `<h2>Happy Birthday, ${member.name}! 🎂</h2><p>Wishing you strength and good health from all of us at <strong>${gym.name}</strong>.</p><p style="color:#888">Powered by FitOS</p>`,
        }).catch((e) => console.error('[cron:birthday] Email error:', e.message))
      }
    }
  })

  console.log('✅ Birthday greetings cron job scheduled')
}
