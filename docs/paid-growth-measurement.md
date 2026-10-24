# Stripe-backed paid growth measurement

## Decision and source of truth

Growth work prioritizes first payments, trial-to-paid conversion, and retained paying customers.
Use the existing Stripe billing records before proposing more product tracking. Manual uploads and
browser subscription events are not payment evidence. No new browser event is needed to establish
that a subscription invoice was paid.

The read-only audit verified that the authorized billing account exposes subscriptions of every status,
subscription invoices, paid invoice-payment allocations with expanded PaymentIntents/charges,
refunds, and the complete product catalog, including its archived legacy product. These supply the
underlying records for the three priorities. This document defines the reporting contract and audit
procedure; it does not implement a calculator or publish a conversion/retention baseline.

| Question | Existing Stripe evidence | Essential qualification |
| --- | --- | --- |
| Who made a first payment? | Invoice subscription/customer links, nonzero amounts, `status_transitions.paid_at`, and successful invoice-payment/PaymentIntent/charge evidence | Deduplicate customers and subscriptions separately; exclude zero-value settlements |
| Which trials became paying subscriptions? | Subscription `trial_start`/`trial_end` joined to qualifying payments | Use mature trial cohorts, including canceled/ended subscriptions; flag ambiguous edited trial windows |
| Which paying customers are retained? | Paid invoice-line periods, subscription end/cancellation dates, and refund/dispute evidence | Annual coverage continues between renewals; cancellation intent is not an effective end |

Stripe customer IDs are billing-customer proxies, not proven unique people or app accounts. Do not
merge customers by email or import unrelated personal/fitness records to resolve identity. Reconcile
trusted account bindings separately if a customer-to-app-account measure is later required.

## First qualifying payment

The initial reporting definition is a **fully paid, nonzero QS subscription invoice with a verified
successful Stripe payment**. Require all of the following:

- The invoice belongs to a subscription and an explicitly reviewed QS product, including archived
  products. Product activity and present-day role metadata do not define historical eligibility.
- The invoice has `status=paid`, `amount_paid > 0`, and a valid `status_transitions.paid_at`.
- At least one linked InvoicePayment has `status=paid` and a positive allocated amount. For the
  observed PaymentIntent payment type, verify `status=succeeded` and the successful paid charge.
  Other payment types, missing expansions, manual/out-of-band settlements, and partially paid
  invoices need explicit reconciliation; do not silently classify them as a paid subscription.

Use invoice `status_transitions.paid_at` consistently for the fully paid invoice timestamp. Invoice
creation, PaymentIntent creation, invoice-payment allocation time, and browser return time are
different clocks; small differences between settlement/allocation timestamps are not join failures.

For **new paying customers**, take the earliest qualifying timestamp per Stripe customer across the
complete eligible history, then group those first timestamps into UTC acquisition cohorts. Also report
first payments per subscription as a separate diagnostic. A returning customer's new subscription or
second invoice is not another new paying customer. A paid invoice with zero collected money, a free
trial, a credit/gift, a checkout URL, or an active status alone does not establish a first payment.

First-payment cohorts record the historical payment event. Later refunds do not move that original
date. Report fully refunded first purchases, partial refunds, and disputes as separate guardrails;
retained/net-paid measures must apply their own reversal policy. Keep currencies separate for any
money totals; this is not an accounting revenue-recognition or tax report.

## Trial-to-paid conversion

Use each subscription's recorded valid trial window as the initial analysis grain. Include all statuses,
not just subscriptions currently `trialing` or `active`. Exclude customers with a qualifying payment
before that trial started when reporting first-time trial conversion; show returning payers separately.

The initial comparison window is **through 14 days after the recorded trial end**. This is an explicit
reporting default, not a claim about Stripe's definition or the app's trial duration:

- Denominator: eligible trial windows whose end plus 14 days is at or before the fixed report cutoff.
- Numerator: those windows with a qualifying invoice payment on that same subscription from trial
  start through the end of the conversion window. Early upgrades can qualify.
- Show not-yet-mature trials separately. Do not put them in the failure denominator or calculate
  conversion by dividing today's active subscriptions by today's trials.

Keep cohort dates, cutoff, observation window, numerator, denominator, and exclusions beside each
rate. A zero denominator produces an unavailable rate. If the 14-day window changes, recompute
comparisons consistently rather than comparing different definitions.

Current trial fields can have been edited or represent a later trial on the same subscription. They
are not a complete history of trial episodes. Investigate ambiguous windows using available Stripe
history and retained billing evidence; mark unresolved episodes unknown. Do not claim complete
historical trial conversion merely because the subscription list finished paginating.

## Paid retention

