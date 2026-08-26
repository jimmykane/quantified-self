# Unified Health Data Foundation

This document is the source of truth for the cross-provider health foundation introduced by issue #610. It defines the shared model and storage/query boundary that Garmin, Suunto, COROS, and Wahoo adapters can target without pretending that every provider exposes the same measurements or semantics. The COROS daily adapter added by issue #611 is the first production ingestion path on this foundation.

Garmin and Suunto provider mapping remains in issues #612–#613. The Health Hub product surface remains in #614. COROS ingestion does not make provider-specific Health records part of the existing MCP, Training, or activity contracts; aggregate COROS sleep values continue through normalized Sleep.

## Goals

- Give provider adapters one typed model for daily health summaries, interval summaries, point measurements, profile snapshots, and bounded high-resolution samples.
- Preserve provider attribution, native meaning, recording method, device attribution, quality, and coverage.
- Normalize only values with a defensible canonical meaning and unit.
- Keep missing data missing; never turn an absent day or unsupported metric into zero.
- Preserve conflicting source observations instead of silently selecting or averaging one.
- Give the Angular app and an authenticated callable the same query, projection, paging, and result contracts.
- Reuse the existing normalized `sleepSessions` model through typed references instead of copying sleep sessions or raw sleep samples.

## Non-goals

- No Garmin, Suunto, or Wahoo health adapter is wired yet; the current provider adapter is COROS daily data only.
- No cross-provider deduplication, ranking, or source-preference policy is applied.
- No medical interpretation or diagnosis is produced.
- No provider payload, credential, raw provider account ID, or signed URL is stored in the health model.
- No new MCP tool, Training metric, normalized Sleep field, dashboard tile, or public page is added.
- No time-based retention or Firestore TTL policy is enabled for health source records or sample chunks.

## Architecture

```text
provider adapter (#611–#613; COROS active)
        │
        ├─ exact provider/native semantics
        ├─ canonical conversion only when defensible
        └─ ordered provider revision
        │
        ▼
runtime validation
        │
        ▼
deletion-guarded atomic replacement
        ├─ users/{uid}/healthSourceRecords/{sourceRecordId}
        ├─ users/{uid}/healthSampleChunks/{chunkId}
        └─ users/{uid}/healthSyncState/{provider}
        │
        ├───────────────┬────────────────────┐
        ▼               ▼                    ▼
direct Firestore   queryHealthRange     account deletion
(default app path) (auth + App Check)   (recursive user root)
        └───────────────┬────────────────────┘
                        ▼
           shared query plan + projector
                        ▼
                 HealthRangeResult
```

The shared implementation is split intentionally:

- `shared/health.ts` defines the schema, stable metric catalog, bounds, and public query/result types.
- `shared/health-query.ts` validates range requests and projects source records into observations, discovery, coverage, freshness, daily references, conflicts, and cursors.
- `shared/health-firestore-query.ts` creates the environment-neutral bounded Firestore plan.
- `functions/src/health/validation.ts` validates untrusted adapter input at runtime.
- `functions/src/health/writer.ts` owns opaque IDs, revisions, sample chunking, replacement, deletion guards, and sync state.
- `functions/src/health/query.ts` and `functions/src/health/callable.ts` provide the server adapter.
- `src/app/services/app.health.service.ts` provides the default direct listener and explicit callable alternative.

## Current provider coverage

COROS daily data uses the existing `coros_poll` Sleep queue, token resolution, rolling seven-day scheduler, and three-month history replay. There is no COROS daily webhook. A successful queue item writes its lifecycle-guarded normalized Sleep sessions first, then guarded Health replacements, then both sync-state documents; it is not acknowledged until every required write completes. Each Sleep/Health write and the final Health ready transition requires the same token document and the captured provider account, connection state, and connection generation to remain current. Retries remain idempotent because the provider calendar date is the daily source identity and recognized content is hashed into the revision token.

