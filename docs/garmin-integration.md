# Garmin Health Integration

This document is the source of truth for Garmin Health API 1.2.4 ingestion introduced by issue #613. Existing Garmin activity, route, Course Import, and Sleep history behavior remains in place.

## Scope

The production Garmin Health adapter uses Garmin Ping/Pull delivery and the shared Sleep & Health queue. One canonical public function accepts Sleep plus the ten supported Health summary families:

| Garmin family | Unified Health data |
| --- | --- |
| `dailies` | steps, wheelchair pushes and distances, floors, active/moderate/vigorous time, active/basal energy, heart rate, resting heart rate, stress summaries and durations, Garmin Body Battery change, 15-second heart-rate samples |
| `stressDetails` | three-minute stress samples and states, Garmin Body Battery samples/feedback/activity impacts |
| `hrv` | overnight RMSSD average, five-minute high, and five-minute samples |
| `userMetrics` | running/cycling VO2 max and fitness age, including algorithm qualifiers when supplied |
| `bodyComps` | weight, BMI, body fat/water, muscle mass, and bone mass |
| `pulseox` | continuous-average and on-demand SpO2 sample series, retained as distinct source identities |
| `allDayRespiration` | all-day respiration samples |
| `bloodPressures` | systolic, diastolic, and pulse point measurements with source method |
| `skinTemp` | average skin-temperature deviation for the sleep interval |
| `healthSnapshot` | snapshot heart rate, respiration, stress, SpO2, RMSSD HRV, and SDRR HRV aggregates/samples |

Garmin Body Battery is retained as provider-native because the provider score is not asserted to be interchangeable with another provider's energy/recovery score. Missing fields remain missing. Sleep continues to use the normalized `sleepSessions` model; the adapter does not copy Sleep sessions into unified Health records.

`epochs`, Women's Health, and enhanced beat-to-beat data are outside this phase. Epochs are tracked in issue #622 and Women's Health in issue #621. This phase does not add a new MCP, Training, or Health Hub surface.


## Nightly HRV in Sleep and reports

