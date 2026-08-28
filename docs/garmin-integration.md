# Garmin Health Integration

This document is the source of truth for Garmin Health API 1.2.4 ingestion introduced by issue #613. Existing Garmin activity, route, Course Import, and Sleep history behavior remains in place.

## Scope

The staged Garmin Health adapter uses Garmin Ping/Pull delivery and the shared Sleep & Health queue. One canonical public function accepts Sleep plus the ten supported Health summary families:

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
- `receiveGarminAPIHealthData` is the canonical endpoint. `receiveGarminAPISleepData` remains a temporary Sleep-compatible alias while the Garmin portal configuration moves.
- The handler accepts at most 10 MiB, validates exact Garmin HTTPS callback hosts and family paths, validates one bounded pull token and an upload window of at most 24 hours, deduplicates exact descriptors, and resolves unique provider accounts with bounded batched lookups. It stores at most 250 callbacks and 700 KiB per UID-scoped live batch row before returning `200`; the existing dispatcher expands those batches into the ordinary per-callback queue asynchronously.
- Direct Push summaries, malformed callbacks, unsupported `epochs`, disabled families, and connections outside the staged rollout are acknowledged and dropped. Only a durable queue-write outage returns `5xx` so Garmin can retry.
- Cloud Tasks fan-out happens asynchronously through the existing dispatcher. Ambiguous provider-account bindings are dropped instead of choosing one Firebase user. The worker follows each Garmin callback with the connected user's OAuth bearer token, a 30-second timeout, and a 10 MiB response bound.
- Callback URLs contain short-lived pull credentials. They exist only on live retryable queue rows, are removed on every terminal outcome, and are stripped from failed-job copies. They are never written to Health records or logs.

## Identity and lifecycle

New OAuth callbacks pin the Garmin provider user ID in server-owned service metadata. Garmin token roots and token children remain owner-readable for compatibility but are server-writable only.

Queue admission resolves the callback account to a token owned by the Firebase user, captures the token credential generation, current token-root OAuth generation, and connection generation, and atomically checks those documents with the queue write. The worker rechecks the same lifecycle before provider I/O, after token refresh, after the callback, and inside every normalized Health/state write. A disconnect or reconnect therefore prevents in-flight work from adopting a different account lifecycle.

Legacy active connections without a pinned provider ID or generation fields remain supported. Before following a Health callback for such a connection, the worker calls Garmin's authenticated user-ID endpoint and requires the returned account to match the ping. A normal reconnect pins the identity for future work; no bulk credential migration or mandatory reconnect is required.

Disconnecting Garmin stops future imports and retains imported Sleep and Health history. Recursive account deletion removes the user-scoped Health records, sample chunks, sync state, Sleep sessions, and queue work. Queue and lifecycle writes recheck the deletion guard so delayed work cannot recreate user data.

## Revision and replacement rules

The callback `uploadEndTimeInSeconds` is the ordered revision watermark. Source identities use the stable provider interval, calendar date, or measurement timestamp rather than `summaryId`, because Garmin can update a record with a new summary ID. Recognized normalized content alone is hashed into the revision token, so replacing only the summary ID remains unchanged. Fractional provider timestamps are rounded to the Health model's millisecond precision. A higher identical delivery advances the maximum-observed watermark; a later distinct but older delivery is stale and cannot overwrite it.

## Rollout and history

Garmin Health is controlled independently from Garmin Sleep by the deny-all-when-empty UID allowlist in `functions/src/garmin/health-rollout.ts`. Sleep remains governed by the existing Sleep provider/user controls.

Existing Garmin Sleep history import remains Sleep-only. Historical Health data is requested operationally through Garmin's Summary Resender after the endpoint is enabled; no local migration script is required. Start with the staged user, one summary family and a narrow time range, verify normalized records and sync state, then expand deliberately.

## Production configuration

No new secret is required. The existing Garmin OAuth client credentials authorize callback pulls.

In Garmin's Endpoint Configuration Tool:

1. Set `receiveGarminAPIHealthData` as the Ping URL for `sleeps` and each enabled staged Health family.
2. Leave `epochs` and out-of-scope families disabled.
3. Keep the existing `receiveGarminAPIDeregistration` and `receiveGarminAPIUserPermissions` endpoint configurations enabled and unchanged.
4. Keep the legacy Sleep function deployed until the canonical URL has demonstrated delivery, then remove the alias in a later cleanup change.
5. Use Summary Resender for bounded historical Health replay after live delivery is healthy.

For planned maintenance or an unhealthy receiver, set the affected summary families to **On Hold** before changing or rolling back endpoints. Garmin continues queueing notifications while a family is enabled and On Hold; remove On Hold only after the canonical endpoint is healthy. For rollback, put the affected families On Hold, restore `sleeps` to the still-deployed legacy Sleep URL, disable the staged Health families if necessary, deploy or restore the previous backend revision, verify the legacy endpoint, and then release On Hold. Use Summary Resender for a bounded recovery window if notifications were missed; do not replay an unbounded history range during incident recovery.

Monitor non-2xx responses, queue retry/DLQ counts, `users/{uid}/healthSyncState/GarminAPI`, and the expected source-record/sample-chunk families. Do not log or export callback URLs, OAuth credentials, or raw provider account IDs.
