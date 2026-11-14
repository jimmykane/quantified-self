# Inactive Free account retention

Implementation status: prepared in source, **off by default**. This document is not evidence of production deployment,
email delivery, TTL activation, monitoring activation or account deletion. Each live rollout action requires separate
explicit approval. No backfill or immediate deletion accompanies deployment.

## Product rule

The independent `processInactiveAccounts` schedule runs every 24 hours, matching subscription enforcement's cadence
without coupling either job's availability or execution order. It uses the latest Firebase Auth `lastSignInTime` or
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

Returning, an email change or restored entitlement invalidates the notice. Subscription events invalidate active
notices even if a short membership ends between daily scans. Old redeliveries cannot invalidate a newer notice.
Unchanged daily claims signals do not reset warnings. A later eligible episode receives a new warning and full 30 days.
There is no hourly requirement or exact deletion-time promise: caps, outages and daily scheduling can delay processing.

## State and safety boundary

- `configuration/inactiveAccounts`: private runtime state, global expiring lease, UTC counters and resumable Auth cursor.
  Missing/unknown mode is `off`; other modes are `dry-run`, `warnings-only` and `enforce`.
  Admin settings writes can change only the mode, bounded daily limits and revision/attribution fields; raw reads,
  counter/cursor/lease edits and deletion remain denied to every browser client.
- `users/{uid}/inactivityRetention/state`: one UID-owned episode with generation, activity/creation snapshots, email
  fingerprint of the exact Auth address, billing revision, mail ID, queue/acceptance/deadline timestamps and state.
  Even case-only Auth address edits require a fresh warning. No plaintext email is stored here.
  The `expireAt` TTL is 90 days; recursive account cleanup also erases it. Expired or missing expiry evidence requires
  a fresh notice even if asynchronous TTL cleanup has not removed the record yet.
- `mail/inactivity_{generation}`: existing mail lifecycle with UID, current recipient and 90-day TTL.
- `userDeletionTombstones/{uid}`: existing durable writer fence, created only when deletion is due. Pending fences
  have no TTL. The existing cleanup owner creates its expiring completed receipt only after verified cleanup.

State proceeds queued → warned → deletion_requested; cancellation permits a later new episode. Auth scanning uses
pages of 100 and a durable cursor. Due episodes get an independent two-minute lane within a four-minute scan budget;
an unfinished Auth page is revisited. Discovery skips existing active notices, so an exhausted deletion budget cannot
block new warnings. Capped deletions yield their due-queue position until the next daily check so an older backlog
cannot repeatedly starve newer warning receipts. A global lease prevents overlap. UTC caps are 100 new warnings and 25 deletion
initiations per day across retries; `warningDailyLimit`/`deletionDailyLimit` may lower these, including zero, but cannot
raise them. Missing limits use those defaults. Invalid limits fail closed. A cap reservation is not refunded after failure.

`dry-run` performs eligibility reads and saves operational cursor/lease progress, including a transient native billing
lease; it creates no warning, episode or deletion fence. `warnings-only` queues/observes warnings but cannot initiate
deletion. Switching to `enforce` can act on already elapsed warnings, so inspect their ages before changing mode.
`off` stops new scans and is rechecked inside mutation transactions. It does not recall queued mail or undo an Auth
deletion already attempted; existing cleanup must continue.

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

The read-only `getInactivityAdmin` callable applies existing admin authentication/App Check and rejects impersonation.
It returns an explicit bounded projection combining private retention/mail/cleanup records with current Auth identities;
direct client reads cannot supply that cross-system projection without exposing the private source records. It never
returns lease tokens, generation/hash evidence, mail bodies or billing identifiers, and performs no Stripe calls or writes.
Settings use the existing Firestore SDK directly. Rules enforce their exact field set, integer caps and monotonically
incremented `settingsRevision`, preserving runtime state and rejecting concurrent/stale edits. Only genuine administrator
sessions may write; impersonated sessions are denied. The page discards pending responses and confirmations after an
account change or destruction. There are no manual-delete, retry, reset-counter or send-email buttons.