Garmin's `hrv.lastNightAvg` is stored as canonical overnight RMSSD in Health; the Sleep payload does not carry it.
Dashboard, Training readiness/recovery, and MCP Sleep/report reads now resolve that separate summary through
`shared/nightly-hrv.ts`, matching the same owner/account, calendar night, and overlapping sleep interval. Existing
Health and Sleep history needs no reimport or persistent copy. Native Sleep HRV from other providers remains preferred.
The five-minute high, samples, and Health Snapshot values cannot supply this nightly average. Overnight heart rate
stays unavailable unless an actual normalized sleep heart-rate aggregate was recorded. MCP requires Health permission
in addition to the existing Sleep grant for this supplement. See the shared
[provider integration contract](provider-integration-guide.md#nightly-hrv-across-sleep-and-health).
## Delivery and trust boundary

- Configure Garmin for **Ping/Pull**. Garmin callbacks use a dedicated shared credential in the exact `/<secret>/API`
  suffix of each function URL, checked before payload inspection, account lookup, queue work, or lifecycle changes.
  This is credential possession, not a Garmin body signature. The separate OAuth-authenticated pull remains the
  authority for Health data. The public `garmin-client-id` header is not authentication.
- `receiveGarminAPIHealthData` is the sole Sleep and Health summary endpoint. Garmin deregistration and user-permission endpoints remain separate.
- The handler accepts at most 10 MiB, validates exact Garmin HTTPS callback hosts and mapped family paths (including `pulseOx` and `respiration` REST aliases), validates one bounded pull token and an upload window of at most 24 hours, deduplicates exact descriptors, and resolves unique provider accounts with bounded batched lookups. Before returning `200`, it stores at most 250 callbacks and 700 KiB per UID-scoped live batch row. A retryable Firestore trigger immediately dispatches each newly created or replacement batch revision outside the acknowledgement path. Retry-state writes for the same revision do not create a new task, so the existing Cloud Task retains its configured backoff.
- Direct Push summaries, malformed callbacks, unsupported `epochs`, and disabled families are acknowledged and dropped. Only a durable queue-write outage returns `5xx` so Garmin can retry.
- A batch worker immediately dispatches each per-callback child through Cloud Tasks; the scheduled dispatcher remains the recovery path for both trigger and child dispatch failures. Ambiguous provider-account bindings are dropped instead of choosing one Firebase user. The worker follows each Garmin callback with the connected user's OAuth bearer token, a 30-second timeout, a 10 MiB response bound, and a 10,000-summary collection bound.
- Normalized callback writes advance through deletion- and lifecycle-guarded checkpoints every 32 source records. The checkpoint stores only an opaque payload digest, stable receipt time, cursor, and cumulative outcomes. If processing reaches six minutes, the same live callback row moves to a new queue revision and is immediately dispatched; the scheduled dispatcher remains the recovery path if that enqueue fails. The next worker refetches the callback and resumes only when its normalized digest matches, otherwise it safely restarts from the beginning. The final partial batch is intentionally not checkpointed, so a crash can replay at most 32 idempotent replacements without falsely completing the callback.
- A terminally invalid callback response records `healthSyncState/GarminAPI` as failed through the current credential and connection lifecycle fence before the exact queue revision moves to the DLQ. If that fence is stale, the callback is skipped instead of overwriting a newer connection state.
- Daily `averageStressLevel` validation failures and unsupported Stress Details state codes attach bounded `validation` metadata to the existing WARNING: fixed family/field/reason, zero-based summary index, value type, and the first offending sample offset when applicable. Only finite numeric values with absolute value at most 1,000,000 are included; all other values are omitted with a disposition code. Strings, objects, raw summaries, provider identities, and credentials are never included. A later successful callback may restore `ready` without recovering an earlier failed batch; inspect the failed jobs separately.
- Callback URLs contain short-lived pull credentials. Garmin workout, Sleep, and Health failures retain their original `callbackURL` or `garminCallbackURLs` in admin-only failed-job records under the existing 30-day expiry for bounded operator recovery; failure alone does not prove that the URL expired. Successful and skipped live rows still remove them. Keep them out of events, Health records, logs, and safe admin response projections; this retention change adds no logging or projection. Retention does not authorize automatic replay or bypass current account/connection/deletion checks.

Activity Files use the same callback guard, a 10 MiB ingress limit and a 10,000-file bound. Invalid authenticated
deliveries are acknowledged without account lookup or queue work; durable queue failures still return 500.
Before admission and again before token refresh/download, activity URLs must be HTTPS on exactly
`apis.garmin.com`, use the standard HTTPS port, have no userinfo/fragment, and target
`/wellness-api/rest/activityFile` with one nonempty ID and at most one nonempty pull token. Legacy URLs without a
pull token remain supported. The original URL and query encoding are retained, including opaque IDs. Arbitrary
hosts, other Garmin API resources and ambiguous ID/token parameters are rejected. Unsafe stored URLs move to the
existing DLQ without a download; this also covers records queued before the ingress guard was introduced.

Both the first activity download and the GPX-to-FIT fallback refuse redirects, use a 60-second deadline that covers
body reading, and stream-enforce a 128 MiB response bound. This is an explicit QS worker safety limit, not a claimed
Garmin contractual maximum. Files exceeding it move to `GARMIN_ACTIVITY_FILE_TOO_LARGE` for operator review without
repeated identical downloads; normal files retain their original bytes. Review any legitimate oversized file before
changing the limit and worker memory. Fetch failures retain only a fixed error message and status category, never
provider bodies or signed URL text. Parser work limits are a separate concern.

## Temporary webhook URL probe

`garminWebhookProbe` is an isolated public Gen 2 HTTP endpoint for checking whether Garmin preserves a configured
endpoint's path and query parameter. It uses `europe-west2`, 256 MiB, fractional Gen 1 CPU, concurrency one, zero minimum
instances, one maximum instance, a ten-second timeout, and no bound secrets. Runtime loading excludes the ingestion,
queue, task, and provider-configuration modules. It does not inspect or persist the request body, resolve accounts,
follow callbacks, call Garmin, or create tasks. It acknowledges every POST with `200`, including missing markers;
this is a protocol probe, not the production authentication fix.

Configure only an evaluation app's selected Ping endpoint with:

```text
<function-base-url>/qs-path-marker-20261002?probe=qs-query-marker-20261002
```

The two fixed markers are public test values, not credentials. Do not use a real secret: platform access logs may retain
request URLs even though the application logs only booleans. POST logs use the fixed message
`[GarminWebhookProbe] URL markers received` with `pathMatches`, `queryMatches`, `manualTest`, and
`garminClientIdPresent`. The client-ID header and manual-test header do not authenticate the sender.
GET returns `200` without a delivery log; other methods return `405`.

1. Smoke-test the URL with a synthetic POST and `x-qs-probe-test: manual`. Both marker booleans should be true.
2. Configure one evaluation endpoint, use Data Generator for a synthetic notification, and verify a correlated POST
   with both marker booleans true and `manualTest: false`. If the generator does not deliver, use an explicitly
   authorized test-account sync. A curl request alone proves only our routing, not Garmin compatibility.
3. Use a bounded evaluation Summary Resender operation to check repeated delivery. New endpoint domains may require
   Garmin's security review. Never divert a production ingress endpoint to this payload-discarding probe.
4. After Garmin-originated delivery is demonstrated, implement and verify a separate secret guard before production
   queue admission. Probe success establishes URL transport, not sender authentication or resource-budget protection.
5. Remove the probe after testing only with separate explicit approval for that exact Function deletion.

Deploy only this target after explicit approval:

```bash
firebase deploy --project quantified-self-io --only functions:garminWebhookProbe
```

The existing product Help remains accurate: this operator-only probe changes no supported integration, user flow,
OAuth permission, entitlement, ingestion behavior, or MCP surface.

## Identity and lifecycle

New OAuth callbacks pin the Garmin provider user ID in server-owned service metadata. A retryable backend projection copies only the connected account identity, connection time, and bounded permission names/timestamp to the owner-readable service metadata used by the connection and route-permission UI; credentials and lifecycle generations never enter that projection. The production projection backfill completed and converged in September 2026. The frontend reads connection accounts exclusively from service metadata, an explicit empty projection is authoritative, and Firestore Rules deny every browser read and write against the Garmin token root and descendants.

Queue admission resolves the callback account to a token owned by the Firebase user, captures the token credential generation, current token-root OAuth generation, and connection generation, and atomically checks those documents with the queue write. The worker rechecks the same lifecycle before provider I/O, after token refresh, after the callback, and inside every normalized Health/state write. A disconnect or reconnect therefore prevents in-flight work from adopting a different account lifecycle.

Legacy active connections without a pinned provider ID or generation fields remain supported. Before following a Health callback for such a connection, the worker calls Garmin's authenticated user-ID endpoint and requires the returned account to match the ping. A normal reconnect pins the identity for future work; no bulk credential migration or mandatory reconnect is required.

Disconnecting Garmin stops future imports and retains imported Sleep and Health history. Recursive account deletion removes the user-scoped Health records, sample chunks, sync state, Sleep sessions, and queue work. Queue and lifecycle writes recheck the deletion guard so delayed work cannot recreate user data.

## Revision and replacement rules

The callback `uploadEndTimeInSeconds` is the ordered revision watermark. Source identities use the stable provider interval, calendar date, or measurement timestamp rather than `summaryId`, because Garmin can update a record with a new summary ID. Recognized normalized content alone is hashed into the revision token, so replacing only the summary ID remains unchanged. Fractional provider timestamps are rounded to the Health model's millisecond precision. A higher identical delivery advances the maximum-observed watermark; a later distinct but older delivery is stale and cannot overwrite it.

Garmin Health Snapshot epoch maps use an inclusive final endpoint: when the documented final sample is one second beyond `durationInSeconds`, the normalized source-record end and coverage extend to that epoch. Stress Details keeps Body Battery activity `eventStartTimeInSeconds` as a bounded signed provider value rather than interpreting negative values as invalid Unix timestamps. Provider event arrays remain input-bounded, and emitted event metrics are deterministically capped to the unified Health record's 128-metric budget; the last retained event records the provider count when truncation occurs.

Stress Details accepts numeric zero samples (the API 1.2.4 table describes rest as below 26), separately from its documented negative measurement-state codes. Garmin also emits daily `averageStressLevel: -2`, although the daily field description only documents -1 as unavailable. Preserve -2 as a native-only `stress_state` with `daily_average_availability`; do not treat it as a negative stress score or infer the Stress Details meaning of large motion for a daily average. The existing -1/0 daily availability behavior remains unchanged. Other out-of-range daily values and unsupported fractional negative sample codes still fail validation. A mapper fix alone does not recover already-dead-lettered callbacks. A retained callback may support separately authorized, lifecycle-checked recovery while its pull credentials remain valid; legacy failed jobs with removed credentials or expired URLs require a bounded Summary Resender delivery. Verify actual ingestion before considering the failure recovered.

## Availability and history

Garmin Health is available to every valid connected Garmin account while the independent operational switch in `functions/src/garmin/health-flags.ts` is enabled. There is no Garmin Health UID allowlist. Sleep remains governed by the existing Sleep provider/user controls.

Garmin activity history remains a separate user-selected flow. Its picker defaults to the latest two calendar years through today; users can expand the selection up to the available rolling five-year limit or choose a shorter range before submitting. Every accepted activity-history request still starts Garmin's 30-day cooldown. The callable divides the selected range into requests of at most 89 days, respects a stricter provider-reported minimum, and does not treat request acceptance as proof that callbacks or activities arrived.

`backfillGarminAPIHealth` is the user-facing Garmin history callable. It requests the existing Sleep history and creates one durable `garmin_health_backfill` cursor spanning all ten supported Health families for every eligible connected Pro user while Garmin Health is enabled. The UI checks the server-owned operational switch before presenting the action and reports the scope returned by the callable. If the emergency switch is disabled, Sleep-only history remains available.

Sleep minimum-start recovery allows at most three provider attempts per window. Garmin's reported cutoff can move while requests and state writes are in flight, so an overlapping retry rounds the minimum upward to a whole second and adds up to 30 seconds of headroom, capped to preserve a non-empty whole-second request window. Windows entirely before the provider minimum are skipped without the extra headroom. The adjusted start is remembered for the same provider account; it is not a fixed, app-wide history-retention limit. A retry warning is emitted only when another attempt remains. Exhaustion still fails the callable and clears its cooldown; Health work is queued only after Sleep request submission succeeds.

Sleep and Health use the shared provider policy to request up to the latest rolling five calendar years, with leap-day clamping in UTC and whole-second upward rounding at admission. Five years is our requested maximum, not a guarantee of Garmin account entitlement or data availability; stricter provider-reported cutoffs still win. The Health cursor advances one inclusive window of at most 90 days at a time. A dedicated Cloud Tasks worker runs with one concurrent dispatch, at most one dispatch per second, a matching 30-minute worker timeout and HTTP task deadline, and at least 1.5 seconds between Garmin calls. Scheduled recovery scans this task class independently from regular Sleep work so capacity pressure in either Cloud Tasks queue cannot starve the other. Every successful 2xx response advances the cursor, `409` is treated as an already-requested window, and Garmin's documented `400` minimum-start response clips only the affected family. Network errors, `429`, and `5xx` retry from the durable cursor; authorization, permission, and other permanent `4xx` responses fail closed without exposing provider response bodies. Before every provider call, the worker re-reads the exact token and performs an expiry-aware refresh while remaining pinned to the backfill's original OAuth and connection generations. Queue revision, deletion, provider identity, connection generation, and the operational switch are also rechecked immediately before every provider call and again when progress is committed. Disabling Garmin Health marks matching live backfill progress `skipped` without affecting Sleep. Every terminal DLQ path, including invalid ranges/requests, authorization failures, and exhausted transient retries, marks the matching progress state `failed` in the same transaction as the exact queue-revision move so newer progress cannot be overwritten.

Health minimum-start clipping independently adds up to 30 seconds of headroom after rounding upward, capped at the inclusive range end so the final valid second is preserved. Three consecutive minimum-start failures in the same family per invocation persist the adjusted cursor and yield to the existing queue retry/exhaustion path instead of looping until the 30-minute deadline. Cutoff-only updates preserve the durable retry count, even when they credit older, unavailable windows; accepted/already-requested windows or advancing past an entirely unavailable family reset it. Normal cutoff adjustments log at INFO with the queue ID, fixed summary-family name, requested/provider-minimum/next timestamps, recovery attempt, outcome, and window counters. Reaching the recovery limit logs WARNING with the actual queue transition result; terminal exhaustion uses the existing failed-progress/DLQ path. Completion logs at INFO and means backfill request processing finished, not that Garmin callbacks have all been ingested. Never infer healthy progress from a fresh `updatedAtMs`, `running` status, or zero retry count alone: verify that completed-window/family counters advance. No provider response body, callback URL, or credential belongs in this telemetry.

Sleep and Health share the existing 30-day Garmin history cooldown, but their ranges are independent: a provider-discovered Sleep minimum does not shorten another Health family's range. The callable reports `sleepQueued` and `healthQueued` separately while retaining `queued` as the number of Sleep date-range requests. Garmin Summary Resender remains an operational recovery option for a deliberately bounded family/range after live delivery is healthy; it is not the normal user history flow, and no local credential migration script is required.

## Permission visibility and management

Connections → Garmin shows compact permission rows from the existing backend-owned connection-account projection.
Each account keeps its own grants: `Granted`, `Not granted` for an explicitly absent grant, or `Not reported` when the
saved permissions array is missing/malformed. The view includes the five supported permission families and extra
provider-reported scope names without implying QS feature availability. `MCT_EXPORT` remains deferred under #621:
it is excluded from the catalog and display, even when an existing account reports that grant. It is not required by QS.
The OAuth adapter still sends the generic `PARTNER_WRITE PARTNER_READ CONNECT_READ CONNECT_WRITE` scopes, not the
permission catalog; this display/catalog change does not alter Garmin-hosted consent or remove saved grants.
The view never reads OAuth documents or writes grants.
User-facing labels, help and delivery errors call `WORKOUT_IMPORT` **Training**, matching Garmin's permission name;
the API identifier and authorization checks remain unchanged.
Unknown legacy permissions do not hide the known account behind a permanent loading message.
History and route-upload tools also distinguish unknown permissions from an active load, and direct users to Garmin
permission management or support when details remain unavailable. Their checks use the same trimmed grant names as the displayed rows;
malformed arrays remain unknown. Pro prompts are focusable Material buttons with a single selection haptic.

**Manage in Garmin** opens Garmin Connect's account/Connected Apps management; choose Quantified Self and manage the
permissions Garmin exposes there. Healthy connections have no **Reconnect** or reauthorization upsell action, even
when individual grants are missing or unreported. **Reconnect** is reserved for reconnect-required and manual-review
disconnect recovery; disconnected users retain **Connect**. Permission callbacks update the saved grants automatically.
Viewing grants and opening Garmin's management UI do not require Pro. A pending OAuth start disables Disconnect and
other connection actions; disconnect-pending still blocks ordinary reconnect. Loading a new account hides the prior
permission snapshot. Permission callbacks and successful OAuth continue to update the safe projection; there is no
new callable, live polling, browser token access, or frontend grant mutation. Backend delivery readiness/consent checks
remain authoritative. Garmin's [account preferences guidance](https://support.garmin.com/en-SG/?faq=JwIU2Sofyy6ThtzhH8ENX6)
describes connected-app management.

Shared connection UI results are pinned to the originating user and view lifetime. Switching accounts/signing out
clears prior connection details immediately, and pending OAuth redirects/callbacks or disconnect results cannot update
a replacement view. Disconnect confirmation is locked against duplicate actions, dismissed on account change/teardown,
and rechecked before dispatch. Server-side connection authority and operations already in flight remain unchanged.
OAuth-start and disconnect dispatch/retries also check the original Firebase auth user after App Check waits, stopping
unsent work when the account or view changes instead of letting a delayed retry use a replacement account.

## Training-planning proof boundary

The ignored local Garmin Training API V2 version 1.0 partner contract is available for development, but it is never
committed. `shared/planned-workout-providers.ts` and the pure serializer under
`functions/src/training-plans/providers/` record redacted running/cycling, pool-swim, native-strength and disclosed
Generic fallback fixtures. Fixture coverage alone is not live provider or device evidence.
Workout content and date-only Workout Schedule payloads are deliberately separate because Garmin assigns and manages
their lifecycles independently. The proof covers fixed repeats, time/distance/manual steps, and absolute
heart-rate/power/speed/pace/cadence ranges.

Training API V2 accepts only broad `RUNNING` and `CYCLING` values for supported running/cycling planned workouts and does
not define a sub-sport field. The adapter keeps the authored QS sport unchanged and maps Trail Running, Treadmill, Indoor Running and
Virtual Running to `RUNNING`, then Mountain Biking, Indoor Cycling, Virtual Cycling, E-Biking, Hand Cycle, Velomobile,
Enduro MTB and Downhill Cycling to `CYCLING`. These are explicit QS Training profiles; it does not infer a family for
unrelated Sports Lib activity types. Running and Cycling remain exact; every subtype fold is a visible degradation that
requires approval because Garmin does not receive the exact profile.
Cycling-family folds retain the existing cycling-only secondary-target rule and device-support warning.
The #733 extension maps pool Swimming exactly to `LAP_SWIMMING` with optional explicit pool length and
target-free swim steps. Its synthetic fixture covers a 25 m pool and four 25 m repetitions with final-rest skipping;
an owner-account cloud test on 23 September 2026 also completed create, edit, date move, positive retained-record checks
and Stop/withdrawal without retries. Later #733 evidence includes owner-confirmed Garmin Connect and watch visibility
for the 25 m standalone workout; cloud acceptance alone is never watch receipt or completed-activity correlation.
Unspecified pool size is contract-valid but may not work on older devices. Completed #734 covers the additive MCP
pool-length contract. Swim targets remain unsupported. Walking, Hiking, Rowing, Indoor Rowing and Open Water Swimming
use the disclosed `GENERIC` fallback, not native sport profiles; QS preserves the authored sport and requires mapping
approval. The owner accepted the remaining Generic/device and target/manual/relative/secondary-target matrix in #655
on 2 October. This records owner sign-off, not newly executed individual device observations.

Native Strength delivery for the verified exercise-name allowlist is complete in #782: deployed cloud
create/update/reschedule/withdrawal and owner-confirmed Garmin Connect/watch checks. Reps or timed sets, load and rest
are preserved for supported names; QS does not guess exercise equipment. These results do not establish support for
every exercise or device, native tracking for Generic fallback sports, or a completed Strength activity.

Garmin planned-workout delivery is available to eligible connected Pro users through the app's explicit Send/plan
consent flow; see the [public delivery boundary](training-workspace.md#garmin-public-delivery-boundary). There is no
per-UID allowlist. Public admission does not bypass Pro, current connection generations or `WORKOUT_IMPORT`; older
connections must reconnect. It does not prove behavior on every compatible device or activity profile.
Relative targets require explicit degradation approval because
the provider percentage fields do not transmit Quantified Self's stored reference snapshot. Secondary targets are
rejected outside cycling and remain device-dependent for cycling. The #647 adapter now has synthetic HTTP and real
Firestore worker tests for separate CRUD, Long IDs, partial recovery, permission repair, reconnect and deletion races.
It reuses existing Garmin OAuth refresh/connection authority and binds existing OAuth secrets only to the Training task
worker. Missing `WORKOUT_IMPORT` requires reconnect; it never grants permission from a browser-supplied account.
The private ledger retains workout, schedule and workout-owner IDs independently of authored documents. The documented
first-create endpoint has no idempotency key or external-ID lookup, so an unknown first-create outcome stays blocked for
attention rather than being posted again. Provider responses and credentials never enter browser status or diagnostics.
Past/completed copies remain protected, and provider-held copies may remain after disconnect/account deletion.

The detailed implementation and production-verification checklist lives in the
[Training source of truth](training-workspace.md#garmin-workoutcalendar-adapter-647). Completed request/response,
schedule-list/404 and device evidence are retained in completed #645/#647/#733/#782. Schedule-only missing-copy repair
is complete in #703. Missing Workout remains inconclusive under the limit recorded in closed #769; QS does not
automatically recreate it from a 404. Remaining operational monitoring stays in #655, which no longer requires code
rollback work or disabled-by-default staging for the approved live rollout. Availability flags and runtime behavior
are unchanged; COROS remains disabled. The retired #698 issue is not a launch gate.

Completed #651 implements exact-marker completion and duplicate/ambiguity handling. Newly imported Garmin FIT
activities may link only when the workout-file reference resolves unambiguously to a same-account delivered Workout
and the applicable dated Schedule. The first committed activity link wins: another recording of the same workout can
confirm completion without replacing that link. Missing, reused or ambiguous references remain unlinked; fallback/manual
matching and audited unlink/relink are out of scope. This is exact local correlation, not a Garmin completion hook,
watch receipt or proof of prescribed-step execution. Documentation and offline proof authorize no new provider call,
deployment or data deletion.

## Production configuration

Deployment of [#800](https://github.com/jimmykane/quantified-self/pull/800) closes the legacy bare URLs. Update and
verify the Garmin portal URLs first, then deploy the receivers with one plain `GARMINAPI_WEBHOOK_SECRET` value.
There is no cutoff timestamp, JSON configuration or compatibility switch. Code or PR completion alone does not
change production behavior. Existing Garmin OAuth credentials still authorize pulls. Provision the callback secret through the approved
[secret-management workflow](function-secret-management.md#garmin-callback-credential-and-migration) before deploying
the four callback receivers. They retain their existing names, regions and memory. No additional Function is required.

1. Inventory the actual deployed callbacks and saved Garmin URLs. The deployed deregistration name is
   `deauthorizeGarminAPIUsers`; `receiveGarminAPIDeregistration` is its internal handler name, not a separate exported
   deployment. Include any genuinely deployed older aliases in the retirement review instead of assuming an alias
   exists from old documentation.
2. Provision `GARMINAPI_WEBHOOK_SECRET` as exactly 64 lowercase hexadecimal characters, without JSON or whitespace.
   If the value was already stored as JSON, publish the same underlying secret as a plain value through the approved
   secret-version workflow before deployment. Running receivers retain their injected version until redeployed.
   First deploy the initial rollout revision's four receivers and `processWorkoutTask` under separate deployment
   approval. That version accepts protected and exact legacy URLs using the same plain secret, without a timed cutoff,
   while the portal is migrated. Skip this initial deployment only if protected delivery is already supported and
   the activity download protections are already deployed.
3. In Garmin's Endpoint Configuration Tool, update and confirm the saved URL for **every enabled** endpoint ends in
   the correct `/<secret>/API` suffix on its production receiver. Replace stale or temporary probe URLs before
   deploying the cleanup:

   | Garmin endpoint | Production receiver |
   | --- | --- |
   | Sleep and enabled Health Ping families | `receiveGarminAPIHealthData` |
   | Activity Files | `insertGarminAPIActivityFileToQueue` |
   | Deregistrations | `deauthorizeGarminAPIUsers` |
   | User Permissions Change | `receiveGarminAPIUserPermissions` |

   Leave `epochs` and out-of-scope families disabled. The probe discards payloads even when it reports successful
   delivery, so it cannot serve as a production receiver. No query parameter is required;
   the portal removed query parameters in the operator's transport test while preserving the path.
4. Before deploying, verify POST delivery to the updated URLs and normal Health/activity processing with safe
   test-account evidence on the current receivers. A 200 alone does not prove ingestion. Validate lifecycle behavior
   with synthetic tests, or separately approved exact account-side actions; do not disconnect a live account merely
   to test routing. Confirm accepted-route logs show `authenticated: true, legacy: false` for the protected deliveries.
   The initial rollout's bare deliveries show `authenticated: false, legacy: true`; those URLs stay open until cleanup.
5. Separately approve and deploy the four receivers from this revision together. Each updated receiver closes its
   bare URL immediately and authenticates before account/queue work. The activity URL/redirect/download protections
   from #798 remain in `processWorkoutTask`; include that worker if those protections have not yet been deployed.
   Do not redirect old URLs or delete Functions as part of this cleanup; actual resource removal requires separate approval.
6. After deployment, recheck protected delivery and queue/worker/import outcomes. `[GarminWebhook] Accepted callback
   route` reports only `functionName`, `authenticated`, and `legacy`; confirm `authenticated: true, legacy: false`.
   Bare and wrong-secret paths must return 403 without side effects; GET returns 405. Watch for stale deliveries.
7. For a connected Pro account with Historical Data Export and Health Export permission, the existing in-app history
   action still reports **Sleep & Health history**. Summary Resender remains bounded operational recovery after the
   protected receiver is healthy. The temporary probe's eventual deletion needs its own exact approval.

The initial rollout retains bare-path compatibility until these cleanup receivers are deployed. Preparing or merging
this PR does not change the currently running receivers or retire legacy URLs.

For separately approved maintenance, Garmin's **On Hold** control can retain notifications while a receiver is being
changed. Resume only after the protected receiver is healthy. A rollback must retain callback authentication; reopening
bare URLs restores the reported boundary failure, so do not roll back to the initial compatibility revision.
When rolling back to #798, retain the same plain secret and redeploy
the four receivers through the approved workflow so bare paths remain closed; do not restore its JSON migration format.
Use Summary Resender only for a bounded recovery window.

The application's Help, OAuth scopes, connection UI, entitlements and MCP contracts need no change for this
operator-managed callback migration. No provider calls, cloud configuration, secret values or deployment are performed
by the implementation PR. A leaked path credential can still admit requests;
the shared secret does not provide body integrity, replay prevention or account-wide resource quotas.

Monitor non-2xx responses, `processGarminHealthBackfillTask` depth/state in the admin queue view, `sleepSyncQueue` retry/DLQ counts, `users/{uid}/sleepSyncState/GarminAPI` Health cursor fields, `users/{uid}/healthSyncState/GarminAPI`, and the expected source-record/sample-chunk families. Each accepted or durably failed ingress log includes non-zero per-family counts for received and valid Ping descriptors, direct-summary/Push-shaped descriptors, invalid Ping descriptors, queued work, skipped accounts, disabled families, and received/direct-summary `epochs` descriptors that remain unsupported. These counters contain only fixed summary-family names and integer counts. Do not log or export callback URLs, OAuth credentials, raw payloads, or raw provider account IDs.
