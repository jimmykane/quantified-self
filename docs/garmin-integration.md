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

## Delivery and trust boundary

- Configure Garmin for **Ping/Pull**, not Push. Garmin's ping has no local request signature, so the public request is only an availability hint.
- `receiveGarminAPIHealthData` is the sole Sleep and Health summary endpoint. Garmin deregistration and user-permission endpoints remain separate.
- The handler accepts at most 10 MiB, validates exact Garmin HTTPS callback hosts and mapped family paths (including `pulseOx` and `respiration` REST aliases), validates one bounded pull token and an upload window of at most 24 hours, deduplicates exact descriptors, and resolves unique provider accounts with bounded batched lookups. Before returning `200`, it stores at most 250 callbacks and 700 KiB per UID-scoped live batch row. A retryable Firestore trigger immediately dispatches each newly created or replacement batch revision outside the acknowledgement path. Retry-state writes for the same revision do not create a new task, so the existing Cloud Task retains its configured backoff.
- Direct Push summaries, malformed callbacks, unsupported `epochs`, and disabled families are acknowledged and dropped. Only a durable queue-write outage returns `5xx` so Garmin can retry.
- A batch worker immediately dispatches each per-callback child through Cloud Tasks; the scheduled dispatcher remains the recovery path for both trigger and child dispatch failures. Ambiguous provider-account bindings are dropped instead of choosing one Firebase user. The worker follows each Garmin callback with the connected user's OAuth bearer token, a 30-second timeout, a 10 MiB response bound, and a 10,000-summary collection bound.
- Normalized callback writes advance through deletion- and lifecycle-guarded checkpoints every 32 source records. The checkpoint stores only an opaque payload digest, stable receipt time, cursor, and cumulative outcomes. If processing reaches six minutes, the same live callback row moves to a new queue revision and is immediately dispatched; the scheduled dispatcher remains the recovery path if that enqueue fails. The next worker refetches the callback and resumes only when its normalized digest matches, otherwise it safely restarts from the beginning. The final partial batch is intentionally not checkpointed, so a crash can replay at most 32 idempotent replacements without falsely completing the callback.
- A terminally invalid callback response records `healthSyncState/GarminAPI` as failed through the current credential and connection lifecycle fence before the exact queue revision moves to the DLQ. If that fence is stale, the callback is skipped instead of overwriting a newer connection state.
- Callback URLs contain short-lived pull credentials. They exist only on live retryable queue rows, are removed on every terminal outcome, and are stripped from failed-job copies. They are never written to Health records or logs.

## Identity and lifecycle

New OAuth callbacks pin the Garmin provider user ID in server-owned service metadata. Garmin token roots and token children are browser-inaccessible. A retryable backend projection copies only the connected account identity, connection time, and bounded permission names/timestamp to the owner-readable service metadata used by the connection and route-permission UI; credentials and lifecycle generations never enter that projection.

Queue admission resolves the callback account to a token owned by the Firebase user, captures the token credential generation, current token-root OAuth generation, and connection generation, and atomically checks those documents with the queue write. The worker rechecks the same lifecycle before provider I/O, after token refresh, after the callback, and inside every normalized Health/state write. A disconnect or reconnect therefore prevents in-flight work from adopting a different account lifecycle.

Legacy active connections without a pinned provider ID or generation fields remain supported. Before following a Health callback for such a connection, the worker calls Garmin's authenticated user-ID endpoint and requires the returned account to match the ping. A normal reconnect pins the identity for future work; no bulk credential migration or mandatory reconnect is required.

Disconnecting Garmin stops future imports and retains imported Sleep and Health history. Recursive account deletion removes the user-scoped Health records, sample chunks, sync state, Sleep sessions, and queue work. Queue and lifecycle writes recheck the deletion guard so delayed work cannot recreate user data.

## Revision and replacement rules

The callback `uploadEndTimeInSeconds` is the ordered revision watermark. Source identities use the stable provider interval, calendar date, or measurement timestamp rather than `summaryId`, because Garmin can update a record with a new summary ID. Recognized normalized content alone is hashed into the revision token, so replacing only the summary ID remains unchanged. Fractional provider timestamps are rounded to the Health model's millisecond precision. A higher identical delivery advances the maximum-observed watermark; a later distinct but older delivery is stale and cannot overwrite it.

Garmin Health Snapshot epoch maps use an inclusive final endpoint: when the documented final sample is one second beyond `durationInSeconds`, the normalized source-record end and coverage extend to that epoch. Stress Details keeps Body Battery activity `eventStartTimeInSeconds` as a bounded signed provider value rather than interpreting negative values as invalid Unix timestamps. Provider event arrays remain input-bounded, and emitted event metrics are deterministically capped to the unified Health record's 128-metric budget; the last retained event records the provider count when truncation occurs.