| COROS field | Unified Health representation | Normalization decision |
| --- | --- | --- |
| `step` | `steps`, daily total | Canonical count |
| `calorie` | `total_energy`, daily total | Native-only `calorie`; no kcal conversion is asserted |
| `rhr` | `resting_heart_rate`, daily resting value | Canonical bpm; references the compatibility value on normalized Sleep when that session exists |
| `ppgHrv` | `heart_rate_variability`, overnight average | Canonical ms; references the normalized Sleep aggregate when that session exists |
| `sleepAvgHr` | `heart_rate`, sleep average | Canonical bpm; references the normalized Sleep aggregate when that session exists |
| valid sleep interval | `sleep_duration` | Typed reference to `sleepSessions.durationSeconds` |
| `hrvList[].hrv` | detailed `heart_rate_variability` sample series | Canonical ms, semantic variant `overnight_interval` |
| optional `hrvList[].hr` | detailed `heart_rate` sample series | Canonical bpm, semantic variant `hrv_interval_mean` |

New COROS responses do not duplicate detailed HRV in `sleepSessions.hrvSamples`; recoverable legacy copies remain until the guarded migration safely moves and cleans them. Sleep retains aggregate vitals needed by existing Sleep views and readiness. Missing fields stay absent, daily and series coverage remains `unknown` because the API does not state completeness, and conflicting provider observations remain source-aware.

The adapter bounds the decoded response to 4 MiB, accepts at most 30 daily rows per provider request, and accepts at most 1,440 detailed HRV points per daily row before shared validation and chunking. The source interval covers the provider wake date plus at most the preceding 24 hours needed by bounded overnight samples. Persisted account IDs, source keys, and revision tokens remain opaque through the shared writer.

COROS connect and terminal-auth transitions mirror safe `ready` or `reconnect_required` Health sync state only while the exact service-connection generation remains current. Token-root deletion updates Health only while that root remains absent and atomically preserves `reconnect_required` when current service metadata owns that state. Imported Health and Sleep history is retained. Recursive account deletion removes the user-owned source records, sample chunks, sync state, Sleep sessions, and operational queues.

## Stable metric catalog

Metric IDs describe stable product semantics. A provider name or native field name must never become a metric ID. Provider-specific meaning belongs in `native.metric`, `semanticVariant`, native units, qualifiers, and source metadata.

| Category | Stable metric IDs |
| --- | --- |
| Movement | `steps`, `wheelchair_pushes`, `distance`, `wheelchair_push_distance`, `floors_climbed`, `active_duration`, `moderate_intensity_duration`, `vigorous_intensity_duration`, `altitude` |
| Energy | `active_energy`, `basal_energy`, `total_energy` |
| Cardiovascular | `heart_rate`, `resting_heart_rate`, `heart_rate_variability`, `blood_oxygen_saturation`, `respiration_rate`, `blood_pressure_systolic`, `blood_pressure_diastolic`, `pulse_rate` |
| Wellness | `stress_level`, `stress_state`, `stress_duration`, `body_energy`, `body_energy_change`, `recovery_score` |
| Body | `body_weight`, `body_mass_index`, `body_fat`, `body_water`, `muscle_mass`, `bone_mass`, `skin_temperature_deviation` |
| Fitness | `vo2_max`, `fitness_age` |
| Sleep references | `sleep_duration`, `sleep_score` plus the applicable cardiovascular metric IDs for referenced Sleep vitals |

Each catalog entry fixes its value type and canonical unit. The current canonical units are count, meters, seconds, kilocalories, beats/minute, milliseconds, percentage, breaths/minute, kilograms, kg/m², mmHg, Celsius, ml/kg/min, years, score, and category.

### Metric semantics

Every value or reference includes:

- `aggregation`, such as total, average, minimum, maximum, latest, or sample;
- `semanticVariant`, which distinguishes meanings that must not be combined, such as a provider daily total and a ten-minute bucket total;
- `origin`: recorded, provider summary, or Quantified Self derived;
- `recordingMethod`: device, manual, provider calculated, Quantified Self calculated, or unknown;
- quality and coverage metadata;
- optional device attribution;
- a native metric/value/unit representation;
- a canonical value only when `normalizationStatus` is `canonical`.

`native_only` and `not_comparable` entries deliberately omit a canonical value. The runtime validator rejects a canonical unit or value that disagrees with the catalog.

