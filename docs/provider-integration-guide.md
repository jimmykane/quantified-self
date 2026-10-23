# Provider Integration Implementation Guide

Health Sources distinguishes automatic retries from exhausted failures for Garmin, Suunto and COROS; Wahoo remains unsupported for Health. This is status bookkeeping on the existing retry lifecycle. See [Health sync state](unified-health-data.md#sync-state) for the flag, compatibility and transaction contract.

This document is the durable implementation guide for adding or materially changing a connected provider such as Garmin, Suunto, COROS, or Wahoo. It describes the repository-wide contract rather than any one partner API.

Keep it current in the same change whenever a provider is added, removed, renamed, gains a capability, changes a lifecycle rule, or changes operational support. The root `AGENTS.md` makes that update mandatory.

Use the provider-specific architecture document for exact API behavior and release decisions. [Wahoo integration](wahoo-integration.md) records its scope and launch checklist; [COROS integration](coros-integration.md) records its daily Health mapping, asynchronous upload, route, single-account, echo-suppression, and entitlement decisions; [Suunto 24/7 Health integration](suunto-integration.md) records its metric mapping, bounded pulls, webhooks, lifecycle fencing, production-wide polling, and rollback switch; [Garmin Health integration](garmin-integration.md) records its Health API 1.2.4 family mapping, Ping/Pull trust boundary, callback credential handling, lifecycle fencing, production-wide availability, rollback switch, and Summary Resender procedure.

The adopted Sports Lib 23.0.0 profile corrections refine Garmin Breathwork and Polar explicit sport names, including
three distinct Team/Racket types (Australian Football, Korfball and Netball). They change normalized activity
classification and JSON compatibility without changing provider transport, permissions, delivery, disconnect or queue
lifecycle. The current provider matrix therefore stays unchanged. Follow the
[coordinated adoption and historical reparse decision](../functions/src/reparse/SPORTS_LIB_REPARSE_RUNBOOK.md#sports-lib-2300-provider-sport-catalog-adoption)
before using these types in production. Official mapping names are tested with synthetic FIT; downloaded recordings
remain temporary because redistribution rights were not established. The app's Help uses the installed activity catalog.

Follow-up review keeps recognized profiles within compatible FIT parents, preserves existing broad-parent refinements,
and retains every documented context for shared profile names. Route and route-file JSON now apply the same invalid
scalar summary policy as activities. These corrections retain the existing provider and queue contracts.

### Refined sport names at recorded-activity and route boundaries

QS keeps the source sport name. Recorded-activity correction and route delivery have their own explicit approvals,
separate from planned-workout aliases. `shared/wahoo-activity-types.ts` adds 32 approved recorded-activity aliases to
existing Wahoo Workout types. The complete table is in [Wahoo recorded-activity profiles](wahoo-integration.md#recorded-activity-sport-profiles).
Unmapped types keep Wahoo inference; native Nordic Walking, virtual and other existing mappings retain their IDs.
A queued upload persists its chosen type before provider I/O and reuses it on resume; a new table does not rewrite
already accepted uploads or authorize a historical correction job.

`shared/route-sport-aliases.ts` covers the separately approved route folds:

| QS route sport | Garmin course profile | COROS route type | Wahoo route family |
| --- | --- | --- | --- |
| BMX; LES MILLS RPM / SPRINT / THE TRIP | Road Cycling | Bike | Cycling |
| Obstacle Racing | Running | Running | Running |
| Vertical Running | Trail Running | Running | Running |
| Enduro MTB; E-Enduro MTB | Mountain Biking | Bike | Cycling |

Exact provider-specific route overrides also precede legacy keyword heuristics. Garmin sends Motorcycling,
Motorcycle Enduro, Hard Enduro, Ski Mountaineering, Offroad Duathlon and Offroad Triathlon as `OTHER`, and
Mountaineering as `HIKING`. Wahoo sends Offroad Duathlon and Offroad Triathlon as Other family `31`. These choices
prevent unrelated names containing cycling, enduro, mountain or road from selecting a cycling profile. Wahoo
Motorcycling keeps the documented Biking family; COROS route fallbacks are unchanged. Brick Training, Pool Triathlon,
Offroad Triathlon and Offroad Duathlon use the existing Wahoo recorded-activity Multisport type `62`, independently
of route families and planned workouts.

These aliases select metadata only at the destination boundary. Original files, QS sport names, provider identity,
echo receipts, permissions, account guards, revisions, leases, retries and queue terminal states retain their existing
contracts. No FIT bytes or encoding logic changes. Monitoring coverage is **unchanged**: the recorded-activity and route
bundles filter existing destination/worker/outcome labels, independently of sport names. Existing backlog-age,
dispatch/processing failure, new DLQ/reconciliation and unavailable-observation policies cover these same workers.
See [activity delivery monitoring](activity-delivery-monitoring.md) and [route monitoring](route-monitoring.md).
Local tests do not establish provider/device acceptance or activate production configuration.

## 1. Define the product contract before writing code

Start with a concise support matrix agreed with product and the provider. Do not infer capability from an OAuth scope alone.

| Question             | Decision to record                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direction            | Import from provider, send to provider, or both. A provider can support different directions for activities, routes, sleep, and plans.                                                    |
| Data types           | Activities, original files, routes, sleep, wellness, device identity, summaries, plans, or another distinct record type.                                                                  |
| Trigger              | Webhook, scheduled polling, user-requested history import, user upload, or a combination.                                                                                                 |
| Plan and entitlement | Free, Pro, admin-only, invite-only, feature-gated, or a combination. Decide separately whether disconnect remains available after entitlement ends.                                       |
| Data retention       | What disconnect removes, what stays in the account, and what account deletion removes.                                                                                                    |
| Partner constraints  | OAuth grant and scopes, redirect URIs, webhook verification, rate limits, pagination order, history range, file availability, retention, file hosts, branding, and production-app review. |
| Failure behavior     | Skip criteria, retryable errors, terminal errors, backoff, user-facing copy, and operational alerts.                                                                                      |

The current providers are intentionally not identical:

| Provider | Current primary role                                                    | Important distinction                                                                                               |
| -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Garmin   | Activity/sleep import, production Health import/backfill, route delivery, and activity delivery to Suunto/Wahoo/COROS | Garmin Health uses one canonical Ping/Pull ingress for Sleep plus ten Health summary families; callback URLs are short-lived credentials. Every eligible connected Pro user's history request adds a durable, paced all-family Health cursor while the independent rollback switch is enabled. Summary Resender is reserved for bounded recovery. Activity-history requests show their active lease in Services. Garmin Connect route delivery requires Course Import permission. |
| Suunto   | Activity/sleep/route import, production 24/7 Health, plus activity and saved-route source/destination workflows | Health independently reconciles Activity, daily statistics, and Recovery for active connected accounts in windows of at most 28 days using signed webhook refetches, bounded polling, and history work. New route-inclusive connection history also imports the entire saved Suunto route library independently of the selected date range. Suunto receives GPX routes; activities can flow to Wahoo/COROS, while saved routes can flow to Garmin/Wahoo/COROS through shared queues. |
| COROS    | Activity plus daily Health/Sleep import; asynchronous activity upload; activity delivery to/from supported providers; direct/saved GPX route delivery | Exactly one active COROS account is used. Daily Health reuses the Sleep poll/history queue, preserves aggregate Sleep through references, and stores bounded detailed HRV in Health. Activity upload is initialized then polled by 64-bit ID. Route push accepts bike/running GPX metadata and is available to eligible connected Pro users through one shared production-wide rollout gate. |
| Wahoo    | Pro activity import, FIT activity delivery, direct/saved route delivery, and Training workout delivery | Wahoo imports only FIT-backed Wahoo-recorded workouts; manual activity history reuses the paged connection-history coordinator. Retained FITs can sync to Suunto/COROS. Connected Pro users can explicitly deliver QS-authored workouts as separate app-owned Plans and dated Workouts within a saved-zone seven-day horizon; exact returned Workout/Plan/token evidence can link the imported activity, while Wahoo-owned plans remain out of scope. |

Treat this table as a high-level orientation, not a partner API specification. The public Help content and each `/integrations/<provider>` page define the user-facing supported scope.

Provider overview cards must name combined history imports consistently with their focused tools. COROS uses **Sleep & daily Health history** and **Import history** because its daily-data replay always queues both domains. Garmin and Suunto use their corresponding combined labels while Health is available, with availability-aware fallback wording where those providers support a Sleep-only path.

Connection-history status distinguishes **Requested range** from the first retained Sleep/Health dates read for the
selected provider. These optional bounded owner reads do not establish gap-free coverage or a particular run's delivery.
Garmin's saved Sleep cutoff is labelled **Last reported** and never reused as a Health-family or replacement-account limit.
See [requested versus stored history](connection-history-import.md#requested-range-versus-stored-history) for the single
provider/date Sleep index and frontend-only release boundary. Monitoring is **unchanged** across #829/#830/#847: no
queue lifecycle, provider API, retry policy or telemetry contract changes. MCP and Training contracts are unaffected.

Dashboard onboarding must recognize durable connections and history requests when users return. Empty activity data does not imply an unconnected service: offer connection setup only after the owner-scoped connection state confirms none are connected. A saved Garmin connection-history run containing Sleep or Health replaces the generic import offer, including queued, failed and skipped runs; direct progress/retry remains in Services. Keep legacy manual-history markers and wait for metadata before deciding. This presentation change leaves the existing coordinator and downstream monitoring bundles, queue lifecycle and MCP contracts unchanged.

All four providers' manual activity-history tools honor active manual leases and show **Import already running** for `already-exists` conflicts with either a manual lease or an automatic recent-history reservation. Preserve that typed error as HTTP 409 at callable boundaries; do not wrap expected contention into HTTP 500 or log it as an ERROR. Genuine provider/ingestion failures keep their existing handling. See [shared history operations](connection-history-import.md#shared-operations) for the unchanged lifecycle/monitoring boundaries and backend-first release order.

Existing-user Health catch-up is available through the dry-run-first `backfill-existing-health`
operator script for Garmin, Suunto, and COROS. It preserves Pro eligibility, queues existing
workers in bounded batches, and keeps deletion-safe submission receipts without treating
request completion as complete data coverage. See [Health backfill operations](health-backfill-operations.md)
before any execution. New eligible Pro connections/reconnections offer a preselected optional history import whose range defaults to 30 days. Users can choose only ranges registered for that provider, up to Garmin's rolling five years, COROS's rolling three months, or all available retained history for Suunto and Wahoo. Dated history uses the same manual operations and durable ingestion workers and never continues earlier than the selected boundary. Suunto's explicitly included saved-route library is independent of that range and uses bounded route-ID batches, its canonical route queue and current-account/deletion guards; older clients and existing runs retain their original scope. History route dispatch binds task identity and late markers to the queue revision, confirms live tasks before recovering reserved names, and preserves configured retry backoff. See [connection history import](connection-history-import.md) for the #681 implementation, capability/range-registration contract, private progress model, admission switch and release order.

Suunto Health history adapts to item-count limits by halving oversized target windows and reapplying local-day context, rather than truncating responses or increasing parser caps. Subrequests remain sequential, lifecycle-fenced, and bounded by per-job HTTP/time/result budgets; irreducible or malformed responses remain failures. See [Suunto ingestion bounds](suunto-integration.md#ingestion-and-revision-flow). Do not treat repeated `response_item_limit` validation failures as transient upstream 500s during bulk backfill monitoring.

Suunto Health failure logs retain allowlisted operation stages and error classifications before raw errors are sanitized for retry storage. Distinguish worker HTTP 500s from validated upstream status codes; RPC, transport, validation and unknown failures have separate safe diagnostics. See [backfill diagnostic fields](health-backfill-operations.md#verification). Do not add raw provider responses, exception messages, stacks, credential URLs or account identifiers to those fields.

Garmin Health failures likewise classify the original exception with safe stages, elapsed time and HTTP/transport/RPC
codes before retry-storage sanitization; unknown internal errors are not labelled as confirmed provider HTTP failures.
The shared Health failure-state write error separately retains its queue ID, provider and allowlisted diagnostics.
Both remain ERROR logs, without raw error text, payloads or credentials. Monitoring is **unchanged**: #830 uses existing
worker/committed-transition events, not these diagnostic messages or queue IDs. Requests, retries and lifecycle guards
are unchanged; release requires separate approval for only `processSleepSyncTask`. Existing Help and MCP are unaffected.

Suunto workout downloads, activity-history reads, and Health pulls allow one same-account forced token refresh and
read retry after HTTP 401 or 403. Health shares that recovery budget across all feeds/subrequests in one invocation;
its existing durable queue retry policy remains unchanged. Never select another connected account to recover old work.
A workout still returning 403 moves to `SUUNTO_WORKOUT_ACCESS_DENIED` without fabricating a retry increment; legacy
shared-account rows still try other matching owners, and transient failures or refresh contention remain retryable.
403 is not proof of global token revocation or a deleted workout. Do not revoke credentials based on that response.
An unexpired-token log proves only local expiry, not provider acceptance. See [Suunto integration](suunto-integration.md)
for recovery, deployment targets, and rollback.

The canonical `receiveSuunto247Data` webhook uses isolated owner-module entrypoint loading at 512 MiB while retaining
its Gen 1 HTTP trigger, 60-second timeout and notification secret. See [entrypoint verification](functions-entrypoint-loading.md);
this startup/memory configuration does not change webhook authentication, durable admission or provider registration.

Suunto Health Activity/Recovery webhooks use the existing durable Sleep/Health queue with a five-minute dispatch bucket per UID, provider account, exact local-day window, and captured token/root/connection generations. The ingress still acknowledges only after durable staging and the retryable trigger retains its lifecycle checks. Queue admission schedules one bounded refetch just after the bucket closes; distinct notifications in that bucket reuse the same queued refetch. An ingress that reaches a bucket after dispatch has begun receives a deterministic notification-specific follow-up, so corrections are not lost. Poll and manual bulk-history jobs retain their current schedules; connection-history children use the bounded prompt dispatch described below. The 30-minute dispatcher preserves the earliest dispatch time when recovering an enqueue failure. Monitor `coalescedWindows` (reused bucket admissions, which can include an exact Eventarc retry), `duplicateIngressWindows` (exact late-ingress retries), actual task/worker counts, queue age, and Health freshness during rollout; revert the Functions revision to restore per-notification dispatch without migrating existing queue data. See [Suunto ingestion](suunto-integration.md#ingestion-and-revision-flow).

The Suunto Health worker also emits one safe per-invocation feed summary for Activity, daily statistics, and Recovery request attempts/time and source-record write outcomes. A compact webhook notification mask is unioned when Activity and Recovery share a queue row; a notification that cannot merge before the worker claims the row gets a deterministic follow-up. The mask changes telemetry only, not which feeds are fetched. Compare those summaries with whole-worker telemetry and billed Cloud Run time before considering feed-specific pulls. See [Suunto operations](suunto-integration.md#sleep-and-health) for field meanings and the correction/reconciliation limit.

Garmin Sleep and Health history recovery must account for a moving provider minimum, not merely round it to the next second. Both allow up to 30 seconds of retry headroom without erasing a short valid window. Sleep retains its three-attempt window limit. The independent Health worker stops after three consecutive minimum-start failures in the same family per invocation and uses the existing durable queue retry/exhaustion path; cutoff-only adjustments must not reset that retry budget. Log safe cutoff/progress metadata without provider response bodies or credentials, and distinguish submitted/skipped request windows from ingested records. See [Garmin history recovery](garmin-integration.md#availability-and-history). Activity history is a separate path.

Garmin stress-validation diagnostics use the existing WARNING with allowlisted family/field/reason, summary index, type, and bounded numeric-only values; never log raw provider strings or objects. Stress sample zeroes are numeric readings; daily average -2 is retained as a native-only availability code because its daily semantics are undocumented. Do not transfer sentinel meanings between summary families or let a recognized non-measurement code discard unrelated valid metrics. Garmin workout, Sleep, and Health failed jobs retain original callback URLs under the existing admin-only 30-day expiry for separately authorized recovery; successful/skipped queue rows still clear them. Never log or project those credentials. Legacy DLQ callbacks with removed credentials or expired URLs require bounded Summary Resender recovery. Verify actual ingestion, not merely replay submission. See [Garmin delivery diagnostics](garmin-integration.md#delivery-and-trust-boundary) for the exact bound and metadata contract.

### Inbound prescription access is separate from delivery (#708)

The October 6, 2026 investigation does **not** approve a cloud workout-library importer. See the
[dated evidence matrix, source contracts, proposed lifecycle and test gates](training-workspace.md#inbound-workout-import-feasibility-708)
for the detailed Training source of truth. Do not infer incoming recipe access from recorded-activity history, an OAuth
scope, a known-ID read or successful delivery of a QS workout.

| Provider | Decision for non-QS prescriptions |
| --- | --- |
| Garmin | Scheduled import blocked pending ownership/coverage proof; undated library no-go without documented enumeration. |
| Suunto | Current Guide contract is creator-application-only, not another partner's or the full consumer library. |
| COROS | Reviewed Training Plan contract has no planned-recipe/schedule read or discovery operation. |
| Wahoo | Restricted entitlement path; content-use and coverage proof required before an import commitment. |

Keep recipes, schedule occurrences and completed recordings separate. Proposed imports would create reviewed local
snapshots with private owner-scoped provenance, not adopt destructive remote ownership or create two-way sync. The
independent structured-FIT-file candidate also needs an explicitly accepted #583 implementation issue and rights-cleared
fixtures; current activity upload support is not prescription import. Neither proposal permits new access requests,
provider contact, live tests, broader consent or deployment. Importing into an active syncing plan would otherwise inherit
its Send opt-in, so the proposed first slice is undated-library/Standalone-only, with no automatic outbound delivery.

### Structured-workout remote verification evidence

Garmin completed-activity correlation is separate from remote Workout/Schedule verification. Its imported FIT
`training_file` serial is only a candidate identifier under the FIT specification; one owner-account recording matched
the retained Training API workout ID. The local linker requires the Garmin activity-file ID from import metadata, a
saved activity in that event, a unique same-account ledger, accepted schedule, current scheduled date, and one recorded
activity on that local date before writing the existing completion and private
reverse link. Ambiguity remains unlinked, with no similarity fallback or activity-metric rewrite. The current v1
completion projection has one recorded source per workout: the first exact link committed wins, and a second provider
recording remains a normal completed activity without replacing it. COROS, Wahoo and Suunto also require the current
workout plan to match its ledger association and its date to match the retained provider copy before a new link. A later
delivery update can make a rescheduled occurrence eligible. Same-account reconnects retain exact matching, while stale
credentials and different owners do not. Provider acceptance is never watch receipt or proof every target was met.

Remote verification (#703) reuses the Training delivery ledger, 25-item reconciliation pages, dispatcher and per-delivery
lease. `check` is an idempotent, revision-checked command with a 15-minute coalescing window; it does not change consent.
Daily checks share production application/account capacity with delivery and yield to writes. The compact owner-readable
verification projection is separate from strict delivery status v1; private evidence/budgets/jobs deny browser access
and participate in recursive account cleanup. See [remote verification and repair](training-workspace.md#remote-verification-and-repair-703)
for the full policy, request accounting, privacy, diagnostics and rollout contract.

Training reconciliation reuses shared database reads within one owner/page/transaction attempt and skips unchanged
ledger and public-projection writes. It still acknowledges newer source edits, repairs missing/stale projections and
stages due delivery/verification work. Provider-request authority, correction/recovery coverage and polling schedules
remain unchanged. See [reconciliation database work](training-workspace.md#reconciliation-database-work) for the
bounded cache, read/write tradeoff, tests and unchanged MCP/monitoring coverage decision.

| Provider | Inspection foundation | Repair gate |
| --- | --- | --- |
| Garmin | Separate retained Workout/Schedule GETs, exact account/owner/date association checks. A positive read of both verifies the cloud copy, not watch receipt. A controlled deletion proved that removing a calendar entry leaves its Workout present and makes the exact retained Schedule ID return 404. An owner-account #769 probe returned 404 for both retained IDs while another QS Workout read returned 200; the orphan Schedule POST was rejected and no new association appeared. | Schedule-only automatic repair still requires two unchanged authoritative observations at least 15 minutes apart. A complete missing-Workout observation is non-authoritative but projects needs-attention, not synced. #769 adds a separately reviewed app-only replacement for paired not-found records, warning of possible duplicates and independently rechecking before POST. A surviving Schedule is not enabled for manual root replacement. Automatic root recreation stays disabled; uncertain root POST acceptance blocks Retry and another replacement. Functions/frontend release and live replacement proof remain separate. |
| COROS | Unavailable; no documented planned-resource read established. | Delivery support does not enable checking; do not substitute activity polling or blind republishing. |
| Wahoo | The public #649 adapter independently checks its app-owned Plan, dated Workout and association. | General inspection remains positive-only: empty/partial/unstable inventory and 404 never authorize replacement or repair. Authorized REMOVE alone can finish already-absent retained copies after current-account/exact catalog access and ownership checks; see the scoped removal policy below. `workout_token` is not POST idempotency. Production cloud CRUD/readback is proved; Wahoo app, ELEMNT and watch receipt remain provider-managed post-release observations, not claimed delivery evidence. |
| Suunto | The #650 adapter keeps positive owned Guide-record reads and resumable inventory internal to exact uncertain-create recovery. User-facing remote visibility checking is unavailable. | A Guide hidden or removed in Suunto can remain visible through the partner API. API presence proves only a retained cloud record, never app/watch visibility; 404/unstable inventory cannot prove deletion. Negative classification and automatic repair remain disabled by #710. |

An explicitly reviewed Garmin replacement that finds the original pair again reuses its IDs and applies the reviewed
prescription/date before claiming acceptance. Unchanged reappearance is a no-op; Schedule-only automatic repair still
preserves provider-side recipe edits. Malformed private inspection timestamps or artifact lists cannot offer replacement.

#801 adds a focused MCP replacement preview and prepare-only Assistant review using this same command/journal,
not another adapter. Existing planning-read and delivery-write grants are required. The preview accepts one exact
opaque workout reference and current revisions, identifies the workout/date and possible-duplicate risk, and never
calls Garmin. Existing native/app approval consumes the 15-minute proposal and exact private evidence digest;
Send/Retry cannot grant replacement authority. Apply revalidates current grants, account/connection/epoch, consent,
revisions, Pro, locks, completion/past state and uncertainty. Existing status/receipts recover lost replies without
another create. New tool deployment and client catalog refresh/rescan are separate release actions; existing v1
batch actions and provider transport contracts remain unchanged.
An edit against a retained Garmin pair that fails before any write-start journal retires only its provably unstarted
attempt for a fresh inspection; started/legacy/partial sends remain protected and cannot authorize replacement.

Inspection never claims device receipt or routinely overwrites provider edits. Stop sync prevents restoration. Pro,
readiness, compatibility, exact connection, saved-zone date/completion eligibility and deletion are rechecked before
repair. All three readiness decisions—delivery, inspection, repair—are independent. Production quotas only; no evaluation
environment, arbitrary evaluation request budget, separate runner or setup wizard is introduced.

Verification policy changes invalidate in-flight evidence. Stable inventory pages carry negative evidence only between
complete scans, never establish absence alone. A received quota rejection remains rejected even if local deferral
persistence fails; replacement retries re-read original artifacts so reappearance cannot create duplicate calendar entries.
The per-delivery deadline also survives new manual checks. Interrupted repair withdrawal retains both original and
replacement identities, including a surviving association before any replacement is accepted. A proven partial
acceptance may continue under the latest authored intent and current readiness; it never permits repeating an
uncertain root create. Adapters must cover interrupted cleanup and superseding edits as well as uninterrupted repair.
Inspection and repair capabilities are declared per artifact. Proof for a provider's schedule/association resource must
never authorize classifying or recreating its workout/content resource.
Garmin schedule repair also adopts one positively discovered same-workout/same-date association under a replacement ID;
an ambiguous listing blocks creation, while an empty listing adds no evidence and leaves the already-confirmed retained-ID
repair path unchanged. Evidence-binding changes clear the old confirmed-absence projection before a new observation chain begins.

Training planning uses a stricter launch boundary than activity or route delivery. Manual plan and standalone-workout
authoring is free and independent of connected services. Provider synchronization is Pro, explicit, and
directional: a plan needs per-provider opt-in, while a standalone workout needs a user-selected Send action. A provider
connection alone never opts workouts into delivery.
The manual editor converts the owner's kilometre/mile step distances and separately selected pace units into canonical
metres and m/s before writing `WorkoutStructureV1`. Provider serializers must use only those stored canonical values:
never infer input units from the account preference or convert a distance a second time. Garmin and Suunto accept
metres, COROS applies its existing integer-metre mapping with approval for loss, and Wahoo's dated delivery continues
to reject distance-ended recipes when a required total duration cannot be established.

Suunto Gym Guide strength load instructions use the owner's independent kg/lb preference through Sports Lib, while
the stored companion stays in kilograms. The private per-attempt unit snapshot and versioned strength mapping keep
uncertain historical sends recoverable and update retained Guide identities after a unit-only change; interval
payloads/digests stay unchanged. The existing reconciliation scan detects preference changes without wider consent,
new provider actions, a migration or a watch-receipt claim. See
[Suunto strength load display units](training-workspace.md#strength-load-display-units) for the detailed contract.

The interval editor also exposes the existing canonical `{ kind: 'manual' }` as **Lap button press**, for every purpose
and repeat child. It has no numeric limit and is not a time/distance-or-button combination. For supported sports,
Garmin serializes `OPEN`, Suunto Guide transitions use `manualLap`, and COROS serializes `EndManually`; COROS delivery
remains disabled. Wahoo's documented structured-plan triggers do not include a manual ending, so compatibility and
delivery must continue rejecting it rather than estimating a duration. Ending a step is neither ending a recording nor
completion evidence. This UI exposure changes no provider payload or MCP contract; strict recipe reads and existing
proposal/confirmation already preserve manual endings, targets and notes.

Timed/distance endings separately support athlete-authored `allowEarlyLap?: boolean`: true means the numeric limit OR
Lap, while absent/false retain the numeric ending. The editor starts unchecked and never adds it to manual, repetition
or kJ endings. Suunto v6 implements documented OR transitions; its private branch screens reuse button-created laps
and create exactly one lap on automatic boundaries when block averages need them. Fixed repeats preserve their authored
prescription while private occurrence screens remain within the 1000-screen cap. Compatibility uses the same selected
readings as serialization: Guides without manual-lap averages keep compact repeats, while one selected average requires
boundary paths across all occurrences. Garmin, COROS and Wahoo
reject true before HTTP because faithful per-step OR support is unverified. Device-global skip/auto-advance controls do
not establish it. False/absent mappings remain unchanged. This adds no provider, scope, new consent or completion claim.

The v2–v5 Suunto recovery serializers/digests remain frozen and reject true; lost ACKs recover existing identities and
never guess a replacement. Roll out compatible Functions/MCP before the editor only after separately approved deployment,
then refresh/rescan the exact pending metadata and client/plugin catalogs. No migration or blanket requeue is required.
The latest additive scheduled/saved full-recipe reads/previews preserve the flag through existing revision-bound
persistence and native/app confirmation; older replacements fail closed rather than erasing it. Mocked provider and
loopback emulator evidence is separate from live acceptance and watch proof. The release checklist must still record
watch model/firmware, automatic versus early/coincident exits, manual-only exits, repeat/final lap counts and per-block
average resets. See [Training workspace](training-workspace.md#optional-early-lap-on-numeric-endings-784-training-07)
for the single detailed mapping, recovery and MCP contract.

The Training UI checks availability and compatibility automatically on entering sync consent. For an MCP standalone
create-and-send, the first proposal names any provider mapping loss; one native approval covers the current
digest-bound adjustment as well as the authored change. The delivery command rechecks that digest, destination and
current schedule before queuing work. Later edits and browser plan-workout reviews keep their own approval semantics;
an applied proposal is not proof of provider or device receipt. Suunto-bound generated step notes should be omitted
when unrequested or kept within its watch text limits, never silently dropping requested meaning.
With one ready provider,
**Sync plan with Garmin** → **Enable plan sync** (plan) or **Send to Garmin** → **Send workout** (standalone) is the normal path;
subsequent eligible edits reconcile automatically. Opening the dialog never mutates consent. The saved/browser time
zone is shown inline and changes explicitly; mapping degradation still needs per-workout approval. Troubleshooting is
secondary, with compact status/history rows and surface-free Show/Hide details matching existing Training controls.
Existing sync settings open without a new preview or active Save action. Only an actual validated time-zone change
enables **Save changes**, after a debounced read-only check; reverting disables it again. One footer distinguishes
Cancel/confirmation from overview Close and in-flight saving. Initial Enable/Send and fresh-account consent remain
explicit, and uncertain saves retain their original receipt. See Training's detailed UI contract for cancellation rules.

Browser sync settings and summaries wait for server-confirmed owner reads, not cached absence. Check refreshes the
exact schedule/scope/settings revisions; a stale consent or replacement preview fails rather than rebasing approval.
Confirmations and uncertain receipt replays keep their reviewed commands unchanged. This frontend readiness fix
also disables a not-yet-dispatched confirmation when live revision updates invalidate its preview. An uncertain save
can still retry its exact original receipt rather than replacing its approval. This does not change provider transport,
permission or completion contracts. See the Training workspace's
[server-confirmed settings contract](training-workspace.md#server-confirmed-sync-settings-and-current-revisions-812).

**Plan sync** separates automatic plan-level settings from **Workout sync status** rows. Each row represents an individual
workout, shows its scheduled date, and opens **Workout sync** details; editing is a separate action. **Stop plan sync** and
**Stop workout sync** name their different scopes explicitly. Plan sync means automatic per-workout delivery, not native
provider training-plan parity. Inherited workout reviews show the server-resolved parent-plan zone, not a retained
override's older zone. Transport timestamps appear in workout details separately from scheduled dates and reflect the
latest attempt or confirmation; an older success never masks a newer failed attempt.

Plans expose one quiet, non-button **Plan sync** row rather than one action per provider. Service logos and the synced/total
counts currently due for delivery remain visible; later workouts are named separately. A small trailing **View** action is the only click target. Service names and full status detail
remain available to assistive technology and in the dialog. On phones, provider indicators use a two-column grid below
the heading and View action. With multiple destinations, the dialog first shows compact provider rows with the saved
sync state, current workout-status summary and one **Manage** action; Manage drills into only that provider. A single
destination opens its provider details directly. **All services** returns to the provider overview, while opening a workout and returning
preserves the originating provider. This navigation is local only: it must not preview, mutate, grant consent or call a
provider.

Plan and workout surfaces show per-service destination summaries from the safe delivery projections. The plan UI gives
today and future workouts the prominent count and summarizes completed, past or skipped workouts as earlier context;
the underlying safe projection remains an aggregate of all current authored workouts and is not evidence of a native
provider plan or device receipt. Only complete,
unchanged confirmations for the matching destination count as synced; earlier-account/removed-source records remain
history. An exact persisted completion is workout-level: its evidence provider is labelled **Completed · activity linked**,
other confirmed destination copies are labelled **Sent · workout completed**, and unrelated past copies are labelled
**Past workout · previously sent**. This display rule does not turn one provider's evidence into another provider's
completion claim or expose provider identifiers. Waiting, paused, unsupported, approval and failure states stay visible.
Bounded/incomplete or failed reads must not claim complete success. Rendering these summaries performs owner-visible
reads only, never provider calls or consent changes. See the Training workspace source of truth for identity matching,
read bounds and tests.

Separately authorized MCP Training delivery changes reuse `trainingDeliveryCommand` and its durable reconciliation
marker; MCP does not implement an adapter or call provider HTTP directly. A strict proposal resolves only server-owned
connection authority, compatibility and readiness. Apply is a separate write-capable tool behind the MCP host's native
approval UI; QS does not use MCP elicitation as an additional confirmation round.
For a standalone Send, `all_connected` includes only providers that are connected, rollout-ready, and compatible with
that workout during preview. Explicit providers retain
an independent blocked result rather than hiding the reason. Destination keys, credentials, artifact IDs, approval
digests and attempt journals never enter MCP input or output. Provider delivery remains Pro-gated, and failure does not
roll back an authored plan/workout mutation in the same confirmed proposal.
For a newly authored workout with a degraded mapping (such as Mountain Biking to Garmin Cycling), MCP's first preview
discloses the mapping loss. Confirming that proposal approves its current destination-bound digest and establishes
consent in one step; a changed digest blocks delivery. Unsupported standalone Send/Resume is different: preview names
the incompatibility, and the delivery command refuses consent even if a client attempts to apply it. Explicit-provider
failure remains independent of authored changes and other provider results. An applied Send result is not a provider-side copy.

Manual training planning is available to every signed-in account across its routes, calendar actions/overlays, Help and
planning-specific connection/deletion instructions. This does not authorize transport work, alter disconnect or deletion
behavior, or enable a provider. See the [Training workspace source of truth](training-workspace.md) for account-change
behavior and the separate delivery boundaries.

The versioned research snapshot lives in `shared/planned-workout-providers.ts`; pure fixture serializers live under
`functions/src/training-plans/providers/`. Garmin, Wahoo and Suunto have their backend delivery flags enabled;
`shared/training-delivery-rollout.ts` contains no per-UID allowlist. COROS is disabled for every account at that shared
frontend/backend admission boundary and is omitted from Training plan, workout and sync-history UI. Existing COROS
preferences, ledgers and safe status projections remain stored but inactive so a later deliberate rollout can reconcile
them without treating retained consent as current provider availability.
Every provider retains Pro, explicit consent, connection authority, provider configuration and its provider-specific
permission checks. Legacy connections must reconnect rather than have permission inferred. See the
[Garmin public delivery boundary](training-workspace.md#garmin-public-delivery-boundary) for live availability and consent.
#655 no longer requires code rollback work for this live rollout; normal Stop/disconnect/deletion controls and the
source-controlled availability decisions are unchanged.

The manual editor additionally preserves the 31 approved Running, Cycling and Walking/Hiking subtype names,
for 45 endurance choices in total. `shared/planned-workout-sport-aliases.ts` is the explicit outbound alias registry;
the complete table and editor rules live in [Training sport names and provider profiles](training-workspace.md#sport-names-and-provider-profiles).
An alias uses an existing tested delivery profile and its existing prescription limits. It establishes no native
provider support for the newly offered QS name. QS retains the exact recipe sport through saved recipes, copies,
JSON reloads and history; serializers select the provider profile only at their boundary. Every actual sport fold
is disclosed through the existing mapping review and bound to the authored content, date and destination.
Changed or unsupported recipes retain an existing provider copy until a supported replacement is approved.
The 21 previously verified Wahoo profiles keep their payload behavior; walking aliases retain timed, untargeted
steps. COROS walking aliases remain unsupported and COROS delivery stays disabled. Classic/Skate Skiing and
AMRAP/EMOM/Tabata use Garmin Cardio Training and Wahoo Cardio Class after mapping review. Recorded-activity uploads use their independent
mapping contract; this planning table does not widen that contract.

`Weight Training`, `Core Training`, `LES MILLS CORE`, `LES MILLS GRIT Strength` and `LES MILLS BODYPUMP` have
Suunto interval-planning aliases to the existing `Strength Training` / Gym (`23`) Guide profile.
`Kettlebell` (`63`) and `Calisthenics` (`104`) use their own native
recommendation profiles with HR-only default live readings, from Suunto's
[published activity catalog](https://aspartnercontent.blob.core.windows.net/apizone/docs/Activities.pdf).
The [Guide contract](https://apizone.suunto.com/suuntoplus-guide-description) uses those IDs as activity recommendations;
they do not establish device availability or account-side delivery proof.
The original recipe sport survives reads and JSON round trips. This is the generic interval mapper, not the
exercise-aware strength companion: existing ending/target validation applies, and profile substitutions require
explicit mapping-loss approval. Native Kettlebell/Calisthenics do not introduce a profile loss. These generic interval profiles do not gain repetition endings or native external-load tracking. The approved additional Suunto modes
are Yoga (`121`), Pilates (`120`), Stretching (`58`), Crossfit (`54`), Circuit training (`73`), Aerobics (`69`),
Crosstrainer (`55`) and Meditation (`112`), with HR-only default live readings. Flexibility Training → Stretching,
Elliptical Trainer → Crosstrainer and Breathwork → Meditation are disclosed substitutions requiring review.
Garmin, COROS and Wahoo require complete strength companions for the seven approved strength aliases; generic Suunto intervals alone do not grant delivery support.
`Virtual Rowing` uses Suunto Indoor Rowing (`57`), Garmin's existing Indoor Rowing → Generic mapping (with device
warning and review), and Wahoo Indoor Rowing (Plan family `6`, indoor location `0`, dated Workout type `22`). Wahoo
keeps timed, untargeted steps only; unsupported distance/manual endings and intensity targets cannot be approved away.
All three providers retain the original QS recipe name and require mapping review. COROS rowing remains unsupported.
Virtual Rowing uses rowing's metric distances and 500 m split presentation in QS/MCP and the Suunto app description,
including with imperial preferences. Provider target speeds remain canonical m/s; native watch units stay watch-controlled.
The catalog audit checked all 283 recipe-valid sports across all four assessors and serializers (1,132 pairs): no
advertised mapping disagreed with serialization for a timed, untargeted recipe. All 45 interval-editor sports have
Suunto, Garmin and Wahoo mappings; COROS retains its nine documented unsupported editor sports and stays disabled.
Suunto now maps 65 catalog sports; its other 218 names remain unsupported for generic planned-workout delivery.
That is a support boundary, not 218 import bugs: native activity recording alone never establishes workout delivery.
All 180 preceding supported serializer results remain byte-identical. This batch adds exactly 11 Suunto sport names
and Garmin/Wahoo Virtual Rowing; no additional classifications were inferred from activity groups.

Monitoring coverage decision for this alias extension: **unchanged**. The existing Training monitoring bundle
(`tools/training-monitoring/definitions.mjs`) already selects Garmin, Wahoo and Suunto delivery outcome/failure
labels, due queue age, dispatch failures and unknown health samples. Aliases keep the same adapters, dispatchers,
leases, revisions, retry policies, terminal states and low-cardinality provider labels. COROS remains excluded
from active-provider alert conditions while delivery is disabled. Existing approval-required/unsupported states
remain user-action states rather than provider-failure pages. No production monitoring configuration is applied
as part of the local compatibility work.

The v1 manual editor also accepts exact Walking, Hiking, Rowing, and Indoor Rowing sports. Suunto's catalog maps them
to Guide activity IDs `0`, `11`, `15`, and `57` respectively; `0` is a valid activity ID, never a missing value.
Rowing distance is authored in metres and pace as a 500 m split while canonical speed remains m/s. Garmin offers a
disclosed, approval-bound `GENERIC` fallback for these four sports and Open Water Swimming, not native sport profiles.
Generic works only on some devices and cannot guarantee native sport tracking or display; QS keeps the authored sport.
COROS remains unsupported for these four sports. Wahoo's Walking/Hiking and rowing limitations are listed below;
recorded-activity support never implies workout delivery. Completed #738/#739 record approved Guide account-side
checks and owner confirmation of all four profiles on the watch. Synthetic tests and API readbacks alone cannot
establish watch receipt or completed-activity linkage.

Strength Training has a separate exercise-aware prescription with ordered names and sets, reps or timed holds,
optional fixed external load stored in kilograms and optional rest after each set. The app editor follows the owner's
kg/lb preference through Sports Lib 21.3.0; provider payloads still use canonical kilograms. Its v1 steps are only a compatibility
projection; delivery validates the owner-scoped companion. Suunto maps it to a Gym (`23`) Guide with manual transitions
for rep sets. This remains degraded, not native strength tracking. Normal Send/Enable sync covers this standard
limitation, disclosed as a warning; no separate approval is required for each workout or edit. Additional mapping loss,
including shortened exercise instructions, still requires review of the current mapping. The COROS partner contract
describes strength Reps/Second, Rest and fixed equipment weight in kilograms. QS now forwards the complete matching
companion through COROS assessment and production batch delivery, with local fixture/demo-emulator evidence only.
Ordered names/sets, fractional/zero loads and final-set rest are preserved. Load-only edits change the digest while
partner IDs stay stable; missing, foreign, invalid or projection-mismatched details fail closed before provider I/O.
COROS Send/sync remains disabled and hidden until entitlement and account-side push/update/delete proof; that live proof
is explicitly omitted from this implementation and stays pending in #741. Garmin's #782
mapping preserves native reps/time, exact kilogram load and rest for a verified 20-name Appendix B allowlist using the
complete companion, never the v1 summary alone. Unknown names are unsupported rather than substituted; Help lists
supported names and the current Garmin kilogram display. Its Workout/Schedule lifecycle, consent, account/revision,
retry and deletion protections are unchanged. Completed #782 records deployed native Strength create/readback,
update, reschedule and authorized withdrawal, plus owner-confirmed Garmin Connect/watch visibility and launchability.
Synthetic fixtures alone do not establish that live evidence. Wahoo #783 accepts timed strength sets/rests as Gym family `6`,
indoor Workout type `42`, using the validated complete companion. Repetition sets remain unsupported. Exercise/load
instructions are degraded, not native tracking; loads use the Sports Lib kilogram display, and actual rounding requires
mapping approval. The QS editor/MCP details keep the exact canonical load and owner kg/lb display preference.
Suunto strength's create/readback, complete-companion update, reschedule/restore, explicit Retry and no-duplicate
evidence is recorded in completed #784 and reconciled into #741 on 6 October. Independent exact Guide-file reads and
bounded inventories retained the same Gym Guide identity and one copy; see its
[live lifecycle proof](https://github.com/jimmykane/quantified-self/issues/784#issuecomment-5994088069).
The owner's positive strength report and #784 functional watch sign-off are reused without implying every device,
exercise or load was tested. The live fixture had no external load, and its current strength completion remains unlinked;
#784's running completion is not strength completion evidence. COROS entitlement and strength account/app/watch proof
remain outstanding in #741. Strength authoring is complete in #740. This evidence-only reconciliation changes no
provider availability, API, consent or MCP contract.

Runtime wrappers must preserve the entire pure policy interface, including the optional strength companion in
`assess` and the explicit past-removal opt-in in `canRemove`; bind the policy method rather than copying a fixed
argument list. Keep OAuth/HTTP execution separately bound to the authorized account. Existing valid plan/workout sync
consent covers Suunto's standard Gym Guide limitation. Keep Pro, active-plan, account-generation and Stop checks;
additional mapping loss still needs confirmation of its matching prescription digest. Do not convert degraded to exact
or change artifact identity merely to remove the extra gate. Other degraded mappings default to approval-required.
Missing/mismatched strength details remain unsupported, completed copies remain protected, and COROS still rejects
past deletion even with opt-in. Synthetic wrapper/emulator evidence is not provider app/watch acceptance evidence.

| Provider | Availability | Truthful delivery model and remaining limits |
| --- | --- | --- |
| Garmin | `enabled` | Early-Lap numeric endings are unsupported. Connected Pro users can explicitly deliver compatible running/cycling or pool-swimming workouts through separate Workout and Workout Schedule lifecycle records after granting `WORKOUT_IMPORT`. Running/cycling sub-sports still fold to broad `RUNNING`/`CYCLING`; pool swimming maps to `LAP_SWIMMING` with optional explicit pool length and target-free swim steps. Owner-account cloud create/edit/reschedule/readback/withdrawal passed on 23 and 27 September 2026. For one separate 25 m standalone workout, the owner confirmed Garmin Connect and watch visibility on 27 September. Native Strength delivery for the verified exercise allowlist has deployed cloud create/update/reschedule/withdrawal and owner-confirmed app/watch proof in completed #782. Walking, Hiking, Rowing, Indoor Rowing and Open Water Swimming use an approval-bound Generic fallback, not native sport profiles. Generic works only on some devices and does not guarantee native tracking or display; QS retains the authored sport. The owner accepted the remaining Generic device and target/manual/relative/secondary-target matrix in #655 on 2 October; this is owner sign-off, not newly executed device observations. Local fixtures alone do not prove live behavior. Cloud acceptance alone never proves app/watch receipt or completed-activity linkage; this one watch observation is not a guarantee for other devices. Schedule-only repair proof is recorded in completed #703. #769 adds a not-found attention state and explicitly reviewed paired-copy replacement; it does not enable automatic missing-Workout recreation, and its separate deployment/live proof remains pending. Exact-marker completion and duplicate/ambiguity handling are complete in #651, without fallback/manual matching. |
| COROS | `disabled` | Early-Lap numeric endings are unsupported. The serializer, batch adapter and synthetic tests remain available for development, but the shared delivery flag is off for every account. No COROS production transport is bound; Training omits COROS plan, workout and sync-history controls, including retained status summaries. Stored preferences and delivery records remain inactive and are not interpreted as permission to send, update, retry or remove a provider copy. The serializer supports target-free pool-swim time/distance/manual steps as `swim`, not open-water workouts; canonical HR/power/pace/cadence targets fail compatibility because the partner's swim target is stroke. The implemented adapter can batch at most 30 dated workouts, retain stable partner IDs, apply per-item deletion outcomes and link an exact returned `planWorkoutId` once deliberately enabled. COROS exposes no documented planned-workout read/list endpoint, so remote Check, missing-copy classification and automatic recreation remain unavailable. Provider entitlement (`30009`), repeated-ID replacement, overlapping-window behavior, reschedule/delete, callback/history correlation, and app/watch behavior still require separately authorized live evidence. |
| Wahoo | `enabled` | Early-Lap numeric endings are unsupported. Connected Pro users can explicitly deliver time-based Running/Cycling and their mapped subprofiles, untargeted outdoor Walking/Hiking and timed Strength/Gym workouts as separate app-owned Plans and dated Workouts. Walking/Hiking use account-tested family `9` with exact Workout types `6`/`9`; intensity targets remain unsupported. Timed strength is degraded instruction-only delivery, not native rep/load tracking; repetition sets are unsupported. The public `plan.json` documents only Biking/Running families. Wahoo supports timed, untargeted pool/open-water swimming and outdoor/indoor rowing. All 21 profiles have integrated account acceptance and owner-confirmed native profile/timed playback (#789, 1 October 2026). Distance endings and intensity targets remain unsupported for walking, hiking, swimming and rowing. Wahoo has no documented physical pool-length delivery field; QS does not support delivering that setting, and a local-setting check is not a pending acceptance item. Catalog IDs are not proof of Plan acceptance. The saved-zone window is today through today + 6. Retained-ID recovery and independent positive Plan/Workout/association reads protect retries, and exact account-bound Workout/Plan/token evidence can link a returned recorded activity. The later integrated Strength recording imported automatically and linked to the exact owned QS workout using retained API/FIT identity. Completed #783/#789 record edit/reschedule/retry/reconnect, eligible withdrawal, completed-copy Stop protection and production frontend release checks. Earlier direct probes without a QS ledger did not prove those links. These results do not establish universal receipt, intensity/distance support or native rep/load tracking. Missing-copy classification and automatic repair remain unavailable because Wahoo inventory and negative responses are not authoritative enough. #649 owns the base adapter; no sandbox is assumed. |
| Suunto | `enabled` | Numeric early-Lap endings use v6 OR transitions with private lap-safe boundary paths; device proof remains separate.  Connected Pro users can explicitly deliver one workout as a dated SuuntoPlus Guide, not a native plan. The Guide recommends the exact supported canonical sport selected in QS, including Trail Running, Treadmill, Mountain Biking, Indoor Cycling, E-Biking/E-MTB, Hand Cycle, pool Swimming (`21`), and Openwater swimming (`85`) where the documented Suunto activity catalog provides an ID. ZIP/icon CRUD and exact external-ID recovery reuse existing OAuth and the existing Suunto API subscription key with Guides access; today through today + 6 is a QS product window. Completed #650 records approved cloud lifecycle and owner-confirmed app/watch visibility/selection. App/watch receipt remains unknowable through the partner API and is not inferred from fixtures or positive cloud reads. Suunto-confirmed retained app/watch copies after cloud removal are expected, not a failed withdrawal or automatic-recreation signal. #710 keeps negative classification and automatic repair disabled. |

Garmin mapping follows the local ignored Training API V2 version 1.0 partner contract; the confidential PDF is evidence,
not a repository artifact. Yoga, Pilates and Cardio Training use its native `YOGA`, `PILATES` and `CARDIO_TRAINING`
profiles, with local serializer/MCP compatibility evidence only; no exercise details are inferred and no new live
Garmin/device acceptance is claimed. Workout content and its date-only schedule remain separate artifacts because each has its own
provider ID and CRUD lifecycle. The fixture mapper supports Running and Cycling exactly. Trail Running, Treadmill,
Indoor Running and Virtual Running fold to `RUNNING`; Mountain Biking, Indoor and Virtual Cycling, E-Biking, Hand Cycle,
Velomobile, Enduro MTB and Downhill Cycling fold to `CYCLING`. These are the explicit QS running/cycling Training
profiles; unrelated Sports Lib activity types remain unsupported. Because the contract has no sub-sport field, those
folds are explicit degradations requiring approval rather than claims that Garmin receives the exact profile. The
authored workout sport is never rewritten to make delivery pass. `Swimming` maps to `LAP_SWIMMING`
mapper: root pool length is explicit metres/yards or null for an unspecified pool, and the single-sport segment keeps
null pool fields. Current swim steps must be target-free; rest uses `FIXED_REST`, repeat blocks skip their final rest,
and non-rest time steps must be 1–59 minutes. Garmin permits unspecified pools but older devices may not. Eligible,
explicitly consenting connections can deliver compatible pool swims after the 23 September 2026 owner-account cloud
lifecycle proof; open water instead uses the separate Generic fallback. A demo-Firestore test with synthetic Garmin HTTP also covers an active
plan's explicit opt-in, pool-swim edit, reschedule and Stop while retaining one remote Workout/Schedule identity until
withdrawal. Separately, a 27 September 2026 owner-account plan-scoped test passed cloud create, edit, reschedule,
readback and Stop. A second standalone 25 m test was visible in Garmin Connect and on the owner's watch. These
observations do not establish completed-activity linkage or guarantee receipt on other devices; cloud checks alone
never establish app/watch visibility.

Garmin Generic is an explicit allowlist for Walking, Hiking, Rowing, Indoor Rowing and Open Water Swimming, following
rejected native sport enum probes. The workout and segment both receive `GENERIC`; a provider-facing description keeps
the authored QS sport visible within the normal 1024-character limit. The degraded mapping requires the existing
current-payload/account approval. Time/distance/manual endings, fixed repeats and one primary target are retained;
repetitions, kJ endings and secondary targets remain unsupported. Open water does not receive pool fields or pool-specific
last-rest skipping. Existing native pool, strength and Running/Cycling payloads are unchanged. Local serializer,
strict MCP proposal/read and demo-emulator lifecycle evidence alone is not Generic app/watch proof. #655 records
the owner's 2 October acceptance of the remaining device matrix, without new individual device observations.
No provider credential, scope, endpoint, lifecycle, MCP wire contract or metric changes.

The mapper also supports fixed repeats, time/distance/manual endings, and absolute HR/power/speed/pace/cadence ranges.
Garmin's percentage fields do not carry
the canonical reference snapshot, so relative targets are frozen to their stored absolute range only after explicit
degradation approval. Secondary targets are rejected outside cycling, must differ from the primary target, and remain
an explicit device-support degradation even for cycling. The private contract does not document a completed-activity
workout identifier.

Suunto is the first adapter to support the editor's exact running/cycling, pool-swim, and open-water profiles. Its
documented Guide `activities` array receives provider IDs only at serialization time: Running `1`, Trail Running `22`, Treadmill `53`, Cycling `2`,
Mountain Biking `10`, Indoor Cycling `52`, E-Biking `105` and E-MTB `106`, Hand Cycle `109`, pool Swimming `21`, and
Openwater swimming `85`. Generic Cycling does
not automatically include Mountain Biking. Garmin folds those profiles—and the additional Indoor/Virtual Running,
Virtual Cycling, Velomobile, Enduro MTB and Downhill Cycling profiles—to its broad `RUNNING`/`CYCLING` API values with an
explicit degradation warning. COROS maps Running, Trail Running and Cycling to `run`, `trailRun` and `bike`.
Treadmill, Indoor Running and Virtual Running fold to `run`; Mountain Biking, Indoor Cycling, Virtual Cycling,
E-Biking, Hand Cycle, Velomobile, Enduro MTB and Downhill Cycling fold to `bike` only with explicit mapping approval.
QS keeps the authored sport. Swimming maps to native `swim` only when its
steps have no intensity target; the partner's stroke target has no canonical v1 equivalent. COROS Training delivery is
disabled at the shared frontend/backend boundary. Open-water swimming is not a COROS `swim` profile in the current mapping. Wahoo remains
mapped to time-based Running/Cycling subprofiles, untargeted outdoor Walking/Hiking and the #783 owner-tested timed Gym path.
Wahoo supports timed, untargeted pool/open-water swimming and outdoor/indoor rowing. All 21 profiles have integrated account acceptance and owner-confirmed native profile/timed playback (#789, 1 October 2026). Distance endings and intensity targets remain unsupported for walking, hiking, swimming and rowing. Wahoo has no documented physical pool-length delivery field; QS does not support delivering that setting, and a local-setting check is not a pending acceptance item.
Running/cycling subprofiles use their native indoor/outdoor type where available. Indoor Running uses Treadmill, Velomobile uses Cycling, and Enduro MTB/Downhill Cycling use Mountain Biking, with a review warning; the saved QS sport is unchanged. The Walking/Hiking extension is based on positive Plan/Workout and
uploaded-JSON readback, not the recorded-activity catalog. Completed #789 records the integrated lifecycle and frontend
checks; distance endings and intensity targets remain unsupported, not deferred launch checks.

Wahoo's Cloud type `42` names a generic Workout, not a Yoga mapping. The native Strength control and saved timed-Gym
probe both used type `42` with FIT `training/strength_training`. Keep Gym family `6` / indoor location `0`; do not replace
it with Yoga `66` or Mental Strength `69`. Help advises checking/selecting the local Strength Training profile before
Start, as Wahoo documents for planned workouts. The earlier Yoga/Indoor Fitness Equipment prompt's cause is unproven;
no documented Cloud field selects local equipment/profile configuration. The direct probe's exact recorded markers
and successful QS import are completion-identity evidence, not a QS planned completion badge: no QS ledger existed.

COROS mapping follows the local ignored COROS API Reference V2.0.6 (February 2026); the confidential PDF is likewise
kept out of Git. Partner athlete/workout IDs in fixtures are redacted or deterministic opaque safe integers. The mapper
supports dated `run`/`bike` time/distance/manual steps and fixed repeats. Native FTP, threshold-HR, and threshold-speed
percentage targets preserve their canonical reference snapshots. Maximum-HR, critical-power, and relative-cadence
targets freeze to absolute ranges only after approval. COROS accepts one intensity target per step, exposes no distinct
recovery intensity, documents cadence targets for running but not cycling, and requires integer lengths and percentages;
each lossy case is surfaced before serialization.

The partner Training Plan contract (§6.1.3, pp. 45–49) has only `run`, `trailRun`, `bike`, `swim` and `strength`.
Walking, Hiking, Rowing, Indoor Rowing and Open Water Swimming therefore remain unsupported, with no Generic fallback.
COROS's [native custom-workout help](https://support.coros.com/hc/en-us/articles/47285577958932-Create-Custom-Workouts-in-Your-COROS-App)
lists additional app-created modes; it does not establish additional partner `WorkoutType` values. Recorded-activity
`mode`/`subMode` values likewise cannot authorize outbound workout mappings. The new subtype folds reuse the existing
payload approval, identity, batching and lifecycle paths; no OAuth, admission, transport binding or production enablement
changes. Serializer, mixed-batch and strict MCP read regressions cover the six additions; live evidence remains #648/#741.

Wahoo mapping follows the official [Cloud API](https://cloud-api.wahooligan.com/) and
[plan.json 1.0.0 format](https://cloud-api.wahooligan.com/docs/plan-json-format.pdf). Canonical repeat count is total
passes, while Wahoo's repeat trigger counts passes after the first, so the serializer writes `count - 1`. Wahoo stores
relative FTP, maximum-HR, threshold-HR, and threshold-speed references in the header. Conflicting snapshots, critical
power, relative cadence, generic `other` purpose, and multiple targets where ELEMNT uses only the first are explicit
degradations. FTP and heart-rate header references are integer fields; a fractional canonical snapshot is rounded only
after explicit degradation approval. Relative threshold/max-heart-rate and threshold-speed targets are also explicit
device-support degradations: Wahoo documents them for treadmill workouts in the Wahoo app, not ELEMNT computers or
RIVAL. Unsupported endings fail.
Yoga, Elliptical Trainer and Cardio Training additionally use indoor Gym Plan family `6` with dated Workout types
`66`, `20` and `43`. Cardio Training discloses its Cardio Class substitution. Only timed, untargeted steps are
supported. Authorized 20 October 2026 API tests verified Plan/file/Workout/association readback and temporary-copy
removal, including payloads generated by the QS serializers; app/watch playback and the integrated QS queue were not
tested. The approved follow-up also maps Crossfit/Circuit Training/Aerobics/HIIT/AMRAP/EMOM/Tabata to Garmin Cardio Training
and Wahoo Cardio Class, Crosstrainer/Elliptical Trainer to Garmin Cardio Training and Wahoo Elliptical,
Stretching/Flexibility Training/Meditation/Breathwork to Garmin Generic and Wahoo Gym, and Pilates to Wahoo Gym.
Mobility/Gym substitutions are timed and untargeted; every sport fold requires review. The seven strength aliases use
complete matching exercise companions on Garmin/COROS/Wahoo, preserve their source name throughout persistence,
and reuse existing exercise, consent and serializer restrictions; COROS delivery stays disabled.
Direct API tests verified all 21 approved Wahoo source names through Plan/file/Workout/association readback and cleanup.
Wahoo rejects fractional minutes on dated Workouts, so new delivery requires an exact whole-minute total; QS does
not round or pad the prescription. Stored decimal seconds and repeat counts are summed exactly for this decision,
so floating-point residue cannot reject a valid whole minute or conceal a real fraction. Historical digests remain
unchanged; only validated recovery accepts the old minutes representation. Read-only compatibility explains the same restriction. This is Cloud evidence,
not proof of local app/watch playback. Existing OAuth, consent, queue, revision and monitoring boundaries remain unchanged. See the detailed evidence
and limitations in [Training](training-workspace.md).

Suunto mapping follows the official [Guide API workflow](https://apizone.suunto.com/how-to-use-suuntoplus-guides-api),
[Guide JSON reference](https://apizone.suunto.com/suuntoplus-guide-description), and
[FIT correlation description](https://apizone.suunto.com/fit-description). Guide `externalId` values are deterministic,
opaque, and at most 64 characters. Relative targets are frozen from the canonical reference snapshot only after explicit
degradation approval. Mapping v2 adapts common punctuation/non-breaking spaces for watch fonts and generates a
23-code-point subtitle from the title without approval. QS-authored text and the app-only description remain intact;
owner and identity fields are not normalized. Authored title/instruction or explicit-subtitle truncation still requires
review and counts Unicode code points. Remaining watch characters outside Suunto's guaranteed minimum set require
approval because rendering is device-dependent; app-only description text is not subject to that watch-font check.
See the [Training source of truth](training-workspace.md#suuntoplus-guide-delivery-650) for upgrade and recovery behavior.
Mapping `suunto-guides-v5` retains Training 01's reviewed lap boundaries and prioritizes sport/prescription readings:
running uses lap-average pace/current HR; cycling uses lap-average power/current HR/cadence/speed;
pool/open-water swimming uses lap-average pace/separate lap-average swimming `strokeRate`/current HR.
Walking/Hiking/Rowing retain pace/HR; strength retains current HR where instructions fit. Both targets' documented
counterparts take priority in authored order, followed by HR and sport defaults. Countdown, every target and instruction
are reserved first within five fields; long manual text stays text-only. Authored untargeted steps stay untargeted.
Average labels `Avg pace`, `Avg pwr` and `Avg strk` identify documented `manualLap`/`average` fields.
Swimming stroke rate is contextual watch data, never a cadence target or rowing-stroke mapping. Only running/cycling
receive documented power/cadence sensor counterparts; missing/unsupported sensors stay unavailable, not zero.

The `suunto-guides-v7` mapping additionally requests measured pool-swim `swolf` with `window: 'manualLap'`,
`aggregate: 'average'` and label `Avg SWOLF`. It is not a native target. Untargeted pool screens prioritize pace,
stroke rate, SWOLF, then optional HR after countdowns/targets/notes; authored target counterparts retain priority.
Open water and all non-pool layouts are unchanged. Native pool length and stroke determine the reading; QS does
not transmit pool length or fabricate unavailable values. Existing lap boundaries and early-Lap behavior stay
unchanged. The exact v6 recovery serializer and synthetic golden pool fixture preserve historical operation
digests; lost v2-v6 ACKs recover before updating the same Guide. The separately approved 6 October Guide-only v7
upload passed exact readback, and the athlete confirmed the requested SWOLF watch check. That is measured-field
evidence, not native targeting or QS completion-link proof. Normal delivery still needs merge and separately approved
Functions deployment. See [measured SWOLF behavior](training-workspace.md#pool-swim-measured-swolf-773).

The historical pool-only v9 screen upgrade requests native step-window `distance` (`Swum`) and `duration` (`Elapsed`)
for manual work, after authored target counterparts and within the five-field budget. Numeric endings show
`Dist rem`/`Time rem`. Stationary `rest` shows HR/countdown/targets/notes, not freshly reset swim averages;
active `recovery` retains swim readings. Long manual instructions stay text-only. Field order is controlled,
and the compact `AvgSWOLF` label keeps new multi-field titles below nine characters without altering the frozen v7
`Avg SWOLF` payload. Suunto's adaptive layout does not promise fixed positions. No measurement-lag,
preceding-interval-statistics, target or transition fix is implied. Frozen v7 payload recovery and its recorded-lap policy are retained before
any eligible same-identity update. Non-pool mappings/digests, consent, completion and queue policy are unchanged.
Private diagnostic labels include v9; existing provider/event-based monitoring filters already cover it.
See [pool screen presentation and verification](training-workspace.md#pool-swim-workrest-screen-presentation).
This local change needs separately approved deployment; no live watch-layout proof is claimed.

The historical Suunto swim mapping `suunto-guides-v10` improves manual swim notifications and stationary Rest for both pool and open
water: generated text explains that Lap finishes the current interval/rest, and Rest requests native cumulative
`distance` (`Total`, `window: 'workout'`) after reserving authored ending/targets/notes and current HR. It omits
freshly reset swim averages, not active-recovery readings. Pool Work keeps v9 fields; open-water Work keeps v7
fields. V9 pool recovery remains frozen, alongside all older attempts; exact recovery precedes one eligible
same-identity update. No previous-interval data, delayed-distance fix, forced haptics, extra countdown steps or
live watch evidence is claimed. Non-swim payloads, recorded laps, consent, queue policy and completion remain
unchanged; provider/event-based monitoring already covers v10. See the single detailed
[swim presentation source of truth](training-workspace.md#swim-manual-instructions-and-cumulative-rest-distance).
Deployment and live testing still require separate approval.

For other supported interval sports, v11 changes generated manual notifications to `Press Lap to finish this interval.`
and manual Rest to `Rest now. Press Lap to finish this rest.`. The empty-screen reminder becomes `Lap to finish`.
Authored notes/exercise instructions win; numeric-only and fully annotated recipes retain v7 identities, while swim
v10 and strength v8 stay byte-identical. Only affected recipes select v11, with exact v7 recovery before one eligible
same-identity update. Metrics, recorded laps, consent, approval, completion and queues are unchanged; existing
provider/event-based monitoring covers v11. See [manual instructions and verification](training-workspace.md#manual-instructions-in-other-sports).
This is local implementation, not deployment or new live evidence.

The frozen v12 eligible Rest presentation uses: countdown first, current target readings/HR,
actual pass labels for simple repeated Work/Rest pairs, and a next-phase hint where space permits. Running/walking/
cycling variants and pool/open-water swimming are covered; active Recovery and Work retain their existing readings.
Authored targets/notes, exact timing and the frozen execution/lap graph stay intact. No previous-effort statistics,
guessed manual distance or forced countdown beeps/vibration are added. Large Guides first keep their native execution
graph without optional numbering; the compact Rest layout is also checked against enriched archive readback bounds.
If optional labels still cannot fit, preserve the frozen layout and all authored fields, without raising memory limits.
Exact v10/v11 recovery precedes one eligible same-ID update,
with pinning, current authority, approval and past/completed-copy protection unchanged. Other recipes retain their
historical watch graphs. Existing provider/event monitoring covers this presentation without queue or alert-policy changes.
See [Rest-first screens and verification](training-workspace.md#rest-first-interval-screens-v12).
This needs separately approved Functions deployment and physical watch verification; it is not live evidence.

Guide payloads retain private v13 app descriptions: documented `richText` Markdown contains grouped workout
steps, complete notes, targets and strength sets in owner units. Native watch steps remain identical to the recipe's
frozen presentation above. Preview/UTF-8 archive budgets fall back to the short description without changing the
workout or increasing memory bounds. Owner units are immutable attempt snapshots; exact historical v2–v12 recovery
precedes a same-ID update, never a speculative replacement. MCP/public responses exclude description and unit/proof
metadata. Monitoring is **covered/unchanged** by provider/event filters; no dashboard, queue or policy changes.
See [app preview and verification](training-workspace.md#suunto-app-workout-preview-v13) for the impact review and
separately approved release/app verification still required.

Pool/open-water swimming without timed Rest selects private v15 for bounded, configurable Work/Rest fields. Selected planned
interval numbers use the heading (13-character limit), not a text metric slot. Previous/next prescription distances
share one compact, explicitly planned text field without an ending instruction; Suunto may crop this text beside
native numbers. A shared allocator drives delivery and the app's per-step Included/Heading/Omitted report, with
Rest listed first and no watch-visibility promise. Native stroke count remains separate from stroke rate.
Short generated timed-Rest popups (at most 20 seconds, no authored note)
are omitted to avoid overlapping the next Work alert, without changing timing/laps or promising forced haptics.
Other sports without timed Rest retain exactly v13. Canonical owner config preferences become immutable private operation/proof
snapshots; frozen v14 and earlier recovery precedes an eligible same-ID update under unchanged consent/authority/Pro gates.
The existing scheduler handles saved display preferences; no new queue, Rules or index is needed. Monitoring is
**covered/unchanged**; MCP Training schemas/read coverage stay unchanged and reject these private fields.
Previous-effort Rest statistics, native pace-format overrides, custom beep patterns and earlier pool-distance
updates remain undocumented capabilities, not guessed upload fields. See the single detailed
[swimming screen contract](training-workspace.md#configurable-swimming-guide-screens-v14) and
[v15 allocation/recovery verification](training-workspace.md#swimming-field-allocation-and-headings-v15).
This change still needs separately approved Functions/frontend deployment and physical watch verification.

The later [swimming wording and reported validation](training-workspace.md#swimming-wording-and-reported-validation-19-october-2026)
clarifies app choices as last/next Work block **planned** distance, distinct from measured results and repetition
numbering. It changes no saved preference, allocation, watch payload or provider lifecycle. Reported numbering and
consistent countdown sound/vibration are recorded for the tested case, not font-size control or a custom final tone.
Previous-effort Rest statistics remain a focused future investigation in #905, separate from #828's native targets.
Monitoring and MCP contracts are unchanged; this copy-only follow-up needs no Functions, Rules or index deployment.

Recipes with timed Rest now select private **v16**, adding a native `default` alert with a `stepDuration` condition
and `countdown: { type: "standard" }` at the exact Rest duration. This applies across supported sports, including
swimming and Gym set rests, by default without a QS toggle. Manual/distance Rest and active Recovery are excluded.
Timing, targets, lap/transition graphs and screens remain unchanged apart from bounded presentation fallback needed
to fit alert bytes. Frozen v15/v13 recovery still proves original acceptance before an eligible same-ID update;
alert readback is strict, pinning/consent/completed-copy fences remain intact, and there is no automatic recreation.
An authorized partner-API QA upload/readback and owner watch test confirmed countdown sound/vibration, **not** a
long final tone or exact five-second sequence. Quiet/tones-off behavior remains unverified. This extension was
discovered in public unofficial client code, not the published partner schema; no dependency or internal endpoint
is added. Monitoring is covered/unchanged and MCP has no wire impact. See
[v16 evidence, bounds and verification](training-workspace.md#native-timed-rest-countdown-alerts-v16).
The application change still requires a separately approved Functions deployment; no frontend settings change is needed.

An explicit **Send a fresh Guide** review can reserve a new Suunto external identity for the same eligible QS workout,
without changing or deleting the earlier Guide. This is not absence detection or automatic repair: hidden Guides may
still exist, duplicates are disclosed, and current consent/Pro/date/completion/unfinished-attempt gates still apply.
Receipt-bound generation snapshots retain exact lost-ACK recovery; bounded aliases retain old/new FIT correlation.
**Duplicate to…** in completed-workout sync details reuses the existing scheduled-workout duplicate path, across providers.
Monitoring remains covered by the existing Suunto worker/outcome/queue filters. No new endpoint, Rules, index or resource
is introduced. Native-app fresh-Guide consent does not expand MCP/Assistant provider actions. See
[fresh identity and completion protections](training-workspace.md#explicit-fresh-suunto-guide-and-completed-workout-reuse).

For additional authored targets, [#773](https://github.com/jimmykane/quantified-self/issues/773) records the
6 October contract review. The published JSON reference defines only the existing HR, power, speed/pace and cadence
target types. Its measured `strokeRate` and `swolf` examples are not native target examples. Suunto's partner resource
list confirms watch-engine possibilities, not the exact partner-upload JSON or range units. Swimming stroke rate
and pool-context SWOLF are the bounded next candidates; neither is currently an authored QS target. The engine's
`/Activity/{Window}/{WindowIndex}/{Field}/{Aggregate}` target pattern excludes ZoneSense's `/Activity/Zones/...`
resources. ZoneSense remains unsupported despite sport-mode availability; do not approximate it with fixed HR.
The preparatory parser/serializer/MCP regressions reject guessed target types and resource injection even with
mapping-loss approval. That initial preparation changed no v1 recipe, provider payload/version, recovery digest,
permission or transport; the subsequent v7 measured-reading mapping above changes no target contract or consent.
See [the Training contract boundary](training-workspace.md#additional-suunto-targets-contract-boundary-773) for units,
candidate semantics, the exact partner example still needed, versioning and separately approved watch-test criteria.

Device capability is not inferred from a connected account. Native watch units apply, without an unverified rowing /500 m label.
Guides containing any manual-lap average create recorded laps at automatic boundaries and final completion;
button-ended predecessors already create a lap, so the successor omits the extra lap. No opening lap or automatic
laps in HR-only/no-average Guides. Native repeats split off the first pass only if its incoming boundary differs
from subsequent wraps, preserving total passes and ID omissions without unbounded expansion. An extra Lap press
during a timed/distance step resets averages but does not advance that step. These laps are not adherence/completion evidence.
Documented partner step-start notifications cover every phase/repeat/rest; a generated non-timed `Guide complete`
screen requests the final alert without adding prescribed time, stopping recording or proving completion. Watch sound/
vibration settings control alerts. Pre-end beeps and out-of-target alerts are not promised; approximately 20-second popups
need short-interval watch testing. No undocumented wrapper fields or new dependency is used.
Notification titles keep the phase and authored notes/strength instructions take priority over generated body text.
Note-free timed steps use shared Sports Lib duration formatting with seconds (`For 01m 30s`, `Recover for 30s`,
`Rest for 02m 00s`); distance/manual steps use `Follow distance countdown`/`Press lap when ready` without guessed units.
Fractional/day-length durations use `Follow time countdown` rather than omitting fractions or seconds. Generated text
is bounded to 54 code points without truncating a duration into another number. Text is static and does
not inherit watch-unit preferences; native countdown/live fields do. This wording is retained in v5;
the exact v2/v3/v4 recovery JSON and public/MCP contracts are unchanged.
New sends use v5 after separately approved deployment. Eligible consented future Guides update in place; past/completed
copies remain protected. Started v2/v3/v4 attempts recover only against their exact digest-verified old payload and retain IDs
before any v5 update. Unknown acceptance never permits a speculative create. An exact approval for the same v2/v3/v4
prescription/losses can carry across this presentation-only upgrade; edits still require review. Verified equivalence is
retained privately on the ledger so retiring a never-started/unaccepted v2 attempt does not lose it. That proof is bound
to the saved approval, current mapping and full canonical content, and never asserts remote acceptance or grants consent.
#784 tracks remaining
account/watch evidence (model/firmware, sensors, sport-specific average resets, swimming stroke rate, sensor availability, all boundary/final alerts, muted settings, short intervals), separately
from #773's additional-target/ZoneSense scope. API acceptance/readback is not watch receipt or behavior proof.
Existing private delivery events add allowlisted `guideMappingVersion` and `deliveryPhase` labels to distinguish
digest-verified v2/v3/v4 recovery from v5 execution/failure. Unknown digests/classification failures stay labelled `unknown`;
removal has no recipe version (`not_applicable`). Classification is local, non-authorizing and never changes delivery.
The labels are log-only, not Firestore/browser/MCP fields, and contain no identities, prescriptions, credentials or raw
errors. See the Training source of truth above for exact values and Cloud Logging filters. Product Help needs no new
copy for these internal diagnostics; its existing screen/alert and delivery-versus-watch guidance remains unchanged.
The #650 transport packages that JSON with a valid 300 × 300 PNG and preserves Guide identity
and pin state through PUT. Suunto file GETs can add `notification.type: "default"`. Full-content comparison permits
only that exact added marker on corresponding FieldsStep notifications (including repeats/final screens), leaving
the sent JSON, historical digests, ownership/date/authority checks and every other field unchanged. Lost-response
recovery can then recognize the retained copy without another create or redundant update. Unknown or changed
content remains uncertain; this is not generic response sanitization, absence proof or app/watch receipt evidence.
Suunto create HTTP 200 replies are decoded but accepted only with the account-bound success envelope, matching owned
metadata and exact Guide ZIP readback. Checkpoint the acknowledged ID as `create/started` before the GET; an interrupted
readback resumes that exact ID against the frozen digest, never another create. Application-error/malformed replies and
missing/changed readback stay uncertain. A historical journal with no retained ID is not automatically reset on deployment.
This private response fix changes no mapping, public/MCP contract, consent or entitlement. Existing Training monitoring
covers its accepted/recovered/failure outcomes and queue health; no new metric, alert, queue or retry policy is needed.
See [Suunto delivery](training-workspace.md#suuntoplus-guide-delivery-650) for the detailed comparison and tests.
Incoming workout-reference FIT metadata is now read through Sports Lib 21.2.3's bounded
metadata-only reader. The public workout-reference classes, return shapes and numeric values remain unchanged, irrelevant
nonstandard vendor definitions on unrelated messages do not poison usable correlation metadata, and the full FIT parser
5.2.1 remains lazy for activity and route imports instead of entering application startup bundles.
Guide HTTP 400 diagnostics classify only a bounded validation envelope into fixed structural categories; Suunto's
free-text `error.description` and uploaded Guide content never enter logs or owner-visible status. An operator replay
must use the existing delivery journal after proving definitive rejection and current consent/connection eligibility;
it must never directly repeat an ambiguous create.
Four observed repeat-containing Guides received terminal HTTP 400 while non-repeat Guides succeeded. A disposable
synthetic real-account test isolated the rule: Suunto rejected the repeat ID and then a child FieldsStep ID, both as
`Step id not allowed inside repeat`. With all IDs inside the repeat omitted, Suunto accepted the terminal repeat,
returned its expected identity and one repeat step on readback, and confirmed deletion afterward. A final screen is
not required for API acceptance; mapping v3 adds one separately to request the finish alert (#784). The serializer
keeps standalone step IDs and the stable Guide external ID. This synthetic proof
does not establish that the four failed user workouts will all be accepted; inspect their exact ledgers and current
consent before any replay. Deploying the changed mapping digest can itself queue definitively failed records, so
deployment requires separate operational approval and monitoring.
QS still revalidates the exact connected account, filters its OAuth client owner and deterministic Guide external ID,
and links only one unambiguous session marker
to the matching scheduled workout. The private IDs/evidence never enter Event/Activity JSON; the owner sees only
**Activity linked**, which does not claim target or interval adherence. Garmin message 72 is retained as candidate evidence;
the conservative account/date/source-validated link above can promote one exact match despite the undocumented
serial-to-API semantics.
Completed #651 implements exact-marker reconciliation with duplicate/ambiguity handling; the first committed
activity link wins. Fallback/manual matching and audited unlink/relink are explicitly out of scope. The existing OAuth
application/client credentials/user tokens and `SUUNTOAPP_SUBSCRIPTION_KEY` are reused, with the
exact OAuth application name supplied through the `SUUNTOAPP_GUIDE_OWNER` Secret Manager setting (`.secret.local`
for emulators). The name is not hardcoded; only the two Training delivery callables and worker bind it. Guides uses the
documented normal Cloud API authentication;
the existing subscription must include Guides access, but no separate key is required by QS. Do not replace credentials
or infer entitlement from reuse. See [Suunto delivery](training-workspace.md#suuntoplus-guide-delivery-650) for lifecycle, credentials,
seven-day window, absence limitations, FIT retention and deployment boundaries. No assumed Suunto quotas, evaluation
budgets, new project or setup wizard are added.

Fixture compatibility is not delivery readiness. Ordinary adapter tests cover create, update, reschedule, delete,
exact duplicate, ambiguous retry, reconnect and provider-specific horizon behavior. Record actual live results only
when separately authorized; do not introduce a separate certification process. The
shared delivery ledger, reconciliation queue and capability-gated UI are implemented in #646 and proved with an excluded
test transport. COROS #648 adds a production batched boundary for every eligible authenticated owner without changing
that common model. [Training delivery foundation](training-workspace.md#provider-delivery-foundation-646) is the detailed
source of truth for its contracts, operations, evidence and maintenance. Garmin's #647 adapter additionally runs through
synthetic HTTP fixtures and real Firestore transactions; the public runtime still requires Pro, explicit consent,
connection authority and `WORKOUT_IMPORT`.
The [Garmin adapter boundary](training-workspace.md#garmin-workoutcalendar-adapter-647) documents the per-request authority
guard, step journal, exact endpoints, request bounds, permission flow and remaining integration checks. In particular,
Garmin's documented first workout POST has no external idempotency/lookup key: unknown acceptance remains blocked for
attention, never retried blindly. Do not turn an empty schedule lookup into proof that a POST failed. HTTP response
handling includes documented empty schedule-create success: a POST 204 is followed by an exact workout/date lookup,
and only one matching schedule ID confirms that artifact. No match or multiple matches keep the journal uncertain.
Production schedule POST responses also return HTTP 200 with a numeric ID alone. The adapter persists that ID before
an exact schedule GET, then validates the workout/date association; decimal Long strings are preserved without numeric
rounding. A scalar PUT acknowledgement must keep the existing ID. Failed or conflicting verification retains the
started journal and known ID for recovery, never a blind replacement POST. Tests cover first-attempt confirmation,
lost checkpoints/reads, duplicate dispatch and concurrent Stop/edits using real Firestore transactions.
Allowlisted HTTP status and failure-phase diagnostics distinguish transport failures without logging raw provider data.
Garmin delivery logs fixed resource/method categories, response/identity-field types, contract-validation reasons and
schedule-lookup outcomes; the shared worker separately logs journal persistence failures before attempting to save
retry state. Scalar acknowledgements additionally log `garmin_schedule_confirmation` phases `id_retained` and
`verified`; final worker `accepted` remains the completion signal. Correlate the `[TrainingDelivery]` events by Cloud
Logging execution ID, not user/provider identifiers.
Wahoo delivery failures additionally include the fixed private `wahooContractCheck` label and `failurePhase="contract"`
when an ownership, date, completion, association or removal-response safety check blocks work. A missing/invalid
completion summary is not proof of completion; `plan_deletion_state_unknown` is not proof of a deleted Plan, and
`*_not_readable`/`*_delete_not_found` do not alone prove absence. These labels retain uncertainty, retry and
destructive-write guards; HTTP failures keep their original status/phase. Authorized removal can separately converge
through the scoped policy below. Final INFO uses fixed `outcome="already_absent"` only after durable acceptance, not
as a claim that this worker performed an earlier DELETE. Private evidence/journals never enter owner-visible or MCP
contracts. Focused fixtures and the Wahoo demo-Firestore worker suite verify warning propagation, unchanged refusal
to delete an unverified copy, and truthful success/failure logging at persistence boundaries.
See [Training diagnostics](training-workspace.md#provider-delivery-foundation-646) for event names and filters.
Never add response bodies, arbitrary field names, dates, workout contents, credentials, IDs or raw error text to these logs.
Functions-only emulation can still write live Firestore and trigger deployed delivery workers; isolate bulk/failure
tests with the demo Firestore suite and synthetic transport, not just a localhost callable URL. HTTP response
tests also distinguish empty successful reads from explicit 404 absence and asynchronous acknowledgement from
completed mutation. Interrupted edits invalidate the old fully accepted payload digest, and provider-imposed retry
deadlines survive authored changes and manual Retry; these are tested locally, not inferred live provider results.
Completed #647/#703 retain Garmin adapter and schedule-repair proof; #645 records contract research. #655 retains
outstanding monitoring and release work, not a repeat of completed provider QA.
The separate #698 certification/evaluation issue is retired. Track deferred functionality in an epic subissue, not a
code-only TODO, and do not silently narrow the epic's product scope.

Training is a distinct consent lifecycle: plans opt in per provider, standalone Send means ongoing sync, inactive plans
withdraw eligible future copies, and Stop can suppress an individual plan workout. Pro expiry keeps preferences and copies
while pausing writes; cleanup removals remain allowed with valid access. Subscription enforcement may revoke access and
require same-account reconnect. Explicit disconnect invalidates Training consent atomically before provider I/O and leaves
copies; authentication failure preserves consent but blocks the failed connection generation. A changed account requires
fresh consent. Do not reuse activity/route auto-restoration rules for Training.

During an oversized staged Training plan restore, the owner schedule is briefly unavailable behind the `_bulk_restore`
lock. Inbound Garmin, COROS, Wahoo, and Suunto activity imports may retain their recorded event, but an exact planned-
workout completion candidate must retry its link until the final plan revision is published. Read the lock in the same
transaction as the candidate workout and completion write; never link against a partly restored occurrence. This
does not change provider marker matching, consent, delivery, or device-receipt semantics.

Deleting a plan or workout still withdraws eligible uncompleted future copies by default. The browser offers a separate,
unchecked past-copy cleanup choice. The server commits that choice beside the deletion under `trainingDeliveryState/current/pastCleanup`
and requires the matching current deletion before a reconciler may attempt any past removal; a later deletion without opt-in
revokes the old choice. The ledger retains the private authorization and artifact IDs for retries, but rechecks the marker,
connection epoch, exact account, completed evidence and provider ownership before every write. Garmin deletes its schedule
then workout, Wahoo its Workout then Plan, and Suunto its owned Guide; acceptance is not device removal. COROS's partner
contract permits deletion only for unexecuted workouts dated today or later, so its past copy is retained with a clear
unsupported reason even if selected. The same COROS backend path remains tested while the app hides new-send controls.
Never infer that deleting a planned provider copy deletes a recorded activity. The additive MCP
`preview_training_deletion` offers the same explicit older-copy cleanup choice with both existing Training write grants
and native/app approval. It calls the existing sanitized deletion transaction and durable worker, not provider HTTP;
the preview/result describe requested cleanup rather than confirmed removal. The registered batch deletion remains
no-opt-in. Clients must ask and disclose that limitation instead of silently preserving older copies when removal was
requested. Completed copies, exact ownership and disconnect epochs remain protected; same-account reconnect is not
permission to bypass an earlier explicit disconnect. No callable, new consent scope or provider adapter is added.

Wahoo REMOVE-only cleanup can finish stale retained references when independent exact Plan/Workout reads find their
previously verified copies already absent. The guarded client confirms the current credential's bound `/v1/user`;
missing Plan readback also requires a successful empty exact app-owned `external_id` lookup. Retained pairs require
their earlier confirmed association. These bounded reads neither enumerate the account history nor authorize upsert,
discovery, inspection or automatic repair to infer absence. Network/auth/access/quota failures, invalid bodies, stale
authority and contradictory catalog responses cannot satisfy cleanup.

Both absent means no DELETE and ordinary accepted/recovered worker completion with cleared active references, attempt,
lease, retries and delivery job, preserved history and safe projections. Plan present / Workout missing permits only
the verified remaining Plan's journaled cleanup. Plan missing / Workout present remains blocked without independently
readable owned association; cached ownership does not bypass completion, past-date or manual-move protection. A lost
DELETE response is not acknowledged just because DELETE returns 404: fresh scoped recovery must establish absence or
retain uncertainty. Read-only absence must still own its lease/current account at persistence; stale evidence cannot
quarantine a newer lease or erase its queue. Existing event cleanup still clears only matching completion protection
and triggers reconciliation. No recorded activity, unrelated provider copy, consent or setting is removed by this fix.
Protective completion/date readback is also read-only, not a late DELETE acknowledgement: it must retain current
authority and a live lease, match the current copy's exact identity, and preserve concurrently learned completion.
The transport, actual event-cleanup incident fixture, concurrent/recovery/persistence demo tests and strict MCP reads
are local evidence; production remediation and deployment need separate approval. Full details and verification are in
[Wahoo delivery](training-workspace.md#wahoo-plan-and-dated-workout-delivery-649).

An adapter must bind to the server-resolved owner/account, implement compatibility, horizon/deletion policy, execution,
inspection and accepted-artifact checkpoints. Garmin workout/schedule IDs and Wahoo Plan/Workout IDs remain distinct;
COROS keeps stable partner workout IDs and batches at most 30; Suunto delivers dated Guides, not native plan parity.
Inspection must establish acceptance or definitive nonacceptance before an uncertain create is repeated. It cannot run
against an auth/permission-blocked connection generation, and execution rechecks current admission after inspection.
New revisions never discard accepted IDs. Delivery history keeps failed withdrawals reachable after authored-source
deletion; recovery commands use the retained server-owned identity, never re-enrol a deleted source, and still enforce
the exact account and explicit-disconnect epoch. Pausing a provider hides new Send actions, not existing status/removal controls. Neither a
connected service nor a capability fixture grants readiness, scopes or user consent. No production setting selects the fake.

## 2. Choose the right architecture

Most activity providers should use the shared asynchronous ingestion pattern:

```text
Provider OAuth / webhook / history request
        -> authenticated Functions ingress
        -> idempotent Firestore queue item
        -> immediate Cloud Task dispatch
        -> scheduled dispatcher safety net
        -> guarded worker and event/original-file persistence
        -> dashboard, exports, and analysis
```

This is preferred over processing partner payloads directly in a webhook or callable because provider requests can be retried, payloads may be incomplete, original files may need another download, and processing can exceed partner timeouts.

Shared recorded-activity imports and manual reuploads reuse an existing event's stored activity document IDs and
source keys rather than adding legacy event/index IDs beside source-keyed reparse results. The shared
`functions/src/shared/import-preservation.ts` helper reads only that owner's event activities, with a field mask and
the existing 100-leg bound, inside the existing source-write reservation transaction before marking load pending.
Rejected identities leave the saved source, load metadata and cache untouched; matched IDs/keys are applied only
after the reservation commits, before original-file/source writes. Unique identity matching includes verified sport
refinements and reordered multisport legs; ambiguous or changed saved leg sets fail through the existing error/retry
path instead of guessing, appending or deleting rows.
The existing first-import marker still permits missing legs on an interrupted initial-write retry, subject to ID
collision checks. New imports retain their existing ID behavior; this is not a historical duplicate cleanup.
Guarded document transactions preserve live titles, descriptions, tags, privacy, notes, legacy feedback fields,
canonical Feeling/RPE stats (including cleared ratings), and custom device names. Parsed measurements and source-file
provenance keep their existing write behavior. Reparse shares the event-edit preservation policy.
Monitoring coverage is **unchanged**: the existing #829 provider/worker retry, failure and committed-outcome metrics
still cover these imports; no queue, schedule, lease, retry, metric label, alert, Rules or index changes are added.
Training formulas, source-write reservation/finalization, planning and MCP contracts remain unchanged. Existing Help
already promises retained activity names and saved load preferences; no frontend release or client refresh is needed.
Local tests do not authorize deployment, provider calls, replay or production data cleanup.

Provider health/wellness data uses the separate [unified health foundation](unified-health-data.md):

```text
Provider webhook / polling / history work
        -> provider-specific mapper
        -> shared runtime validation
        -> deletion-guarded revision replacement
        -> bounded source records and sample chunks
        -> shared direct/callable query projection
```

The shared Health writer may replace up to eight independent source records in one Firestore transaction so provider
workers can reuse the same deletion, credential, connection, and queue-revision reads. The transaction remains bounded
by the existing 4 MiB modeled write budget and a conservative 450-write ceiling. Duplicate source-record identities are
rejected before that transaction starts. The provider worker then splits duplicates, byte- or operation-heavy groups,
and record-specific failures in input order. Each retry/rebase attempt invokes exactly one atomic transaction and every
split transaction rechecks the full lifecycle authority, so a credential rotation cannot retry records committed by an
earlier split. Earlier valid records retain the same durable behavior as the original one-record writer.

Do not put wellness records into activity events or create a second provider-specific health schema. Keep the existing normalized Sleep model canonical and use the foundation's allowlisted Sleep references when a relationship is needed. COROS is the reference implementation for sharing one provider response between Sleep aggregates and Health daily/sample records without duplicating detailed samples. Suunto is the reference for keeping separately fetched 24/7 Activity/Recovery data distinct from workout FIT and Sleep while reusing a guarded queue worker. Garmin is the reference for accepting an unauthenticated availability ping, resolving unique provider accounts in bounded lookups, durably queueing compact UID-scoped batches of validated provider-hosted callbacks, dispatching newly created or replacement batch revisions immediately from a retryable Firestore trigger outside the acknowledgement path, and immediately dispatching their callback workers while retaining the scheduled dispatcher for recovery. Same-revision retry-state writes must leave retry timing to the existing Cloud Task backoff instead of creating a fresh task. Authenticated bounded pulls happen only in those workers. Large callback writes use digest-bound durable cursors and new queue revisions for timed handoff instead of rejecting a valid provider response or staging raw Health payloads in Firestore. When a documented timestamp-keyed feed returns complementary or corrected rows at the same timestamp without a provider revision, merge per metric in provider response order: a later non-null observation may replace an earlier value, but omission or a documented missing sentinel must not erase an available measurement.

For range-based Health pulls, route both decoded-response byte limits and sample-count limits into bounded adaptive subdivision. Suunto validates and incrementally combines duplicate/complementary raw rows before enforcing the normalized-sample cap, with separate byte and raw-row bounds. Each invocation completes one target window, reapplies provider-local-day context, and saves a lifecycle/queue-revision-fenced cursor only after all its records are durable. The same queue row then hands off a new revision at the learned window width; failures resume instead of restarting completed windows, and only the final window completes the parent job. Request, time, and result budgets still apply. Do not erase a local response-limit classification when sanitizing errors: retrying the same oversized response cannot make progress, even when the provider returns HTTP 200. See [Suunto Health bounds and recovery](suunto-integration.md) for this contract.

Add a provider-specific architecture document under `docs/` when the integration has meaningful protocol, data-flow, rollout, or operational detail. Link it from the Architecture Documentation section of `README.md`; Wahoo is the reference example.

Use the existing provider structure before inventing a parallel abstraction:

- `functions/src/<provider>/constants.ts` owns collection names, service name, endpoint-safe constants, and limits.
- `functions/src/<provider>/auth/` owns the adapter, API wrapper, OAuth callable wrappers, and token handling.
- `functions/src/<provider>/` owns webhook/history ingress, queue storage, processor, file download validation, and provider payload mapping when relevant.
- `functions/src/queue.ts`, `functions/src/tasks/`, and `functions/src/shared/queue-config.ts` provide shared dispatch and worker infrastructure.
- `shared/functions-manifest.ts` owns callable names and regions used by browser and Functions code.
- `shared/provider-presentation.ts` owns display labels, branding variants, and icon keys.

### Connection lifecycle module ownership

`functions/src/service-connection-meta.ts` is the compatibility facade used by OAuth callbacks,
scheduled repairs, and existing connection readers. `service-connection-lifecycle.ts` owns guarded
connection transitions, Health lifecycle projections, provider-neutral route restoration, and
pending-disconnect queue-release repair. Wahoo recovery fields, opaque-refresh failure tracking,
reconnect queue release, and durable retry handling live in `wahoo/connection-recovery.ts`.
The facade supplies Wahoo's connected-state fields to the same guarded connection transaction
and invokes its continuation only after that write succeeds; clear-state recovery fields also
remain in the existing transaction. Wahoo recovery calls generic restoration, while the generic
lifecycle does not import Wahoo recovery or its queue-release implementation. This separation
preserves the persisted fields, guards, repair schedules, and restoration/release ordering. Connection-history
acceptance follows the same boundary: the facade forwards its server-only history context, and the lifecycle
owner atomically stages the private run and safe connection projection after validating OAuth/credential
and deletion guards. Wahoo recovery continues only after that transaction succeeds.

### Stripe billing provider boundary

Stripe is an infrastructure provider rather than a user-connected activity source. Ownership transfers explicitly from the installed Invertase extension to repository-owned handlers through `configuration/stripeBilling`; dormant replacements never process extension-owned billing. See [Stripe billing](stripe-billing.md) for the authoritative architecture, contracts, local testing, monitoring and staged cutover/recovery procedure. Custom Functions use Stripe Node `22.4.0` with API `2026-07-29.dahlia`; integration changes must regression-test the custom claims, subscription lifecycle, email, cleanup, price-maintenance, and renewal-amount paths while leaving extension configuration unchanged unless a separate migration explicitly requires it.

Privileged admin billing mutations use a dedicated `STRIPE_ADMIN_BILLING_KEY` restricted to subscription read/write access and bound only to `previewAdminSubscriptionGift` and `grantAdminSubscriptionGift`. The general `STRIPE_SECRET_KEY` remains isolated from that workflow. Subscription-time gifts use an absolute future `trial_end` with no proration, preserve price items, tax configuration, metadata unrelated to the gift, and `cancel_at_period_end`, and rely on the currently selected billing webhook processor to synchronize the result. Reject Subscription Schedules, billing schedules, pending billing updates, and flexible-billing subscriptions instead of competing with future Stripe state. Validate monthly Basic, annual Pro, existing-trial, and scheduled-cancellation cases with Stripe sandbox subscriptions and test clocks before requesting any live rollout.

## 3. Foundation and shared contracts

Wahoo Training completion can use the API Workout/Plan/token association or a Sports Lib 21.4.0 file-scoped app FIT
reference. The latter requires one session, one matching persisted activity, trusted event source metadata, current
account/generation authority, and exactly one accepted owned single-workout Plan with its deterministic app identity.
A missing scheduled Workout ID must remain null; a new saved recording ID is not a substitute. Retained identifiers
stay in private event completion evidence and never enter event/activity JSON, metrics or MCP projections. Duplicate
Plans, stale occurrences and second recordings do not authorize a new link. Neither path infers interval adherence.

Complete these shared changes early. Exhaustive unions and switch statements are deliberate: they force every cross-cutting surface to acknowledge the provider.

1. Add the provider to `ServiceNames` and provider metadata in `@sports-alliance/sports-lib` when the provider is part of the shared contract.
2. Publish the required sports-lib version before making the application depend on it. Do not leave an application lockfile pointing at an unpublished package version.
3. Add provider labels, source/destination branding, and icon keys to `shared/provider-presentation.ts`. Use source attribution for imported data and destination branding for connection or sending surfaces.
4. Add Function names and the correct region to `shared/functions-manifest.ts`; export every deployed entry point from
   `functions/src/full-entrypoint.ts`. Add a direct owner-module loader in `functions/src/function-target-loader.ts`
   and verify its benchmark, discovery, metadata, rollout, and rollback process as described in
   [Firebase Functions target-aware entrypoint loading](functions-entrypoint-loading.md).
5. Add the environment configuration in `functions/src/config.ts`. Match established providers by requiring credentials when the integration runs; add a feature gate only when an explicitly approved staged rollout or operational requirement needs one. Update the configuration table in `README.md` with names only—never values, secrets, or production URLs.
6. Add approved SVG assets and register them through the existing icon/presentation path. Confirm partner brand requirements before release.
7. Add or update Firestore indexes, Rules, Storage Rules, TTL policies, and Firebase configuration only when the provider data model needs them.
8. For health/wellness support, add provider metric mappings to the unified health writer rather than expanding the stable catalog with provider field names. Record native semantics, coverage, quality, and revision behavior explicitly.
9. Validate field semantics against the provider's published examples, including signed event values and inclusive sample endpoints. Cap or compact provider arrays against the shared metric and sample write budgets before handing a normalized record to the writer; do not let a provider-valid payload fail only at the generic persistence boundary.

### QS-calculated Garmin sleep heart rate

Missing Garmin sleep HR can be resolved read-only from same-owner/account Daily 15-second HR samples, with complete
revision-checked reads, at least 90% coverage and no gap over five minutes. Native values take precedence; QS-calculated
averages and lowest representative values keep distinct semantics/baselines. No provider request, Sleep rewrite,
reimport, OAuth scope or ingestion-queue change is involved. Current readiness/daily-report MCP use additionally
requires Health and Sleep grants; ordinary Sleep and legacy readiness remain native. Sampled Daily content changes
target the existing readiness invalidation. Health/Sleep ingestion monitoring is **unchanged**; no additional derived-alert coverage is claimed.
See [Garmin Health](garmin-integration.md#nightly-hrv-in-sleep-and-reports) and
[Readiness today](training-workspace.md#readiness-today) for bounds, attribution, compatibility and release order.

### Nightly HRV across Sleep and Health

A provider may deliver nightly HRV inside Sleep (Suunto/COROS) or as a separate Health summary (Garmin).
`shared/sleep.ts` owns the provider-independent display-date, effective-onset, account/night identity, and bounded
fragment-partition rules used by Dashboard, Health, Training, and MCP derived Sleep/report reads.
`shared/nightly-hrv.ts` owns the separate HRV enrichment and weighted evidence aggregation rules.
The display-date resolver derives a missing date only from a validated wake instant and rejects an explicitly malformed
date. Live/current consumers also reject impossible session timestamps before accepting date or physiology evidence.
Preserve native normalized Sleep HRV. When absent, match canonical Health HRV by owner, provider, opaque account
identity, provider calendar date, and overlapping sleep interval. The Health account identity is SHA-256 of the
JSON-framed `healthAccountIdentityParts`; Sleep must retain the same provider account ID used by the Health writer.
Unidentified legacy accounts are not guessed. Native records and existing canonical Sports Lib records work without
reimport or a Sleep rewrite. Only missing main nights are supplemented, once across fragments; late delivery,
corrections, and removal are reflected at read time.

If a provider can finalize one physical night as multiple records, keep every provider record and stable ID for audit,
then define a provider-specific read-time reconciliation rule. Suunto records for the same provider account and wake
date are one canonical night only when they overlap or the gap is at most 30 minutes. Sum sleep duration and stage
durations, preserve the interruption as awake time, take the latest score, and weight average HRV by positive recorded
sample counts. Never use a plain mean or the last fragment; when fragment values differ, incomplete weights make the
canonical HRV unavailable. A larger gap remains a separate sleep, even on the same displayed date. Presentation and derived
reads consume that canonical night; raw storage, exact provider IDs, and the MCP session-list audit surface remain
unmerged. Keep the reconciliation in-memory and bounded by the existing query, with no extra provider or Firestore read.

New providers should use an approved canonical overnight-average semantic from `HRV_PERSONAL_RANGE_VARIANTS`,
`average` aggregation, milliseconds, and recorded/provider-summary origin with device/provider-calculated recording
method. Register a new semantic only after establishing its meaning and testing it. Spot checks, activity intervals,
five-minute maxima, manual readings, unknown semantics, and conflicting summaries cannot fill nightly Sleep HRV.
Do not substitute daily/resting heart rate for overnight heart rate. Raw Health/Sleep samples remain separate.

Health reads reuse the existing metric/date/document-ID index and bounded owner Rules (32 records per page plus
look-ahead, 2,048 records and 16 MiB total). Backend pages recheck owner/deletion state before and after reads.
MCP supplementation requires both Health and Sleep grants; raw provider/account identities never enter its projection.
Frontend pages stay subscribed so Health changes update an open dashboard; failed supplemental reads retain native
Sleep evidence. HRV Health mutations invalidate the Training readiness and build-comparison snapshots. See
[Training workspace](training-workspace.md) for baseline comparability and targeted version transitions.
Include native-only, separate-summary, arrival-order, correction/deletion, exact-account, conflicting-source, legacy,
and bounded-read cases in every provider's integration tests. There is no provider-name branch in the resolver.

## 4. OAuth and provider identity

OAuth is a server-owned integration. The browser starts and completes the user experience, but it must never receive client secrets, access tokens, refresh tokens, or raw provider account mappings.

### Required flow

1. The frontend asks the authenticated callable for an authorization redirect URI.
2. The backend creates signed state that binds the request to the Firebase user and redirect URI.
3. The provider redirects back with either a code or an explicit authorization error. Handle both; do not report a successful connection when access was denied or state/code is incomplete.
4. The backend exchanges the code, fetches the stable provider user identity, verifies entitlement and feature state, and stores credentials only in a server-owned token tree.
5. After the credential write and guarded connected-state promotion both succeed, the callable returns the minimal `{ connected: true, outcome: 'connected' }` completion receipt. A recovery flow returns `disconnect_recovery_completed` only after local removal is proven, or `disconnect_recovery_pending` when cleanup is partial or retryable. Do not return tokens, provider account IDs, OAuth state, or lifecycle generations, and do not let a missing or legacy empty response drive a success message.
6. The browser shows success only for that exact connected receipt. Provider denial, missing state/code, exchange failure, lifecycle races, and unknown completion responses remain visible failures. The browser reads a safe connection-state projection only; it should display connected, reconnect-required, or disconnect-pending status without exposing credentials. A stable provider account ID may be included for display, but tokens and refresh credentials must never be projected.

The expiry requirement needs a staged Functions rollout because authorization attempts created by the previous backend have no trustworthy creation or expiry timestamp. Do not add a permissive callback fallback for those rows. Deploy in this order:

1. Deploy only `getGarminAPIAuthRequestTokenRedirectURI`, `getSuuntoAPIAuthRequestTokenRedirectURI`, `getCOROSAPIAuthRequestTokenRedirectURI`, and `getWahooAPIAuthRequestTokenRedirectURI`. These authorization-start callables write the new server-owned expiry while the previous callback revisions continue accepting attempts already in flight.
2. Start the drain clock only after all four deployments complete and serve traffic. Wait at least 70 minutes: the one-hour `OAUTH_FLOW_TTL_MS` window plus a ten-minute propagation and drain margin. A user who returns from an older authorization after that point must restart the connection.
3. Deploy the remaining Functions, including the four strict `requestAndSet*AccessToken` callback callables and `retryPendingServiceDisconnects`.
4. Deploy the frontend that requires the completion receipt last. Older frontends safely ignore the additive result, while the new frontend deliberately rejects the former empty response.

This sequence ensures every callback that can still be valid was created by a start callable that wrote `oauthFlowExpiresAt`; missing or malformed expiry remains a hard failure before provider exchange.

### Identity rules

- Prefer a stable provider user ID over a display name, email, or mutable device identifier.
- When the provider documents stable identity inside a token returned directly by its authenticated OAuth exchange, normalize the documented claim before persisting credentials. If a legacy top-level response field is also present, require both identities to agree, and require refresh identity to match the retained account before updating either the credential or any server-owned authority binding.
- If one provider account may belong to only one Quantified Self account, use the shared duplicate-token query and cleanup lifecycle unless the provider requires stronger atomic transfer semantics.
- If a provider account may intentionally be shared by multiple Quantified Self accounts, explicitly exempt that provider from cross-user duplicate cleanup and test both OAuth preservation and webhook fan-out for every notification type that uses that identity; Suunto Workout, Route, Sleep, and Health all follow this policy with UID-namespaced queue identities.
- If reconnect-required work is retained for one provider account, pin that provider identity in server-owned connection metadata. Reject an OAuth callback for a different account until the retained connection is explicitly disconnected, and require every inbound, history, and outbound consumer to resolve the same pinned credential rather than selecting an arbitrary token document.
- Assign a server-owned generation when an OAuth flow starts. Claim state and PKCE context once, then require that same flow generation when persisting the exchanged token. A newer authorization attempt and explicit disconnect must invalidate the generation before cleanup, ordering delayed callbacks so they cannot recreate a deleted connection.
- Give every new OAuth flow server-owned creation and expiry timestamps. The shared flow lifetime is one hour; authorization preparation and token exchange must reject expired context before publishing PKCE data or calling the provider. The existing pending-disconnect scheduler scans one bounded, document-ID-ordered page per provider and uses a durable cursor. After rechecking the exact flow generation, expiry, and user-deletion guard in a transaction, it scrubs expired `state` and `codeVerifier` secrets even when a token, pending-disconnect lifecycle, or explicit-disconnect fence must remain. In those owned roots it preserves OAuth creation/expiry metadata and every credential/disconnect generation, so cleanup cannot invalidate live lifecycle guards and a later scan does not repeat the secret write. It removes the remaining expired OAuth lifecycle fields or an expired explicit-disconnect fence only when no token, pending retry, or active disconnect owner remains. Empty provider roots are retained because legacy maintenance tooling can create a child without first generation-checking the root; document-only deletion could orphan that credential. Active flows, active leases, changed generations, and missing/deleting users are preserved.
- Treat legacy OAuth roots without server-owned expiry as report-only until an explicit migration policy is approved. Inspect aggregate counts with `npm --prefix functions run audit-service-oauth-roots -- --project=<firebase-project-id>`; the command requires and verifies the target project, is bounded and read-only, rejects unsupported or execution flags, and never emits user IDs or OAuth values. It exits unsuccessfully and reports `truncated: true` when the requested root cap leaves unaudited documents. This root audit cannot discover token subcollections whose parent document is missing; use the separately reviewed canonical-user repair approach below for that historical orphan case. Any production cleanup or deployment still requires separate approval.
- While an explicit disconnect lease remains active, OAuth start must return a retryable, user-visible `unavailable` response with bounded retry metadata, even after every token has been removed. Only an expired lease may be reclaimed by a new OAuth flow; this prevents an older operational cleanup from overlapping a replacement connection.
- Emit structured disconnect lifecycle transitions for lease claim, cleanup completion or failure, and finalization. Correlate transitions with a one-way digest of the random operation generation; never log the Firebase UID, provider account ID, token document ID, credential material, raw lifecycle generation, or provider error body.
- Prefer resolving webhook identity from indexed, server-only token documents when the stable provider ID is stored with the credential. Require exactly one structurally valid match and fail closed on ambiguity. Add a separate mapping only when token-index resolution is insufficient; if a mapping is transferable, verify current ownership before cleanup.
- Never mint server-owned webhook authority from a token or mapping document that the browser can create or mutate. Lock the complete credential root and child subtree before enabling the authority writer. Legacy candidates must prove their stable identity through the provider, and durable bindings must record recognized server authorization provenance; reject and remove provenance-less bindings instead of trusting local shape alone.
- Discover ordinary legacy authority candidates through the canonical server-owned provider root. Use stable keyset pagination rather than numeric offsets, bound both roots and retained children per invocation, record sweep age, and keep failed-candidate backoff independent from the main cursor so one hostile or permanently invalid row cannot starve the migration. Before relying on that sweep, account for Firestore's child-without-parent behavior: if historical writes could leave a token child below a missing provider root, use a bounded one-time repair that pages canonical `users/{uid}` roots and directly reads that provider's exact child path. Never use a broad cross-provider collection-group scan to mint authority. Provider-verify each candidate and commit the recreated root, lifecycle generations, binding, and resumable repair marker in one credential-fenced transaction.
- Recheck connection, pinned provider identity, connection generation, entitlement, deletion, and queue ownership immediately before event persistence. If a provider supports mutable revisions, keep the active processing lease while recording a newer revision so two workers cannot interleave non-atomic event/activity writes. Make the lease longer than the worker runtime, recheck it immediately before persistence, and let the newer revision become dispatchable when the current worker completes. Stage original files outside user-readable paths until all deletion-guarded Firestore writes succeed.
- Treat provider-derived retry, verification, and maintenance metadata as background writes too. After provider I/O, recheck the shared account-deletion guard inside the same transaction as every metadata update; a pre-request check cannot authorize a post-request write during recursive cleanup.
- Use the shared `getServiceAdapter()` factory and `ServiceAuthAdapter` lifecycle. Do not create a provider-specific token refresh path that bypasses shared deauthorization, cleanup, or safe metadata behavior.
- Refresh access tokens only when a provider request needs one, persist rotation safely, and never log token values or signed authorization URLs. The shared `getTokenData()` path takes a transaction-backed lease on the token document before calling a provider refresh endpoint; bound that HTTP request below the lease duration. The lease owner may persist only if the credential snapshot and server-issued credential generation still match and the account-deletion guard remains active; a contender re-reads a winning refresh or retries later, and an expired lease is reclaimable after a crash. OAuth reconnect, disconnect, duplicate-account cleanup, and account deletion must replace, remove, or reject that snapshot atomically so an older worker cannot restore stale credentials.
- Give every connected, reconnect-required, and disconnect-pending transition a new opaque connection-state generation. Terminal credential cleanup must prove the expected generation and absence of a replacement credential in the same transaction that writes reconnect-required state; any later route-disable write must require that same generation and state. This prevents a stale refresh failure from overwriting a successful OAuth callback or disabling routes after reconnection.
- Keep a queue task's OAuth credential generation and connection-state generation immutable from its first lifecycle capture. Ordinary token refresh may update credential timestamps only inside that generation; never rebase old work onto a replacement OAuth snapshot. When token children can outlive a deleted parent document, require the original server-owned token-root generation in every downstream write transaction and deny direct browser creation, update, and deletion of that root.
- When credential generations are introduced after connections already exist, document and test the rollout boundary explicitly. A compatibility path may treat an existing root and child that both omit the generation as one legacy credential, but it must still reject a missing root, a generation on only one side, and unequal generations. Do not perform a blind credential migration or require reconnect when the existing pair can be safely fenced by this exact matching-absence rule.
- When authoritative connection metadata is mirrored into a separate product status such as unified Health, commit a generation-keyed repair marker in the authoritative transition. Require the exact marker claim as part of the derived-write guard, retry it from a bounded scheduler, and clear only that claim after success. A disconnect must transactionally supersede any pending claim while proving the credential root remains absent so an in-flight or delayed connected projection cannot restore stale status; logging and swallowing a partial projection is not a recovery mechanism.
- Keep any provider-specific refresh-failure exception narrow, centralized, and temporary. The current Suunto `400 invalid_grant` exception preserves credentials and retries because Suunto confirmed a provider outage; remove that exception and restore terminal-auth cleanup once Suunto confirms the incident is fixed.

### Security checklist

- Callable Functions require authenticated users, App Check where the shared callable pattern applies, feature gating, and the correct plan check.
- Admin callables use `onAdminCall`; do not make queue or credential controls client-writable.
- Validate redirect URIs from server-generated state, not arbitrary browser input.
- Store OAuth errors in user-safe form and redact tokens, signatures, query strings, and authorization headers from logs and queue error fields.

## 5. Firestore model, Rules, and ownership

Separate state by trust boundary.

| State                            | Typical location                            | Browser access                                                     |
| -------------------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| OAuth access/refresh tokens      | Provider token root and token subcollection | Never readable or writable                                         |
| Optional provider-to-Firebase mapping | Server-owned top-level collection when token-index lookup is insufficient | Never readable or writable                              |
| Safe connection status           | `users/{uid}/meta/<Provider>`               | Owner may read the limited projection; client does not write it    |
| Queue and failed jobs            | Server-owned queue and DLQ collections      | No client writes; admin read only where the Rules model permits it |
| Imported event and original file | Existing event/file model                   | Follow the established event and Storage access model              |
| Imported health source record    | `users/{uid}/healthSourceRecords`            | Owner bounded read; server writes only                              |
| High-resolution health samples  | `users/{uid}/healthSampleChunks`             | Owner bounded read; server writes only                              |
| Safe health sync status         | `users/{uid}/healthSyncState`                | Owner bounded read; server writes only                              |

For every new persistent write path:

- Use the shared Firestore write sanitizer for event/activity documents. Never persist `streams` or top-level `activities` in an event document.
- Validate external payloads defensively. Treat every field as optional or untrusted until normalized.
- Keep provider credentials and signed download URLs out of safe metadata, events, error text, analytics, logs, and admin responses.
- Move user-scoped queue items to a DLQ only in a transaction that rechecks account deletion and the exact live queue revision; otherwise account cleanup or a newer queue payload can be resurrected by an in-flight worker.
- Add Firestore Rules tests proving browser denial for token roots, optional mappings, queues, and backend-owned connection fields, plus owner read access for the safe projection.
- Add indexes deliberately for scheduled scans, queue status, pending disconnect retries, and history leases. Check the emulator and deployed index requirements before launch.
- Use the shared health writer's deterministic opaque provider-account ID, source-record ID, account-scoped source-key hash, and hashed revision token. Never persist the raw provider account ID, raw provider record key or revision token, free-form provider error, or raw provider payload in the unified health collections.
- Let the shared Health writer maintain `maxObservedRevisionOrder` separately from the content revision copied to sample chunks. An identical higher-order delivery advances only that source-record watermark; delayed distinct content below it remains stale, while source/chunk revision identity stays aligned.
- Keep health sample documents and reads strictly bounded. Time-based retention is intentionally uncapped until product/privacy policy explicitly changes it; do not add ad hoc TTL in a provider adapter.

## 6. Ingestion: webhooks, history, and idempotent queues

### Webhooks

Garmin's Health/Sleep, Activity Files, deregistration and permission callbacks share a dedicated Secret Manager
credential in the exact `/<secret>/API` URL suffix. `GARMINAPI_WEBHOOK_SECRET` contains only a plain 64-character
lowercase hexadecimal value; JSON configuration is rejected. Verify it before any payload/account/queue work.
Deployment of #800 closes the legacy bare URLs, with no cutoff timestamp or compatibility switch. Update and verify
the portal URLs before deploying the receivers. The initial rollout accepts protected and exact bare paths with
the same plain secret while the portal is migrated; it has no timed cutoff. If a JSON secret was already provisioned,
replace it with the same underlying secret as a plain value through the approved workflow before deployment. See
[Garmin production configuration](garmin-integration.md#production-configuration) for endpoint mapping, migration
prerequisites, proof requirements and secret handling. The public client-ID header is not authentication.

- Verify the provider's documented authentication or shared secret before accepting work. Reject malformed and unrelated payloads before queueing. Reject unknown, disconnected, deletion-pending, and non-entitled identities before direct queueing. When a strict acknowledgement deadline requires durable asynchronous fan-out, first bind the request through a bounded indexed server-owned identity lookup and recheck lifecycle state in the ingress transaction; do not retain ingress for unknown or ineligible identities. Unless the integration enforces provider-account uniqueness, retain every eligible match as independent durable work rather than selecting the first owner. Recheck each binding and lifecycle again in the retryable worker before fan-out.
- Resolve provider identity through server-owned credentials or a server-owned direct mapping, never browser-visible metadata. A direct mapping should use a one-way provider-identity key, be updated atomically with credential ownership, and be removed on disconnect and deletion. Do not use a globally limited credential query as webhook authority: unrelated client-writable token documents can consume the limit before structural filtering.
- Treat access/refresh-token rotation within the same credential generation separately from authority replacement. A worker may rebase a failed write guard only after atomically recapturing the live credential and proving that the provider binding, credential generation, root lifecycle, connection generation, and deletion state are unchanged; bound the rebase attempts and leave repeated rotation retryable.
- Revalidate the server-owned identity binding in any worker that maps an embedded webhook payload. This prevents already queued work from retaining authority after a binding is revoked, replaced, or rejected during a provenance migration.
- When terminal payload validation happens after lifecycle authority is captured, write the provider's failed sync state through that exact lifecycle guard before moving the queue revision to the DLQ. If the guard no longer matches, skip the stale work instead of overwriting newer connection state.
- Treat webhook delivery as at-least-once. Duplicate, delayed, and out-of-order deliveries must not create duplicate events.
- A signed route-update notification proves provider origin, not that an arbitrary direct-export ID is still present in the connected account's route library. Before exporting or persisting webhook-driven route work, confirm the exact route ID through the current account-scoped route listing. If that account listing failed, retry rather than treating absence as authoritative; if the listing succeeded and the ID is absent, skip the notification. After export, compare the provider file with the previously retained original and preserve the existing content revision when the content is unchanged, even if the provider supplied a newer modification timestamp. Keep exact bytes as a fast path, but account for volatile revision fields embedded inside the export: Suunto comparison ignores only numeric `modified` and `revision` values at the documented namespace-qualified GPX metadata path, retaining all other content and the untouched original. Malformed or unrecognized files cannot prove equality. This prevents timestamp-only notifications from rewriting the route or redelivering it to downstream partners while still allowing missing destinations to reconcile against the last real revision. See [Suunto route comparison and rollout](suunto-integration.md#provider-contract) for the worker-only release and rollback.
- Match the provider's acknowledgement contract exactly. For providers that retry every non-`2xx`, acknowledge authenticated malformed, oversized, unknown, disconnected, deleting, or otherwise permanently skipped deliveries with `2xx`; retry cannot repair them and repeated failures may trip a provider-wide circuit breaker. Authentication failures still fail closed. Reserve retryable `5xx` for a failed identity lookup or durable ingress/dispatch preparation so the provider retries. Keep health-check behavior separate from authenticated delivery handling.
- For strict acknowledgement deadlines, keep the synchronous path to a bounded direct identity lookup plus one idempotent ingress transaction, acknowledge only after the durable create or a deliberate no-write permanent skip, and move queue or Cloud Tasks fan-out to a retryable datastore trigger. Any mapping used as identity authority must already be server-write-only. Deploy Rules, mapping writers/backfill, and the consumer before the producer. Never rely on non-awaited work after returning the response.
- A stable ingress ID deduplicates provider retries but does not identify a Firestore document incarnation across disconnect/reconnect. Bind every asynchronous completion and discard to the original create/update version so a stale trigger cannot mutate a same-ID ingress recreated under a newer lifecycle.
- If provider revisions exist, persist a revision timestamp or version. A newer revision should safely supersede an older queued one; an older delivery must not reopen or overwrite newer work.
- Return quickly. Queue a compact, validated work reference rather than doing file download, parsing, or event persistence in the webhook handler.
- Protect integer-shaped provider IDs before JSON parsing when the API can emit 64-bit numbers. Normalize them to bounded decimal strings and test values above JavaScript's safe-integer limit.

### History imports

Derived refreshes automatically use a five-minute fixed build interval while an existing history checkpoint is active
and recent. No per-account allowlist or environment activation is required. Provider admission, pacing, callbacks, child coverage, retries and lifecycle
checks keep their existing semantics. The existing terminal history-write trigger can expedite pending derived work,
with owner/run-revision/deletion rechecks and retryable enqueue failure; late child/source writes still invalidate
normally. A private per-run completion receipt prevents duplicate or superseded terminal events from advancing later
work; enqueue recovery retains the exact original generation and retry budget. The receipt stays out of public history
projections and uses existing run retention/cleanup. See [Training scheduling](training-workspace.md#import-specific-five-minute-batching) for the scheduling policy,
bounded metadata reads, completion/race tests, monitoring deployment workflow and rollback. This adds no provider request,
Function, queue, index, secret, public MCP field or new history import action.

Manual Suunto/COROS/Wahoo activity imports from updated clients now reuse the existing coordinator through the additive
`background: true` option on their current callables. Admission atomically binds the existing account and credential/
connection generations, exact custom dates, activity-only capability, reservation and owner-safe progress. Older
clients and unversioned legacy connections retain the previous call path. Automatic history, Garmin manual
history, and manual Sleep/Health/routes keep their scope. No provider call happens during background admission;
the existing bounded child path and committed outcomes control continuation. Suunto/COROS retain their 60-second
dispatch spread; Wahoo uses one 100-workout page per step, its existing deferred dispatch and exact date filtering.
Wahoo's no-FIT/third-party exclusions and pinned-account checks before/after each page and inside queue writes remain.
Existing progress/Retry UI and #847/#829 monitoring cover both starts. See
[manual history admission](connection-history-import.md#manual-activity-imports-suunto-coros-and-wahoo)
for compatibility, precision, lifecycle/overlap guards, backend-first rollout and rollback boundary. After the shared
manual coordinator support is deployed, Wahoo adds only `addWahooAPIHistoryToQueue` plus the frontend release.
No new Function, queue, secret, index, Rules, MCP or Training contract is introduced.

Suunto/COROS coordinator-owned activity batches use the existing guarded workout dispatcher after durable
admission, restricted to at most 100 exact children of that run/account/owner, spread over 60 seconds. Capacity,
revision/deletion guards and scheduled recovery remain; completed, issued, retrying, leased and parked work is not
reopened. The coordinator still waits for its children before admitting the next window. Legacy manual bulk activity history
and scheduled recovery keep their 15-minute spread; Wahoo and Garmin retain their existing dispatch paths.
Reserved-name recovery verifies explicit queue revisions for Suunto as well as COROS; fallback diagnostic failures
cannot invalidate admission or interrupt other started enqueues. Monitoring is
**covered/unchanged** by #829's native queue, committed outcomes and scheduled eligible-backlog/recovery signals and
#847's coordinator observations; prompt fallback warnings do not claim ingestion or scheduled-dispatch failure.
See [coordination and recovery](connection-history-import.md#coordination-persistence-and-retries) for the backend-only
release/rollback boundary. Help, MCP/Assistant and Training contracts are unchanged.

Connection-history Sleep/Health children dispatch through the existing immediate, revision-bound queue path after
durable admission. The single-dispatch coordinator retains bounded batches, capacity checks and minute-long child waits;
manual bulk backfills, Garmin Health pacing and the half-hour recovery scan are unchanged. Existing children are never
reset or replayed to obtain faster dispatch. The Admin card distinguishes oldest **import age** from task delay and
counts retained finished coordinators, not ingested records; unavailable metrics are not zero. See
[coordination and recovery](connection-history-import.md#coordination-persistence-and-retries) for exact failure,
monitoring and separately approved backend/frontend release boundaries. Coverage remains **covered/unchanged** under
#847 and #830; no new monitoring resource, provider scope, MCP or Training contract is introduced.

Health/Sleep request boundaries are provider-specific and shared through
`getHealthBackfillStartMs` in `shared/sleep-backfill.ts`: Garmin requests the latest
rolling five calendar years, Suunto requests from January 1, 2000, and COROS retains
its documented rolling three calendar months. Calendar subtraction clamps month-end
and leap-day boundaries in UTC; Garmin admission rounds the start upward to whole
seconds. These policies do not guarantee historical coverage. Preserve stricter
provider-returned minima, per-request windows, pacing, cooldowns, and lifecycle/deletion
guards. UI and operator scripts must use the same helper, not a shared fixed year.
The Suunto callable caps admission at 512 windows and four concurrent queue writes,
waits for started writes before reporting failure, and leaves provider requests to
the existing workers. The operator CLI retains its smaller job/user/backpressure caps.
Before publishing initial Garmin progress, its reservation transaction rechecks live
and failed queue rows so a stale preview cannot reset or recreate already-submitted work.
Activity history is separate from this Health/Sleep policy. Garmin and Suunto activity-history
pickers default to the latest two calendar years through today. COROS defaults to its full
rolling three-month provider limit. Wahoo defaults to the latest two years, or a narrower
provider limit when one is supplied. COROS month-end minima clamp to the last valid day
of the earlier month, matching the default selection and server policy. Users can select a longer or shorter range before
submission, subject to each provider's available-history limit. Garmin still starts its
30-day activity-history cooldown after an accepted request. Keep the selected dates visible
in confirmation and status state. Status and deadline refreshes also refresh the picker's
current-day maximum. The same timer also refreshes at local midnight, including idle dialogs,
so open pickers stay current without changing the selected range or producing haptic feedback.
Date controls also validate the current calendar bounds in the form model before admission, so a delayed
midnight timer or template update cannot submit a range outside the refreshed provider limit. Keep the
selected dates and show a field error so the user can adjust the range before trying again.
Stored activity-history metadata describes the last request and its next-available date.
Show this as **History import cooldown**; the metadata remains after queued processing completes.
Retained Garmin acknowledgements state that the request was accepted without renewing a delivery-time promise on reopen.
Import controls also refresh on account access updates and Pro grace-period expiry using the same background timer.
Recheck access when an action is clicked because background timers may be delayed. Access changes must preserve
already dispatched requests and their retained results.

- Use the same queue format and processor as webhooks. Separate processing paths drift and create inconsistent duplicate or cleanup behavior.
- Require the appropriate entitlement and connection state at request time, then re-check in the worker.
- Use a per-user lease so duplicate browser clicks, tabs, or retried callables cannot run overlapping history scans.
- Reflect an active activity-history request in the frontend using existing owner-readable server metadata. Garmin and Wahoo use the finite future `historyImportLeaseExpiresAt` value to show **Import already running** and block another submission across dialog reopenings. Clear that state when the lease is removed or expires, then apply the normal cooldown. Keep the server lease authoritative: metadata is only a display hint. Treat Garmin/Wahoo callable `already-exists` contention as a normal wait status without a false success, error haptic, or frontend error report; preserve unexpected failure logging even after the dialog closes. Late completions must not update a destroyed dialog.
- The shared History import tool also reserves an in-memory request synchronously, scoped to authenticated UID, provider, and activity versus Sleep/Health domain. It retains pending, accepted, cooldown, and failure state across dialog reopenings within the same running app. Accepted activity ranges stay attached to their response rather than to a reopened form's default dates. Activity dispatch starts in the accepted action's turn without a render-delay timer, so closing immediately after the click does not discard the request. A request cancelled before dispatch releases its reservation; once dispatched, closing the dialog keeps the reservation until the response arrives. Account/provider context changes and teardown suppress stale snackbar, output, change-detection and haptic callbacks while shared results remain scoped to their original key. This frontend guard does not replace server admission protection across tabs, reloads or other clients.
- History callable wrappers also capture the Firebase user object and UID, including the originating UI UID when supplied. The existing local `AppFunctionsService` cancellation check runs before and after App Check readiness, including its refresh retry, so a delayed request cannot switch owners before transmission. Dialog closure alone does not cancel this account-bound dispatch. Local cancellation releases the reservation without error feedback; nothing extra is serialized into the callable payload.
- Automatic connection-history retries additionally bind dispatch and feedback to the displayed run and provider. Teardown or replacement cancels dispatch that has not started and suppresses stale completion feedback; a replacement run can retry independently. Automatic Sleep/Health token-read and queue-admission failures preserve their original retry/authorization metadata for the coordinator, retaining the claimed reservation and cooldown. Manual callable error mapping and cooldown recovery keep their existing behavior. These fixes retain existing queue monitoring definitions; coordinator-specific coverage remains tracked in [#847](https://github.com/jimmykane/quantified-self/issues/847).
- Cooldown timers enable admission at the exact deadline, matching server comparisons. Cooldown, processing-estimate and running-import timers wait outside Angular's zone so they do not keep the app unstable; their expiry callbacks re-enter Angular to refresh the controls and status. Garmin/Wahoo contention also survives dialog reopening with a five-second local retry buffer while server metadata catches up; an active server lease continues to block after that buffer. This buffer does not assert a server lease or extend the provider cooldown. Activity processing estimates stay anchored to acceptance and refresh to an elapsed-estimate message without asserting completion. Retained Sleep/Health confirmations use the accepted response's separate queue counts to describe its scope; a later availability check governs a new request without relabelling already accepted Health work.
- Sleep/Health admission in the tool requires a server-confirmed first sync-state emission, including a confirmed absent document. The existing Firestore adapter's `waitForServer` option filters cached snapshots and pending local writes for this listener; other Sleep consumers retain their default cache behavior. A ten-second first-read timeout runs outside Angular, keeps admission locked on failure, and exposes a status-check retry without timing out the ongoing listener after confirmation. Read errors and retries retain a previously known cooldown until a successful replacement snapshot. Exact existing activity `permission-denied` / Sleep `resource-exhausted` cooldown messages with valid ISO timestamps become normal wait states, retained across reopenings and refreshed at expiry. Activity parsing covers both `History import is not allowed until` and Garmin's `History import cannot happen before` contract. Accepted activity confirmations also show the next-available date, preserving the deadline when reopened later. Other permission/rate-limit errors and malformed timestamps remain reportable failures. Accepted requests get selection feedback; current-view success/failure gets completion feedback, with no error haptic or frontend Sentry report for expected waits.
- Monitoring impact for this frontend history feedback change: **unchanged**. Reviewed `tools/import-monitoring/definitions.mjs` and the [recorded import runbook](activity-import-monitoring.md), plus `tools/health-sleep-monitoring/definitions.mjs` and the [Health/Sleep runbook](sleep-sync-operations.md#cloud-monitoring-830). Their fixed provider filters cover the same existing queues; committed outcomes, dead letters, bounded observations, dispatch failures and unknown telemetry are unaffected. Health/Sleep failure policies already exclude expected contention and native HTTP attempts remain diagnostic. Browser cooldown presentation changes no worker, dispatcher, schedule, retry, lease, queue write, Rules, callable or stored contract. MCP/Assistant and Training have no impact. Release requires only the verified frontend through the normal separately approved Hosting workflow; no Functions deployment or data migration is required.
- Record enough cursor/range state to make failures observable without exposing provider data.
- For a multi-minute import, re-read and expiry-refresh the exact credential before every provider request while proving the original provider identity, credential generation, OAuth root generation, connection generation, and deletion state still own the work. Do not treat expiration of a token cached at worker startup as evidence that the user must reconnect.
- When any terminal path removes a durable cursor, mark only its matching observable progress state terminal in the same guarded transaction as the DLQ move. Apply the same guarded progress transition when rollout or lifecycle removal skips the cursor. Never leave progress running after its final queue row is gone or overwrite progress owned by a newer import.
- Confirm the partner pagination order. For descending history, include both selected date boundaries and stop only once records are older than the start boundary. Do not assume API ordering without tests.
- Confirm whether a provider range is made of calendar dates or instants and whether both ends are inclusive. Use one canonical representation end to end, split by the provider's maximum number of included dates, and make adjacent windows non-overlapping. Test timezone boundaries plus one-day, exact-limit, and limit-plus-one ranges.
- Do not assume a successful bounded range endpoint returns only requested dates. Some providers include a current-day summary with older requests. Keep response byte and item bounds, validate every returned row, and persist only records intersecting the original target; a valid extra day is not a retryable transport failure.
- Classify provider 429 responses separately and surface reset metadata where available. Do not convert rate limits into rapid retries.

### Queue item design

Queue IDs and imported event IDs must be stable across retries. Prefer provider identity plus stable provider activity/workout ID, with a secondary provider-user identity where collisions are possible.

Queue items generally need:

- Firebase UID and stable provider owner ID;
- provider activity/workout ID and revision/version;
- minimal processing data such as source URL or payload fields needed after the webhook ends;
- stable provider mode/submode, device, timezone, plan/workout, and multipart-component metadata needed for faithful attribution or later detail recovery;
- `processed`, `retryCount`, `dateCreated`, dispatch marker, result/error fields, and TTL expiry;
- lease owner, lease expiry, and revision claim fields where the provider can update the same activity.

Use a transaction for an upsert that can race with another webhook or history page. Claim a revision before processing it. When stable queue IDs allow history to replace an item, give every replacement a new opaque revision and include that revision in both the task identity and payload. Dispatch recovery, the post-enqueue marker, retry/DLQ transitions, deferral, and completion must atomically prove the stored revision still matches. Event persistence needs the same protection: claim a revision-bound lease transactionally, make replacement transactions preserve an active lease, keep competing workers retryable, and release the replacement as undispatched only after the older event/original-file/fan-out sequence ends. Set the lease beyond the worker timeout and verify an expired lease has a durable task retry/reclaim path. A stale task may acknowledge its own delivery, but it must leave the replacement pending for its own task. Reuse the shared workout-dispatch recovery and guarded queue-transition helpers rather than adding unguarded provider-specific writes. Cloud Tasks remains at-least-once, so event persistence and downstream fan-out must remain idempotent even with these lifecycle guards.

Treat a shared token-refresh lease owned by another worker as expected queue contention, not as a provider failure. Before acknowledging the current workout task, enqueue a distinct delayed recovery after the refresh lease can expire and bind its payload to the exact queue revision or legacy creation timestamp. Carry a monotonic recovery generation in the task payload and persist the next generation with the retained dispatch marker: retries of one task then deduplicate the same recovery, stale deliveries acknowledge without adding work, and a later recovery can advance to a new task name. Only after the enqueue is confirmed may the guarded transaction retain the non-null marker and generation; this prevents the scheduled dispatcher from producing an immediate duplicate. If either enqueue confirmation or the guarded marker write fails, fail the current task so Cloud Tasks retries it. Apply this contract to initial credential reads and provider-specific forced-refresh paths. Contention must not consume provider retry budget or produce warning-level noise.

Keep stable identity separate from transport data. A short-lived signed file URL must not be part of a new queue or event ID. When a provider offers a detail endpoint, retain the bounded stable request fields needed to recover a missing or expired URL, validate that the returned record/component matches the queue item, and persist only the refreshed queue URL under deletion and revision guards.

### Provider retry budgets

Recorded activity/route imports and delivery, Sleep/Health ingestion, Garmin Health backfill and connection-history
recovery use `PROVIDER_MAX_RETRY_COUNT = 20` and the matching `PROVIDER_CLOUD_TASK_RETRY_CONFIG`. The seven task
workers are `processWorkoutTask`, `processActivitySyncTask`, `processSleepSyncTask`, `processRouteSyncTask`,
`processRouteDeliverySyncTask`, `processGarminHealthBackfillTask` and `processConnectionHistoryTask`.
Internal derived calculations, normal/heavy/route reparses and date-sensitive Training delivery retain the default
ten-attempt policy. Training's application ledger limit remains `MAX_RETRY_COUNT = 10`; it does not inherit the
recorded-provider budget.

The existing 15-minute, 30-minute, one-hour, two-hour and then four-hour retry delays, concurrency, schedules, leases,
revision checks, lifecycle/deletion fences and terminal error classifications are unchanged. Twenty task attempts
include the first delivery and span approximately 64 hours before runtime/throttling delays, rather than approximately
24 hours for ten. The seven-day queue/send window still applies. Application counters and Cloud Tasks delivery counts
are independent: a delivery can fail before recording an application retry. Raising only one limit is insufficient,
and resetting an application counter does not reset a task's transport budget. No new retry loop, task identity,
counter reset, failed-job replay or retention extension is introduced. Accepted uploads retain their exact continuation
and status-only recovery; permanent rejection, revoked access, Stop and uncertain acceptance still stop as before.

Monitoring coverage decision: **covered/unchanged** after review of the #829 import, #830 Health/Sleep, #832 activity
delivery, #833 route and #847 connection-history source bundles/runbooks. Their existing worker/dispatcher, committed
retry/failure, new-DLQ/manual-review and unknown-observation filters cover the same paths. Short failure-rate alert
windows and heartbeat/backlog thresholds are not extended; exhausted-DLQ alerts naturally occur later. Normal backoff
remains excluded from actionable undispatched samples. No Cloud Monitoring metric, dashboard, alert resource or production
apply changes. The admin Queue Monitor uses the same provider retry limit for pending/stuck counts, including source and
Sleep-provider breakdowns. Its retry histogram adds a `10-19` bucket, with eight additional bounded aggregate count queries
per stats request and no new index shape. The shared response key is optional so older backend responses still render;
older clients ignore it until the admin chart is released. Existing Help describes automatic retries without a fixed
attempt/time promise and needs no wording change. MCP/Assistant schemas, consent, projections and Training behavior are
unchanged; no registered-app refresh is required.

Release requires separate approval for the seven workers above plus the four recorded-import recovery dispatchers
(`parseGarminAPIActivityQueue`, `parseSuuntoAppActivityQueue`, `parseCOROSAPIWorkoutQueue`, `parseWahooAPIWorkoutQueue`)
so their query budget matches the workers, plus `getQueueStats` for correct admin counts. Release the frontend separately
to display the new admin histogram bucket; this does not change sending or retry behavior. Read back each native queue's
limit/backoff after deployment. Live tasks are not reset, and already deleted tasks or terminal failed records are not
resurrected. Roll back the same endpoints to restore the previous limits; retained retries above the old limit may then
become terminal on their next failure.

### Outbound activity delivery

When a provider accepts activities, use the shared `activity-sync` route model rather than adding a provider-specific fan-out path. Define an explicit `source -> destination` route in `shared/activity-sync-routes.ts`, enable it only from Services, and route historical delivery through the existing date-range backfill callable.

The callable also accepts a version 2 `preview` or `send` request with destination, selected sources, inclusive ISO date bounds, and an opaque page cursor. It scans owner events in bounded pages and returns per-source eligible/skipped counts, queued count, skip reasons, failures, and the next cursor. The browser supplies filters only; the server selects event IDs, verifies Pro access, destination connection, route gate, source metadata or trusted manual-upload origin, retained original path/generation/size/FIT format, and existing successful or live queue state. Preview does not write. Send uses the same activity-sync queue, metadata, upload adapters, outbound echo receipts, and asynchronous reconciliation as automatic delivery. An unaccepted automatic queue row for the same route and event can be replaced transactionally with a historical row and a new task generation, so a disconnected source does not park the explicit send. Provider claims, accepted upload state, successful sends, existing historical sends, and manual-reconciliation rows cannot be replaced. Repeated sends skip those pending or completed rows. The older callable request remains available for compatibility.

`manualUpload` is a one-time source for Suunto, Wahoo, and COROS only, with distinct route IDs that have no automatic setting. New manual uploads receive a server-owned `metaData/manualUploadOrigin` marker; older uploads are accepted only if the original FIT bytes reproduce the upload endpoint's deterministic event ID. FIT.gz is decompressed within a 20 MiB output bound before upload. Merged and derived events, non-FIT files, changed generations, and missing originals are excluded. For saved provider imports, source connection state is not required at send time; destination lifecycle, Pro access, account deletion, rollout gate, and provider-side authorization still apply in the worker. A preview is an eligibility snapshot, not a promise of provider acceptance.

The historical-send dialog uses the app's Dayjs datepicker values throughout validation, preview identity and
request creation. Validate calendar dates rather than native `Date` instances or time-of-day ordering; missing,
invalid, reversed and future ranges remain blocked with field errors. Serialize the selected local dates as inclusive
start/end-of-day ISO instants, including DST transitions. Date input clears the previous preview immediately, without
waiting for blur. Any changed date or source, lost destination connection or lost Pro access requires a new eligible
preview before Send. Starting a repeat preview also clears the old result so pending or failed previews cannot enable
Send. Typing stays silent; a changed, valid calendar selection receives one haptic when the picker closes.
The shared date adapter parses localized calendar dates strictly, rejecting impossible dates instead of rolling them
into another month; it also accepts single-digit day/month input. Regression tests must enter dates through the real
Material controls, not only constructor defaults.
The datepicker audit also covers activity search, history import, Timeline notes and Training workout dates; those
already handle Dayjs. Admin changelog uses its explicit native adapter and normalizes saved values.

Historical previews batch exact document reads within each 50-event page: delivery status first, queue state for
unsent source matches next, then source provenance for remaining candidates. Each RPC contains at most 100 documents,
with at most two RPCs in flight and 600 documents per page for all four sources. Invocation-local snapshots preserve
the existing skip-reason priority; completed/accepted queue rows never require an original-file check. Storage checks,
trusted manual-origin validation and legacy FIT identity verification remain unchanged. Send does not reuse preview
snapshots: it re-reads current state and uses the existing guarded queue admission.

The browser shows checked/eligible progress after each page, keeps Send disabled until the entire preview completes,
and renders results above its actions. Stop discards the read-only page already dispatched and prevents later pages;
stale replies cannot replace a restarted preview. Async state uses Angular signals so completion updates controls without
another click. Duplicate cursor detection stops a repeated-page loop without publishing an incomplete preview.
The completed preview displays only ready-to-send counts per selected source. Exclusion rows group existing reason
counts into sent, queued, original unavailable/unsupported, merged/derived, delivery review, unavailable activity,
failed checks and an unknown-reason fallback. `not_imported_from_source` and `not_manual_upload` are source mismatches,
so neither appears in exclusion rows or an inflated per-source skipped total. Reason counts remain source checks,
not unique activities; the UI explicitly labels possible overlap. Failed checks remain visible even when their reason
breakdown is absent. A visible, accessible Send description distinguishes a required preview, invalid filters, empty
dates, no matching sources, previous delivery and failed checks. This changes presentation only: server eligibility,
duplicate protection, callable contracts, source admission and queue behavior are unchanged.
Safe per-page diagnostics contain only destination, source count, scanned/failure counts, continuation presence and
elapsed milliseconds; no dates, cursors, owners, activity/file/provider identities or raw errors. Logging is best-effort.

Monitoring impact for preview performance: **unchanged**. The reviewed activity-delivery bundle covers the same queues,
workers, dispatchers, historical/manual labels and committed outcomes; preview diagnostics are read timings, not delivery
success. No lifecycle, retry, lease, permission, data contract, Training planning or MCP/Assistant behavior changes.
The preview exclusion presentation also leaves monitoring **unchanged**: no worker, dispatcher, state, log, alert,
query or delivery contract changes. It consumes existing response counts; it requires only a frontend release.
Release requires a separately approved deployment of `backfillActivitySyncRoute` plus the frontend; no index, migration,
secret, monitoring apply or provider replay is needed. Unit evidence verifies fewer RPCs, not production wall-clock speed.

Monitoring impact for this date-entry fix: **unchanged**. Reviewed `tools/activity-delivery-monitoring/definitions.mjs`
and [activity delivery monitoring](activity-delivery-monitoring.md): the same historical source/destination/mode labels,
queues, committed outcomes, failure/DLQ signals and unknown telemetry apply. No worker, dispatcher, retry, lease,
provider capability, permission, callable, stored contract or MCP/Assistant change is introduced. Existing Help's
preview-before-send instructions remain accurate. Release needs only the separately approved frontend workflow.

After scheduling, a deleted event, changed provenance or file generation, or missing/invalid retained original completes the historical queue row as skipped before provider upload. Temporary Storage errors remain retryable. Once a provider upload has an accepted resume ID, the worker retains reconciliation instead of treating a missing original as an ordinary skip. Historical metadata writes require the event root to still exist, so a deleted event does not gain an orphaned status child.

- Make directions explicit. A provider can be a destination without being a source; do not create reverse routes merely because both APIs exist. Wahoo has deliberate Wahoo -> Suunto and Wahoo -> COROS routes because its import path retains native Wahoo FIT files, while Wahoo does not disclose workout summaries that it identifies as third-party-app activity. Document the partner behavior that prevents a reciprocal Wahoo import loop instead of assuming every provider has that protection.
- When a destination can return delivered activities through its import feed, write a deletion-guarded outbound receipt before the provider call. Use destination-namespaced exact-file hashes plus a bounded semantic FIT fingerprint when provider re-encoding is possible. Check receipts before inbound event persistence and fan-out, deny browser access, expire them through TTL, and ensure one file sent to multiple destinations cannot overwrite another destination's receipt. Give each pre-request write an operation ID: roll it back only when a final guard proves no provider request started, and retain it after any request-start boundary because delivery may be ambiguous. Wahoo's third-party import exclusion remains a provider defense, not a substitute for the shared receipt mechanism.
- Deliver the retained original only when its format is accepted by the destination. Do not silently transcode or use a derived event unless the product contract explicitly covers it.
- Recheck source and destination connection, entitlement, disconnect-pending, reconnect-required, deletion, and feature-gate state in the worker. A route setting is not an authorization grant.
- When a provider has a narrowly scoped refresh anomaly, make the first bounded failures durable per-account backoff rather than repeatedly charging shared provider capacity. Reset consecutive-failure state atomically with a successful winning refresh so isolated failures separated by valid rotations cannot accumulate into a false reconnect requirement. If failures become reconnect-required, park unaccepted activity and saved-route deliveries under a guarded queue state; a successful OAuth reconnect clears only that provider's recovery state, restores only route settings that were enabled before parking, and re-dispatches the parked items. Bind the post-token OAuth lifecycle transition to the server-issued credential generation so a stale callback cannot clear or overwrite a newer authorization. Persist route restoration itself as a provider-neutral, connection-generation-bound repair marker. Restore settings first, transactionally close a generation- and credential-bound parking barrier, reconcile every row parked before that barrier against the restored settings, and clear the marker only as the final phase. Workers must treat an open barrier as parkable and a closed barrier as authoritative, so no row can appear behind the release scan. This keeps failures durably retryable and finalizes intentionally disabled routes instead of reopening them. If a separate multi-collection re-dispatch can partially succeed, persist a server-only repair marker and retry it from an existing or dedicated scheduler; never require another OAuth callback to complete the release. Do not silently turn preserved route settings off unless the product contract calls for it.
- Persist a provider-issued asynchronous upload/job identifier as soon as it is issued. When initialization returns an ID before the provider accepts the blob, durably retain the exact server-side continuation required to repeat the same idempotent blob request, and make that guarded state write succeed before sending any blob bytes. A state-write failure must abort the PUT. Subsequent queue workers repeat that same request when delivery is uncertain and then poll the same identifier; they must never initialize a replacement job. Keep signed URLs and headers only on the live admin-only queue row, clear them on completion, and exclude them from logs and DLQ copies. Direct callable upload flows must return opaque resume identifiers in retryable errors and check the same job first. A direct flow without a persisted signed continuation must keep polling that job when the provider reports `NEW`, because `NEW` can also describe an accepted blob that is still processing; starting a fresh direct upload must be an explicit user action rather than an automatic retry.
- Normalize terminal states into the shared result contract: success, duplicate-as-success, retryable pending/rate-limit/outage, skipped auth/scope problem, or a sanitized terminal failure. Do not log raw provider payloads or source files; for operator diagnosis, log only the HTTP status and a length-bounded, allowlisted provider error message. Some providers, including Wahoo, report an exact duplicate as an asynchronous terminal status; handle that as success rather than a failed retry.
- A documented accepted-but-pending job status is not a Cloud Task failure. Persist the job ID, consume a bounded polling budget, durably record the next poll due time, acknowledge the current task, and enqueue a status-only poll with the configured retry/backoff cadence. The reconciliation scheduler must honor that due time rather than starting an immediate duplicate, page past future scheduled polls so they cannot starve newer work, and ensure a retry before that time reuses the same scheduled task rather than performs an early provider poll. Emit an info-level structured poll-scheduled log. Scheduler or transport failures, exhausted polling, and terminal provider rejection must remain warning/error paths. The shared COROS and Wahoo activity-sync adapters use this path while preserving each provider's required resume identity.
- When FIT-file inference is known to lose canonical activity types, correct the provider result only through an explicit, documented mapping. Wahoo activity-sync delivery reads the persisted Sports Lib `Activity Types` value, maps multiple canonical types to Wahoo `MULTISPORT`, and performs an idempotent workout `PUT` containing only the documented type field after Wahoo returns a workout ID; do not overwrite the user-visible workout title. Direct Wahoo FIT delivery derives the same mapping from the server-side initial FIT parse, returns the optional mapped ID beside the provider upload ID, and keeps both only in the browser's in-memory upload row for status-only polling. The status callable must revalidate the echoed ID against the explicit numeric mapping before the type-only `PUT`. The browser can alter that ID, but authenticated Pro access, App Check, the same user's Wahoo credential, and the provider-returned workout association bound the effect to that user's own workout type. An unmapped type deliberately keeps Wahoo's inference; never default it to cycling, `OTHER`, or an approximate type. Retain the asynchronous upload ID and mapped type through every accepted-upload failure so status and the idempotent correction can be retried without repeating the FIT `POST`.
- Classify destination failures at the provider boundary with `ProviderOperationError`. The adapter owns provider-specific HTTP, job-status, and message interpretation; shared queue workers consume only its disposition (`retryable`, `permanent`, `auth_required`, or `permission_required`) and retry mode (`resume`, `restart`, or `none`). Do not add provider message matching to a shared worker except as an explicitly temporary compatibility rule for already-deployed behavior.
- COROS recorded-activity status `-1` with a matching upload ID and successful status-query result is a confirmed failed operation: queued delivery uses the existing bounded `restart` path, retaining the original provider account across resends. Do not reset retry counts, resend pending/unknown operations, or retry explicit unsupported-file result `5096`. Preserve the last failed upload identifiers at exhaustion. Direct manual-upload controls remain separate; see [COROS activity delivery](coros-integration.md#activity-delivery).
- #600's COROS FIT adapter prepares valid single-session Snorkeling copies with or without recorded GPS as swimming/open-water (`5` / `18`); Sailing still requires recorded GPS for generic/generic (`0` / `0`). Separate controlled imports reached terminal success and the owner confirmed Open Water Swim / GPS Cardio with matching data; a later authorized GPS-less Snorkeling test also reached terminal status `2`, without fabricating coordinates or metrics. Direct and fresh/restarted queued uploads fingerprint the actual sent copy; retained originals and QS types remain unchanged. Already accepted uploads keep status-only reconciliation. GPS-less Sailing, mixed/malformed and unrelated files pass through unchanged, with no acceptance guarantee. Never substitute a COROS mode number for a FIT sport enum. See [category fallbacks and evidence limits](coros-integration.md#recorded-activity-category-fallbacks-600). Help discloses the mapping; #832 monitoring covers the unchanged delivery outcomes. Deployment and replay are separate approvals.
- COROS additionally repairs only the reproduced zero-byte Event `data` / Lap `total_cycles` definitions in an outgoing single-session activity copy with intact original CRCs and a strictly valid result. All actual native/developer data and retained originals are preserved; unknown defects and missing summaries remain untouched. Direct and fresh/restarted queue uploads fingerprint the sent copy, while accepted operations stay status-only. A synthetic controlled A/B reproduced failed versus successful COROS processing; it does not establish Walking support. See [repair boundaries](coros-integration.md#empty-fit-field-compatibility). Existing #832 metrics/dashboard/policies are covered and unchanged; no retry, lifecycle, scope, credential or new-function change. No new help/category contract is introduced. Deploy/replay still need separate approval.
- For strictly valid sessionless activity files, COROS's same preparation boundary can separately use the shared `FitActivitySessionRepair` class. It reconstructs one evidenced Session only from contiguous same-sport laps under one complete timer in a manual Activity, with all samples inside the interval; ambiguous/multisport/inconsistent evidence passes through unchanged. Existing Sessions and retained originals are never replaced. Native/developer data stays intact apart from correcting the outgoing footer's session count. The class uses `fit-file-parser` validation/encoding and contains all added binary span work. See [missing-Session boundaries and authorized terminal-success evidence](coros-integration.md#missing-fit-session-compatibility). Other providers are not enabled automatically; Help, MCP/Training, lifecycle, retries and #832 monitoring remain unchanged. Deployment and replay need separate approval.
- Preserve the provider phase boundary. A typed retry decision applies only while the provider request is in progress. Once the provider confirms success, a later metadata or queue write failure must not be reclassified as a provider failure. Prefer a durable acceptance receipt, DLQ record, or terminal manual-reconciliation marker before acknowledging accepted work. When a direct provider call needs an outbound-echo receipt, write it as an operation-scoped provisional claim, promote it only after the final account/lifecycle guard and immediately before provider I/O, and roll back only that claim if no request starts. Echo detection must require the promoted marker; concurrent rollback must never delete another operation's accepted receipt. Keep the terminal live marker without a TTL when work is copied to DLQ, and reject both automatic and manual re-enqueue until an operator has reconciled and explicitly cleared that marker. The DLQ audit copy may retain its normal TTL. If every Firestore persistence path is unavailable, leave the durable provider-operation claim untouched and fail the Cloud Task. A later delivery must reconcile or DLQ that stale claim without repeating the provider request. Retry exhaustion must retain the provider-specific DLQ context for diagnosis. Side effects derived from provider success, such as per-service upload counters, must use the durable queue item or provider operation ID as an idempotency record so completion retries cannot count the same upload twice. Treat a supposedly completed asynchronous response without its required provider operation ID as a terminal provider-contract failure rather than retrying the original non-idempotent request.
- If authentication is lost while polling an already accepted asynchronous upload, retain the provider operation ID and fail closed into manual reconciliation. Do not downgrade accepted work to an ordinary reconnect skip that can later be manually replayed.
- A direct browser file upload is a separate product path. State whether it creates an event or route. Wahoo direct activity delivery intentionally accepts FIT only and retains only the short-lived browser row values needed to show status and resume the optional mapped-type correction; it does not persist the FIT, mapped type, or a Quantified Self event. Wahoo direct course/route delivery accepts FIT and GPX sources, converts GPX to FIT in memory because Wahoo receives FIT courses, makes a server-side idempotent route-library request using the source-file fingerprint, and does not create or retain a Quantified Self route. Saved-route delivery is distinct: Suunto routes already saved in Quantified Self flow through the shared route-delivery queue and use the saved-route ID as a stable opaque Wahoo external key, so revisions update rather than duplicate the provider route. Bound both source and converted output, and define conversion limits such as one route with valid coordinates.
- Suunto FIT activity delivery keeps the direct callable at concurrency one and one instance. Shared queue uploads and legacy direct clients retain at most five status attempts spaced by ten seconds. Updated direct clients opt into `supportsPendingStatus: true` on the existing `importActivityToSuuntoApp` callable: each invocation makes one status attempt and returns HTTP 200/pending with the upload/account identifiers only for recognized `NEW`/`PROCESSING` states. Unknown/malformed responses remain retryable errors, never success. No new endpoint or persistent state is added. The browser reuses its bounded provider status-poll controller with a ten-second initial delay, exponential backoff capped at sixty seconds, and eight automatic checks; exhaustion leaves the row Processing with **Check status again**. In-flight duplicate checks, closed/cleared rows and account switches must not replay uploads or publish stale completion. Explicit `restart` failures stop status polling and clear the failed job identifiers; `resume` failures retain them. Direct blob acceptance can remain ambiguous without a persisted signed continuation, so status-only retries never automatically initialize a replacement. Provider failures remain WARNING with neutral "Retryable provider operation failure" wording rather than promising an automatic retry. Expected pending transitions are INFO.

Suunto upload initialization logs structural diagnostics on the existing success INFO and a validation-failure WARNING:
HTTP status, fixed content-type category, response/ID/URL/header-field types, ID/URL validity and last-request elapsed
milliseconds. Never log response values, arbitrary field names, headers, signed URLs or credentials. Correlate by the
platform execution ID. The optional HTTP metadata observer cannot change request/error handling. A successful HTTP
response missing a usable upload ID or URL stops before any FIT bytes are sent and produces a typed `retryable/restart`
failure. The shared queue uses the twenty-attempt provider budget and existing Cloud Tasks backoff, retaining
`SUUNTO_ACTIVITY_UPLOAD_INVALID_RESPONSE` at exhaustion; no immediate response-validation retry loop is added.
Direct clients receive `unavailable` with `retryMode: restart` for an explicit Retry upload. Invalid local account
identity remains permanent, and accepted uploads retain their existing guarded continuation/status-only handling.
Monitoring is **covered/unchanged**: the reviewed activity-delivery bundle counts committed retries and exhausted DLQ
outcomes, not HTTP 200 or diagnostic logs. Existing Help retry guidance stays accurate; MCP and Training have no impact.
Deploy only `importActivityToSuuntoApp` and `processActivitySyncTask`; rollback restores their previous revisions.
Any replay is a separate authorized operation and must prove the exact job has no accepted upload before clearing its blocker.

Provider-upload progress jobs belong to the uploader's local monitoring lifecycle. Closing/clearing the view, changing
destination, or discarding an in-flight result after an account switch removes its active local jobs; it must not leave
the global progress indicator active indefinitely or mark unconfirmed provider work complete/failed. Destination changes
also discard the old rows so stale identifiers and in-flight controls cannot be reused against a new destination.

For this direct-upload update, deploy the compatible callable before the updated frontend after separate approval. Old clients omit the capability flag and retain the legacy pending/error contract. A rolled-back backend still returns resume identifiers that the updated client can retain for manual retry. Neither deployment needs queue migrations, indexes, secrets, MCP changes or a provider-wide requeue. Verify pending-to-success/duplicate, explicit restart, transient resume, exhausted polling and dialog teardown with mocked provider calls before release; inspect production outcomes only after an approved rollout.

Apply the same typed failure contract to queued saved-route delivery. Provider adapters should map 408, 429, and safely repeatable update failures to retryable outcomes; explicit content or validation rejection to permanent outcomes; and auth/scope failures to skipped outcomes. Keep any provider job or external route identifier needed for idempotent resume/update behavior. Persist each provider acceptance before continuing a multi-account direct delivery batch, but mark it partial until every account has been attempted. A stale partial receipt must fail closed for reconciliation rather than being finalized as complete or replayed. When a provider lacks a stable create key or duplicate-reconciliation endpoint, an ambiguous create timeout or transport failure must fail closed for operator reconciliation rather than automatically creating a possible duplicate; do not add a second adapter-level retry loop.

### Saved-route actions on Route Details

Route Details derives its Suunto, COROS, Garmin, and Wahoo menu from one ordered set of destination eligibility records. Disconnected, reconnect-required, pending-disconnect, non-Pro, non-owner, missing-original, and provider-specific ineligible destinations are hidden. Connection state comes from the existing safe connection watchers; Garmin retains its original-account and Course Import checks, Suunto retains its source-account restriction and explicit copy confirmation, and COROS retains its rollout gate. Wahoo route scopes are checked server-side because the browser connection projection does not expose them; scope failures retain the status explanation and open the existing Wahoo route-access reconnect dialog used by the Routes list, for both in-band and thrown failures.

The action passes only the current saved-route ID and destination to `AppRouteSendService` / `sendRoutesToService`. The server loads the current saved name, original geometry, and adapter-supported metadata. Manual delivery returns a result from the existing adapter; it does not return a queued status. Automatic route-delivery queues are unchanged. The UI locks before any Suunto copy confirmation and remains locked through the request, shows persistent accessible sending/result feedback plus the usual snackbar, and uses selection/completion haptics. Successful responses immediately update the current view's destination badges and Suunto copy-confirmation state without writing Firestore delivery metadata or inventing provider IDs. Send confirmations and UI completion feedback are bound to the originating owner, route, view revision, and component lifetime; leaving and returning to the same route cannot dispatch a stale confirmation or publish stale feedback. Destroying the view dismisses its pending copy confirmation, and closing the Wahoo reconnect dialog discards late OAuth URL results rather than redirecting the new page. Server-owned authorization, Pro, deletion/disconnect, receipt, and deduplication safeguards remain authoritative.

Provider actions use the existing Material menus for keyboard navigation and focus restoration. The app currently ships English strings without locale catalogs or a localization runtime; action text follows that convention and remains ordinary DOM text for browser translation.

### Direct manual route delivery formats

The shared Services uploader accepts **GPX and FIT** source routes for every current route destination. The browser sends the selected source unchanged; Functions parses it and produces the destination representation in memory. Never put provider conversion logic in the browser, and never infer the output format from the source extension alone.

| Destination | Accepted source | Destination representation | Retention and retry behavior |
| ----------- | --------------- | -------------------------- | ---------------------------- |
| Wahoo | GPX, FIT | FIT course; GPX is exported to FIT | Does not create a Quantified Self route. Source-file fingerprint is the external ID, so a retry updates the same Wahoo route. |
| Suunto | GPX, FIT | Fresh GPX route generated from the parsed source | Does not create a Quantified Self route. Keep compatibility for older browser clients that gzip GPX before calling Functions. |
| Garmin Connect | GPX, FIT | Garmin Course Import JSON built from parsed route geometry | Does not create a Quantified Self route or delivery metadata. A repeat direct upload creates another Garmin course; saved-route sends use delivery metadata and update the existing course. |
| COROS | GPX, FIT | Fresh GPX plus COROS bike/running metadata | Available to eligible connected Pro users. Does not create a Quantified Self route. Direct, saved, and Suunto route delivery share the same empty production allowlist so an operational rollback remains possible. A deterministic partner user ID avoids exposing the Firebase UID; deterministic revision IDs make exact repeats duplicate-safe. Cycling-family routes map to bike and all other/missing types to running. |

Apply the same request controls to every destination: authenticated App Check callables, Pro entitlement, explicit FIT/GPX filename allowlist, strict base64 decoding, a 20 MB source limit (including legacy gzip expansion), parsed-route validation, converted-output limit where an output file is generated, deletion/disconnect guards, and sanitized provider errors. Make the route format and retention behavior visible in Services, Help, privacy policy, and the public integration page.

OAuth scope changes are migrations. Request the full supported scope for new connections, enforce the specific write scope immediately before outbound calls, and show existing users a clear reconnect action. Wahoo's direct and saved-route flows need both `routes_read` (idempotency lookup) and `routes_write` (create/update); its direct activity flow needs `workouts_write`. Wahoo Training delivery adds `plans_read plans_write` and requires workout read/write access. The existing reconnect dialog uses purpose-specific route/Training copy and discards late redirects after account changes. Do not mark a read-only connection as generally disconnected when inbound imports remain valid.

Wahoo requests `plans_read` and `plans_write` for all new connections and reconnects. These remain explicitly requested
provider permissions, not automatic Training consent: Pro eligibility and per-plan/workout opt-in still apply. Existing
credentials are not assumed to gain the additional grants without reconnecting.

For Wahoo Training, successful withdrawal reserves a durable new Plan incarnation for the next consented send;
ordinary retries never rotate identities. Wahoo can return an owned deleted Plan as a tombstone rather than a 404.
Confirm its ownership, current account and dated-Workout outcome separately: Plan deletion alone is not Workout
deletion. Never issue an undocumented undelete, infer absence from a history scan, or recreate an uncertain/completed
copy. Legacy migration requires the latest matching, fully accepted server withdrawal receipt. A deleted Plan without
that proof requires attention, not an automatic retry loop. FIT completion validates the new Plan incarnation while
retaining the existing safe read/consent contract. See the Wahoo lifecycle in `docs/training-workspace.md`.

When product behavior specifies a single active provider account, centralize token selection in one server helper and use it for imports, polling, history, direct uploads, shared workers, and route delivery. Pin the stable provider ID in safe connection metadata, use one deterministic migration choice for legacy multi-token roots, and fail closed if the pinned token disappears. A browser-only selection rule is insufficient.

## 7. Worker, original files, and event persistence

The worker is the final safety boundary. It should be safe to execute repeatedly and must expect the connection or user to have changed since ingestion.

Before each irreversible action, use `functions/src/shared/user-deletion-guard.ts`:

1. before queue insertion;
2. before a worker makes provider requests or refreshes credentials;
3. immediately before event/original-file persistence;
4. inside transactions that write queue completion, history lease, or other follow-up state.

Also stop work when the provider is disconnected, reconnect-required, or disconnect-pending. A disconnect that starts mid-job must not result in a new import.

### Downloading provider files safely

Provider file URLs are external input even if they came from an authenticated partner API. The Wahoo and COROS implementations use the shared defensive pattern for a safe FIT download path; each keeps its own reviewed provider-host policy and provider-specific response handling. Prefer exact provider-owned hosts. A shared CDN suffix or filename pattern alone does not prove provider ownership. COROS retains its existing CDN-host policy but treats returned paths as opaque, including additional directories; do not turn an observed folder layout into a mandatory transport contract. Retain the controls below:

- require HTTPS;
- reject credentials in URLs, IP literals, localhost, private targets, and unapproved redirect targets;
- enforce the provider's reviewed host allowlist on initial requests and every redirect; do not broaden it merely to accept a different path;
- enforce a request deadline and, when the provider documents a safe maximum, a byte limit;
- validate response type and file magic bytes before parsing;
- keep full signed URLs only in backend-owned retry state or an explicitly documented bounded recovery record (Garmin's admin-only failed jobs); never log or project them into events, user metadata, or safe admin responses.

Treat a successful HTTP status as transport success, not proof that a provider file is ready. Normalize only recognized wrappers and validate the complete FIT envelope—including its declared length—before invoking Sports Lib. Apply a decoded-body limit when the provider contract documents a safe maximum; do not invent one that could reject valid activity files. A provider-specific incomplete or placeholder response should remain retryable with a distinct exhausted-retry DLQ context. Diagnostics may retain only structural facts such as byte length, an allowlisted content-type category, and validation reason; never retain or log the response body. If a structurally valid FIT parses without a session, retry only when provider evidence supports a narrowly bounded not-ready case (for Suunto, a suspiciously small response); keep ordinary full-sized sessionless files terminal so permanent corruption does not consume the retry budget.

Suunto FIT downloads in the queued sync worker use the existing 60-second deadline plus an application safety bound
of 128 MiB per response, enforced while reading even when Content-Length is absent. Redirects are rejected. This is
an operator-selected QS limit, not a documented Suunto maximum: a valid larger file will require operator review.
Oversized responses move immediately to the existing failed-job flow with `SUUNTO_ACTIVITY_FILE_TOO_LARGE`, including
after a forced token refresh, instead of repeatedly downloading the same oversized response. Failure records retain
only a fixed safe error, never the provider body or credential URL. Timeout and incomplete-file retries retain their
existing behavior. The download explicitly sends `Accept: */*`: Suunto's endpoint returns 500 for FIT-specific media
types but accepts the wildcard request. That worker has a 540-second runtime, leaving time for sanitized error
handling after an abort. Deploy the workout processor after verification; watch this failed-job category and download
failures for compatibility problems. Reverting this Functions change restores the prior download policy without
changing existing activity data, connections, or queues.

Garmin Activity Files deliberately use an application safety bound: 128 MiB per response and a 60-second deadline,
including the GPX-to-FIT fallback. This is not asserted as a Garmin API maximum; oversized files move to a distinct
operator-review DLQ category instead of repeatedly buffering the same response. Original preformed URLs are validated
before queueing and again in the worker, restricted to the exact Garmin HTTPS Activity File endpoint, and redirects
are refused by the actual HTTP client. These checks apply to previously queued rows too. The detailed compatibility
and migration limits are in [Garmin integration](garmin-integration.md#delivery-and-trust-boundary).

Wahoo's [FIT request diagnostics](wahoo-integration.md#fit-download-diagnostics) distinguish provider HTTP failures
from the local deadline using fixed outcomes, bounded numeric metadata, cache categories and hashed request IDs.
They add no raw headers, file/account data, retries or provider calls. Monitoring is **covered/unchanged** by the
existing recorded-import worker/commit filters; Help, MCP, Training and persistence contracts are unaffected.

Do not use a provider's short-lived file URL as durable application data. Download it in the worker, validate it, and store the original file through the existing event/file flow so reprocessing, export, and sync use the owned copy.

### Original-file upload integrity

Activity imports, manual activity uploads, comparisons, merges, and manual/provider route uploads use
`functions/src/shared/storage-file-save.ts`. The helper calculates CRC32C over the exact bytes passed to
Cloud Storage and supplies the base64 checksum in `metadata.crc32c` with `validation: 'crc32c'`.
Cloud Storage checks the supplied checksum before committing the object; the SDK also validates the
returned checksum. This explicit metadata avoids depending on an SDK's default checksum-header behavior.
Already compressed files are hashed and retained as compressed bytes. Generation tracking,
original-file provenance, and deletion/connection guards remain in force.

Provider activity imports, manual activity uploads and merges additionally isolate distinct original bytes under
`users/{uid}/events/{eventId}/sources/{sha256}/original[_index].{extension}`. The shared EventWriter saves the adapter's
actual path in both original-file metadata fields. An older upload or staged promotion finishing late cannot overwrite
a newer revision's bytes after its Firestore writes were rejected. Identical bytes reuse the same path, with no extra
Storage or Firestore requests; different revisions occupy separate objects until normal event/account cleanup.
Existing objects keep their paths and remain readable without migration. Downloads and reparse follow metadata;
historical manual sends accept only the legacy or exact digest path inside the same owner/event and retain all
provenance, format, size and generation checks. Existing event-prefix cleanup and Storage Rules cover nested paths;
public-event sharing continues to expose source objects within that event folder, including retained revisions.
Comparisons and saved routes retain their existing writers. See [Training persistence](training-workspace.md) for
the complementary Firestore source reservation and control-preservation contract.

Monitoring impact is **unchanged**: reviewed `tools/import-monitoring/definitions.mjs` and the recorded-import runbook;
the same workers, persistence failures, committed outcomes, retries and cleanup paths apply. No queue, lease,
scheduler, monitoring label or provider request changes. Existing Help remains accurate and MCP schemas are unchanged.

Provider activity originals staged under `event-write-staging/` receive the same validation before
promotion. Promotion remains a server-side copy, which Cloud Storage validates against the source
object's checksum. An upload rejection propagates through the existing retry and cleanup paths;
failed staged uploads cannot be promoted. No checksum field is added to Firestore or MCP responses.
Diagnostic debug-bucket uploads remain separate from retained original files.

Functions declares `@google-cloud/storage` directly at `^7.22.0` and Firebase Admin at `^13.7.0`.
Verify with `npm --prefix functions test -- src/shared/storage-file-save.spec.ts src/utils-usage.spec.ts`;
the checksum spec exercises the real SDK against a loopback HTTP server, including corrupted uploads,
without calling Firebase, providers, or production buckets. Existing objects require no migration.
Backend deployment remains a separately approved release action.

### Failed-file debug captures

Before asking a user for a failed import/upload original, check the separate diagnostic bucket
`quantified-self-io-debug-files` (`config.debug.bucketName`). Provider captures use
`<service>/<firebaseUserID>/<queueItemId>.<extension>`; existing prefixes include `Suunto app`, `COROS API`, and
`garmin`. Capture is best effort and not every failure reaches it; check `[DebugUpload]` logs and object metadata
before claiming a file is available. Debug objects are not retained activity originals or successful imports.

Manual archive uploads through `uploadActivity` capture unexpected parser failures, including `EVENT_EMPTY_ERROR`,
under `manualUpload/<firebaseUserID>/<payloadSha256>.<extension>`. Match the verified `userID` and `payloadSha256`
from `[uploadActivity] Activity parsing failed`. The stored bytes are the original bounded HTTP body, preserving
gzip with a `.gz` extension; the logged digest identifies the **decompressed parser input**, not the compressed body.
The path never includes the original filename. Rejected copies of the same parser input reuse the same account,
digest, and extension path. Non-FIT supported formats use the same capture path.

Capture runs only after authentication, App Check policy, size/decompression, and account-tier checks pass, and
rechecks the account-deletion guard immediately before Storage. Successful uploads, known route/course rejections,
authentication/quota failures, and failed decompression are not captured by this branch. Debug-storage or guard
failures preserve the parser's existing HTTP 400; they do not create events, retries, or queue jobs. This reuses the
existing bucket and helper without changing bucket access. The Send activities temporary-source lifecycle is separate
and is not covered by this manual archive-upload branch.

#### Fourteen-day debug-file expiry

`storage.debug-lifecycle.json` defines native Cloud Storage deletion eligibility at object age 14 days for the entire
**diagnostic bucket only**. The shared helper is called by Garmin activity import failures (`garmin/`), the common
Suunto/COROS activity import failure path (`Suunto app/`, `COROS API/`), and manual archive parser failures
(`manualUpload/`). Wahoo uses a separate import worker and does not currently call the debug helper. A bucket-level
rule covers every existing/future debug prefix without adding provider-specific code, a scheduler, or Firestore TTL.
It never applies to normal retained originals or the Send activities temporary copies in other buckets.

Apply only with explicit approval for this exact bucket and for existing older files: lifecycle rules cover existing
objects as well as future uploads. Read back the current lifecycle/metageneration first; preserve unrelated rules
and use a metageneration precondition so a concurrent bucket change cannot be overwritten. The supplied file contains
only lifecycle rules, not IAM, soft-delete, versioning, or a minimum-retention policy. Do not set Bucket Lock.

Cloud Storage evaluates deletion asynchronously, and configuration changes can take up to 24 hours to take effect;
14 days is eligibility, not a guaranteed exact deletion time. The existing seven-day soft-delete window starts after
deletion and stays unchanged. This bounds ordinary diagnostic retention but does not add immediate account-deletion
cleanup for the separate debug bucket. Verify with
`npm --prefix functions test -- src/debug-utils.spec.ts`, then read back the production policy after an approved apply.
See [Cloud Storage lifecycle management](https://docs.cloud.google.com/storage/docs/lifecycle).

Production readback on 15 October 2026 at 12:31 UTC confirmed this exact rule on
`quantified-self-io-debug-files`, bucket metageneration 2. The owner explicitly approved existing and future debug
objects, including the 366 objects already older than 14 days in the preflight inventory. The seven-day soft-delete
window was preserved; no object purge, IAM, versioning, minimum-retention, or Function deployment was performed.
This bucket configuration is already active independently of the manual-upload capture code's release. Recheck live
configuration before relying on this historical readback, and distinguish deletion eligibility from confirmed removal.

Inspect exact-prefix metadata first. If an authorized investigation needs file contents, use private temporary
storage outside the checkout, treat contents as untrusted data, and never commit production files or put their
contents, private filenames, or download URLs in logs, docs, tests, issues, or PR attachments. Captures cannot recover
earlier rejected manual uploads that were never stored. Do not replay, upload to a provider, or purge objects without
the user's separate authorization.

### Persisting events

- Resolve a deterministic event ID before writing. Put provider identity fields in safe event metadata for future deduplication and attribution.
- Preserve normalized provider metadata that has durable meaning—such as mode/submode, device, source timezone, plan/workout ID, and multipart component identity—without retaining ephemeral URLs or raw partner payloads.
- Call the shared event persistence path rather than hand-writing an alternate event document schema.
- Recheck deletion immediately before the write; a check only at the beginning of a long FIT parse is insufficient.
- Mark the exact claimed queue revision complete only after event persistence succeeds. On errors, sanitize the error, increment retries atomically, and move terminal work to the existing DLQ/TTL model.

## 8. Lifecycle: disconnect, entitlement, deletion, and cleanup

Every new provider needs a lifecycle plan before it is enabled.

### Disconnect

Explicit user disconnects disable every activity-sync and saved-route direction involving the provider in the **initial transaction**, alongside the existing OAuth/disconnect-operation fence. That transaction also removes earlier automatic route-restoration intent and marks connection metadata disconnect-pending; no provider request starts until it commits. Token-root deletion triggers remain an idempotent fallback. Reconnecting does not restore the routes that the user explicitly disconnected.

Credential removal and a server-only `serviceDisconnectCleanup/{opaqueUserOperationAccountHash}` intent commit atomically. The intent contains only the Firebase owner, provider lookup identity, lifecycle fence, server-timestamp cutoff and pagination/lease state—not credentials, callback URLs, raw payloads, state or PKCE. It is denied to browser clients by the existing Rules. Imported activities, saved routes, Health and Sleep history are not cleanup targets.

Garmin recorded-activity workers also distinguish a confirmed completed disconnect from an unexplained missing
credential when cleanup races queued work. Owner-pinned token lookup plus a cleared, generated lifecycle and an
explicit revisioned empty account projection allow a deletion/queue-identity-guarded terminal skip at INFO, counted
only after commit by existing import-skip telemetry. Missing tokens alone must not hide a connection fault; unknown
state retains the existing warning/DLQ path. Never borrow another owner's token or reopen a completed skip on
reconnect. See [Garmin identity and lifecycle](garmin-integration.md#identity-and-lifecycle) for the precise boundary
and affected rollout targets. Existing product Help remains accurate: disconnect stops future imports and retains history.

COROS Health/Sleep polls use the same confirmed-disconnect classification, with the additional requirement that the
original owner's token root is absent. COROS active-account lookup also rejects account and credential-generation
mismatches, so a missing-token error alone must never silence those failures. The existing Sleep completion helper
owns deletion/revision/lease checks and post-commit skip telemetry; no new lifecycle or recovery mechanism is added.
See [COROS daily ingestion](coros-integration.md#daily-health-and-sleep-ingestion) and the
[Sleep operations runbook](sleep-sync-operations.md#queued-coros-polls-after-disconnect).

Owned Suunto workout and Sleep/Health jobs use the same confirmed-disconnect skip, requiring a cleared generated
lifecycle, revisioned empty account projection and no remaining token children for that Firebase owner. An empty
OAuth root may remain; a missing exact-account token while another credential exists is not a completed disconnect.
Legacy unowned jobs and unknown/reconnect-required/pending state retain existing failure handling. Completion uses
the existing deletion/queue-identity guards and post-commit skip telemetry. Routes already skip unavailable sources
and are unchanged. See [Suunto queued disconnects](suunto-integration.md#queued-work-after-disconnect).

The existing `retryPendingServiceDisconnects` scheduler re-drives these intents every 30 minutes (up to ten cleanup tasks concurrently, at most 25 operational roots per page, with a five-minute claim lease and resumable query cursor). Operational trees are recursively deleted through transaction-fenced writes; every delete rechecks user deletion, the original lifecycle for an active user, queue document revision and shared-account ownership. Queue tombstones commit with root removal. Newer queue documents are excluded by the credential-removal commit timestamp, and a replacement OAuth lifecycle retires stale cleanup for an active user. Transient failures retain the intent without a finite event-retry or TTL deadline.

Cleanup intents deliberately survive recursive deletion of `users/{uid}` so provider-only queue rows do not lose their last lookup identity. `cleanupUserAccounts` invokes the existing bounded reconciler, and the scheduler owns unfinished pages or active leases. For a missing/deleting account, reconciliation waits for that provider's remaining credential children to disappear and then deletes only the captured operational data; it never recreates user descendants. Shared-account ownership and queue revision checks still apply. An intent is removed only after cleanup completes, not simply because account deletion started.

The same scheduler also reclaims one expired explicit-disconnect episode per provider per execution, retaining its original operation generation. The existing ten-minute lease orders this against in-flight callables; failures renew that lease, and a cursor in the existing scheduler-cursor collection advances past roots belonging to deleted users or otherwise unable to renew. This also finalizes interrupted legacy roots that already have an operation/lease, but cannot reconstruct operational identities from credentials removed before durable intents existed. Entitlement restoration cannot clear an explicit disconnect. An explicit operation may use subscription-pending credentials only with its matching operation generation, so recovery can finish without enabling ordinary sync. Failed revocation or metadata finalization stays pending rather than reporting successful disconnect.

For this lifecycle change, deploy the `serviceDisconnectCleanup` collection-scope indexes for `nextAttemptAt` and `userID` before updating Functions; keep the existing scheduler, account-cleanup handler and four provider disconnect callables deployed. There are no new Functions, secrets or migration scripts. Validate the interruption cases with `npm run test:disconnect` (local Firestore and real token-use guards, mocked provider I/O) and watch the sanitized `[ExplicitDisconnectCleanup]` page/retry logs and `[OAuthDisconnect]` lifecycle/recovery logs after an approved rollout.

1. Start provider deauthorization when the partner supports it.
2. If the partner call fails transiently, record the shared disconnect-pending state and pause new work rather than pretending the connection is gone.
3. Keep disconnect available even when a formerly-Pro user no longer has entitlement.
4. Use the scheduled pending-disconnect retry workflow; add the provider token root to its collection configuration.
5. When cleanup runs, recursively remove provider token subtrees and feature-owned operational state, including every ingress/source queue, its DLQ copies, optional mappings, history leases, and pending disconnect state. Workers must also recheck the exact source connection before unchanged-item shortcuts, inside any persistence transaction that follows provider I/O, and immediately before downstream fan-out, because cleanup can race already-running work. Pass the originally captured lifecycle fence into persistence rather than recapturing after I/O, and remove any newly uploaded external object when the guarded transaction rejects while preserving the prior committed object. If external-object deletion can fail, transactionally persist a backend-only, deletion-safe reservation containing the exact object path before uploading anything; do not upload if that write fails. Treat a rejected external-object write as ambiguous: keep its original delayed reservation even if an immediate delete reports success, because the write can become visible afterward. Lease active reservations beyond the worker timeout, make cleanup idempotent, path-bounded, and aware of any object that later became committed, and provide a recurring bounded re-drive in addition to finite event retries. Put deletion-surviving cleanup state outside the recursively deleted user subtree, deny browser access, and make account cleanup invoke the same reconciler without deleting an active lease. Do not use TTL for unresolved reservations. Carry that lifecycle into downstream queue rows, recheck it in the queue-admission transaction, and recheck it when the downstream worker claims and performs the irreversible provider operation. If a rollout introduces strict lifecycle generations for legacy credentials, backfill them only after server-side provider verification or from an existing provider-authorized binding; update that binding atomically, preserve every existing nonempty generation, and never promote legacy token-tree contents as authority by themselves.
6. Assign each pending-disconnect episode an opaque generation and copy it to every parked queue row. Parking must transactionally recheck the authoritative token-root state. Release must transactionally prove that the token root has no live pending episode; once clear, it should reopen every older parked generation for that service. This lets a newer live episode block a stale clear without leaving rows from an earlier episode stranded after the authoritative state is eventually cleared.
7. Carry both the disconnect-episode generation and active OAuth credential generation through provider cleanup. Recheck them immediately before provider deauthorization, inside local credential deletion, and again before recording a retry failure so stale disconnect work cannot disable or delete a newly authorized connection.
8. Capture subscription-enforcement token queries and their token-root generation in one read transaction. Bind each local deletion to both that lifecycle generation and the captured token document version, falling back to an exact credential snapshot only when version metadata is unavailable. This includes same-document replacements.

Scheduled cross-user repair scans must use bounded ordered pages, durable cursors, and bounded concurrency. A partial repair marker is intentionally idempotent: advancing past a failed row may delay it until cursor wraparound, but must never make it unreachable.

If the provider exposes a binding/status endpoint, check it server-side when the browser opens the connection overview rather than trusting token-document presence. Project only a safe checked state and timestamp. An authoritative unbound response should atomically mark reconnect-required and disable every automatic route involving that provider after proving the credential and account are still current; a timeout, malformed response, or stale result must leave connection state unchanged and offer a retry. Browser request coalescing is not provider-quota protection: reuse recent results server-side, claim a short per-account in-flight lease before the upstream call, and enforce or monitor an aggregate provider budget. The response write must still own that lease and match the credential/account revision. Reject exhausted capacity before the provider call, emit structured saturation logs, and leave a short backoff lease after provider failures.

COROS overview checks also pause during frontend connection actions. Bind local coalescing and result handling to the originating user, provider account, connection generation, and request revision. A successful local disconnect and the completed disconnect's cleared lifecycle state take precedence over older account summaries while metadata and projection triggers catch up; legacy connections without a generation remain supported. Invalidate earlier checks when disconnect starts, resume eligible checks after cancellation, and resume a disconnected account only for a new connection generation. Ignore obsolete failures before changing retry state or reporting to Sentry, while keeping current failures observable and preserving server quota/authorization controls. Verify pending/completed disconnect, same-account reconnect, account switches, delayed rejection, and normal Retry with mocked calls. This UI guard requires only the normal approved Hosting release and has no Functions, persisted-data, or MCP impact; see [COROS account identity](coros-integration.md#account-identity).

For COROS, the OAuth callback route must pause binding checks before the metadata subscription starts callback processing. After callback navigation clears the parameters, reevaluate the current metadata rather than waiting for another snapshot. Reevaluate after disconnect completion too: a newer connection generation can become eligible while the disconnected generation stays blocked. Guard completion effects after view teardown. Cover these subscription/action ordering cases in component tests, including retained existing-account metadata during OAuth.

### Credential documents and connection projections

OAuth token roots and children are backend-owned data, including for an authenticated owner. The browser must derive connection UX from a bounded `users/{uid}/meta/{service}` projection rather than reading token collections. Project only the account fields the existing UI needs (stable account identity where multiple-account or route provenance behavior requires it, connection time, and bounded permission metadata); never project access/refresh tokens, OAuth or credential generations, provider response bodies, or operational authority. The projection is display and selection context only and must never authorize provider work.

Maintain the projection from trusted backend token writes with retryable, idempotent triggers. Reject out-of-order trigger revisions, recheck the account-deletion guard in the projection write transaction, and write an empty account array after the last credential is removed. Rules must allow only the owner to read service metadata and deny browser writes. Before changing credential Rules for an existing provider, prepare and run a one-off, guarded backfill for every existing token root, then release in this order:

1. Deploy the projection triggers while the old browser reads still work.
2. Run the one-off backfill in dry-run mode and inspect its summary.
3. Apply it with an explicit confirmation, then repeat the dry run and verify expected root/account coverage.
4. Deploy the projection-aware frontend with a temporary field-absent-only fallback to legacy owner reads. An explicit empty projection must remain authoritative so disconnect cannot revive stale token state.
5. In a separate follow-up release, remove that fallback and deploy Rules denying token-root and token-child reads. Keep the triggers deployed so reconnect, refresh, retained-account, and disconnect changes remain synchronized.

Do not combine or reverse steps 4 and 5 in the initial release: an older frontend and the projection-aware frontend's field-absent fallback may continue to use the legacy read temporarily, but denying credential reads before the existing-account projections are verified makes connected accounts appear disconnected. The initial projection release must preserve both compatibility layers; the follow-up release removes both together.

Garmin, Suunto, and COROS completed this rollout in September 2026: the production backfill converged with no pending updates or failures, the frontend fallback was removed, and browser reads and writes against their token roots and descendants are denied. The one-off backfill tooling was then retired. Their backend projection triggers remain the only synchronization path for connection-account metadata.

### Subscription enforcement

If a provider is Pro-only, add it to the scheduled entitlement scan and its token-root discovery. Decide whether an entitlement restoration clears a pending disconnect or requires a fresh user connection; document the result in the provider-specific guide and Help content.

### Account deletion

Account deletion is not merely token deletion. Add provider identity discovery and recursive cleanup for all feature-owned top-level state, including queue items, DLQ records, optional mappings, leases, and scheduler cursor/checkpoint documents when keyed by user. The deletion tombstone is the durable signal; missing user roots alone are not enough.

Existing imported events are product-policy decisions. State explicitly whether disconnect, entitlement expiry, and account deletion each retain or remove them. Wahoo retains imported events on disconnect but removes account-associated data on account deletion.

Unified health history is retained on provider disconnect and removed on account deletion. Its collections live below `users/{uid}`, so the native account owner prepared in this phase recursively covers them (the installed extension remains until separately approved cutover); provider adapters must not delete historical health source records during ordinary deauthorization.

The existing Gen 1 `cleanupUserAccounts` owner replaces the installed extension's
configured Firestore/Storage scope, using 1 GB memory, a 540-second timeout and
retries. It keeps its Auth deletion trigger, runtime identity and provider secrets;
tenant users are ignored because these UID paths belong to default-project accounts.
Deploy the write fences and UID-bearing mail writers, update this owner, verify
cleanup, then retire the extension under a separately approved cutover. Keep
`cleanupUserAccounts` deployed after retirement. The source comparison found that
extension 0.1.30 uses a bare Storage prefix, which can include a longer custom UID,
and interprets replacement tokens in custom UIDs. Resolve both extension scope
issues before approving overlapping deletion. See the runbook source comparison.

The deletion owner checkpoints provider identities before removing credentials or UID-owned queue sources. Failed discovery/checkpoint reads preserve those sources; mandatory local failures continue independent cleanup and then fail the Auth event for retry. Pending tombstones have no expiry. Completion follows scoped Firestore/Storage/operational absence verification, including deferred original-file and disconnect intents, and only completed markers receive a seven-day TTL. Provider deauthorization/archival remain best-effort and remote copies can remain. See [Delete User Data extension replacement and recovery](delete-user-data-migration.md) for exact scope, release boundaries and the existing activated monitoring coverage (#836).

Operational queue and MCP targets are checkpointed before recursive deletion so retries can remove descendants after a parent disappears from ownership queries. Replay validates the fixed collection allowlist and current ownership. Every recursive child/root delete transaction checks the selected parent revision or continued absence and the current attempt; provider-only targets retain minimal lookup attribution and recheck connected credentials transactionally even after their parent disappears. A native recursive BulkWriter bounds this at ten concurrent transactions and commits queue tombstones with root removal. Changed or unavailable ownership keeps cleanup pending; provider-only identifiers remain scoped to their own provider. Completion and checkpoint removal require the current cleanup attempt, preventing stale invocations from releasing the fence. Exact UID/provider queries are paged at 100 rows for discovery, deletion and readback; unrelated queues are not globally scanned, and canonical safe numeric legacy provider IDs are covered alongside strings. See the native-cleanup runbook for recovery and release gates.

The latest native account owner also checkpoints provider attribution from `connectionHistoryImports`
before deleting those UID-owned trees. It invokes the existing UID-scoped `activitySendUploadCleanup`
reconciler and keeps the completion fence pending until all reservations have cleared; future upload
reservations and active cleanup leases must survive user-root deletion. The hourly activity-send owner
retains its role. The account owner preserves #836 telemetry and its existing Gen 1
structured/native failure coverage; no monitoring resources or activation changes are required.

## 9. Frontend, help, public pages, and attribution

The frontend should reuse the Services and provider-presentation patterns rather than create a one-off integration page.

### Required product surfaces

Garmin's connection overview displays supported permissions per browser-safe account snapshot, including optional
Training and Course Import grants. `WORKOUT_IMPORT` is displayed as **Training** in UI, help and delivery errors;
retain the API identifier in authorization checks. Explicit empty arrays mean not granted; absent or malformed arrays mean not reported,
not denial or endless loading. Deferred `MCT_EXPORT` (#621) is excluded from the catalog and display even if already
granted; it is not required by QS. Other extra provider permission names remain visible as text, and separate accounts' grants
are never combined for display or authority. The rows are a last-reported snapshot, not a live Garmin check or local
consent toggles. **Manage in Garmin** opens the existing connected-app management path. Healthy connections have no
**Reconnect** or reauthorization upsell, including when grants are missing or unknown. **Reconnect** remains only for
reconnect-required or manual-review disconnect recovery; disconnected accounts retain **Connect**. Permission callbacks
update the saved grants. Do not require an explicit disconnect to refresh consent: it disables other sync routes.
Pending disconnect/reconnect actions cannot overlap, and merely rendering the
view does not contact Garmin, refresh credentials, change grants, or opt workouts into delivery.
History and route-upload tools distinguish a pending projection from an unreported/malformed permission snapshot;
the latter directs users to Garmin permission management or support instead of a permanent spinner. Permission checks normalize the
same grant names as the overview. Locked Garmin tools use explicit keyboard-accessible Pro buttons, not clickable
panels, with one selection haptic per action.

The shared connection view binds OAuth URL/callback completion and disconnect confirmation/result feedback to the
originating UID and view revision. Account changes clear old projections and pending UI state; teardown and account
changes dismiss the owned confirmation and discard late redirects, navigation, status, and haptics. Provider-specific
initialization also checks teardown before creating secondary connection listeners. Disconnect locks
before confirmation so duplicate actions and reconnect cannot overlap. This suppresses stale client effects without
cancelling or reauthorizing server work already started for the original account.
OAuth-start and disconnect requests also capture the Firebase auth user instance and UID. Their optional local
dispatch check runs after App Check readiness/refresh and before every disconnect retry, so a delayed client attempt
cannot move to a replacement signed-in account or a closed view. The check is never sent to Functions and does not
replace Auth/App Check or server connection fencing; an already dispatched request is not cancelled.

- Add the provider to `ServicesComponent`, its navigation order, connection-state map, query-param selection, and focused tool-dialog switch.
- Create or adapt a provider service component using `ServicesAbstractComponentDirective`. Keep connection summary and advanced tools compatible with the dialog contract (`showConnectionSummary`, `showAdvancedTools`, `activeProviderTool`, and `showOnlyActiveProviderTool`).
- Show connection, reconnect, disconnect-pending, locked/Pro, loading, and history states accessibly. Upsell actions must be actual buttons, not a click handler on a non-interactive panel.
- Add the provider to `AppUserService`, source icons, dashboard prompts only when relevant, and shared provider presentation helpers.
- Add/update `/integrations/<provider>` when it has product/search value. Update route metadata, server prerender routes, sitemap/robots, internal links, the integrations hub, public Help, policies, and tests together.
- State supported and unsupported workflows plainly. Do not imply that a connected provider supports routes, sleep, uploads, or provider-to-provider sync when it does not.

Provider overview cards must name combined history imports consistently with their focused tools. Suunto uses
**Sleep & 24/7 Health history** and **Import history** because the production path queues both datasets; its focused
history dialog remains availability-aware and falls back to Sleep-only wording when the independent Health switch is off.

Use `app-service-source-icon` and the shared presentation helpers. Imported activity surfaces use source attribution; connection and destination surfaces use destination branding. See [connected-provider attribution audit](connected-provider-attribution-audit.md).

## 10. Admin and operational coverage

Account cleanup and disconnect recovery monitoring (#836) is deployed and enabled in
the independent `tools/cleanup-monitoring/` bundle: nine fixed-label metrics, seven policies
and the **QS Account Cleanup & Disconnect Recovery** dashboard. It reuses existing
30-minute recovery page reads and committed lifecycle outcomes, with no extra Firestore
reads/writes, index, collection, observer Function or schedule. Local completion, Auth
handler ACK, remote-unconfirmed revocation and independently unfinished extension cleanup
are not interchangeable. Completed deletion tombstones are not backlog, and bounded-page
deferrals/stale generations do not count as failures. A dedicated first-observation email
policy covers failed/unconfirmed partner revocation for all four providers, even if local
credentials are subsequently removed; it does not claim the partner is definitely active
or change retry/token-retention behavior. Existing #655 Training cleanup alerts
remain unchanged. Help, provider behavior, deletion fences, recursion and MCP/Assistant
contracts are unchanged. The owner approved deployment and activation on 19 October
2026; twelve existing Functions are ACTIVE and all 29 chart/condition queries passed
live readback. The natural 11:07 UTC recovery run acknowledged with all thirteen
uncapped idle pages, and positive post-correction Monitoring heartbeat/page series
were verified at 11:08–11:09 UTC. No destructive QA or test mail was needed; this
completes #836's approved operational verification, not actual deletion/revocation
proof. See [the cleanup monitoring runbook](account-cleanup-monitoring.md).

Email/marketing monitoring (#835) is implemented locally through the existing Firestore `mail` outbox and Trigger Email
extension, separately from fitness-provider queues. New mail initializes supported PENDING metadata in its original
write, without another collection, observer Function, scheduler, send or retry. The existing marketing dispatcher
adds a bounded masked read-only sample every 15 minutes; existing delivery tracking emits fixed state categories.
Its independently owned dashboard/twelve metrics/seven policies reuse the direct Alerts channel and shared provisioner,
with separate deployment/apply/readback approval still required. SMTP acceptance is not inbox delivery or reading;
caps, schedules, pauses, suppression and empty campaigns are excluded from failure/stall pages. No MCP/Assistant,
provider availability, consent, TTL, Help or fitness queue behavior changes. See the single detailed
[email lifecycle and activation runbook](email-lifecycle.md#cloud-monitoring-835).

The four recorded-activity source dispatchers (`parseGarminAPIActivityQueue`, `parseSuuntoAppActivityQueue`,
`parseCOROSAPIWorkoutQueue`, `parseWahooAPIWorkoutQueue`) use direct `queue` owner-module loading instead of the full
entrypoint. They retain Gen 1, `europe-west2`, maximum one instance, their existing memory/timeouts, no secrets and
the same 30-minute schedule. Dispatch, recovery, lifecycle guards and #829 telemetry are unchanged; monitoring
continues using `cloud_function` for dispatchers and `cloud_run_revision` for the Gen 2 worker. See the
[entrypoint contracts and local benchmark](functions-entrypoint-loading.md#recorded-activity-import-dispatcher-isolation).
This startup optimization changes no provider behavior, availability, MCP contract or user-facing Help.

Recorded completed-activity import monitoring (#829) uses fixed-label commit/attempt
telemetry, bounded read-only observations on the existing 30-minute dispatchers, and a
separately owned Cloud Monitoring dashboard with six policies, activated with the existing
Alerts email channel on 7 October 2026 after the approved five-Function deployment.
It is not Training delivery monitoring and does not change any provider's availability. See
[activity import monitoring](activity-import-monitoring.md) for sample limits, exclusions,
unknown observations, thresholds, cost bounds and the separately recorded production
activation/readback evidence in #829. Future cloud changes still require separate approval.
HTTP acknowledgements and historical retained `failed_jobs` totals are not import success
or a new failure rate. No provider calls, retry/TTL changes or production apply are part of
the local implementation. Unexpected observation/client-initialization errors remain
isolated from the dispatcher's original result or error; unavailable observations are
visible rather than converted into an empty backlog.
The shared monitoring provisioner rejects malformed inventories and mismatched managed
policy identities before any cloud writes; a title alone cannot adopt another policy.

Connection-history coordinator monitoring (#847) was **activated on 9 October 2026** after
separately approved Functions deployment and monitoring-bundle apply using the existing
Alerts email channel.
Its separate `tools/connection-history-monitoring/` bundle reuses shared provisioning,
covering the dedicated task queue and all four existing Gen 2 endpoints with native
metrics, plus fixed-category post-commit/failure signals and six alert policies.
The unchanged once-per-minute recovery observes a masked, read-only sample of at most
20 due runs on UTC quarter-hour ticks, within five seconds. Expected capacity, future
retries, leases, permissions/cooldowns and superseded/disconnected/deleting accounts
do not produce failure pages. Capped/unknown observations cannot assert healthy zero.
Matching committed receipt keys keep checkpoint recovery observable without new
provider admission; receipt payloads are not read and keys are never logged.
Downstream ingestion remains owned by #829/#830; request submission, worker ACK and
committed ingestion are distinct. Provider behavior, retry policy, scheduler cadence,
Function runtime resources, Help and MCP contracts are unchanged. Production readback
verified the dashboard, all 14 metrics,
six valid enabled policies, all 18 chart and nine condition queries, native runtime/queue
coverage and positive post-creation heartbeat points for all four providers from the
natural 13:15 UTC tick. Actual absence conditions were initialized, and count/age samples
were real idle zeroes. A second apply preserved resource/condition identities without
duplicates or deletion; unrelated resources and every notification channel stayed unchanged.
Existing same-channel email proof is reused, with no new email test or manual invocation.
Future cloud changes still require separate approval. See the authoritative
[connection-history monitoring runbook](connection-history-import.md#coordinator-monitoring-847)
for signals, bounds, costs, thresholds, exclusions and the activation checklist.

Health/Sleep monitoring (#830) has a separate bundle, activated on 7 October 2026, for the ordinary
`processSleepSyncTask` and single-task `processGarminHealthBackfillTask` queues. It reuses
the ordinary worker invocation summary and adds post-commit terminal observations and
a bounded, field-masked probe on the existing dispatcher. Garmin, Suunto and COROS
ordinary ingestion remain distinct from intentionally paced Garmin historical requests.
The probe excludes superseded connection metadata; unknown metadata is not healthy zero.
Native HTTP attempts remain diagnostic only, since expected contention also retries;
classified processing failures, unavailable observations and missing heartbeats alert separately.
Its three affected Functions and owned dashboard/11 metrics/six enabled policies were
deployed/applied with separate approval and verified through production API/query readback,
reusing the existing Alerts email channel. It was not activated by the #829 deployment.
Final 8 October read-only verification confirmed positive post-creation heartbeat,
sampled-count and sampled-age series for all four lanes, plus all thirteen chart and
fourteen condition queries. Dated activation and observation evidence are recorded
in completed #830; idle bounded samples do not prove global coverage, and earlier raw
logs were not substituted for metric-series proof. Future changes still require separate approval.
See [Sleep sync operations](sleep-sync-operations.md#cloud-monitoring-830) for meanings,
exclusions, thresholds, costs and activation steps. HTTP ACK, request-campaign completion
and received Health/Sleep records are different outcomes; idle feeds are not an outage.
All three affected handlers use direct owner-module target loading. The Garmin backfill
worker retains Gen 2, 512 MiB, 1,800 seconds, Garmin secrets and one-at-a-time task pacing;
the existing dispatcher retains Gen 1, 256 MiB, maximum one instance and its 30-minute
schedule. Monitoring coverage is unchanged (`cloud_run_revision` workers / `cloud_function`
dispatcher); see the [entrypoint verification](functions-entrypoint-loading.md#healthsleep-backfill-and-dispatcher-isolation).
No provider availability, queue concurrency, retry policy, MCP/Assistant permissions or
user-facing Help behavior changes.

Provider parity includes operational visibility, not only a user-facing connection.

Recorded-activity **outbound delivery** monitoring (#832) covers `activitySyncQueue`,
`processActivitySyncTask` and `dispatchActivitySyncQueue`, separately from the above
inbound imports, Health/Sleep and Training workouts. Fixed-label post-commit outcomes
distinguish confirmed delivery, accepted/pending provider processing, actual retries,
new DLQ transitions and new durable manual-reconciliation cases; HTTP ACK is not
delivery success. A bounded field-masked read-only probe reuses the existing
30-minute dispatcher, excludes normal backoff/future/lifecycle waits, and checks
overdue accepted Wahoo/COROS polls without resending. Its sample is a lower bound,
not global coverage. Deterministic task deduplication does not count as a dispatch
failure. Accepted polls stay observable if new-send allowlisting changes, while
invalid scheduling metadata reports unknown rather than healthy zero.
Recognized Suunto `NEW`/`PROCESSING` waits also remain distinct from actual failures;
their existing Cloud Task retry/resume behavior is unchanged, and unknown statuses,
transport failures and retry exhaustion stay visible.
Both handlers have isolated target loading with unchanged
runtime generations/resources. Their separately approved 8 October 2026 deployment
passed active-state/configuration readback, retaining the existing scheduler and task
retry/rate limits. The separate dashboard, twelve log metrics and seven enabled
policies were subsequently activated with separate approval using the existing Alerts
email channel. Production configuration and all fourteen dashboard queries passed API
readback on 8 October; unrelated resources and notification channels stayed unchanged.
The next natural 07:00 UTC run produced positive post-creation heartbeat time series
for Suunto, Wahoo and COROS, verified through Monitoring at 07:01 UTC. A natural
Garmin-to-Suunto committed delivery also reached its distinct success metric. This
completes #832's operational evidence without manual processing, fault injection or
new test emails; idle bounded samples do not claim complete backlog or device receipt.
See [activity delivery monitoring](activity-delivery-monitoring.md) for semantics,
privacy, exclusions, costs, tests and activation steps. No provider support,
availability, retry/TTL/concurrency, Help or MCP/Assistant contract changes.

Route import and outbound-copy monitoring (#833) is a separate workstream. Its first
slice, deployed on 2026-10-08, adds fixed-category post-persistence outcomes and whole-task attempts to
`routeSyncQueue` / `processRouteSyncTask` and `routeDeliverySyncQueue` /
`processRouteDeliverySyncTask`, plus private-data-free rejected-original cleanup
diagnostics. Worker attempts include payload/read failures; observation-only logger
failure cannot turn an ACK into a retry. An ACK, stale revision, deferred item, or durable
manual-review blocker is not a successful route send. The follow-up, deployed from
`67cce336d` on 2026-10-08 at 09:50 UTC, adds masked,
bounded import/delivery eligibility observations on the existing 30-minute outbound
dispatcher, actual immediate/reconciliation dispatch failures, and an isolated Gen 1
dispatcher loader with unchanged resources. It excludes lifecycle/revision/permission
skips; incomplete zero samples are unknown, not healthy. No probe calls providers,
refreshes credentials, pins accounts, writes queue state or changes dispatch decisions.
Firestore sub-millisecond commit timestamps remain valid and their observed age rounds
down; COROS account-ID fallback accepts only absent/empty values, matching its worker.
The import probe does not invent a blanket Pro gate: unchanged/unlisted inbound work
may be retired, while new/changed imported-route persistence still requires Pro.
Restoration markers do not hide
incoming imports, enabled outbound directions or manual copies that workers may process;
disabled automatic directions and persisted restoration deferrals remain excluded.
The five affected route Functions were read back as ACTIVE with unchanged resources,
secrets and triggers; native task-queue rates/retries and the 30-minute scheduler were
also preserved. Its natural 10:00 UTC run emitted all four complete idle sample groups.
The independent source-controlled bundle provides one dashboard, 16 log metrics
and eight policies, including both dispatch generations and rejected-original cleanup.
Offline tests cover filtering, ownership, pagination and serial reapplication without
touching the four earlier monitoring bundles. Its separately approved production apply
from `94bc51e35` completed on 8 October by 10:18 UTC using the existing Alerts email
channel. API readback confirmed the owned resources and eight valid enabled policies;
all 19 chart and 12 condition queries passed, plus native-series checks for both route
queues. Unrelated monitoring configuration and all notification channels remained
unchanged. The natural 10:30 UTC run initialized all four heartbeat groups; Monitoring
readback at 10:31–10:32 UTC confirmed positive post-creation heartbeat points and real
idle zero count/age observations for import/QS and delivery/Garmin, Wahoo and COROS.
The actual heartbeat conditions saw those points, and both dashboard hourly-mean
queries returned zero for every group. All eight policies remained valid/enabled.
This completes #833's operational evidence without claiming complete queue coverage
or provider receipt from bounded samples.
No new Functions deployment, provider call, route mutation or test email was needed
to apply the bundle. Its route CLI resolves symlinked entrypoint paths without changing
approval or provisioning semantics. Provider behavior, Help and MCP contracts remain unchanged. See
[route monitoring](route-monitoring.md) for semantics, completed verification,
resources and operational diagnosis. Help and MCP/Assistant contracts are unchanged.

Garmin's temporary `garminWebhookProbe` tested URL transport and discarded incoming payloads. PR #800 removes its
source and deployment exports. After saved portal URLs use the protected production receivers and real ingestion
is verified, retire the existing cloud Function through the exact, separately approved
[probe retirement procedure](garmin-integration.md#temporary-webhook-url-probe). Deploying only the four receivers
does not delete the probe. No account, queue, secret or provider data is removed; Help and MCP contracts have no impact.

### Required current admin parity

- Add the provider queue collection to `getQueueStats` so the Queue Monitor reports pending, succeeded, stuck, dead-letter, retry-bucket, throughput, and lag statistics.
- Include its queue collection in ingestion DLQ analysis and error clustering.
- Add the provider token root to admin user filtering and user enrichment so admins can filter connected users and see the connection date.
- Add the provider logo to Admin User Management and Queue Monitor.
- Keep all these functions under the existing admin callable authorization. Never expose raw token or queue data to normal users.

The current admin UI is aggregate observability. It does not provide provider-specific inspection, replay, or requeue actions for the normal activity-ingestion queues. Do not add a Wahoo-only manual retry control without defining an equivalent safe, audited queue-operation model for every provider it should cover.

The Activity Sync queue view also breaks out historical sends (`deliveryMode: historical`) and manual uploads (`sourceServiceName: manualUpload`). Manual origins include historical archive originals and direct temporary sources, so the rows must not be added together. Each reports pending, succeeded, stuck, provider reconciliation, and dead-letter counts from the retained queue and failed-job documents; these are not lifetime delivery totals. A reconciliation row can also have a dead-letter copy, so those columns can overlap. Admin count queries need the activity-sync and failed-job composite indexes in `firestore.indexes.json` before the updated callable is released. An unavailable query is shown as **N/A**, not zero.

### What to monitor after release

- OAuth starts, callback failures, provider denial/cancel rates, duplicate or ambiguous provider identities, and token-refresh failures;
- webhook authentication failures, accepted/skipped payloads, duplicate/superseded revisions, and history lease/reservation collisions (expected manual contention remains HTTP 409, with INFO diagnostics for Suunto/Garmin, while all four providers' frontend presents it as a wait status);
- queue depth, age/lag, retries, stuck work, DLQ growth, and Cloud Task dispatch failures;
- provider 429s, pagination errors, signed-file download rejects, timeouts, parsing failures, and original-file retention failures;
- disconnect-pending age, deauthorization failures, entitlement enforcement, and cleanup/deletion failures.

Use structured logs with safe identifiers and error categories. Do not put token values, authorization codes, signed URLs, file query strings, or full raw partner payloads in logs, analytics, or admin responses.

Outbound semantic FIT fingerprint failures and unexpected manual activity-parser failures use the shared
`activity-parser-diagnostics` allowlist. It records a diagnostic ID (alongside the platform request trace), Sports Lib
version, format and payload byte length, known error names/codes/literal messages, a bounded-message hash, and package
line/column plus an allowlisted package-relative importer module, without raw stack paths. For JSON payloads up to
64 KiB, it records only root type, `DeviceLog` presence, and whether `Samples` is an array; larger payloads are not
inspected again. FIT signature and declared data-length facts are structural only. Unknown messages
are withheld rather than relying on credential-only redaction to remove file content. Fingerprint failures remain
WARNING and explicitly report `exact_only` fallback; exact-byte receipts remain available. Do not lower this warning
until the new diagnostics explain the affected files. Manual route/course rejections retain HTTP 400 with the stable
`route_file_in_activity_upload` code; the browser offers an explicit Routes navigation action after all active manual
upload batches finish, including overlapping batches. Later per-file errors or the generic batch summary must not
replace this action, and account changes or teardown suppress it. Unexpected manual parser failures additionally use
the separate [failed-file debug captures](#failed-file-debug-captures) described above; diagnostic expiry and the
remaining account-deletion-cleanup boundary are documented there. Route/course rejections remain uncaptured.
Manual parsing and route-only warning logs include the authenticated UID and a SHA-256 digest of the parsed payload,
so exact re-submissions can be distinguished from similarly sized files even across account recreation. FIT parsing
warnings also include the bounded FIT-envelope reason; `valid` means the envelope length is complete, not that the
file contains an activity or has a verified CRC. Never add raw filenames or FIT contents to these warning logs.

## 11. Test plan

Add deterministic tests next to the code being changed. The minimum set for an activity-import provider is below; add cases for every provider-specific rule.

| Area             | Required assertions                                                                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared contracts | Service enum/metadata, provider presentation, source icon, function manifest, and required configuration validation (plus any explicitly approved rollout gate).                                  |
| Health/wellness  | Native/canonical semantics, source attribution, coverage, missing-data behavior, ordered revision replacement, bounded chunks/queries, conflict preservation, Sleep references, disconnect retention, and deletion guards. |
| OAuth            | State binding, approved redirect, explicit provider denial, incomplete callback, token refresh/rotation, stable identity, duplicate handling, and disconnect after entitlement expiry.             |
| API boundary     | Request timeout, input normalization, pagination, rate-limit mapping, secret redaction, and no unsafe retry behavior.                                                                           |
| Webhook/history  | Health and delivery acknowledgement, authentication, entitlement/connection/deletion rejection, lossless 64-bit IDs, deterministic IDs, duplicate delivery, out-of-order or newer revision, inclusive/date-window boundaries, skip rules, and lease contention. |
| File worker      | Allowed host/redirect checks, unsafe URL rejection, size/type/FIT validation, missing/expired URL detail recovery, metadata preservation, timeout, retry/DLQ behavior, and original-file persistence. |
| Lifecycle        | Disconnect pending/retry, entitlement enforcement, cleanup ownership races, recursive deletion, and account deletion guards before every write.                                                 |
| Rules            | Token/queue client denial, optional-mapping denial, and safe owner metadata read.                                                                                                               |
| Frontend         | Provider navigation, query selection, server-verified connection states and retry behavior, focused tool dialog, live history-lease reopen/clear/expiry/renewal and duplicate status, teardown feedback, Pro and keyboard-accessible upsell behavior, help, policies, integration page, route metadata, sitemap, and logo. |
| Admin            | Queue stats inclusion, user filter/enrichment, labels/logos, and existing admin authorization.                                                                                                  |

Run the narrowest tests after each edit round, then run the relevant builds before handoff:

```bash
# Frontend
npx vitest run <affected-frontend-specs> --reporter=verbose

# Functions
npm --prefix functions test -- <affected-functions-specs>
npm --prefix functions run build

# Firestore and Storage Rules
npm run test:rules

# Application build
npm run build

# sports-lib, when its shared provider contract changed
npm --prefix ../sports-lib test -- --runInBand <affected-sports-lib-specs>
npm --prefix ../sports-lib run build
```

Run commands from the appropriate checked-out worktree. Do not deploy, publish, or push as part of implementation verification.

## 12. Release and rollback checklist

This is the general checklist for new integrations. The live Training rollout in #655 is an explicit exception to
disabled-by-default staging and code rollback requirements: Garmin, Wahoo and Suunto have approved enablement; COROS
remains disabled. Do not reinstate gates or require a rollback implementation/rehearsal for that completed launch.
Normal Stop, disconnect, deletion safeguards and separate approval for future deployments still apply.

1. Verify the provider agreement, production review, privacy terms, allowed scopes, redirect URIs, webhook registration, exact file hosts, and brand assets.
2. Publish required shared-library changes first, then update application lockfiles to the published version and verify a clean install resolves it.
3. Add production configuration through the approved secret/configuration process. If an explicitly approved staged rollout uses a feature gate, keep it disabled until all code, Rules, indexes, TTL policy, queues, and hosting artifacts are ready.
4. Deploy through the normal release workflow in dependency order. Exercise sandbox or test-account OAuth, webhook, history, revision deduplication, rate limiting, disconnect, expired entitlement, and account deletion.
5. Watch the operational signals above before broad enablement. Enable gradually only when the provider has an intentionally implemented staged rollout.
6. Define rollback before launch. If an approved feature gate exists, it should stop new connections, webhooks, and history requests without deleting existing user data or blocking disconnect. Decide whether accepted queue work drains and document that behavior.

## 13. Pitfalls to avoid

- **Treating OAuth as the integration.** OAuth only grants access; stable identity, safe storage, refresh, webhooks/history, worker behavior, cleanup, and product scope still need implementation.
- **Processing partner requests inline.** Webhooks and callables can be retried or time out. Queue durable work and process asynchronously.
- **Using timestamps or titles as identity.** Activity names and start times can change or collide. Use stable provider IDs and revision data.
- **Assuming pagination order or date semantics.** Test inclusivity, timezone, order, page termination, and rate-limit behavior with partner-shaped payloads.
- **Storing an ephemeral signed file URL.** Validate and download it promptly, then retain the owned original file; never log the signed URL.
- **Trusting a partner URL.** Defend against SSRF, redirects, private addresses, oversized responses, invalid content, and unbounded requests.
- **Checking account deletion only at ingress.** Deletion can begin during download or parsing. Guard before enqueue, processing, persistence, and transactional follow-up writes.
- **Deleting a root document non-recursively.** Token roots and feature state can have subcollections. Use `recursiveDelete` for subtree-capable cleanup.
- **Copying Sleep or flattening provider health into one preferred value.** Keep `sleepSessions` canonical, reference allowlisted aggregates, preserve every source observation, and make any future source-selection policy explicit.
- **Making disconnect dependent on Pro.** Users must be able to revoke access after their plan changes. Separate connect/import authorization from disconnect authorization.
- **Giving the client access to useful-looking operational fields.** Token roots, optional mappings, queues, retry state, and disconnect controls are backend-owned even when the browser shows a connection badge.
- **Adding only the service card.** A provider is incomplete without help, policies, integration page/SEO where appropriate, attribution, Rules, admin visibility, cleanup, and tests.
- **Adding an admin action without an operation model.** Aggregate monitoring is safe by default. Manual retry/replay must define authorization, idempotency, deletion checks, auditability, rate limits, and cross-provider parity.
- **Forgetting deployment order.** A released app must not depend on an unpublished sports-lib version, missing Cloud Task queue, missing index, missing Rules deployment, or unregistered webhook/redirect URI.
- **Letting the guide drift.** Update this guide and the provider-specific document whenever a capability, provider list, lifecycle rule, admin surface, or release requirement changes.

## Change checklist

Use this checklist in every provider integration PR or implementation handoff:

- [ ] Product scope and unsupported behavior documented.
- [ ] Partner/API, privacy, retention, and launch constraints recorded.
- [ ] Shared service/presentation/manifest/config contracts updated.
- [ ] OAuth, stable identity, server-only storage, and safe metadata implemented.
- [ ] Webhook/history ingress is authenticated, idempotent, revision-aware, and rate-limit aware.
- [ ] Worker validates external files, retains originals, uses deterministic event IDs, and sanitizes writes/errors.
- [ ] Queue dispatch, TTL, retry/DLQ, and scheduled safety net are wired.
- [ ] Disconnect, entitlement, pending retry, account deletion, and recursive cleanup cover every owned collection.
- [ ] Firestore/Storage Rules, indexes, TTL, configuration, and any approved feature gate are reviewed.
- [ ] Health/wellness mappings use the unified model, bounded writer/query contracts, source-aware conflicts, and Sleep references without duplicating Sleep data.
- [ ] Services UI, accessibility, icons, source/destination labels, Help, Policies, public integration page, metadata, sitemap, and internal links are updated as applicable.
- [ ] Admin queue stats, DLQ analysis, user filtering/enrichment, and logos are updated.
- [ ] Unit, Rules, frontend, admin, shared-library, and build verification passed.
- [ ] Provider-specific architecture/release document and this guide were updated.
- [ ] Rollout, monitoring, and rollback plan are written before enabling production traffic.

### Connection-history capability registration

For each provider/history API addition, register a versioned capability in `shared/connection-history.ts` and its adapter in `functions/src/connection-history/adapters.ts`, or explicitly declare history unsupported. Contract tests enforce the pairing. Reuse the existing family registry, manual import operation, reservations and canonical queues/writers. Snapshot inventories affect future connections only. Test the bounded range, owner-scoped identity, restart receipts, shared cooldowns, permission failures, replacement credentials and deletion guards; do not add OAuth-specific fetch loops or frontend background orchestration. See [the extension checklist](connection-history-import.md#adding-capabilities).

## Durable one-time activity sending

Temporary FIT staging atomically reserves a backend-only `activitySendUploadCleanup` leaf outside the user tree before upload. Its 15-minute delayed reconciliation survives account deletion and is retained after unknown writes or successful inline deletion. Active failed previews remain resumable; adopted sources are protected after fresh source/account checks. The existing hourly cleanup redrives bounded pages with a 30-minute cleanup claim, exact path/digest/generation checks and 30-minute failure backoff. Account-prefix cleanup invokes the same reconciler and preserves active leases. There is no TTL, new Function, scheduler or provider action. Monitoring is **covered/unchanged** by the existing hourly cleanup failure/heartbeat and account-trigger native errors; pending leases are expected waits. Activation/readback remains deferred to #876. MCP and Training are unaffected.

Workspace delivery-detail counts retain completed provider claims and reset legacy retry history on the private source row before explicit restart. The guarded source/queue transaction and live projection preserve these diagnostic counts without changing worker retry budgets or cumulative worker counters; duplicate projections/rejected replays add no attempts. Monitoring is **unchanged**: provider outcomes, task generations, backlog/worker metrics, labels and alert thresholds are unaffected. No MCP or Training contract changes.

Thirty-day workspace history pruning retains its private expiry marker while recursively deleting public history and every private child collection, removing that marker last. Partial recursive deletion therefore stays eligible for scheduled retry, including nested descendants whose parent was already removed. Monitoring is **unchanged**: the existing hourly cleanup failure/heartbeat observations cover this recovery; no scheduler, queue retention, provider action or telemetry label changes. Saved archive data and accepted queue identifiers remain outside this pruning scope.

The authenticated, noindex `/send-activities` workspace consolidates local recorded FIT/FIT.gz and retained saved FIT delivery to Suunto, COROS and Wahoo. Pro is enforced by the backend for preparation/admission, while owner reads, stopping unclaimed work and checking accepted operations remain available after lapse. It uses existing account scopes and activity workers; automatic sync and legacy endpoint contracts remain compatible. Direct local sources are private temporary files, never archived events. Destination accounts are pinned at review, and explicit revision confirmation precedes durable queue admission. Retained originals preserve their existing provenance and generation checks.

See [Activity sending workspace](activity-sending-workspace.md) for the single detailed lifecycle, quotas, recovery and retention contract. Provider-confirmed processing failure requires an explicit workspace retry; acceptance uncertainty never permits replay. Stop preserves claimed/accepted operations. No Training or MCP provider mutation is added. Release checks include real Rules/demo-emulator isolation, entrypoint contracts/cold imports, private source cleanup, mobile/light/dark layout, Help/Privacy and monitoring activation.

Workspace admission ignores delivery-only progress writes, and delivery projection avoids unchanged row/aggregate
writes while retaining cleanup retries. The shared activity task queue caps active tasks at ten globally; dispatch
rate and exponential retry timing remain unchanged. Typed, unaccepted Suunto initialization failures may use that
bounded retry policy before any FIT bytes are sent; other workspace restarts, accepted/uncertain operations and
terminal review remain protected. See the workspace contract above. Monitoring is **covered/unchanged** by the
existing native queue charts, committed retry/manual-review observations and trigger error/latency diagnostics;
the [delivery runbook](activity-delivery-monitoring.md#workspace-contention-and-initialization-retries) records the
verification/release boundary. No new queue, lease, scheduler, metric, scope, MCP or Training change is introduced.

Queue ownership commits before dispatch so concurrent Stop/admission cannot lose or erase a claim. Local and saved sends recheck the sending window inside provider-claim transactions; reconnect release preserves this authority and the original queue retention. Duplicate temporary sources release quota immediately. Account deletion winning a background transaction is a silent no-op.

Saved-preview criteria are canonical and server-private, allowing the workspace to continue the original paged preview after reload. Deleted selections receive exclusions and empty ranges finish without delivery. Loading/unavailable display reads block replacement drafts and confirmation; aborted transfers have a recoverable result. Stop reconciliation uses the existing retry-enabled operation trigger and a private 50-row cursor, including already admitted unclaimed work. It advances only after source cleanup succeeds and preserves claimed/accepted identifiers. No new worker, scheduler, task queue or external provider action is introduced.

Saved workspace previews check at most five recordings per request, with a cooperative 20-second yield between recordings and the existing private cursor/reply-recovery format. Old 50-row date cursors remain resumable; explicit selections retain canonical ID ordering and the 50-selection limit. No in-flight read or transaction is abandoned. Draft checked/ready/excluded counts and preview-timeout guidance never claim delivery or automatically confirm Send. Manual FIT source filters follow import provenance, not recording-device brand. Fixed-count/duration INFO logs omit identities, file data, dates and cursors. Monitoring is **unchanged**: the reviewed outbound bundle still owns committed delivery/backlog/cleanup outcomes; preview logs do not enter those metrics. See the workspace contract for tests and separately approved callable/frontend deployment. No Rules, index, migration, replay, MCP or Training change is required.

Preparation waits for accepted draft navigation. User changes to destination, source or batch permanently stop the prior view's follow-up work and outcome feedback, including while create is pending and after switching away and back. Cancelled draft navigation is recoverable from Recent sends; same-draft query changes stay active. This frontend recovery change leaves monitoring **unchanged**: no queue states, provider calls, retry/lease policy or telemetry labels change. MCP and Training contracts are unaffected.

Monitoring decision: source definitions cover `direct`, existing task backlog/dispatch/worker outcomes and new temporary-source cleanup failures. Deployment and production monitoring reapplication/readback remain separately approved operational work; track activation in [#876](https://github.com/jimmykane/quantified-self/issues/876).

Interrupted-preview/Stop recovery monitoring is **unchanged**: admission-trigger errors and latency remain native Function diagnostics, stopped rows remain expected lifecycle skips, and the existing hourly cleanup failure/heartbeat observations cover retained temporary sources. Dispatch, worker retry/lease policy, fixed telemetry labels and delivery alert thresholds are unchanged. Offline bundle tests verify coverage; activation/readback is still deferred to #876.

Draft removal commits private cleanup intent before acknowledging the deleted review row. The existing operation trigger drains this intent in bounded 50-row pages and clears it only with successful quota release, including after browser interruption or Storage failure. Saved archive originals are preserved and late staging remains fenced. Monitoring is **unchanged**: removal failures use this trigger's existing native error/latency diagnostics and hourly cleanup remains the expiry fallback; no scheduler, worker retry policy, label, dashboard or alert threshold changes. Recent-send/browser-history navigation resets only stale view invalidation, and row paging allows one active read. These internal lifecycle/display changes have no MCP or Training impact.

Failed late staging writes rearm retired cleanup after save or metadata errors, including when quota was already released. Current Storage generations and private cleanup revisions protect cleanup against overlapping writes/requests. Active failed uploads remain resumable, and account/tree deletion never recreates intent. Existing trigger errors/latency and hourly cleanup-failure observations retain **unchanged** monitoring coverage; no provider identifier, source path or revision is added to telemetry labels.

Saved recording review distinguishes known ineligibility from temporary read failures. Missing/invalid originals remain exclusions; unavailable reads pause preparation and retain the private criteria, cursor and reviewed rows for continuation. This command creates no provider work. Monitoring is **unchanged**: delivery queues, backlog/worker outcomes, retry/lease policy and fixed telemetry labels are unaffected. MCP and Training contracts are unchanged.

Stopping closes retry authority for provider-confirmed processing failures and releases their private temporary files/quota while preserving the failed result and operation identifiers. Finished retryable batches retain the Stop control, including after Pro lapse. Active/uncertain operations retain their sources; saved archive files are never deleted. Cleanup failures remain resumable through the existing Stop cursor and operation trigger. A later confirmed failure after Stop completes releases its source through the existing retry-enabled delivery projection; open failures keep their retry source. Monitoring is **unchanged**: native admission/projection-trigger error/latency diagnostics and the existing hourly cleanup failure/heartbeat fallback cover these release paths, with no new scheduler, queue outcome, worker retry policy or telemetry label. MCP and Training contracts are unaffected.

### Original-file reprocessing monitoring (#834)

Original-file reprocessing monitoring is independently tracked in [#834](https://github.com/jimmykane/quantified-self/issues/834)
and the [reprocessing monitoring runbook](reparse-monitoring.md). It uses existing normal/heavy/route workers
and ten-minute scanners with bounded read-only job observations only on the hourly scheduled tick;
empty queues need one query per collection and progress is read only for eligible outstanding tiers.
There is no new scheduler, provider call, queue state, reparse, admission cap, retention,
retry or MCP contract change. Fixed-label telemetry separates accepted task
admission, whole-attempt ACK, committed rewrite/skip/supersession and same-target/tier progress. Heavy/manual
review and deployment waits are not ordinary failure pages. The four collection-scoped job indexes,
five existing Function updates and dashboard/metrics/policies were deployed/activated with owner approval
on 19 October 2026. Natural heartbeat and representative normal-tier completion/duration
evidence are verified. A native scanner-timeout coverage gap was found when an
HTTP 504/DEADLINE_EXCEEDED request later logged an application ACK, escaping the existing
structured-only discovery-failure policy. A narrow correction adds native Cloud Run
5xx request counts for the two exact scanner services to that same policy and dashboard,
retaining three errors per scanner in an hour and preserving the structured condition.
It adds no log metric, Function, Firestore work or runtime/retry tuning. The owner-approved
correction was applied and verified at 12:28–12:32 UTC on 19 October 2026: ten owned
metrics, seven enabled policies/eight conditions, all 28 chart/condition queries, stable
resource IDs and unchanged unrelated monitoring/channel configuration. #834's monitoring
acceptance criteria are complete; no further Functions deployment was needed. The earlier
504 and explicitly unavailable samples remain recorded as such, not successful/healthy
runs. Exact scope, native-metric limitations and verification are in the runbook.
Future production changes still require separate approval; #543 owns the heavy backlog cap.

A subsequent observation-health email exposed hourly checks starved behind long discovery
passes. The follow-up runs the existing five-second-bounded check before discovery
in both scanners, retaining the hourly cadence, read caps, deletion/privacy fences and
all alert thresholds. With separate owner approval, only the two scanner Functions were
deployed and independently verified ACTIVE at 13:51 UTC on 19 October 2026, preserving
resource/schedule/queue controls and all monitoring. Read-only verification at 17:13–17:14
Helsinki confirmed natural route and normal/heavy samples at 17:06 and 17:08 respectively:
zero eligible sampled pending work, zero unknowns, no truncation or stall, positive sample
series, whole-attempt ACKs and native HTTP 200 for both invocations. The older unavailable
observations remain in the historical three-hour warning window; no CLOSED email is claimed.
No monitoring bundle, index, Rule, worker, provider behavior or MCP contract changes.
See the runbook's starvation follow-up for exact revisions, bounds and limitations.

### Suunto EnergySense parser support

Sports Lib 23.0.0 retains the mapping introduced in 22.0.0 from Suunto JSON/SML Endurance to the existing Stamina family and EnduranceDistance
to Estimated Sustainable Distance plus its source/sampled minimum. Its raw distance unit is assumed to be metres pending
provider confirmation. Cur and Min remain source observations, EnduranceValid is not an eligibility rule, and absent FIT
fields are not synthesized. Canonical metric labels and reparse compatibility are described in the
[reparse runbook](../functions/src/reparse/SPORTS_LIB_REPARSE_RUNBOOK.md#pending-energysense-library-candidate) and
[MCP contract](mcp-server.md#energysense-and-endurance-streams-pending-coordinated-release).

Monitoring review: covered unchanged by the existing import/reparse queue monitoring. This is an offline parser and
presentation extension: no provider transport, scopes, queue state, retry, scheduler, secret, data-write endpoint,
alert condition or deployed resource changes. Existing sanitized persistence and provider outcomes remain authoritative.
