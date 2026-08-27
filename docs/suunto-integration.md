# Suunto 24/7 Health Integration

This document is the source of truth for the Suunto 24/7 Health ingestion added by issue #612. It supplements the repository-wide [provider integration guide](provider-integration-guide.md), [unified Health model](unified-health-data.md), and [Sleep sync operations](sleep-sync-operations.md).

The integration is deliberately staged independently from production-wide Suunto Sleep. Only Firebase UIDs in the server-only `functions/src/suunto/health-rollout.ts` receive Health work, and `functions/src/suunto/health-flags.ts` is the source-controlled kill switch. An empty Health allowlist is deny-all; it does not mean all users. Sleep enablement and its empty-allowlist semantics are unchanged. The Angular bundle never receives the raw rollout list; an authenticated App Check-protected callable returns only the current user's combined-history availability. Retained Health sync state is historical operational data and is not treated as rollout authorization.

## Provider contract

Suunto exposes three relevant pull resources. Every request is authenticated with the connected user's OAuth access token and the Suunto subscription key.

| Resource | Request/range behavior | Used fields |
| --- | --- | --- |
| `/247samples/activity` | Internal half-open millisecond range translated to Suunto's inclusive `to=end-1`, at most 28 days | `HR`, `HRExt.Min`, `HRExt.Max`, `HRV`, `SpO2`, `Altitude`, `StepCount`, `EnergyConsumption` |
| `/247samples/daily-activity-statistics` | ISO start/end range, at most 28 days | `stepcount` and `energyconsumption`, grouped by aggregation and device source |
| `/247samples/recovery` | Internal half-open millisecond range translated to Suunto's inclusive `to=end-1`, at most 28 days | `Balance`, `StressState` |

The corresponding documented webhook notifications are `SUUNTO_247_ACTIVITY_CREATED` and `SUUNTO_247_RECOVERY_CREATED`. They are handled by the existing signed Suunto webhook endpoint. The notification payload is used only to identify bounded local-day refetch windows; raw Health samples from the webhook are never placed in Firestore, the queue, or Health collections. After signature and bounded-shape validation, the handler performs one idempotent create of a compact `suuntoHealthWebhookIngress` document and acknowledges Suunto. A retryable Firestore trigger resolves the staged account and fans out queue work asynchronously, keeping credential lookup and Cloud Tasks dispatch outside Suunto's two-second acknowledgement window.

Production setup must subscribe those two notification types to the existing `receiveSuuntoAppSleepData` endpoint using the configured `SUUNTOAPP_NOTIFICATION_SECRET`. This repository change does not register provider webhooks or deploy Functions.

## Normalization

Suunto Health data is kept separate from workout FIT metrics and normalized Sleep sessions. The provider and source-record type remain explicit on every record.

| Suunto value | Unified Health representation | Decision |
| --- | --- | --- |
| `HR` | `heart_rate`, interval average | bpm |
| `HRExt.Min` / `HRExt.Max` | `heart_rate`, interval minimum/maximum | bpm |
| `HRV` | `heart_rate_variability`, interval sample | milliseconds |
| `SpO2` | `blood_oxygen_saturation` | Provider ratio multiplied by 100 to canonical percent |
| `Altitude` | `altitude` | meters |
| activity `StepCount` | `steps`, accumulated interval series | count; distinct from the daily statistic |
| activity `EnergyConsumption` | `total_energy`, accumulated interval series | joules divided by 4,184 to canonical kilocalories |
| daily `stepcount` | `steps`, provider daily total/average | canonical count |
| daily `energyconsumption` | `total_energy`, provider daily total/average | joules divided by 4,184 to canonical kilocalories |
| recovery `Balance` | `body_energy` | Provider ratio multiplied by 100 to canonical percent |
| recovery `StressState` | `stress_state` category | `1 relaxing`, `2 active`, `3 passive`, `4 stressful`; invalid sentinel `0` is omitted |

Missing values remain missing. Exact duplicate timestamps collapse; conflicting duplicates fail the queue attempt. Daily statistic nulls are ignored when a non-null value exists, while conflicting non-null values fail validation. Activity and recovery records are grouped by provider-local calendar date and UTC offset. A daylight-saving offset change therefore creates separate source records rather than pretending the whole local date used one offset.

Historical coverage is `unknown` because the provider does not assert completeness. The current provider-local date is `partial`. Activity and recovery observation freshness follows the latest accepted sample; daily statistics use the end of their bounded day. The expected refresh interval is 48 hours.

Daily statistics retain multiple devices as separate source records using a one-way device key derived from the provider account and Suunto source name. Activity and recovery feeds do not expose a device source in the documented sample shape, so those records deliberately have no device attribution.

## Ingestion and revision flow

```text
signed webhook ─> durable compact ingress ─> retryable fan-out ─┐
daily scheduler ────────────────────────────────────────────────┼─> sleepSyncQueue / suunto_health_poll
history import ─────────────────────────────────────────────────┘          │
                                                                            ▼
                                                                 lifecycle-fenced Suunto pulls
                                                                            │
                                                                            ▼
                                                                bounded mapper + Health writer
                                                                            │
                                                                            ├─ users/{uid}/healthSourceRecords
                                                                            ├─ users/{uid}/healthSampleChunks
                                                                            └─ users/{uid}/healthSyncState/SuuntoApp
```

