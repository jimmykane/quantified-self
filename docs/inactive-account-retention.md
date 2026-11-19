# Inactive Free account retention

Implementation status: prepared in source, **off by default**. This document is not evidence of production deployment,
email delivery, TTL activation, monitoring activation or account deletion. Each live rollout action requires separate
explicit approval. No backfill or immediate deletion accompanies deployment.

## Product rule

The independent `processInactiveAccounts` schedule runs every 24 hours, matching subscription enforcement's cadence
without coupling either job's availability or execution order. In all three active modes, a batch that uses its time
allowance hands unfinished work to `continueInactiveAccounts`. The next batch can start as soon as Firestore delivers
the event. Eligibility uses the latest Firebase Auth `lastSignInTime` or
`lastRefreshTime`. A remembered app session refreshing protects the account. Provider sync and MCP activity do not
update this clock. No frontend heartbeat or activity collection is added.

Eligibility requires strictly more than six calendar months in UTC, clamping month-end dates. Creation time validates
the identity but never substitutes for missing activity. Missing, malformed, future or inconsistent dates, disabled or
tenant users, admins, missing email, unknown roles and any Basic/Pro claim are protected.

Currently Free accounts include former subscribers only after every access/grace period has ended. Both Auth claims
and canonical grace fields, subscription records, gift operations, checkout history and pending billing work are checked.
Every nonterminal subscription is protected, including trialing, past_due, unpaid, paused and incomplete. A canceled
subscription is terminal; a cancellation scheduled for the end of an active term is protected.

The warning goes to the current Auth email and is transactional, independent of marketing consent. A `mail` record
alone does not start the countdown. Matching UID, generation, template and recipient, `delivery.state=SUCCESS`, a single
accepted address, empty rejected/pending recipients and a valid extension `endTime` are required. That time starts a
full 30 days. SMTP acceptance does not establish inbox placement or opens. Missing/error/ambiguous mail prevents deletion.
After acceptance, the worker checks that the original queue time precedes or equals acceptance and that the stored
deadline allows at least 30 days. A missing or inconsistent timestamp invalidates that notice and requires a fresh warning.

Returning, an email change or restored entitlement invalidates the notice. Subscription events invalidate active
notices even if a short membership ends between daily scans. Old redeliveries cannot invalidate a newer notice.
Unchanged daily claims signals do not reset warnings. A later eligible episode receives a new warning and full 30 days.
There is no hourly requirement or exact deletion-time promise: caps, outages and daily scheduling can delay processing.

The daily due lane also attempts **one final reminder during the last seven days before the original deadline**.
The worker schedules the next check by the opening of that window. If a sweep first observes SMTP acceptance during
the final week, it can recheck the account and queue the reminder in the same sweep.
It requires a still-valid accepted notice and repeats the Auth, billing, deletion-guard and lease checks used for
initial warnings. A delayed scan sends the exact existing deadline, including UTC time, rather than promising
another seven days. No reminder is queued at or after that deadline. The reminder is supplemental: its delivery failure,
absence or delay neither extends the original 30-day period nor replaces the initial SMTP-acceptance evidence.
Returning or losing eligibility cancels a reminder that has not yet been queued. Already queued mail cannot be recalled.

## State and safety boundary

- `configuration/inactiveAccounts`: private runtime state, global expiring lease, UTC counters and resumable Auth cursor.
  Missing/unknown mode is `off`; other modes are `dry-run`, `warnings-only` and `enforce`.
  Admin settings writes can change only the mode, bounded daily limits and revision/attribution fields; raw reads,
  counter/cursor/lease edits and deletion remain denied to every browser client.
- `configuration/inactiveAccounts/work/continuation` holds one private, single-use request. The batch creates it in
  the same transaction that releases the lease. The Firestore creation handler matches its ID, mode and settings
  revision before consuming it and acquiring the next lease. Duplicate or superseded events cannot start a fresh
  inventory. A daily run can take over pending work from the saved Auth position and check all notices due that day.
- `users/{uid}/inactivityRetention/state`: one UID-owned episode with generation, activity/creation snapshots, email
  fingerprint of the exact Auth address, billing revision, mail ID, queue/acceptance/deadline timestamps and state.
  Even case-only Auth address edits require a fresh warning. No plaintext email is stored here.
  The `expireAt` TTL is 90 days; recursive account cleanup also erases it. Expired or missing expiry evidence requires
  a fresh notice even if asynchronous TTL cleanup has not removed the record yet.
- `mail/inactivity_{generation}`: existing mail lifecycle with UID, current recipient and 90-day TTL.
- `mail/inactivity_reminder_{generation}`: one supplemental mail per episode, also UID-owned with 90-day TTL.
  The episode's `reminderMailId` and `reminderQueuedAt` are committed atomically with this mail. They remain as
  deduplication evidence even if the mail fails or expires; scheduled processing never resends that reminder.
  A new episode replaces these markers and must earn its own initial accepted notice and 30-day deadline.