The existing help/policy content already describes the unchanged customer-facing retention behavior; this admin-only
surface does not change those rules. Monitoring coverage is unchanged: dashboard data reuses scheduler outcomes and
does not replace the existing heartbeat, failure, delivery, overdue or pending-fence policies.

## Monitoring and recovery

The existing cleanup monitoring owner gains nine metrics, five policies and dashboard panels via
`tools/cleanup-monitoring/inactivity.mjs`; the full source bundle is 18 metrics and 12 policies. Existing identities,
conditions and the independent Alerts channel are retained. This source change does not apply them to production.

`[AccountInactivity]` summaries contain fixed outcome counts and bounded ages, without recipient identifiers or raw
errors. Off/idle/contended runs emit heartbeat. Policies cover real scan/provider failures and native 5xx/timeouts,
unconfirmed warnings, pending inactivity fences older than 24 hours, observed overdue deadlines or an Auth scan
unfinished for seven days, and a missing daily heartbeat for 48 hours. Holds/caps/contention are not failed deletions.
Samples are bounded; queued mail, Auth initiation and cleanup completion are distinct. Existing email-delivery and
native cleanup policies remain authoritative for their stages.

The 48-hour heartbeat uses a PromQL sum over the lookback window, with an explicit zero fallback for absent data;
it alerts after five minutes without any positive observation in that window. This avoids the
[23.5-hour metric-absence limit](https://docs.cloud.google.com/monitoring/alerts/metric-absence). Warning/deletion/hold
distribution charts show per-run p95 counts, not totals; their percentile alignment produces numeric series as required
by the [Monitoring aggregation contract](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.alertPolicies#Aligner).
On first creation, the metric has no history: [log-based metrics do not backfill earlier logs](https://docs.cloud.google.com/logging/docs/logs-based-metrics).
The enabled policy can therefore open an initial absence incident until a new heartbeat is ingested. An older log entry
is not proof that the new metric has data.

On an alert, inspect the exact episode, mail acceptance, latest Auth metadata, billing history, marker/checkpoints and
native cleanup logs using read-only access. Do not infer an absent Auth user or finished cleanup from a network error.
Preserve pending fences and uncertain Stripe operations. A prepared marker left by a crash, an attempted RPC without
confirmed outcome, or an orphaned user requires exact-target review. Any replay, marker removal, email resend, account
deletion or infrastructure change requires separately approved scope. No general-purpose destructive recovery command
is supplied. Reconcile through the existing deletion runbook after establishing what actually committed.

## Verification and rollout

Local tests cover calendar boundaries, identity/recipient changes, refreshed sessions, billing ambiguity, paid/grace
protection, delivery evidence, exact deadlines, repeated/concurrent runs, caps, cursor progress, guarded cancellation,
ambiguous Auth failure and recursive cleanup. Lifecycle emulator tests use real loopback Firestore with fake Auth
and Stripe; the existing cleanup suite verifies its recursive data boundary. These do not prove real SMTP delivery,
remote Stripe permissions or production Auth trigger delivery.

Before an approved rollout:

1. Review current native billing ownership, indexes, TTL configuration and existing cleanup health. Verify
   `STRIPE_BILLING_KEY` permits Customers, Subscriptions, Subscription Schedules and Checkout Sessions reads. The new
   Subscription Schedules read permission must be verified; this PR does not modify a key or secret.
2. With separate deployment approval, use Node 22 and the repository's pinned CLI:
   `npm run firebase -- deploy --project quantified-self-io --only firestore:rules,firestore:indexes`, then
   `npm run firebase -- deploy --project quantified-self-io --only functions:processInactiveAccounts,functions:getInactivityAdmin,functions:onSubscriptionUpdated,functions:deleteSelf`.
   Verify the due/state collection-group query indexes and 90-day episode TTL are active, not merely present in source.
   Deploy the help/policy changes with the normal approved Hosting build.
3. With separate template-write approval, seed only the selected warning and its required partials using
   `npm --prefix functions run seed-emails -- --templates=account_inactivity_warning` under an explicitly verified
   target project environment. The seeder does not select a project from a `--project` argument. Verify HTML/plaintext
   previews first; a controlled-inbox SMTP test needs its own mail authorization.
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
