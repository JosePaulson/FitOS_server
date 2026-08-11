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
import staffPayrollRoutes from './routes/staffPayroll.routes.js'
import subscriptionRoutes from './routes/subscription.routes.js'
import saasAdminRoutes from './routes/saasAdmin.routes.js'
import gymRoutes from './routes/gym.routes.js'
import memberPortalAuthRoutes from './routes/memberPortal.auth.routes.js'
import memberPortalRoutes from './routes/memberPortal.routes.js'
import memberPortalChatRoutes from './routes/memberPortal.chat.routes.js'
import ptSessionRoutes from './routes/ptSession.routes.js'
import workoutLogRoutes from './routes/workoutLog.routes.js'
import memberPortalPTRoutes from './routes/memberPortal.ptSession.routes.js'
import equipmentRoutes from './routes/equipment.routes.js'
import workoutLibraryRoutes from './routes/workoutLibrary.routes.js'
import memberPortalEquipmentRoutes from './routes/memberPortal.equipment.routes.js'
import exerciseCatalogRoutes from './routes/exerciseCatalog.routes.js'
import memberPortalExerciseCatalogRoutes from './routes/memberPortal.exerciseCatalog.routes.js'
import memberPortalWorkoutLibraryRoutes from './routes/memberPortal.workoutLibrary.routes.js'
import memberPortalPushRoutes from './routes/memberPortal.push.routes.js'
import memberPortalFoodScanRoutes from './routes/memberPortal.foodScan.routes.js'
import memberPortalPTPlanRoutes from './routes/memberPortal.ptPlan.routes.js'
import memberPortalAttendanceCheckinRoutes from './routes/memberPortal.attendanceCheckin.routes.js'
import memberPortalWorkoutLogRoutes from './routes/memberPortal.workoutLog.routes.js'
import memberPortalPaymentRoutes from './routes/memberPortal.payment.routes.js'
import webhookRoutes from './routes/webhook.routes.js'
import complaintRoutes from './routes/complaint.routes.js'
import memberPortalComplaintRoutes from './routes/memberPortal.complaint.routes.js'
import staffRatingRoutes from './routes/staffRating.routes.js'
import memberPortalStaffRatingRoutes from './routes/memberPortal.staffRating.routes.js'
import leaveRoutes from './routes/leave.routes.js'
import reimbursementRoutes from './routes/reimbursement.routes.js'
import timetableRoutes from './routes/timetable.routes.js'
import ptEarningsRoutes from './routes/ptEarnings.routes.js'
import memberPortalTimetableRoutes from './routes/memberPortal.timetable.routes.js'
import memberPortalTransformationRoutes from './routes/memberPortal.transformation.routes.js'

// ── Connect DB ────────────────────────────────────────────────────────────
await connectDB()

const app = express()

// Render (and most PaaS hosts) sit the app behind a reverse proxy, so
// without this, req.ip resolves to the proxy's own address for every
// request — which would make the IP-based rate limiters below treat all
// traffic as coming from one single "IP" instead of each visitor's real
// one. `1` trusts exactly one hop (the platform's own proxy).
app.set('trust proxy', 1)

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
  origin: [process.env.CLIENT_URL, process.env.MEMBER_PORTAL_URL, process.env.MEMBER_PORTAL_URL_VERCEL, process.env.CLIENT_URL_VERCEL, 'http://localhost:5173', 'http://192.168.0.112:8081', 'http://192.168.0.112:5174', 'http://localhost:8081', 'http://192.168.0.105:8081', 'exp://192.168.0.105:8081'],
  credentials: true,
}))

// ── Body parsers ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }))
app.use(express.urlencoded({ extended: true }))

// ── Rate limiters ─────────────────────────────────────────────────────────
// Both limiters key on plain client IP (express-rate-limit's default
// keyGenerator, req.ip) — no per-user or per-gym logic layered on top.
// The general limit is generous (200/15min) specifically because many
// members hit the API from the same gym WiFi, i.e. the same public IP;
// a tighter per-IP limit would end up throttling a whole gym at once.
const rateLimitHandler = (req, res, _next, options) => {
  res.status(options.statusCode).json({ message: options.message })
}

app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  message: 'Too many requests, please try again later.',
  handler: rateLimitHandler,
}))

// Auth attempts stay tighter — brute-forcing logins/OTPs is the actual
// risk here, and legitimate retries from a shared gym IP are rare enough
// that this doesn't need the same headroom as general API traffic.
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
app.use('/api/staff-payroll', staffPayrollRoutes)
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
app.use('/api/member-portal/payments', memberPortalPaymentRoutes)
app.use('/api/member-portal/complaints', memberPortalComplaintRoutes)
app.use('/api/member-portal/staff-ratings', memberPortalStaffRatingRoutes)
app.use('/api/member-portal/timetable', memberPortalTimetableRoutes)
app.use('/api/member-portal/transformation', memberPortalTransformationRoutes)
app.use('/api/member-portal', memberPortalRoutes)
app.use('/api/pt-sessions', ptSessionRoutes)
app.use('/api/workout-logs', workoutLogRoutes)
app.use('/api/equipment', equipmentRoutes)
app.use('/api/workout-library', workoutLibraryRoutes)
app.use('/api/exercise-catalog', exerciseCatalogRoutes)
app.use('/api/member-portal/exercise-catalog', memberPortalExerciseCatalogRoutes)
app.use('/api/member-portal/workout-library', memberPortalWorkoutLibraryRoutes)
app.use('/api/complaints', complaintRoutes)
app.use('/api/staff-ratings', staffRatingRoutes)
app.use('/api/leave', leaveRoutes)
app.use('/api/reimbursements', reimbursementRoutes)
app.use('/api/timetable', timetableRoutes)
app.use('/api/pt-earnings', ptEarningsRoutes)

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