- `userDeletionTombstones/{uid}`: existing durable writer fence, created only when deletion is due. Pending fences
  have no TTL. The existing cleanup owner creates its expiring completed receipt only after verified cleanup.

State proceeds queued → warned → deletion_requested; cancellation permits a later new episode. Auth scanning uses
pages of up to 100 and a durable cursor. Within each four-minute batch, the first two minutes are available for due
notices. A continuation resumes after the last notice's time and document path. It keeps the due-time cutoff unless
recording a late delivery receipt makes a final reminder due during the handoff.
It can finish checking notices after Auth discovery is complete. Discovery resumes at the last fully committed page.
If no page fit before timeout, the next batch tries a smaller page down to one account. Discovery skips existing
active notices, so an exhausted deletion budget cannot block new warnings. Capped deletions yield their due-queue position until the next daily check so an older backlog
cannot repeatedly starve newer warning receipts. A global lease prevents overlap. UTC caps are 100 warning emails
(initial warnings and final reminders combined) and 25 deletion
initiations per day across retries; `warningDailyLimit`/`deletionDailyLimit` may lower these, including zero, but cannot
raise them. A timeout can start another batch during the same UTC day. Every batch draws on the same counters.
A quota stop alone creates no continuation. A warning-capped discovery page waits for the next daily run, while
unfinished due-notice work can continue independently. Missing limits use those defaults. Invalid limits fail closed.
A cap reservation is not refunded after failure.
The budget day and queue timestamps use the current transaction attempt's time after eligibility reads, including
when those reads or a retry cross UTC midnight.

`dry-run` checks eligibility using a transient native billing lease, saves scan progress, and records first-warning
candidates in a private admin report. It creates no warning, episode or deletion fence.
`warnings-only` queues/observes warnings but cannot initiate
deletion. Switching to `enforce` can act on already elapsed warnings, so inspect their ages before changing mode.
`off` stops new scans and is rechecked inside mutation transactions. It does not recall queued mail or undo an Auth
deletion already attempted; existing cleanup must continue.
Final reminders run in both `warnings-only` and `enforce`, subject to the shared warning cap. After the cap is reached,
the reminder becomes due for another check at the next UTC midnight or the original deadline, whichever comes first.
`dry-run` checks eligibility without queuing a reminder or changing its episode.

Native billing ownership and a valid handover timestamp are required. The scanner holds the same customer lease as
native billing, rechecks guarded Firestore state transactionally and reads Stripe without mutating or linking customers.
An email matched to a different customer, conflicting bindings, missing former-paid bindings, unknown billing data,
open/ambiguous checkout, nonterminal schedule, provider error or truncated history is a hold. Histories over 100
subscriptions, schedules or sessions require review instead of assuming that an incomplete page proves Free.
Live Stripe history also rejects subscriptions/checkouts begun or ended since the warning.

After the final checks, the scanner uses the shared initiation helper extracted from `deleteSelf`: an individual
`auth.deleteUser(uid)` triggers the existing `cleanupUserAccounts` flow. Never replace it with bulk `deleteUsers`,
which does not deliver the required per-user Auth deletion events. Confirmation mail means Auth access was removed,
not that background cleanup finished. Provider disconnects, recursive account/customer/MCP/mail cleanup, Storage
cleanup and completed receipt verification retain their existing owner and scope.

The scanner checks Auth again after preparing the fence. A detected return/change before the RPC removes only its
own untouched prepared fence. A competing cleanup attempt or another initiator's marker always wins. Once the Auth
RPC may have started, failures keep the fence and require review; scheduled scans never blindly repeat that RPC.
Firestore, Firebase Auth and Stripe do not support one distributed transaction. The final Auth observation and
customer lease narrow races but cannot eliminate a sign-in or externally initiated payment in the final RPC window.
This residual boundary must be understood before enabling enforcement.

## Admin route

**Admin → Inactive accounts** opens `/admin/inactive-accounts`, independently of Maintenance. It is admin-guarded,
client-rendered and noindexed, and links directly from the Admin dashboard. The page provides:

- Off, dry-run, warnings-only and enforce settings, daily limits, current UTC-day reservations and explicit save confirmation.
  Enforcement confirmation explains that existing elapsed notices may become actionable. Saving does not run a scan.
- Last scan start/finish, last complete Auth inventory, worker lease state and the most recent active run's bounded counters.
  The scheduler persists only one aggregate `lastRun` alongside its normal lease release. Failed active runs retain a failed
  summary; off/contended invocations do not replace it. Cloud Monitoring remains authoritative for missed invocations/timeouts.
