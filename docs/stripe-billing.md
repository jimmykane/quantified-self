# Stripe billing

Repository-owned billing replaces the `firestore-stripe-payments` extension. The deployed `configuration/stripeBilling` document controls processor ownership and request admission; source deployment alone does not transfer ownership or reopen billing. This document is the architecture, test guide and operational source of truth. The email extension remains unchanged. Account erasure uses the existing native cleanup owner; the separate [Delete User Data retirement](delete-user-data-migration.md) is already part of `develop` and is not a Stripe cutover step.

## Runtime and ownership

Functions use Node 22, Stripe Node `22.4.0`, API `2026-07-29.dahlia`. Native billing endpoints run in `europe-west3`, matching the old extension. Existing claims, renewal, gift and Auth cleanup functions retain their regions. Only the existing `onSubscriptionUpdated` path reconciles claims, grace periods and subscription emails; webhook processing does not write claims. Gifts keep the isolated admin key and absolute `trial_end` behavior. New Checkout subscriptions explicitly select classic billing mode to preserve gift eligibility; the pinned Stripe API otherwise defaults to flexible billing.

`configuration/stripeBilling` is server-owned. Its public fields are:

- `owner`: `extension` or `native`; absence means extension. Every native worker/dispatcher checks this.
- `requestsEnabled`: boolean, default false. Rules enforce checkout admission, including cached/old clients. The app reads it from the server and shows maintenance. Native portal also enforces it.
- `webhooksEnabled`: boolean, default false. Native ingress returns 503 until durable admission is enabled; it may collect events while processing remains extension-owned.
- `nativeSince`: Firestore Timestamp set at the handover. Native checkout ignores documents created before this boundary. This is a drain boundary, not permission for concurrent processors.

Deploying code does not activate these flags. Never enable native-owned checkout requests while the extension's checkout processor remains installed. Pausing requests permits already-admitted native work to drain. Changing owner to extension suspends native processing and retains outbox work.

## Contracts and trust

The browser continues creating `customers/{uid}/checkout_sessions/{id}` and waiting for `sessionId`, `url` or a safe `error: {code,message}`. Requests are immutable. Owners can read/delete their own records; deletion during processing prevents a result write from recreating the request. Parent customer records and all server results remain server-owned. Rules allow only registered, active prices and the configured trial length, matching mode, tax/promotions, own UID metadata and approved return URL shapes. Native processing independently fetches price/product and validates all policy, ownership and trial history. Only explicit local emulation permits loopback return URLs.

Customer IDs remain at `customers/{uid}.stripeId`. Existing trusted bindings and the verified-email linking callable are reused. Webhook metadata and browser-supplied customer IDs never establish ownership. More than one UID bound to the same customer fails closed. Creation is on demand, matching the former extension configuration.

Catalog stays at `products/{productId}/prices/{priceId}` and tax rates at `products/tax_rates/tax_rates/{id}`. `stripeBillingPrices/{id}` is a server-written, public Rules index: active, product, mode and trialDays. Freeze catalog changes during initial seeding/cutover. Trial days come from trusted price metadata `trial_days`; histories with any subscription cannot claim a new trial. Trials, promotions and automatic tax remain supported; promotion entry is enabled in Checkout. Subscription checkout blocks existing nonterminal subscriptions.

Subscriptions remain at `customers/{uid}/subscriptions/{id}`. The projection includes product/price DocumentReferences, items, role, status, metadata, trial/cancellation dates and Timestamp period boundaries. New API item periods are translated into top-level minimum start / maximum end, consistent with renewal and gift calculations. App-owned fields are preserved. Product metadata supplies the extension-compatible role; the existing claim reconciler retains the same product-role authority. Invoice locations remain `subscriptions/{id}/invoices/{id}`; payment locations remain `customers/{uid}/payments/{id}` with amounts, status, metadata, receipt/refund information and Checkout prices/items. Subscription invoices use the newer `parent.subscription_details.subscription` relation. No mobile PaymentSheet or Eventarc event publishing is introduced.