## Firestore model

### Source records

`users/{uid}/healthSourceRecords/{sourceRecordId}` stores one provider source record. A source record contains its calendar date and interval, source type, opaque source key, opaque account key, ordered revision, coverage, device, metric entries, searchable `metricIds`, and sample-chunk IDs.

The source-record ID is a deterministic SHA-256 identifier derived from the Firebase UID, provider, raw provider account ID, provider record type, and provider record key. The account key is a separate deterministic hash. The persisted source key is another account-scoped deterministic hash of the provider record key, and the persisted revision token is a source-record-scoped hash of the adapter token. Raw provider account IDs, record keys, and revision tokens remain in writer memory only for identity, revision, and digest calculation; none is persisted or logged.

### Sample chunks

`users/{uid}/healthSampleChunks/{chunkId}` stores compact arrays for one provider source record, metric, semantic variant, and series. Offsets and value arrays are chunk-local and must align exactly. Coverage is repeated series-level metadata, so its `sampleCount` is the validated total across the source series rather than the current chunk length. Each chunk retains the provider receipt time so sample freshness does not substitute a local write timestamp.

Chunks are permanent leaf documents by schema. Firestore Rules do not grant access to descendants, which makes document-only deletion safe when a higher provider revision replaces stale chunks.

### Sync state

`users/{uid}/healthSyncState/{provider}` stores the safe aggregate state needed by a future Health Hub: ready, permission missing, reconnect required, failed, unsupported, or disconnected, plus bounded timestamps and an opaque error code. Raw error messages and payload excerpts are rejected.

This collection is not the OAuth connection source of truth. Provider credentials and stable raw account identity remain in their existing server-owned integration stores.

## Hard bounds

Bounds protect Firestore document size, transaction limits, client reads, and projection memory. They are not a time-based retention policy.

| Boundary | Limit |
| --- | ---: |
| Metrics per source record | 128 |
| Sample points per chunk | 1,440 |
| Sample chunks per source record | 200 |
| Estimated source-record payload | 256 KiB |
| Estimated sample-chunk payload | 900 KiB |
| Estimated payload per revision | 4 MiB |
| Worst-case old + new replacement data | 8 MiB before index/protocol overhead |
| Summary query range | 366 calendar days |
| Sampled query range | 31 calendar days |
| Public source-record page | 1–32 source records; default 32 |
| Firestore source-record fetch | Public page plus one look-ahead source record |
| Public chunk page | 1–8 chunks; default 8 |
| Firestore chunk fetch | Public page plus one look-ahead chunk |
| Sample points returned | 1,440–11,520; default 10,000 |

The validator counts recognized input JSON-escaped UTF-8 bytes cumulatively while walking aligned metric/sample values, charges raw sample strings before trimming, and stops before retaining the element that would cross 4 MiB. The writer then cleans, measures, and retains one sample chunk at a time with the same cumulative ceiling before applying the exact final source-record-plus-chunks check. This bounds validation and construction amplification; the final estimate remains authoritative because repeated chunk metadata changes the persisted size.

The per-revision payload stays below half Firestore's 10 MiB transaction request limit because replacing a source record can both write the new revision and delete the previous revision. The largest combined source-record/chunk fetch, including both look-ahead documents, is under 17 MiB. That leaves material serialization and projection headroom below the 32 MB non-streaming response limit for a second-generation HTTP function. See the official [Firestore quotas](https://firebase.google.com/docs/firestore/quotas) and [Cloud Functions quotas](https://firebase.google.com/docs/functions/quotas).

Automatic indexes are disabled for every health collection except the date field needed by unfiltered range reads; the four explicit provider/metric/date composites remain available. This leaves write-request headroom for index entries and protocol overhead.

Sample projection never splits a stored chunk to fit a point budget. It returns only complete matching chunks and reports truncation. The chunk cursor identifies the last consumed source chunk, which also lets sparse provider-first pages advance when their matching result is empty.

## Revision and replacement contract

Provider adapters must supply a non-negative ordered revision and a bounded stable token. The writer hashes that token before persistence and calculates the content digest itself, excluding receipt/write timestamps so an exact redelivery remains idempotent.

