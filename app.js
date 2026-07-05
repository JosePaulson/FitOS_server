import 'dotenv/config'   // loads + validates .env — must be first

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'

import connectDB from './config/db.js'
import errorHandler from './middleware/errorHandler.js'
import { startRenewalReminderJob } from './jobs/renewalReminders.js'
import { startBirthdayJob } from './jobs/birthdayGreetings.js'

// ── Routes ────────────────────────────────────────────────────────────────
import authRoutes from './routes/auth.routes.js'
import leadRoutes from './routes/lead.routes.js'
import memberRoutes from './routes/member.routes.js'
import planRoutes from './routes/plan.routes.js'
import invoiceRoutes from './routes/invoice.routes.js'
import attendanceRoutes from './routes/attendance.routes.js'
import dashboardRoutes from './routes/dashboard.routes.js'
import workoutRoutes from './routes/workout.routes.js'
import staffRoutes from './routes/staff.routes.js'
import subscriptionRoutes from './routes/subscription.routes.js'
import saasAdminRoutes from './routes/saasAdmin.routes.js'
import gymRoutes from './routes/gym.routes.js'
import memberPortalAuthRoutes from './routes/memberPortal.auth.routes.js'
import memberPortalRoutes from './routes/memberPortal.routes.js'
import memberPortalChatRoutes from './routes/memberPortal.chat.routes.js'
import ptSessionRoutes from './routes/ptSession.routes.js'
import memberPortalPTRoutes from './routes/memberPortal.ptSession.routes.js'
import webhookRoutes from './routes/webhook.routes.js'

// ── Connect DB ────────────────────────────────────────────────────────────
await connectDB()

const app = express()

// ── Security & logging ────────────────────────────────────────────────────
app.use(helmet())
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))

// ── Webhook MUST be mounted before express.json() (needs raw body) ────────
app.use('/api/webhooks/razorpay', webhookRoutes)

// ── CORS ──────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [process.env.CLIENT_URL, process.env.MEMBER_PORTAL_URL, process.env.MEMBER_PORTAL_URL_VERCEL, process.env.CLIENT_URL_VERCEL, 'http://localhost:5173'],
  credentials: true,
}))

// ── Body parsers ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }))
app.use(express.urlencoded({ extended: true }))

// ── Rate limiters ─────────────────────────────────────────────────────────
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  message: 'Too many requests, please try again later.',
}))

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: 'Too many auth attempts, please try again later.',
})

// ── Mount routes ──────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes)
app.use('/api/leads', leadRoutes)
app.use('/api/members', memberRoutes)
app.use('/api/plans', planRoutes)
app.use('/api/invoices', invoiceRoutes)
app.use('/api/attendance', attendanceRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/workout-plans', workoutRoutes)
app.use('/api/staff', staffRoutes)
app.use('/api/subscriptions', subscriptionRoutes)
app.use('/api/saas-admin', saasAdminRoutes)
app.use('/api/gym', gymRoutes)
app.use('/api/member-portal/auth', memberPortalAuthRoutes)
app.use('/api/member-portal', memberPortalRoutes)
app.use('/api/member-portal/chat', memberPortalChatRoutes)
app.use('/api/pt-sessions', ptSessionRoutes)
app.use('/api/member-portal/pt-sessions', memberPortalPTRoutes)

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }))

// ── 404 ───────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ message: 'Route not found' }))

// ── Global error handler (must be last) ───────────────────────────────────
app.use(errorHandler)

// ── Cron jobs ─────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  startRenewalReminderJob()
  startBirthdayJob()
}

// ── Start server ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`🚀 FitOS server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`)
})

export default app