`invoice.upcoming` is acknowledged without a projection or queued retrieval: Stripe's notification has no durable invoice ID, and upcoming amounts continue to come from the existing renewal callable. `invoice.deleted` concerns one-off drafts, outside the subscription-invoice projection. Reordered create/update events whose invoice is already missing also complete without a projection; other lookup failures remain retryable. These events therefore do not poison a bounded replay window. See Stripe's [event definitions](https://docs.stripe.com/api/events/types) and [invoice deletion constraints](https://docs.stripe.com/api/invoices/delete).

`createStripePortalLink` implements `{returnUrl} -> {url}` with Auth, production App Check, ownership and URL validation. The manifest uses this native name. After extension retirement only, deploy `ext-firestore-stripe-payments-createPortalLink` for cached clients. Firebase converts its endpoint ID into a dotted runtime target; the isolated loader and non-enumerable runtime alias preserve both discovery and invocation. Do not deploy this alias while the extension owns the old function.

## Durable work

Private `stripeBillingAccounts/{uid}/operations/*` records freeze customer/checkout parameters and idempotency keys before POSTs. A customer-wide lease serializes checkout, portal, webhook projection and deletion. A single catalog lease serializes related product/price updates. Lease duration exceeds worker timeout; transactions verify the token. Every independent normal Stripe call rechecks deletion/ownership, and persistence rechecks inside its transaction.

Lost customer replies are reconciled using operation metadata search, then the original key within 23 hours. Lost checkout replies retry identical parameters/key; after 23 hours they require a uniquely matching session in a bounded customer query. Incomplete/ambiguous reconciliation stops with `operation_uncertain`. Never delete a journal or mint a replacement operation to bypass this state. A definitive Stripe HTTP 400 content rejection is reconciled against the bounded customer session list. Only after confirming no matching session, the original journal is marked rejected and its active reservation released; a new browser request may create a separate operation. Network errors, 409 conflicts, idempotency errors and 5xx responses never release that reservation. An open session is reused for repeated requests with the same price/mode; a conflicting pending checkout blocks a replacement. Every retrieved session must still belong to the current trusted customer binding, including a retained session from another request. A mismatch fails with `customer_conflict` before returning a URL or creating a replacement checkout.

`stripeBillingWebhook` verifies `rawBody` and `Stripe-Signature`, rejects Connect/mode mismatches, and writes a minimal event reference plus pending outbox state atomically before HTTP 200. Unsupported/unowned events are deliberately skipped. No raw payload is retained. A storage/admission failure returns 503. Each `stripeBillingJobs/{sha256}` receipt deduplicates the Stripe event ID. The private `processStripeBillingTask` retrieves current Stripe objects, validates customer identity, skips unchanged projections, and commits projections plus completion in one transaction. Reordered events therefore converge on current state.

The creation/generation trigger dispatches immediately. Recovery uses the established half-hour schedule and a bounded 50-row query on state/recoverAt. Cloud Tasks uses the existing provider policy: 20 attempts, 15-minute minimum / four-hour maximum backoff, four doublings. Missing task reservations are verified with `getTask` before a new generation. Enqueue failures, task-lookup failures and reservation rotations share a bounded recovery budget; failed dispatches persist `dispatchRetryAt` with provider-policy backoff before acknowledgement. Duplicate trigger deliveries respect that backoff, and recovery excludes it from actionable backlog age. Application attempts count durable worker claims, survive transport replacement, and do not inherit transport retries caused by contention. Terminal failures retain the job and a safe `failed_jobs/stripe_billing_{id}` record; terminal checkout dispatch also writes a safe request error in that transaction. No raw provider error enters logs or client documents. Completed/skipped receipts for active accounts expire after 30 days through the declared TTL. Failed jobs require operator review; their operational failure records have a 30-day fallback expiry.

Expected worker contention (`billing_busy`) commits a successor generation in the same outbox before acknowledging the task. Its scheduled time is 5–10 seconds later, with stable jitter to spread simultaneous customer/catalog events; existing later provider or dispatch backoff is preserved. The generation trigger enqueues that successor, and bounded recovery covers an interrupted dispatch. Deferral preserves operation journals, idempotency keys and attempt/recovery counts, and clears only the deferring worker's claim. A duplicate of another active claim leaves its generation and recovery deadline intact. A failed deferral write still rejects the task so Cloud Tasks can retry; an ambiguous commit is safe because the old generation becomes a no-op. Account-deletion guards apply inside the deferral transaction, while deletion jobs remain eligible to finish cleanup. Normal contention resolves successfully without warning/error logs or failure counters; actual provider, persistence and dispatch failures retain their existing handling.

Auth cleanup and customer-document deletion call the same idempotent staging helper. It captures remote IDs before customer-root cleanup, sets a deletion fence, and queues deletion under the same customer lease. The outbox also retains those IDs: a late deletion event cannot lose its customer identity when the worker removes the private account journal. Completion checks every admitted identity atomically. Duplicate lifecycle events preserve pending/terminal retry budgets; exhausted deletion requires explicit replay, while a completed deletion can reopen for a newly discovered identity or later Auth cleanup. The existing Auth cleanup retains the customer root and retries if billing admission fails, while allowing unrelated cleanup stages to continue. Both event orderings work. A customer accepted during deletion is retained only in the private operation journal long enough to delete that exact remote customer. Recovery checks processor ownership and the lease before each Stripe call. Normal workers cannot recreate public data. Cleanup removes associated jobs, dead letters and operations recursively, including the deletion receipt after Auth deletion. It does not wait for TTL. Already-enqueued Cloud Tasks become harmless no-ops when their job disappears; Cloud Tasks drains them. Removing only a customer document retains a private deletion fence until reviewed, preventing automatic recreation while the Auth account still exists.

After confirmed remote customer deletion, cleanup cancels any surviving active/trialing subscription documents for an existing app account. This covers customer-root deletion that leaves descendants behind. The transaction checks the user-deletion guard, lease, processor ownership and replacement customer bindings; it updates existing subscription documents without recreating the customer root. Pages are bounded at 100 subscriptions and continue through the retained deletion job. The existing subscription trigger remains responsible for claims, grace periods and emails. Auth cleanup skips these public writes and removes the account tree through its existing cleanup path.

## Existing subscription policy

Only active/trialing subscriptions provide a paid claim. `past_due` enters the existing 30-day grace path, so payment recovery does not masquerade as an active subscription. A recovered active subscription clears grace; terminal cancellation retains the existing cleanup/notification behavior. Stripe's live retry schedule remains an independently verified account setting.

Admin gifts retain the existing 1–12 UTC calendar month validation, month-end clamping and Stripe trial limit. They preserve prices, tax and scheduled cancellation; ordinary period-end cancellation also accepts Stripe’s derived `cancel_at` when it equals the item period end. Unsupported schedules, custom fixed cancellation timestamps, pending updates and flexible billing fail closed. Their own persisted operation and idempotency key remain unchanged. Renewal calculation continues using `discounts[]` and item period ends under the pinned API.

## Credentials

Production has independent Secret Manager bindings:

| Credential | Consumers | Required access |
| --- | --- | --- |
| `STRIPE_BILLING_KEY` | native portal, compatibility portal, private worker | Customers and Checkout Sessions write; Billing Portal sessions write; Products, Prices, Subscriptions, Invoices, PaymentIntents, Charges and Tax Rates read. Validate restricted-key resource grouping in Stripe test mode. |
| `STRIPE_BILLING_WEBHOOK_SECRET` | ingress only | Endpoint signing secret; not an API credential |
| `STRIPE_SECRET_KEY` | existing claims/linking/renewal paths | Existing policy unchanged |
| `STRIPE_ADMIN_BILLING_KEY` | gift preview/grant only | Existing Subscription read/write restriction unchanged |

Use a dedicated operator credential for Events read when running event-window reconciliation; runtime processing does not need Events access. No extension credential is reused as a production native key. See [secret management](function-secret-management.md). Never print values, put them in commands/PRs or export Secret Manager versions for a cutover inventory.

## Local test environment

Billing ports are Auth 9191, Firestore 8181, Functions 5101 and Storage 9291, all loopback. This avoids sharing the normal development emulators.

Normal `npm start` is a hybrid development environment and is **not** a billing sandbox. Use Node 22 and the dedicated configuration below. The launcher rejects live keys, uses only `demo-stripe-billing`, scrubs inherited cloud credentials and overrides well-known ADC with an inert local-only credential, and directs Auth, Firestore, Functions, Storage and task dispatch to loopback. The frontend disables hosted App Check, Analytics, Performance and Remote Config for this project and connects both full and Lite Firestore SDKs locally.

Store these two entries in ignored, permission-600 `functions/.secret.billing-test.local` in the worktree:

```dotenv
STRIPE_BILLING_KEY=sk_test_REPLACE_LOCALLY
STRIPE_BILLING_WEBHOOK_SECRET=whsec_REPLACE_LOCALLY
```

The webhook secret comes from the local Stripe CLI listener using the same test account/key, not a production endpoint. The launcher maps that single test API key to the three backend API binding names **only inside this local runtime**. It writes a permission-600 `.secret.local` in a dedicated temporary runtime outside repository test discovery, never touches an existing `functions/.secret.local`, and exports only billing-related Functions. Its local-only Auth cleanup exercises billing deletion and recursive user/customer erasure; the broader native account cleanup has its own unit and emulator suites. Mail is written to the emulator but never sent: the email extension is not started. No real users, cards or production exports belong in fixtures.

```sh
npm --prefix functions run build
npm run billing:local -- start
# Separate terminals, with the Stripe CLI installed:
npm run billing:local -- listen
npm run billing:app -- --host 127.0.0.1
```

The long-running local stack exports/imports only its synthetic demo data under ignored `.local/stripe-billing/emulator-state` across restarts, retaining operation journals. Temporary runtime files and local test credentials are never deployed.

`STRIPE_CLI=/absolute/path/to/stripe` may select a locally installed CLI. Listener output is filtered so signing secrets are not echoed. Use Stripe test products/prices and synthetic emulator users. Seed server-owned catalog with the operator tool below. Set the emulator control to native, requests/webhooks enabled and a nativeSince Timestamp before the test requests. Local Cloud Tasks dispatch is HTTP-only to the Functions emulator; delayed retries are driven by the explicit local recovery command. It never calls a cloud queue.

```sh
node tools/stripe-billing/operate.mjs --local --project=demo-stripe-billing --catalog
node tools/stripe-billing/operate.mjs --local --project=demo-stripe-billing --catalog --execute --confirm-project=demo-stripe-billing
node tools/stripe-billing/operate.mjs --local --project=demo-stripe-billing --recover --execute --confirm-project=demo-stripe-billing
```

The optional `test-mode.mjs` driver creates only synthetic test products/users, writes authenticated checkout requests through Rules, and records local evidence in ignored `.local/stripe-billing/fixtures.json`. Its hosted Checkout return URLs use port 4210. Complete payment with Stripe's documented test card, then verify provider state, projections, claims and emulator mail. Enable test Tax first; any real head-office details stay in Stripe. Test clocks exercise renewal, plan changes, payment failure/recovery, gifts, cancellation and deletion:

```sh
node tools/stripe-billing/test-mode.mjs seed
node tools/stripe-billing/test-mode.mjs checkout first
# Complete the URL in the ignored fixture file, using test card 4242 4242 4242 4242.
node tools/stripe-billing/test-mode.mjs verify first
node tools/stripe-billing/test-mode.mjs policy first
node tools/stripe-billing/test-mode.mjs checkout trial subscription --trial
node tools/stripe-billing/test-mode.mjs checkout once payment
node tools/stripe-billing/test-mode.mjs lifecycle
```

Catalog seeding is bounded to 100 prices and refuses a partial seed. The launcher also supports `exec '<local test command>'` for a bounded emulator run. Unit/emulator tests use injected Stripe mocks and no credentials; actual fake-payment validation separately uses Stripe test mode. Neither local task HTTP success nor offline tests establish production IAM/Cloud Tasks readiness.

## Replay and reconciliation

All operator commands default to dry run; writes require `--execute --confirm-project=<exact-project>`. Live commands require an explicit live project, no emulator variables and an appropriate live credential supplied securely through the environment. Running them in production requires separate authorization even when flags are present.

```sh
# Preview one failed native job; executing retains its operation keys/parameters.
node tools/stripe-billing/operate.mjs --project=PROJECT --job=JOB_SHA256
# Preview a Stripe event or bounded cutover window (within Stripe's 30-day retention).
node tools/stripe-billing/operate.mjs --project=PROJECT --event=evt_EVENT
node tools/stripe-billing/operate.mjs --project=PROJECT --since=ISO_START --until=ISO_END
```

A window exceeding 100 events fails before writes; narrow the window. Event replay reuses receipt deduplication and fetches current state. For an already failed receipt, explicitly replay its job after diagnosis; re-admitting the event does not silently reset failure budgets. Job replay advances task generation and resets retry/recovery budgets while preserving customer/checkout journals. Deleted-account jobs are ineligible. Replaying `operation_uncertain` does not authorize another Stripe POST beyond the original idempotency window: reconcile the provider identity first, with a reviewed recovery action.

## Monitoring

Definition/test coverage is implemented here; production activation and live readback are tracked in [#921](https://github.com/jimmykane/quantified-self/issues/921) in the Quantified Self IO project.

`tools/stripe-billing-monitoring` uses the shared owned-resource provisioning policy. It provides a dashboard and alerts for admission, processing, dispatch, terminal and checkout failures, actionable backlog age, unknown observations and missing recovery heartbeat, plus native HTTP failures. Webhook acceptance and committed processing have separate counters. Labels are fixed; no UID, email, event/job/customer ID, payload or raw error is extracted. The bounded recovery sample excludes future work, active leases and deleted accounts; a capped/unavailable sample cannot establish healthy zero. Expected contention and stale tasks do not increment application failure counters.

Monitoring coverage for the short contention retry is **unchanged**: it reuses the same outbox, dispatcher, bounded recovery and committed-processing counters. Pending successors remain covered by actionable backlog and missing/unknown recovery telemetry; a failed enqueue retains dispatch-failure and terminal-failure coverage. No new metric or alert is needed for normal lock contention. Emulator regression coverage checks concurrent delivery, active claims, deferral-write failures, preserved provider backoff/idempotency, deletion guards and absence of contention error logs. Local verification does not deploy this behavior or establish production readiness.

```sh
node tools/stripe-billing-monitoring/cli.mjs --project=PROJECT
# Only after separate approval, using an existing verified direct email channel:
node tools/stripe-billing-monitoring/cli.mjs --project=PROJECT --notification-channel=projects/PROJECT/notificationChannels/CHANNEL --apply --confirm-project=PROJECT
```

Provisioning preserves unrelated resources and refuses unowned name collisions. Activate heartbeat alerts only at native ownership, then verify an initial heartbeat and exact service/queue filters. Alert delivery must not depend on the monitored email extension. Defaults are three failures per hour (one terminal failure), one-hour actionable backlog and two-hour missing heartbeat; tune with observed traffic. Keep local definition coverage separate from live activation/readback evidence.

## Production cutover and recovery

This is a manual release procedure; opening/merging the PR does not authorize it. Keep the PR draft until the required real Stripe test-mode matrix passes. The legacy instance targeted by this procedure is `firestore-stripe-payments` (`invertase/firestore-stripe-payments@0.3.12`), with six old Node 20 Gen 1 functions. Leave the email extension and native account-cleanup ownership unchanged. Existing subscriptions continue billing at Stripe during the agreed brief checkout/portal pause.

1. **Prepare.** Capture a value-free inventory of the actual live Stripe webhook endpoint/events/version, installed extension instance, function regions/runtime, service accounts, exact deploy targets, existing customer bindings and outstanding checkout outcomes. Verify independent native secrets and restricted-key permissions, Firestore composite index and receipt TTL, named task queue permissions (enqueue and task get), private task invoker/OIDC identity, service account token creation and Eventarc delivery. Preview monitoring and select a verified independent channel. Freeze catalog changes, preview/execute catalog Rules-index seeding under separate approval, and verify all active prices/trials. Save prior control/routing/IAM settings without credentials. Required webhook families are subscription, checkout completion/async payment, invoice, PaymentIntent, charge refund, product, price, tax rate and customer deletion. Native ingress accepts snapshot events on the account; do not configure Connect or thin events.
2. **Deploy dormant replacements.** Initialize control with owner extension, requestsEnabled true, webhooksEnabled false and no nativeSince. Deploy the new ordinary endpoints, changed Auth cleanup, and existing claims/gift callers listed below. The claims callers must receive the customer-deletion fence; both gift callables must receive the period-end cancellation compatibility change. Deploy the frontend and Rules only after catalog-index preparation. Keep the legacy portal compatibility target out of this deployment. The native portal deliberately reports maintenance while extension owns billing; schedule the frontend switch for the agreed pause. Deploy indexes/TTL and inspect readiness, not merely the deploy exit code.
3. **Pause requests.** Set requestsEnabled false and confirm Rules reject an old cached client's checkout create. Pause the old portal through separately approved endpoint IAM/routing, because the installed extension cannot read the native admission flag. Capture prior invocation permissions for rollback. Drain old checkout triggers and all outstanding request documents; resolve every ambiguous Stripe outcome. Do not transfer ownership with an unresolved checkout operation. Existing open Checkout Sessions need explicit reconciliation/expiry policy before resuming another request.
4. **Transfer processing.** Enable durable native webhook admission and route the intended Stripe event families to the new signed ingress. Stop old webhook routing and drain its in-flight executions before setting owner native plus nativeSince to the handover timestamp. No new checkout is admitted. Dispatch/recover the retained native backlog and verify fresh subscription/invoice/payment projection, claims and mail outbox synchronization. Processing convergence and deduplication must pass before retirement.
5. **Retire only Stripe.** With separate explicit approval naming this instance, uninstall only `firestore-stripe-payments`; preserve all billing documents. Remove that instance's declaration/configuration from the deployment configuration as a reviewed cutover change so a later deploy cannot recreate it. Do not remove any other extension or alter native account-cleanup ownership. Then deploy the old-name portal compatibility endpoint and verify the cached callable contract. Verify the old customer/checkout/webhook/deletion functions are gone before reopening requests.
6. **Reconcile/reopen.** Dry-run the exact cutover event window, execute deduplicated replay, inspect mappings and latest subscription periods/status/roles, exercise portal and a controlled separately authorized live smoke if required, and read back queue/IAM/monitoring health. Confirm welcome/cancel/gift paths still use the existing deterministic email logic. Only then set requestsEnabled true. Record SHA, deployment targets, timestamps, operator and evidence without private data.
7. **Recover.** Before extension retirement, pause requests, stop native processing, restore prior webhook routing and old portal permissions, and reconcile outstanding native operations before extension admission resumes. Afterwards keep requests paused and queued work retained; restore the tested native build or roll forward. Never erase an uncertain operation to force a retry and never depend on reinstalling Node 20. Do not purge event receipts, customers or subscription documents as a rollback.

Initial dormant deployment targets (review against the actual manifest; never use a broad Functions deploy during the overlap):

```sh
firebase deploy --project=PROJECT --only functions:createStripeCheckoutSession,functions:createStripePortalLink,functions:stripeBillingWebhook,functions:dispatchStripeBillingJob,functions:recoverStripeBillingJobs,functions:processStripeBillingTask,functions:deleteStripeCustomerOnDocumentDeleted,functions:cleanupUserAccounts,functions:restoreUserClaims,functions:linkExistingStripeCustomer,functions:onSubscriptionUpdated,functions:enforceSubscriptionLimits,functions:previewAdminSubscriptionGift,functions:grantAdminSubscriptionGift
# AFTER the exact Stripe extension instance is uninstalled:
firebase deploy --project=PROJECT --only functions:ext-firestore-stripe-payments-createPortalLink
```

Before retirement, inspect the extension's two Secret Manager entries, `firestore-stripe-payments-STRIPE_API_KEY` and `firestore-stripe-payments-STRIPE_WEBHOOK_SECRET`, without accessing their values. The `firebase-extensions-managed` label makes uninstall permanently delete those secrets. Preserve them by removing only that label before uninstall, retaining other labels and enabled versions. Native endpoints must already bind the independent `STRIPE_BILLING_KEY` and `STRIPE_BILLING_WEBHOOK_SECRET`; the admin gift key stays isolated. Retaining legacy credentials does not reactivate the disabled legacy webhook. Any later credential deletion or revocation requires its own explicit approval.

An authorized immediate uninstall uses `firebase ext:uninstall firestore-stripe-payments --project=PROJECT --immediate`; without `--immediate`, the CLI only changes local configuration until an extension deployment. Verify the exact instance and all six old Functions are absent before deploying the compatibility endpoint. Compare billing document identities and customer bindings, other extension configuration, unrelated Function revisions, Rules, Hosting, monitoring and secret versions before/after. Preserve private inventories outside the repository; record only aggregate verification results here.

## Verification and release evidence

Required coverage: first/returning checkout; recurring/one-time payments; trials/promotions/tax; portal and legacy alias; renewals/failures/cancellations/upgrades/downgrades; grace periods/emails/gifts; duplicates/reordering; concurrent creation; ambiguous replies; dispatch failure/exhaustion/replay; deletion during creation/checkout/projection/retry; forged Rules writes; maintenance. Keep the actual test-mode evidence and any remaining cases in the PR, not inferred from mocked tests.

Run affected frontend, Functions, Rules and registered emulator tests, billing tools/monitoring, suite/CI registration checks, frontend/backend builds, secret bindings, isolated entrypoints and the cold-import benchmark. Distinguish local and Stripe test-mode verification from separately authorized production actions and their live readback evidence.

### Production retirement checkpoint — 2026-10-24

The repository owner explicitly authorized retiring only the Stripe extension and deploying its portal compatibility endpoint while keeping requests paused. The Functions source deployed for this checkpoint was commit `8decc29edf7511404df670986748b42dce234d38`; this retirement changes deployment configuration and this runbook, not the handler implementation.

- `firestore-stripe-payments` and all six of its Node 20 Gen 1 Functions were removed. The email extension and the other 188 Functions retained their prior configuration/revisions.
- Only `ext-firestore-stripe-payments-createPortalLink` was then deployed, as a Node 22 Gen 2 callable in `europe-west3`. Its dotted runtime target resolved correctly and its sole secret binding is `STRIPE_BILLING_KEY`. Live preflight returned HTTP 204 for the production origin, and an unauthenticated callable request returned HTTP 401 with `UNAUTHENTICATED` and no portal URL. No production portal session was created.
- Before/after inventories matched for all 1,655 billing documents, including all 394 customer bindings. Legacy and native secret versions were preserved; only the legacy secrets' extension auto-deletion labels were removed. Rules, Hosting, monitoring policies and the billing control document were unchanged. The native task queue remained running, empty and without public worker invocation access.
- `owner=native`, `requestsEnabled=false`, and `webhooksEnabled=true` remained in force. The native Stripe destination is enabled; the old Stripe destination remains disabled. Prior to retirement, genuine Stripe `product.updated` deliveries returned HTTP 200, completed on their first processing attempts, and synchronized both addition and removal of temporary product metadata.
- Verification passed: 27 focused unit checks; one focused Auth/Firestore emulator portal-contract/maintenance test using synthetic Stripe responses; the Functions build and deployment-source safety check; secret bindings for 74 endpoints; entrypoint checks for 188 exports and 107 isolated targets; and the cold-import benchmark across 108 scenarios with five samples each. The compatibility target's median import was approximately 129 ms. Monitoring coverage is unchanged because the native worker, queue and telemetry paths are unchanged.

This checkpoint does not reopen checkout or portal. Complete the reconciliation/reopening step under separate explicit authorization. Private inventories and operational logs are retained outside source control; this document contains only the scope and aggregate verification results.