| Incoming revision | Result |
| --- | --- |
| No stored source record | Write the source record and all chunks atomically |
| Lower order | Return `stale`; write nothing |
| Same order, token, and digest | Return `unchanged`; write nothing |
| Same order with different token or content | Throw `HealthSourceRecordRevisionConflictError`; write nothing |
| Higher order | Atomically replace the source record, write current chunks, and delete stale leaf chunks |

Every transaction rechecks the account-deletion tombstone and user root through `getUserDeletionGuardStateInTransaction` before reading or writing feature data.

## Query and projection contract

`HealthRangeQuery -> HealthRangeResult` is the only public health range contract.

The query accepts inclusive `YYYY-MM-DD` boundaries, provider and metric filters, sample inclusion, page limits, point limits, and stable `{ calendarDate, id }` cursors. Both the browser and Functions validate the same limits and create the same Firestore plan.

Only one provider-or-metric predicate is used per Firestore collection to avoid a combinatorial index surface. Provider filtering takes precedence when both are supplied; the shared projector applies the remaining metric filter to the bounded source page. Paging is therefore source-page based: a page can contain fewer observations or chunks than its limit, including an empty matching sample page. Callers follow the corresponding cursor until its truncation flag is false.

Daily summaries, discovery, coverage, freshness, and conflicts describe the current source page. `sourceRecordAggregateComplete` and `sampleAggregateComplete` are true only when the corresponding result was produced without an input cursor and has no later page. A paged consumer combines observations/chunks across every page before presenting range-wide aggregates; `findHealthConflicts()` recomputes conflicts across source-record page boundaries. Each observation carries effective source-record-or-entry coverage and device attribution for this purpose.

The result contains:

- source-aware observations with native/canonical metric entries;
- complete sample chunks when requested;
- per-date observation and Sleep-reference IDs;
- metric discovery with providers, value types, canonical units, aggregations, semantic variants, origins, recording methods, first/last dates, and sample availability;
- per-provider/account and semantic-series coverage, including requested, recorded, missing, partial, and unknown day counts;
- per-provider/account semantic-series freshness with observed/received timestamps and explicit fresh, stale, or unknown state;
- conflicts between overlapping observations with identical canonical semantics but differing values, including origin, deterministic provider/account source pairs, and involved recording methods;
- independent source-record/chunk cursors and truncation flags.

The projector never fills gaps. A metric recorded on one of seven requested days reports one recorded day, not seven values with six zeroes.

### Direct and server reads

`AppHealthService.watchRange()` is the default Health Hub path. It uses owner-scoped Firestore listeners, then runs the shared projector in the app. Separate source-record/chunk listeners can emit one side of an atomic replacement first; the projector suppresses any chunk whose revision disagrees with a parent source record present in the same source page, reports `sampleRevisionMismatchCount`, and marks the sample aggregate incomplete until the listeners converge.

`AppHealthService.queryRangeViaServer()` calls `queryHealthRange` for consumers that need an authenticated server read. The server executes source-record and chunk queries in one read-only Firestore transaction so both snapshots share one consistent read time.

The callable derives the data owner exclusively from `request.auth.uid`, requires App Check, validates every bound, logs only a safe error class, and returns the same `HealthRangeResult` shape.

## Conflict policy

Source records remain source-aware. The foundation does not pick a preferred provider, blend values, or hide duplicates.

A conflict is emitted only when canonical entries share metric ID, calendar date, aggregation, semantic variant, origin, canonical unit, and overlapping time intervals, come from different provider/account sources, and contain different scalar values. Native-only entries and different semantic variants are not declared conflicts.

A future product layer may define an explicit source-selection policy, but it must operate on these preserved observations and expose that policy to the user.

## Sleep compatibility boundary

`users/{uid}/sleepSessions` remains the canonical normalized Sleep model and current Sleep query path. Unified health source records must not copy a Sleep session, stage intervals, provider fields, or respiration/SpO₂/HRV sample arrays.

When a health source record needs a Sleep relationship, it stores a typed `sleep_reference` containing the existing Sleep document ID and one allowlisted aggregate field:

