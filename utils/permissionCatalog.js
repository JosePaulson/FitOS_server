/**
 * Permissions an owner can switch on/off per staff role (manager,
 * receptionist, trainer). The owner always has every permission and can't be
 * locked out.
 *
 * `defaults` reproduce what each role could already do before this feature
 * existed, so nothing changes for a gym until its owner customises it.
 * (Separate from the older per-user `permissions.payroll` flags, which stay
 * as they are.)
 */
export const PERMISSIONS = [
  { key: 'members.enrol',   label: 'Add & renew members',            description: 'Enrol new members and renew memberships.',                 defaults: ['manager', 'receptionist'] },
  { key: 'members.manage',  label: 'Edit & archive members',         description: 'Change member details, plans and dates; archive members.', defaults: ['manager'] },
  { key: 'members.hold',    label: 'Hold & resume memberships',      description: 'Freeze a membership and resume it later.',                 defaults: ['manager'] },
  { key: 'billing.view',    label: 'View invoices',                  description: 'See the invoice list and download invoice PDFs.',          defaults: ['manager', 'receptionist', 'trainer'] },
  { key: 'billing.collect', label: 'Collect payments',               description: 'Mark invoices paid, record part payments, send payment links.', defaults: ['manager', 'receptionist'] },
  { key: 'revenue.view',    label: 'See revenue totals',             description: 'Monthly revenue and tax-collected figures.',               defaults: ['manager'] },
  { key: 'coupons.manage',  label: 'Manage coupons & offers',        description: 'Create, edit and delete discount coupons.',                defaults: ['manager'] },
  { key: 'engagement.manage', label: 'Announcements & challenges',   description: 'Send announcements to members and run challenges.',       defaults: ['manager'] },
  { key: 'waivers.sign',    label: 'Collect waivers at the desk',    description: 'Record a member\u2019s signed waiver and health form on their behalf.', defaults: ['manager', 'receptionist'] },
]

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key)
export const CONFIGURABLE_ROLES = ['manager', 'receptionist', 'trainer']

export const defaultsFor = (role) => PERMISSIONS.filter((p) => p.defaults.includes(role)).map((p) => p.key)

/** Keep only known permission keys, de-duplicated. */
export const sanitizeKeys = (keys) => [...new Set((Array.isArray(keys) ? keys : []).filter((k) => PERMISSION_KEYS.includes(k)))]
