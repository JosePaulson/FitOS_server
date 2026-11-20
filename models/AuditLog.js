import { Schema, model } from 'mongoose'

/**
 * Who did what, when. Written by middleware/audit.js for sensitive staff
 * actions (money, memberships, pricing, staff, settings, exports). Rows are
 * never edited or deleted by the app.
 */
const auditLogSchema = new Schema(
  {
    gymId:     { type: Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    actorId:   { type: Schema.Types.ObjectId, ref: 'User' },
    actorName: String,
    actorRole: String,
    action:    { type: String, required: true, index: true },   // e.g. 'member.freeze'
    entityType: String,                                           // 'member' | 'invoice' | ...
    entityId:  String,
    summary:   String,                                            // human sentence
    details:   Schema.Types.Mixed,                                // { changes: {field:{from,to}}, request: {...} }
    ip:        String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

auditLogSchema.index({ gymId: 1, createdAt: -1 })

export default model('AuditLog', auditLogSchema)