- duration or score;
- average, minimum, or resting heart rate;
- average or overnight HRV;
- maximum SpO₂;
- average respiration.

The validator also requires the health metric ID to match the referenced Sleep field. For example, `durationSeconds` maps to `sleep_duration`, while `vitals.averageHeartRateBpm` maps to `heart_rate`. The referenced value is resolved by the Sleep consumer; it is not copied into the health source record.

## Security and privacy

- Firestore Rules permit owners to get their own health documents and issue only explicitly bounded list queries.
- All browser writes are denied. Provider adapters use the Admin SDK writer.
- The callable requires Firebase Authentication and App Check and ignores any caller-supplied UID.
- Provider account IDs, provider source-record keys, and provider revision tokens are hashed before persistence. Credentials, raw payloads, raw values in logs, signed URLs, and free-form provider errors are prohibited.
- Large metric/sample arrays are excluded from automatic Firestore indexes.
- Health source records, sample chunks, and sync state live below `users/{uid}`, so the configured recursive Delete User Data extension removes them with the account.
- Background and transactional writes no-op when the user is missing or deletion is active.

## Retention and disconnect

Disconnect stops future provider access and changes safe sync state; it does not delete already imported health history. This matches the existing retained-import model and prevents a connection toggle from silently erasing historical analysis.

Account deletion writes the deletion tombstone before deleting the Firebase Auth user; if that marker cannot be stored, deletion fails closed and the account remains so recursive cleanup cannot begin without a writer-visible deletion signal. After Auth deletion, the configured extension removes all health source records, chunks, and sync state through recursive deletion of `users/{uid}`. There are no top-level unified-health collections that require a separate cleanup query.

Time-based health retention is intentionally uncapped for now. No `expireAt` field or TTL override exists for `healthSourceRecords` or `healthSampleChunks`. Storage remains bounded per document, replacement, and query. Revisit time-based retention only with an explicit product/privacy decision and measured storage data.

## Provider adapter checklist

Issues #611–#613 should implement each provider independently against this foundation:

1. Confirm the documented API family, delivery mode, history/range limits, sampling cadence, permission/scopes, and revision behavior.
2. Map only documented fields. Preserve the exact provider field/unit and semantic variant.
3. Supply a stable provider account ID, record type/key, ordered revision, and stable provider revision token. The shared writer derives account-scoped opaque persisted identities from the raw account ID and record key and hashes the revision token before storage. A revision token is an identifier such as an ETag or version marker, never an OAuth/access credential.
4. Normalize units only where conversion is defensible; otherwise use `native_only` or `not_comparable`.
5. Preserve recorded/provider-calculated/manual origin, device, quality, and partial coverage.
6. Send bounded aligned sample series to the shared writer; never hand-build chunk documents.
7. Update safe sync state with opaque error codes only.
8. Recheck connection, entitlement, permissions, and account deletion at ingress and again before persistence.
9. Test duplicates, stale/newer revisions, missing fields, partial days, timezone boundaries, unit conversion, sample bounds, and disconnect retention.
10. Update this document, the provider guide, provider Help/policy/integration pages where behavior becomes user-visible, and provider-specific operational documentation.

## Operational and release notes

The foundation is inert until provider adapters call the writer and the Health Hub calls `AppHealthService`. There is no migration or backfill in #610.

A release that begins using these collections must apply compatible Firestore indexes and Rules before enabling provider writes or Health Hub reads, then deploy the `queryHealthRange` callable and application through the normal release workflow. This implementation does not deploy or mutate production infrastructure.

Useful local verification:

```bash
npx vitest run src/app/shared/health.shared.spec.ts src/app/services/app.health.service.spec.ts --reporter=verbose
npm --prefix functions test -- src/health/validation.spec.ts src/health/writer.spec.ts src/health/query.spec.ts src/health/callable.spec.ts src/health/lifecycle.spec.ts src/firestore-indexes.spec.ts
npm run test:rules
npm --prefix functions run build
npm run build
```

The in-app Help content was reviewed for this foundation. No Help copy changes are required until provider health ingestion or the Health Hub becomes user-visible in #611–#614.