`scheduleSuuntoHealthSync` runs every 24 hours and refetches the rolling recent seven-day window for staged connected accounts. Signed Activity/Recovery notifications durably stage immediate local-day reconciliation before acknowledgement; the ingress trigger then enqueues the work. The existing Suunto history callable keeps its deployed name and cooldown; for staged users, each 28-day Sleep range also queues a matching Health range for every connected Suunto account and the UI calls it **Import Sleep & Health History**. The existing Sleep backfill continues to use its established first-usable-account behavior.

The short-lived, server-only ingress contains only the notification type, provider account ID needed for credential resolution, bounded windows, receive time, processing status, and a seven-day TTL. Its document ID is a one-way digest of the authenticated raw notification, so exact retries collapse to the same durable create; the raw notification and samples are not retained. The queue contains only the Firebase UID, provider account ID needed to select the server-owned token, bounded range, trigger kind, and deterministic dedupe identity. Later same-day Activity or Recovery notifications receive a fresh refetch identity. Repeated poll/webhook/backfill work still resolves to deterministic Health source identities, and the shared writer treats unchanged content as unchanged rather than creating duplicates. Provider source keys, account IDs, device source names, and revision tokens are hashed before Health persistence.

Each provider response is capped at 4 MiB and 10,000 activity or recovery samples. Activity, Recovery, and daily statistics are each capped at 256 mapped source records per queue item; daily statistics are additionally capped at 16 groups, 64 sources per group, and 64 samples per source. A pull includes one day of context on each side of its target and splits larger targets into 26-day segments, so no provider request exceeds 28 days and a range boundary cannot replace a previously complete local-day record with partial samples. Only full daily records intersecting the original target are retained. Requests time out after 30 seconds. A provider 401 forces one guarded token refresh and one retry; all provider response, URL, token, and datastore detail is replaced with an opaque error before logs, queue retry fields, or sync state are written.

## Lifecycle and deletion

Every request and write is fenced to the original account token document credential, the token root's captured OAuth lifecycle revision, connection state, and connection generation. Suunto can retain multiple account tokens, so an account token is not required to own the root's latest OAuth generation; all retained accounts remain usable while the captured root revision stays unchanged. A completed OAuth connection rotates that root revision and invalidates in-flight work across the account set without silently excluding older connected accounts. The worker checks account deletion before token resolution, before every provider request, and through the shared Health writer transaction. A stale worker cannot adopt a later OAuth connection.

Connected and reconnect-required Suunto transitions mirror `ready` or `reconnect_required` into Health sync state for staged users using a durable generation-keyed repair marker. Token-root deletion supersedes a pending projection while proving the root is absent, then projects `disconnected` unless current service metadata authoritatively owns reconnect-required. The scheduled lifecycle repair scans both COROS and Suunto markers.

Ordinary Suunto disconnect retains imported Sleep and Health history but stops new work. Disconnect cleanup recursively removes matching pending webhook ingress. Account deletion removes the Suunto token subtree, every matching `suuntoHealthWebhookIngress`, `sleepSyncQueue`, and DLQ row (including `suunto_health_poll`), and recursively removes `sleepSessions`, Health source records, Health sample chunks, and both sync-state collections under `users/{uid}`. The ingress trigger rechecks the live kill switch, staged-user allowlist, connection lookup, and account-deletion guard before fan-out. Its completion uses update-only semantics, so concurrent cleanup cannot recreate a deleted ingress document; TTL is only a fallback for stale operational rows. Deletion-aware completion, retry, and DLQ transitions cannot recreate removed work.

## Operations and rollout

The existing Sleep queue/Cloud Task worker carries both Sleep and Health work. Admin Queue Monitor labels it **Sleep & Health Sync** and exposes the existing pending, retry, lag, provider, and DLQ views. Health queue documents remain distinguishable by `type: suunto_health_poll` and `healthTrigger: poll | webhook | backfill`. Operations must also monitor failures and aging unprocessed documents for `fanOutSuuntoHealthWebhookIngress`; Eventarc retries transient fan-out failures, while processed ingress remains short-lived until TTL cleanup.

Before enabling another account:

1. Confirm the Suunto production entitlement covers all three pull resources and both webhook notification types.
2. Add the Firebase UID to `SUUNTO_HEALTH_SYNC_ALLOWED_USER_IDS` and keep `SUUNTO_HEALTH_SYNC_ENABLED` true.
3. Deploy `fanOutSuuntoHealthWebhookIngress` and its Firestore configuration first. Verify the trigger is active before deploying the updated signed webhook handler; then deploy `scheduleSuuntoHealthSync`, the shared dispatcher/worker, and lifecycle repair function through the normal release process. This ordering prevents the handler from accepting ingress before an asynchronous consumer exists.
4. Register Activity and Recovery webhook notifications with Suunto if they are not already registered.
5. Verify poll, webhook, history, 401 refresh, reconnect, disconnect, and account deletion for the staged account.
6. Monitor queue age/retries, opaque error categories, Health sync timestamps, validation rejects, and provider rate-limit responses before widening the allowlist.

Rollback sets `SUUNTO_HEALTH_SYNC_ENABLED` to false and deploys the affected Functions. New schedules and webhooks then stop Health work, already queued Health rows are acknowledged as provider-disabled without calling Suunto, and the availability callable makes the History Import UI sleep-only even when an older Health sync-state document remains. Existing imported Health data remains until account deletion; Sleep continues independently.