- Pages of 25 accounts for warning delivery, deletion deadlines, cancelled notices and pending deletion follow-up, ordered
  by UID. Pending tombstones remain visible after user-root cleanup. Current email/absence comes from Firebase Auth;
  an Auth lookup failure fails the request rather than claiming the account is gone. Hold counts are observations from the
  last run, not a complete per-account billing investigation or a global candidate inventory.

**Last completed dry run.** On this route, **Review eligible accounts** opens the completed scan's list of
first-warning candidates in pages of 25. The total counts distinct accounts at scan time. Account cleanup removes
that account's row, and Firebase Auth supplies the current sign-in email when the page is viewed. Warning and deletion
decisions always run their own eligibility checks.

During a dry run, each complete Auth page commits its cursor and eligible memberships in the same lease-checked
transaction. A partial page is retried. A failed or contended discovery check also leaves that page for a later
invocation. Only the final page publishes the new report and total. Until then the previous completed report remains
available. Page requests carry its report ID so a newer published report starts the viewer on page one.

The worker alternates two private leaves under `users/{uid}/inactivityDryRunMatches`. Each stores only a scan ID.
Overlapping pages count a UID once per report. The account deletion guard protects these writes and recursive user
cleanup removes both leaves. The control document holds the draft and the last published report. Changing settings
during a scan discards the partial draft on the next dry run. Legacy cursors start a fresh report from the beginning.

For rollout, deploy the collection-group ascending index on `inactivityDryRunMatches.scanId` and verify it is ready.
Deploy the private `continueInactiveAccounts` trigger before updating `processInactiveAccounts`, so the first
handoff has a listener. Release the scheduler and `getInactivityAdmin` before the admin frontend. Complete a fresh
dry run to populate the first report. Earlier scans retained batch counts only and cannot supply a list of accounts.

The read-only `getInactivityAdmin` callable applies existing admin authentication/App Check and rejects impersonation.
It returns an explicit bounded projection combining private retention/mail/cleanup records with current Auth identities;
direct client reads cannot supply that cross-system projection without exposing the private source records. It never
returns lease tokens, generation/hash evidence, mail bodies or billing identifiers, and performs no Stripe calls or writes.
Settings use the existing Firestore SDK directly. Rules enforce their exact field set, integer caps and monotonically
incremented `settingsRevision`, preserving runtime state and rejecting concurrent/stale edits. Only genuine administrator
sessions may write; impersonated sessions are denied. The page discards pending responses and confirmations after an
account change or destruction. Returning to the same UID cannot revive an old confirmation or let an old save result
clear a newer dialog or its pending state. There are no manual-delete, retry, reset-counter or send-email buttons.

The Help page explains the supplemental reminder and unchanged original deadline. Admin account details distinguish a
queued final reminder from the initial accepted warning. Daily warning reservations and queued counts include both
email types; accepted counts still describe initial notices that establish the deadline.

## Monitoring and recovery

The existing cleanup monitoring owner gains nine metrics, five policies and dashboard panels via
`tools/cleanup-monitoring/inactivity.mjs`; the full source bundle is 18 metrics and 12 policies. Existing identities,
conditions and the independent Alerts channel are retained. This source change does not apply them to production.

`[AccountInactivity]` summaries contain fixed outcome counts and bounded ages, without recipient identifiers or raw
errors. Only the daily scheduler supplies the heartbeat. Both workers supply scan outcomes, including real
scan/provider failures and native 5xx/timeouts. The existing progress policy flags a current request that waited
30 minutes or longer when either worker picks it up. Monitoring also covers unconfirmed warnings, pending inactivity
fences older than 24 hours, observed overdue deadlines, an Auth scan unfinished for seven days and a missing daily
heartbeat for 48 hours. Holds/caps/contention are not failed deletions.
Samples are bounded; queued mail, Auth initiation and cleanup completion are distinct. Existing email-delivery and
native cleanup policies remain authoritative for their stages.

Final-reminder monitoring impact: **covered by existing telemetry; no new policy or label**. Queued reminders use the
existing `counts.queued` warning metric and shared warning cap. Transaction/provider failures flow into `counts.failed`;
the existing daily heartbeat and due-lane coverage apply. The ordinary `mail` record initializes `queuedAt` and pending
delivery metadata, so the existing transactional email backlog, unknown-state, SMTP failure and partial-acceptance
monitoring includes it automatically. The initial-notice-unconfirmed metric remains specific to deletion-blocking
first-warning evidence. Protective cancellations, caps and contention remain excluded from failure pages.