## Availability and history

Garmin Health is available to every valid connected Garmin account while the independent operational switch in `functions/src/garmin/health-flags.ts` is enabled. There is no Garmin Health UID allowlist. Sleep remains governed by the existing Sleep provider/user controls.

`backfillGarminAPIHealth` is the user-facing Garmin history callable. It requests the existing Sleep history and creates one durable `garmin_health_backfill` cursor spanning all ten supported Health families for every eligible connected Pro user while Garmin Health is enabled. The UI checks the server-owned operational switch before presenting the action and reports the scope returned by the callable. If the emergency switch is disabled, Sleep-only history remains available.

The Health cursor advances one inclusive window of at most 90 days at a time from January 1, 2016 to the request time. A dedicated Cloud Tasks worker runs with one concurrent dispatch, at most one dispatch per second, a matching 30-minute worker timeout and HTTP task deadline, and at least 1.5 seconds between Garmin calls. Scheduled recovery scans this task class independently from regular Sleep work so capacity pressure in either Cloud Tasks queue cannot starve the other. Every successful 2xx response advances the cursor, `409` is treated as an already-requested window, and Garmin's documented `400` minimum-start response clips only the affected family. Network errors, `429`, and `5xx` retry from the durable cursor; authorization, permission, and other permanent `4xx` responses fail closed without exposing provider response bodies. Before every provider call, the worker re-reads the exact token and performs an expiry-aware refresh while remaining pinned to the backfill's original OAuth and connection generations. Queue revision, deletion, provider identity, connection generation, and the operational switch are also rechecked immediately before every provider call and again when progress is committed. Disabling Garmin Health marks matching live backfill progress `skipped` without affecting Sleep. Every terminal DLQ path, including invalid ranges/requests, authorization failures, and exhausted transient retries, marks the matching progress state `failed` in the same transaction as the exact queue-revision move so newer progress cannot be overwritten.

Sleep and Health share the existing 30-day Garmin history cooldown, but their ranges are independent: a provider-discovered Sleep minimum does not shorten another Health family's range. The callable reports `sleepQueued` and `healthQueued` separately while retaining `queued` as the number of Sleep date-range requests. Garmin Summary Resender remains an operational recovery option for a deliberately bounded family/range after live delivery is healthy; it is not the normal user history flow, and no local credential migration script is required.

## Production configuration

No new secret is required. The existing Garmin OAuth client credentials authorize callback pulls.

In Garmin's Endpoint Configuration Tool:

1. Set `receiveGarminAPIHealthData` as the Ping URL for `sleeps` and each enabled Health family.
2. Leave `epochs` and out-of-scope families disabled.
3. Keep the existing `receiveGarminAPIDeregistration` and `receiveGarminAPIUserPermissions` endpoint configurations enabled and unchanged.
4. Keep the legacy Sleep function deployed until the canonical URL has demonstrated delivery, then remove the alias in a later cleanup change.
5. For a connected Pro account with Historical Data Export and Health Export permission, use the in-app Garmin history action and verify that it reports **Sleep & Health history**. Keep Summary Resender for bounded operational recovery only.

For planned maintenance or an unhealthy receiver, set the affected summary families to **On Hold** before changing or rolling back endpoints. Garmin continues queueing notifications while a family is enabled and On Hold; remove On Hold only after the canonical endpoint is healthy. For rollback, put the affected families On Hold, restore `sleeps` to the still-deployed legacy Sleep URL, disable the Health families if necessary, deploy or restore the previous backend revision, verify the legacy endpoint, and then release On Hold. Use Summary Resender for a bounded recovery window if notifications were missed; do not replay an unbounded history range during incident recovery.

Monitor non-2xx responses, `processGarminHealthBackfillTask` depth/state in the admin queue view, `sleepSyncQueue` retry/DLQ counts, `users/{uid}/sleepSyncState/GarminAPI` Health cursor fields, `users/{uid}/healthSyncState/GarminAPI`, and the expected source-record/sample-chunk families. Each accepted or durably failed ingress log includes non-zero per-family counts for received and valid Ping descriptors, direct-summary/Push-shaped descriptors, invalid Ping descriptors, queued work, skipped accounts, disabled families, and received/direct-summary `epochs` descriptors that remain unsupported. These counters contain only fixed summary-family names and integer counts. Do not log or export callback URLs, OAuth credentials, raw payloads, or raw provider account IDs.