Start customer cohorts at their first qualifying payment. For an initial D30/D60/D90 **paid-coverage
retention** view, include only customers old enough to reach the checkpoint. Determine whether at
least one eligible subscription has paid service coverage at that checkpoint using its invoice-line
periods and the effective subscription end. Treat service periods as start-inclusive/end-exclusive.

An annual payment can cover later checkpoints without another payment in those months. Conversely,
a current active status does not reconstruct past paid coverage. A scheduled cancellation does not
end coverage early; use the effective end and reviewed billing policy. Respect payment timing, gaps,
refund timing, and disputes rather than treating every invoice period as unconditionally paid.

Reconcile full refunds against their dated successful refund records. Review partial refunds and
disputes separately; current charge totals alone do not reconstruct when a reversal happened. Keep
refund creation separate from final success; ambiguous checkpoint boundaries need event/ledger
evidence or an unknown result. Keep
past-due/grace, paused, unpaid, reactivated, and unknown coverage states explicit. Do not infer app
access or historical entitlement from this billing proxy. Product-usage retention is a different measure.

Report the mature denominator and retained count with each rate. Segment monthly and annual plans
when their renewal opportunities differ. Do not label all subscribers as renewed merely because they
have not yet reached a renewal date.

## Reusable read-only audit

Use the already-authorized Stripe connection and standard GET operations. A paid Sigma plan or new
tracking integration is not required for these source reads. Pin the account, live/test mode, source
read interval, fixed reporting cutoff, eligible product set, currency policy, and definitions first.

1. `GET /v1/products`, `limit=100`, without an active-only filter. Review the full catalog before
   selecting QS history; legacy product metadata may differ from the present catalog.
2. `GET /v1/subscriptions`, `status=all`, `limit=100`. Retain customer/product links, trial dates,
   cancellation/end dates, item periods, cadence, pause state, and mode in a private projection.
3. `GET /v1/invoices`, `limit=100`, across eligible history. Retain subscription/customer links,
   status, amounts/currency, paid timestamp, and scoped line periods. Filtering only by invoice
   creation in the reporting month cannot establish first-ever payment or payment-date cohorts.
4. `GET /v1/invoice_payments`, `status=paid`, `limit=100`, with
   `expand=["data.payment.payment_intent.latest_charge"]`. Retain invoice links, allocated amounts,
   payment/charge statuses, charge identity, refund totals, dispute flags, and relevant timestamps.
5. `GET /v1/refunds`, `limit=100`. Reconcile charge/payment links, amount/currency, status, and
   creation dates; inspect further reversal/dispute history where the selected measure requires it.

For every list, use `starting_after` from the last object until `has_more=false`. Verify unique keys,
join coverage, same-customer ownership, same currency for linked money, timestamp availability, and
mode. Separately paginate truncated invoice lines or subscription items. A failed/incomplete read
is unknown coverage, not a zero. Record the read interval because multiple GETs are not an atomic
snapshot. Do not mistake pagination completeness for complete historical state reconstruction.

Keep only the fields needed for joins and checks in private working memory. Keep customer-level
records, identifiers, amounts, exports, credentials, and query receipts out of repository docs, fixtures,
PR descriptions, and logs. Publish only reviewed aggregates in the authorized analysis surface.

## Existing application surfaces

`functions/src/stripe/billing/projections.ts` already copies trial, cancellation/end, subscription item,
and period information. Its invoice projection retains amounts, status, and invoice creation/period
dates, but not `status_transitions.paid_at` or the InvoicePayment payment links. Use Stripe originals
for this audit; the gap does not justify a new frontend event or an automatic schema expansion.

`functions/src/admin/handlers/financials.handlers.ts` reports paid invoice revenue filtered by invoice
creation in the current UTC month and counts matching invoices. That is not a first-paying-customer,
trial-conversion, or retention report. Do not reuse its invoice count as a count of paying customers.
Browser `subscription_started` also includes trials and cannot replace successful-payment evidence.

The billing runtime, event handlers, data projections, telemetry, monitoring, queues, and consent
policy are unchanged by this document. Billing operations remain governed by [Stripe billing](stripe-billing.md).
Acquisition attribution remains governed by [Analytics attribution](analytics-attribution.md); billing
records alone do not establish channel ROI or causal lift from a growth change. Existing Help billing
guidance needs no new user workflow for this read-only reporting procedure.

## Primary references

- [Stripe invoice payments](https://docs.stripe.com/api/invoice-payment)
- [Invoice status transitions](https://docs.stripe.com/invoicing/integration/workflow-transitions)
- [Partial payments and payment lifecycle](https://docs.stripe.com/invoicing/partial-payments)
- [Subscription object](https://docs.stripe.com/api/subscriptions/object)
- [Refund objects](https://docs.stripe.com/api/refunds/object)