The 48-hour alert counts successful requests across revisions of the daily scheduler. Cloud Monitoring checks every
five minutes and alerts when the preceding 48 hours contain zero successful responses, including when no series exists.
The worker logs its summary before returning success. The dashboard and rollout check use that application heartbeat
directly. The alert uses the native Cloud Run metric because [log-based PromQL alerts can look back at most 25 hours](https://docs.cloud.google.com/monitoring/promql/promql-in-alerting).
Warning/deletion/hold
distribution charts show per-run p95 counts, not totals; their percentile alignment produces numeric series as required
by the [Monitoring aggregation contract](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.alertPolicies#Aligner).
On first creation, the metric has no history: [log-based metrics do not backfill earlier logs](https://docs.cloud.google.com/logging/docs/logs-based-metrics).
The enabled policy can open an initial absence incident until the new service returns its first successful response.
Verify the application heartbeat metric separately after the scheduled run.

After a worker failure, the daily job recovers from the durable Auth cursor and due notices once the lease expires.
A redelivered event for an already claimed request does not repeat a batch. An ambiguous Auth deletion remains fenced
for operator review.

On an alert, inspect the exact episode, mail acceptance, latest Auth metadata, billing history, marker/checkpoints and
native cleanup logs using read-only access. Do not infer an absent Auth user or finished cleanup from a network error.
Preserve pending fences and uncertain Stripe operations. A prepared marker left by a crash, an attempted RPC without
confirmed outcome, or an orphaned user requires exact-target review. Any replay, marker removal, email resend, account
deletion or infrastructure change requires separately approved scope. No general-purpose destructive recovery command
is supplied. Reconcile through the existing deletion runbook after establishing what actually committed.

## Verification and rollout

Local tests cover calendar boundaries, identity/recipient changes, refreshed sessions, billing ambiguity, paid/grace
protection, delivery evidence, exact deadlines, repeated/concurrent runs, caps, cursor progress, guarded cancellation,
ambiguous Auth failure and recursive cleanup. Reminder checks cover the seven-day boundary, exact UTC deadline,
concurrent deduplication, shared caps, all modes, changed Auth/billing state, deletion fences and failed/missing reminder
mail without extending the deadline. Lifecycle emulator tests use real loopback Firestore with fake Auth
and Stripe; the existing cleanup suite verifies its recursive data boundary. These do not prove real SMTP delivery,
remote Stripe permissions or production Auth trigger delivery.

Before an approved rollout:

1. Review current native billing ownership, indexes, TTL configuration and existing cleanup health. Verify
   `STRIPE_BILLING_KEY` permits Customers, Subscriptions, Subscription Schedules and Checkout Sessions reads. The new
   Subscription Schedules read permission must be verified; this PR does not modify a key or secret.
2. Before deploying the reminder-capable scheduler, with separate template-write approval, seed both retention
   templates and their required partials using
   `npm --prefix functions run seed-emails -- --templates=account_inactivity_warning,account_inactivity_final_reminder` under an explicitly verified
   target project environment. The seeder does not select a project from a `--project` argument. Verify HTML/plaintext
   previews first, then read back the seeded templates and partials before proceeding. A controlled-inbox SMTP test
   needs its own mail authorization.
3. After the template readback, with separate deployment approval, use Node 22 and the repository's pinned CLI:
   `npm run firebase -- deploy --project quantified-self-io --only firestore:rules,firestore:indexes`, then
   `npm run firebase -- deploy --project quantified-self-io --only functions:continueInactiveAccounts`, then
   `npm run firebase -- deploy --project quantified-self-io --only functions:processInactiveAccounts,functions:getInactivityAdmin,functions:onSubscriptionUpdated,functions:deleteSelf`.
   Verify the due/state collection-group query indexes and 90-day episode TTL are active, not merely present in source.
   Deploy the help/policy changes with the normal approved Hosting build.
4. Preview monitoring offline with `node tools/cleanup-monitoring/cli.mjs --project=quantified-self-io`. Apply only
   under separately approved configuration authority with the verified existing independent notification channel.
   The bundle enables policies during apply; allow for the initial absence incident described above. Keep retention off
   until the first post-creation scheduled heartbeat appears in the metric and its alert clears. Any manual off-mode
   invocation to accelerate that check requires separate approval.
   Read back all owned resources and prove old identities/conditions are preserved. Verify actual heartbeat series.
5. Keep mode off until those prerequisites pass. Separately approve `dry-run`, inspect aggregate holds and scan
   completion, then separately approve a bounded `warnings-only` phase. Do not backdate acceptance or shorten deadlines.
   Review current evidence and aged notices before separately authorizing `enforce` and exact operational limits.

No new MCP tools, data contracts, consent or provider mutations are exposed. Existing account-deletion coverage removes
the new user subtree; provider sync and Training calculations are unchanged.

See [native account cleanup](delete-user-data-migration.md), [email lifecycle](email-lifecycle.md),
[billing ownership](stripe-billing.md) and [cleanup monitoring](account-cleanup-monitoring.md).
