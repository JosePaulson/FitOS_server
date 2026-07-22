# Member payments (membership & PT) — Razorpay

Members can now pay their gym online — for membership enrolment/renewal and
for PT plan purchases — via Razorpay Checkout (UPI, cards, wallets,
netbanking). This is separate from the existing gym→FitOS SaaS subscription
billing (`services/razorpay.service.js`'s `createSubscription` etc.), though
for now both run through the **same single Razorpay account** — there's no
per-gym payment gateway setup yet.

## Setup

No new environment variables — this reuses what's already there:

```
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
```

If these aren't set, online payment is simply unavailable — the member
portal falls back to its original "contact your gym" copy. Nothing breaks.

In the **Razorpay Dashboard → Webhooks**, point a webhook at:

```
<API_URL>/api/webhooks/razorpay
```

with these events enabled (the subscription ones were already required; add
`payment.captured`):

```
subscription.activated
subscription.charged
subscription.halted
subscription.cancelled
payment.captured
```

Also confirm UPI, Cards, Wallets and Netbanking are enabled under
**Dashboard → Payment Methods** (Checkout is configured to explicitly show
only these four, in that order).

## How it works

- **`POST /api/member-portal/payments/invoices/:id/order`** — pay an
  existing pending invoice (e.g. one staff created at the front desk).
- **`POST /api/member-portal/payments/membership/checkout`** — self-serve
  buy/renew/switch a membership plan (`{ planId }`).
- **`POST /api/member-portal/payments/pt/checkout`** — self-serve buy a PT
  plan (`{ ptPlanId }`).
- **`POST /api/member-portal/payments/verify`** — called by the frontend
  right after Razorpay Checkout succeeds; verifies the signature and
  fulfils the invoice.
- **`GET /api/member-portal/payments/config`** — `{ enabled }`, used by the
  member portal to decide whether to show payment buttons at all.

All four (and the admin's existing `PATCH /api/invoices/:id/mark-paid`, and
the `payment.captured` webhook) funnel into
`services/paymentFulfillment.service.js`'s `fulfillInvoicePayment()`, which
is **idempotent**: it's safe to call twice for the same payment (e.g. the
client-side verify call *and* the webhook both firing), and safe to call on
an invoice that was already active at creation (staff-created invoices) —
it only extends membership / creates the PT plan assignment once, gated by
`Invoice.fulfilled`.

## Data model additions

- `Invoice.type` — `'membership' | 'pt'`
- `Invoice.ptPlanId`, `Invoice.memberPTPlanId`
- `Invoice.fulfilled` — whether the plan/PT effect has been applied yet.
  Defaults `true` (existing behavior, unchanged for staff-created
  invoices); self-checkout invoices are created with this `false` and it
  flips to `true` only once payment is confirmed — so an abandoned
  checkout never grants free membership/PT time.
- `Invoice.paymentMethod` enum gained `wallet`, `emi`, `paylater`
  (Razorpay's actual method values).
- `Invoice.razorpaySignature`

## Known limitation

PT plan fees have no tax-rate field on the `PTPlan` catalog (unlike
`MembershipPlan.taxRate`), so PT invoices are created with `taxRate: 0` —
the fee is treated as a flat total with no GST split. If your gym needs to
show GST on PT invoices, add a `taxRate` field to `PTPlan` and pass it
through in `routes/memberPortal.payment.routes.js`'s `/pt/checkout`.
