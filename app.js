import 'dotenv/config'   // loads + validates .env — must be first
import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'

import connectDB from './config/db.js'
import errorHandler from './middleware/errorHandler.js'
import { startRenewalReminderJob } from './jobs/renewalReminders.js'
import { startBirthdayJob } from './jobs/birthdayGreetings.js'
import { startPTPlanReminderJob } from './jobs/ptPlanReminders.js'

// ── Routes ────────────────────────────────────────────────────────────────
import authRoutes from './routes/auth.routes.js'
import leadRoutes from './routes/lead.routes.js'
import memberRoutes from './routes/member.routes.js'
import planRoutes from './routes/plan.routes.js'
import ptPlanRoutes from './routes/ptPlan.routes.js'
import memberPTPlanRoutes from './routes/memberPTPlan.routes.js'
import trainerAvailabilityRoutes from './routes/trainerAvailability.routes.js'
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
import equipmentRoutes from './routes/equipment.routes.js'
import workoutLibraryRoutes from './routes/workoutLibrary.routes.js'
import memberPortalEquipmentRoutes from './routes/memberPortal.equipment.routes.js'
import memberPortalPushRoutes from './routes/memberPortal.push.routes.js'
import memberPortalFoodScanRoutes from './routes/memberPortal.foodScan.routes.js'
import memberPortalPTPlanRoutes from './routes/memberPortal.ptPlan.routes.js'
import memberPortalAttendanceCheckinRoutes from './routes/memberPortal.attendanceCheckin.routes.js'
import memberPortalWorkoutLogRoutes from './routes/memberPortal.workoutLog.routes.js'
import webhookRoutes from './routes/webhook.routes.js'

// ── Connect DB ────────────────────────────────────────────────────────────
await connectDB()

const app = express()

// A fresh value every time the process boots — the simplest reliable signal
// that "the server was redeployed", without needing a manual version bump.
// The frontends poll GET /api/version and prompt to reload if this changes
// since the page was loaded, covering server-side code updates.
const SERVER_BOOT_VERSION = String(Date.now())

// ── Security & logging ────────────────────────────────────────────────────
app.use(helmet())
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))

// ── Webhook MUST be mounted before express.json() (needs raw body) ────────
app.use('/api/webhooks/razorpay', webhookRoutes)

// ── CORS ──────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [process.env.CLIENT_URL, process.env.MEMBER_PORTAL_URL, process.env.MEMBER_PORTAL_URL_VERCEL, process.env.CLIENT_URL_VERCEL, 'http://localhost:5173', 'http://192.168.0.112:8081', 'http://192.168.0.112:5174', 'http://localhost:8081', 'http://192.168.0.105:8081'],
  credentials: true,
}))

// ── Body parsers ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }))
app.use(express.urlencoded({ extended: true }))

// ── Rate limiters ─────────────────────────────────────────────────────────
const rateLimitHandler = (req, res, _next, options) => {
  res.status(options.statusCode).json({ message: options.message })
}

app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  message: 'Too many requests, please try again later.',
  handler: rateLimitHandler,
}))

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: 'Too many auth attempts, please try again later.',
  handler: rateLimitHandler,
})

// ── Mount routes ──────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes)
app.use('/api/leads', leadRoutes)
app.use('/api/members', memberRoutes)
app.use('/api/plans', planRoutes)
app.use('/api/pt-plans', ptPlanRoutes)
app.use('/api/member-pt-plans', memberPTPlanRoutes)
app.use('/api/trainer-availability', trainerAvailabilityRoutes)
app.use('/api/invoices', invoiceRoutes)
app.use('/api/attendance', attendanceRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/workout-plans', workoutRoutes)
app.use('/api/staff', staffRoutes)
app.use('/api/subscriptions', subscriptionRoutes)
app.use('/api/saas-admin', saasAdminRoutes)
app.use('/api/gym', gymRoutes)
// Specific sub-paths FIRST, catch-all /api/member-portal LAST
app.use('/api/member-portal/auth', memberPortalAuthRoutes)
app.use('/api/member-portal/chat', memberPortalChatRoutes)
app.use('/api/member-portal/pt-sessions', memberPortalPTRoutes)
app.use('/api/member-portal/equipment', memberPortalEquipmentRoutes)
app.use('/api/member-portal/push', memberPortalPushRoutes)
app.use('/api/member-portal/food-scan', memberPortalFoodScanRoutes)
app.use('/api/member-portal/pt-plans', memberPortalPTPlanRoutes)
app.use('/api/member-portal/attendance', memberPortalAttendanceCheckinRoutes)
app.use('/api/member-portal/workout-logs', memberPortalWorkoutLogRoutes)
app.use('/api/member-portal', memberPortalRoutes)
app.use('/api/pt-sessions', ptSessionRoutes)
app.use('/api/equipment', equipmentRoutes)
app.use('/api/workout-library', workoutLibraryRoutes)

// ── Health check ──────────────────────────────────────────────────────────
// Deliberately mounted before rate limiting, auth, and DB-dependent logic —
// this must always respond fast, even if the database is briefly down.
// Polled by both frontends to detect a server redeploy and prompt a reload.
// No auth required — needs to work even for a logged-out/expired session.
app.get('/api/version', (_req, res) => {
  res.json({ version: SERVER_BOOT_VERSION })
})

// Used by uptime pingers (see deployment notes) to keep a Render free-tier
// instance from spinning down after 15 minutes of inactivity.
app.get('/health', (_req, res) => {
  const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting']
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),   // seconds since this process started
    db: dbStates[mongoose.connection.readyState] || 'unknown',
    environment: process.env.NODE_ENV || 'development',
  })
})

// ── 404 ───────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ message: 'Route not found' }))

// ── Global error handler (must be last) ───────────────────────────────────
app.use(errorHandler)

// ── Cron jobs ─────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  startRenewalReminderJob()
  startBirthdayJob()
  startPTPlanReminderJob()
}

// ── Start server ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`🚀 FitOS server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`)
})

export default app
