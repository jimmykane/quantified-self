# Unified Health Data Foundation

This document is the source of truth for the cross-provider health foundation introduced by issue #610. It defines the shared model and storage/query boundary that Garmin, Suunto, COROS, and Wahoo adapters can target without pretending that every provider exposes the same measurements or semantics. The COROS daily adapter added by issue #611 is the first production ingestion path; issue #612 adds production Suunto 24/7 Activity, daily-statistics, and Recovery ingestion; issue #613 adds production Garmin Health API 1.2.4 ingestion.

Issue #614 adds the authenticated **Health** workspace on top of this foundation. COROS, Suunto, and Garmin ingestion still does not make provider-specific Health records part of the existing MCP or Training contracts; normalized Sleep remains separate and is resolved through typed references. Weight profile context and activity-level VO2 max already embedded in imported workouts can also be read on demand for Health without copying them into Health storage or changing the activity contract.

## Goals

- Give provider adapters one typed model for daily health summaries, interval summaries, point measurements, profile snapshots, and bounded high-resolution samples.
- Preserve provider attribution, native meaning, recording method, device attribution, quality, and coverage.
- Normalize only values with a defensible canonical meaning and unit.
- Keep missing data missing; never turn an absent day or unsupported metric into zero.
- Preserve conflicting source observations instead of silently selecting or averaging one.
- Give the Angular app and an authenticated callable the same query, projection, paging, and result contracts.
- Reuse the existing normalized `sleepSessions` model through typed references instead of copying sleep sessions or raw sleep samples.

## Non-goals

- No Wahoo health adapter is wired yet. COROS daily Health, Suunto 24/7 Health, and Garmin Health are production-wide; Garmin and Suunto retain independent operational rollback switches.
- No cross-provider deduplication, ranking, or source-preference policy is applied.
- No medical interpretation or diagnosis is produced.
- No provider payload, credential, raw provider account ID, or signed URL is stored in the health model.
- No new MCP tool, Training metric, normalized Sleep field, dashboard tile, or public page is added.
- No time-based retention or Firestore TTL policy is enabled for health source records or sample chunks.

## Architecture

```text
provider adapter (#611–#613; COROS/Suunto/Garmin active)
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
                        │
                        ▼
          /health source-separated workspace

users/{uid}/events (Weight) ────────────────┐
users/{uid}/activities (activity VO2 max) ──┼─ queryActivityHealthRange
                                            └─ bounded identity-free observations
                                                        │
                                                        └─ /health only; no Health write
```

The shared implementation is split intentionally:

- `shared/health.ts` defines the schema, stable metric catalog, bounds, and public query/result types.
- `shared/health-query.ts` validates range requests and projects source records into observations, discovery, coverage, freshness, daily references, conflicts, and cursors.
- `shared/health-firestore-query.ts` creates the environment-neutral bounded Firestore plan.
- `functions/src/health/validation.ts` validates untrusted adapter input at runtime.
- `functions/src/health/writer.ts` owns opaque IDs, revisions, sample chunking, replacement, deletion guards, and sync state.
- `functions/src/health/query.ts` and `functions/src/health/callable.ts` provide the server adapter.
- `shared/activity-health.ts` and `functions/src/health/activity-query.ts` define the separate bounded workout-evidence projection used only by Health; `activity-callable.ts` enforces Authentication and App Check.
- `src/app/services/app.health.service.ts` provides the default direct listener, the bounded cross-page workspace loader, and the explicit callable alternative.
- `src/app/components/health/health-activity-query.service.ts` is the lazy workspace-only client for workout evidence, keeping the direct Health-record service and result contract unchanged.
- `src/app/components/health/` and `src/app/helpers/health-workspace.helper.ts` provide the authenticated source-separated Health workspace and its view projection.

## Current provider coverage

COROS daily data uses the existing `coros_poll` Sleep queue, token resolution, rolling seven-day scheduler, and three-month history replay. There is no COROS daily webhook. A successful queue item writes its lifecycle-guarded normalized Sleep sessions first, then guarded Health replacements, then both sync-state documents; it is not acknowledged until every required write completes. Each Sleep/Health write and both final ready transitions require the same token document, token-root credential generation, and exact in-memory credential revision plus the poll's original provider account, connection state, and connection generation to remain current. A refresh within that credential generation is allowed, but an old task cannot adopt a later OAuth or connection generation. Credential values are compared only inside lifecycle checks and are never added to normalized records, state, or logs. Retries remain idempotent because the provider calendar date is the daily source identity and recognized content is hashed into the revision token.

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

COROS connect and terminal-auth transitions mirror safe `ready` or `reconnect_required` Health sync state only while the exact service-connection generation and pending projection claim remain current. The authoritative transition atomically stores a generation-keyed pending marker before the derived write; a bounded scheduled repair retries failed mirrors and clears only the exact marker after success. Browser clients retain compatibility reads but cannot create, update, or delete the COROS token root; server-owned OAuth and disconnect callables own all mutations and remove token children first. Token-root deletion transactionally supersedes pending claims only while the root remains absent, then updates Health and atomically preserves `reconnect_required` when current service metadata owns that state. The root credential-generation guard also blocks an in-flight daily write after deletion or recreation. This ordering invalidates an already-running stale projection and prevents an empty client-created root from reviving a legacy orphan. Imported Health and Sleep history is retained. Recursive account deletion removes the user-owned source records, sample chunks, sync state, Sleep sessions, and operational queues, while deletion-aware queue transitions cannot recreate a failed-job copy after cleanup has started.

Suunto Health uses distinct `suunto_247_activity`, `suunto_247_daily_activity_statistics`, and `suunto_247_recovery` source records. It maps heart rate averages/minimums/maximums, HRV, SpO2, altitude, accumulated steps and energy, daily steps and energy, recovery Balance, and StressState without mixing them with workout FIT or Sleep values. Ratios become canonical percentages, joules become kilocalories, and documented StressState codes become categories while invalid sentinel `0` remains missing. Complementary or corrected Activity/Recovery rows sharing a timestamp merge per metric: the later non-null provider occurrence wins, while a later missing/sentinel value cannot erase an available measurement. Activity and Recovery retain bounded sample series by local date and offset; daily statistics retain multiple device sources behind one-way device identifiers. Suunto can include its current local day beyond an older daily-statistics request, so the worker fully validates the bounded response and discards complete days outside the original target instead of treating them as a failed request. Historical completeness is unknown and the current local date is partial.

Suunto uses a production-wide rolling seven-day reconciliation sweep that advances a bounded account page every 30 minutes and pauses for 24 hours after a completed sweep, plus signed Activity/Recovery webhooks. Before persistence, each valid notification is resolved through one-way-keyed, server-owned per-user OAuth account bindings to every active Firebase connection and transactionally rechecked against each exact account token, the current token-root lifecycle revision, authoritative connection metadata, and account deletion. Retained Suunto account tokens may predate the root's newest OAuth revision; the binding matches the token generation while the current root revision is captured separately so later work cannot adopt a replacement lifecycle. Unknown, disconnected, deleting, malformed, and oversized signed deliveries are acknowledged as permanent drops without retained ingress; authentication failures remain rejected, while transient binding or durable-write failures return retryable errors. Accepted notifications durably stage one compact local-day ingress per active connection and acknowledge before retryable asynchronous queue fan-out. Queue creation and processing remain fenced to the captured token, root, and connection generations. Raw webhook samples are not retained, and the worker deletes any ingress that later becomes non-retryable. Suunto Sleep history requests also enqueue matching Health ranges of at most 28 days while the independent Health kill switch is enabled. Each response is bounded to 4 MiB, provider errors are made opaque before telemetry, and one provider 401 receives one guarded token-refresh retry. Connect, terminal-auth, disconnect, deletion, and scheduled derived-state repair reuse the same generation-fenced lifecycle contract as COROS. See [Suunto 24/7 Health integration](suunto-integration.md) for the complete provider mapping, delivery, rollback, and operations contract.

Garmin Health uses production-wide Ping/Pull callbacks for Daily, Stress Details, HRV, User Metrics, Body Composition, Pulse Ox, All-day Respiration, Blood Pressure, Skin Temperature, and Health Snapshot summaries. Callback URLs are treated as short-lived credentials: the public endpoint validates the exact Garmin host, family, token shape, and 24-hour upload window, deduplicates descriptors, resolves unique provider accounts in bounded batched lookups, and writes compact UID-scoped live queue batches before acknowledging. Ambiguous bindings are dropped, and the existing dispatcher expands valid batches into authenticated pulls asynchronously. Pull responses are capped at 10 MiB and 10,000 summaries, then normalized into daily/interval/point/profile records and bounded sample series. Writes checkpoint every 32 normalized records with only a digest, stable receipt time, cursor, and cumulative outcomes; a six-minute task budget advances the same live row to a fresh queue revision, and the next pull resumes only when the normalized digest matches. Raw provider responses are never staged. Queue admission, checkpoints, and every provider/Health write are fenced to the current queue revision, token credential, token-root OAuth generation, provider identity, connection generation, operational switch, and deletion state. New OAuth connections pin the provider identity; active legacy connections are verified against Garmin's authenticated user-ID endpoint before their first callback pull. Callback URLs are removed on every terminal queue outcome and stripped from failed-job copies. The normal Garmin history action adds a durable all-family Health cursor alongside Sleep for every eligible connected Pro user while Garmin Health is enabled. A dedicated single-concurrency worker requests inclusive windows of at most 90 days, persists progress after every window, paces Garmin calls, and rechecks the exact queue/lifecycle/deletion fence before each request. Summary Resender remains a bounded operational recovery tool. See [Garmin Health integration](garmin-integration.md) for the exact family mapping, exclusions, delivery contract, and rollback procedure.

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

`users/{uid}/healthSourceRecords/{sourceRecordId}` stores one provider source record. A source record contains its calendar date and interval, source type, opaque source key, opaque account key, ordered content revision, maximum observed revision-order watermark, coverage, device, metric entries, searchable `metricIds`, and sample-chunk IDs. Legacy records without the optional watermark use their content revision order as the initial watermark; no schema-version migration is required.

The source-record ID is a deterministic SHA-256 identifier derived from the Firebase UID, provider, raw provider account ID, provider record type, and provider record key. The account key is a separate deterministic hash. The persisted source key is another account-scoped deterministic hash of the provider record key, and the persisted revision token is a source-record-scoped hash of the adapter token. Raw provider account IDs, record keys, and revision tokens remain in writer memory only for identity, revision, and digest calculation; none is persisted or logged.

### Sample chunks

`users/{uid}/healthSampleChunks/{chunkId}` stores compact arrays for one provider source record, metric, semantic variant, and series. Offsets and value arrays are chunk-local and must align exactly. Coverage is repeated series-level metadata, so its `sampleCount` is the validated total across the source series rather than the current chunk length. Each chunk retains the provider receipt time so sample freshness does not substitute a local write timestamp.

Chunks are permanent leaf documents by schema. Firestore Rules do not grant access to descendants, which makes document-only deletion safe when a higher provider revision replaces stale chunks.

### Sync state

`users/{uid}/healthSyncState/{provider}` stores the safe aggregate state shown by Health: ready, permission missing, reconnect required, failed, unsupported, or disconnected, plus bounded timestamps and an opaque error code. Raw error messages and payload excerpts are rejected.

This collection is not the OAuth connection source of truth. Provider credentials and stable raw account identity remain in their existing server-owned integration stores.

### Sports Lib scalar serialization boundary

Quantified Self pins `@sports-alliance/sports-lib@20.3.0` and uses its exported Health and Sleep data classes as the
canonical scalar serialization boundary. A canonical Health `value` metric stores a versioned `sportsLibData` envelope
inside that metric entry; a normalized Sleep session stores one versioned aggregate envelope at the session root. Each
entry in the envelope is the exact single-key JSON returned by the explicitly mapped class's `toJSON()` method:

```ts
{
  schemaVersion: 1;
  metrics: {
    value?: { Steps: 10000 };                 // Health metric entry
    duration?: { 'Sleep Duration': 28800 };  // Sleep session aggregate
  };
}
```

The field keys outside the Sports Lib JSON are Quantified Self semantic slots, not alternate Sports Lib type aliases.
Readers accept legacy scalar-only documents and the versioned representation. When the new representation exists, they
require the exact envelope version, allowlisted semantic key, canonical Sports Lib type key, one finite scalar, matching
value type, and an exact `fromJSON()`/`toJSON()` round trip. Unknown, alias, additional, ambiguous, non-finite, or
legacy-conflicting values fail closed. Successful reads consume and remove the internal envelope before projecting the
existing domain/result shape. After the guarded production migration reached a zero-candidate dry run, new writers use
the Sports Lib envelope as the only persisted canonical scalar copy. Health retains provider-native values and goal
metadata but omits duplicate `canonical` values; Sleep retains session structure, stages, samples, provenance, and
non-scalar score metadata but removes the duplicate aggregate paths on changed documents. Adapters cannot supply or
override the server-derived envelope. Legacy scalar readers remain available for rollback and untouched historical
documents during the observation window.

Existing legacy canonical fields may remain beside the new representation on untouched documents during the rollback
window; new and changed documents do not create another copy. Quantified Self still owns timestamps, provider/source
attribution, opaque account identity, revisions, quality, coverage, conflicts, stages,
bounded sample series, and raw provider fields. Sports Lib JSON never wraps a complete source record or Sleep session,
and no JSON object is added per sample point. Native-only and non-comparable values remain outside this canonical scalar
boundary.

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
| One Health workspace source aggregate | 2,048 source records |
| One Health workspace sample aggregate | 256 chunks and 100,000 whole sample points |
| One Health workspace serialized aggregate | 16 MiB across retained source records and chunks |
| Workout-backed Health query page | 128 event or activity candidates |
| One workout-backed Health query | 2,048 candidates and 1 MiB projected output |

The validator counts recognized input JSON-escaped UTF-8 bytes cumulatively while walking aligned metric/sample values, charges raw sample strings before trimming, and stops before retaining the element that would cross 4 MiB. The writer then cleans, measures, and retains one sample chunk at a time with the same cumulative ceiling before applying the exact final source-record-plus-chunks check. This bounds validation and construction amplification; the final estimate remains authoritative because repeated chunk metadata changes the persisted size.

The per-revision payload stays below half Firestore's 10 MiB transaction request limit because replacing a source record can both write the new revision and delete the previous revision. The largest combined source-record/chunk fetch, including both look-ahead documents, is under 17 MiB. That leaves material serialization and projection headroom below the 32 MB non-streaming response limit for a second-generation HTTP function. See the official [Firestore quotas](https://firebase.google.com/docs/firestore/quotas) and [Cloud Functions quotas](https://firebase.google.com/docs/functions/quotas).

Automatic indexes are disabled for every health collection except the date field needed by unfiltered range reads; the four explicit provider/metric/date composites remain available. This leaves write-request headroom for index entries and protocol overhead.

Sample projection never splits a stored chunk to fit a point budget. It returns only complete matching chunks and reports truncation. The chunk cursor identifies the last consumed source chunk, which also lets sparse provider-first pages advance when their matching result is empty.

## Revision and replacement contract

Provider adapters must supply a non-negative ordered revision and a bounded stable token. The writer hashes that token before persistence and calculates the content digest itself, excluding receipt/write timestamps so an exact redelivery remains idempotent. The source record separately stores `maxObservedRevisionOrder`; advancing that watermark for identical later content does not change the content revision shared with its sample chunks.

| Incoming revision | Result |
| --- | --- |
| No stored source record | Write the source record and all chunks atomically |
| Lower than `maxObservedRevisionOrder` | Return `stale`; write nothing |
| Same token and digest at the current watermark | Return `unchanged`; write nothing |
| Same token and digest above the current watermark | Advance only `maxObservedRevisionOrder`; return `unchanged` without rewriting chunks |
| At the current watermark with different token or content | Throw `HealthSourceRecordRevisionConflictError`; write nothing |
| Above the current watermark with different token or content | Atomically replace the source record, write current chunks, and delete stale leaf chunks |

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

`AppHealthService.watchRange()` remains the bounded live one-page path. It uses owner-scoped Firestore listeners, then runs the shared projector in the app. Separate source-record/chunk listeners can emit one side of an atomic replacement first; the projector suppresses any chunk whose revision disagrees with a parent source record present in the same source page, reports `sampleRevisionMismatchCount`, and marks the sample aggregate incomplete until the listeners converge.

`AppHealthService.loadMetricRange()` is the `/health` workspace path. It accepts exactly one selected metric, deliberately omits provider predicates, and uses the metric/date indexes so a provider-first page cannot fill with unrelated metric families. It walks source records in pages of 32 and chunks in pages of 8, retaining only the bounded aggregate described above. Provider filters are then applied locally and are never persisted as a preferred source. The loader stops at the first aggregate cap and returns an explicit incomplete state instead of silently projecting a partial result.

Catalog availability is resolved separately across all stored history. `AppHealthService.loadAvailableMetricIds()` runs one owner-scoped, server-resolved indexed count capped at one match for each stable metric ID; it never downloads or scans the user's complete Health history. Sleep availability uses a one-document query against the normalized Sleep-session collection. Health and Sleep apply successful availability results independently: a pending, denied, or failed domain remains unfiltered so a transient read problem cannot create a false absence, while the other domain can still hide confirmed absences. A visible notice explains the degraded state after a denied or failed check. After both checks settle, an unavailable selected/default metric falls back in product priority order (Sleep, Heart rate, HRV) and then to the first displayed catalog metric. Provider sync timestamp advances re-run Health metric availability discovery.

After every page is loaded, `projectLoadedHealthRange()` recomputes observations, sample revision filtering, coverage, freshness, daily references, and conflicts over the entire retained aggregate. The workspace ignores results from stale in-flight requests after metric/range navigation and refreshes the selected metric plus its priority summaries when Health sync-state timestamps advance.

`AppHealthService.queryRangeViaServer()` calls `queryHealthRange` for consumers that need an authenticated server read. The server executes source-record and chunk queries in one read-only Firestore transaction so both snapshots share one consistent read time.

The callable derives the data owner exclusively from `request.auth.uid`, requires App Check, validates every bound, logs only a safe error class, and returns the same `HealthRangeResult` shape.

### Workout-backed Weight and VO2 max

`queryActivityHealthRange` is a separate Health-only contract rather than an extension of `HealthRangeResult`. The frontend sends exactly `body_weight` or `vo2_max` plus the selected Health window's inclusive start/end milliseconds. The callable derives `users/{uid}` from Authentication, requires App Check, reads exact 128-document internal pages, and stops explicitly at 2,048 candidates or 1 MiB of projected output. It selects only the metric, source timestamps, bounded source fields, and activity type needed for projection. The response contains one-way observation and source-account keys, canonical values/units, provider, and a bounded discipline; it excludes event/activity IDs, names, locations, Firebase UIDs, provider account IDs, and raw creator fields. Candidates whose provider cannot be recognized are counted toward the safety bound but omitted instead of receiving invented Quantified Self provenance.

Weight reads `events.startDate + stats.Weight`. Sports Lib profile Weight is repeated on child activities, so querying the parent event emits at most one context observation per imported event. This is labelled `workout_profile_context`: it is not a weigh-in and is shown only when the active provider-filtered window contains no real `body_weight` Health observation.

VO2 max ranges candidates with `activities.startDate + stats.\`VO2 Max\`` and plots each retained value at that same child activity timestamp. This keeps an in-window child activity discoverable even when a merged parent event started outside the selected range. The individual activity preserves its discipline, whereas the parent event reduces child VO2 values to a maximum and is therefore deliberately excluded. Workout series use `workout_imported_<discipline>` and remain separate by provider, opaque account, discipline, origin, recording method, and unit. Consecutive identical values are collapsed within one source/discipline run by retaining its latest observation; a later changed value begins another run. Provider Health User Metrics and workout estimates are never averaged or merged.

The two indexed paths are `events(startDate, stats.Weight, __name__)` and `activities(startDate, stats.\`VO2 Max\`, __name__)`, ascending. The client never queries `events` or `activities` directly. No historical migration or backfill is needed because the projection reads already imported workout documents on demand.

## Conflict policy

Source records remain source-aware. The foundation does not pick a preferred provider, blend values, or hide duplicates.

A conflict is emitted only when canonical entries share metric ID, calendar date, aggregation, semantic variant, origin, canonical unit, and overlapping time intervals, come from different provider/account sources, and contain different scalar values. Native-only entries and different semantic variants are not declared conflicts.

The Health workspace deliberately defines no source-selection policy. It gives every provider/account/aggregation/semantic variant/origin/recording method/unit its own labeled series, isolates native-only or non-comparable values, and highlights comparable conflicts without selecting or averaging either value. Multiple accounts use local ordinal labels; opaque account keys are never rendered.

## Health workspace contract

The authenticated `/health` route is client-rendered and `noindex`. Owner-scoped reads remain available to signed-in, onboarded users who open the route directly, while all in-app entry points are temporarily presentation-gated by `shared/health-workspace-rollout.ts`. The staged UID sees a compact **Open Health** Dashboard action and a **Health · Beta** item immediately after Dashboard in primary navigation; other users receive no in-app link to `/health`. Provider connection and history-import plan checks are unchanged. Health is intentionally not a configurable dashboard tile.

The workspace opens on Resting heart rate for the latest 30 days when that metric is available. Its fixed priority order is Sleep, Heart rate, then HRV, with a latest row for each source series so differing semantics stay separate. The explorer groups the user's available historical metrics by the stable catalog categories; an empty current date window does not remove a metric that exists elsewhere in history. `/health` does not encode workspace state in query parameters. The selected `today`, `14d`, `30d`, `90d`, or `1y` range is validated and stored as the client-owned `appSettings.healthWorkspace.range` account preference; a missing or invalid value falls back to 30 days. The selected metric, older/newer window position, and provider filters remain local to the current workspace session, with metric and window position returning to Resting heart rate and today on the next visit before availability fallback is applied. Today is one calendar day and can be paged one day at a time.

Totals render as bars, scalar or point readings as lines/points, and categorical readings as stepped series. Health metric charts use the shared ECharts host, theme, tooltip, resize, and mobile-interaction stack; Sleep continues to reuse its normalized Sleep chart. Detailed chunks load for Today, 14-day, and 30-day windows; 90-day and 1-year views use stored summaries and explain when a metric is sample-only. Today combines the day's source-attributed summaries with any available intra-day chunks, but it does not imply continuous coverage where a provider supplies intermittent samples or daily summaries only. Coverage, freshness, device attribution, partial results, superseded revisions, conflicts, and safe sync state stay visible. The expandable source-observation table is the accessible textual equivalent of the charts.

Weight and VO2 max are always discoverable in the Health catalog because either may exist only in imported workouts rather than `healthSourceRecords`. Selecting either metric starts the direct Health-record load and the bounded workout-evidence callable together for the same remembered window. Request generations discard both stale results after metric, range, or older/newer navigation. A failed workout query does not hide successfully loaded provider Health measurements; the workspace identifies that partial source explicitly. Workout coverage is shown as not applicable rather than implying daily measurement completeness, raw creator fields are not presented as device attribution, and the latest workout observation still supplies last-observed context.

Future manual measurements use the existing Health schema rather than another store: provider `QuantifiedSelf`, origin `recorded`, recording method `manual`, and the canonical catalog metric/unit. A manual Weight is a real Health observation and suppresses the workout Weight fallback in the active filtered window. Manual VO2 max remains separate from provider Health and workout series through source, origin, recording method, and semantic variant. Manual Sleep remains in `sleepSessions` and is exposed to Health only through typed Sleep references. This compatibility is intentional; this implementation adds no manual-entry form, write callable, migration, or persistence path.

The compact provider footer reads the existing Health and Sleep sync-state documents. For a ready Garmin, Suunto, or COROS connection owned by an eligible Pro account, it offers the existing provider history callable only when a successful owner-scoped sync-state read proves that no prior Sleep/Health history request was made, or when that request failed and is retryable. A denied or failed state read cannot be interpreted as an absent backfill. A prior or cooldown-bound request suppresses the action, while Garmin's granular Health backfill state also exposes queued and running progress. The workspace does not invent progress states that Suunto and COROS do not publish. Wahoo and disconnected, permission-blocked, or reconnect-required sources never receive this action. The callable remains authoritative for plan access, provider rollout, connection credentials, permissions, deletion state, and cooldown enforcement. Request generations are UID-scoped so account/profile changes and component teardown cannot publish or clear another request's local state.

## Sleep compatibility boundary

`users/{uid}/sleepSessions` remains the canonical normalized Sleep model and current Sleep query path. Unified health source records must not copy a Sleep session, stage intervals, provider fields, or respiration/SpO₂/HRV sample arrays.

When a health source record needs a Sleep relationship, it stores a typed `sleep_reference` containing the existing Sleep document ID and one allowlisted aggregate field:

- duration or score;
- average, minimum, or resting heart rate;
- average or overnight HRV;
- maximum SpO₂;
- average respiration.

The validator also requires the health metric ID to match the referenced Sleep field. For example, `durationSeconds` maps to `sleep_duration`, while `vitals.averageHeartRateBpm` maps to `heart_rate`. The referenced value is resolved by the Sleep consumer; it is not copied into the health source record.

Sleep duration, in-bed duration, stage-duration totals, score, aggregate sleep heart rate, aggregate/overnight HRV and
sample count, maximum SpO₂, and average respiration use the same Sports Lib 20.3 scalar boundary described above.
Exact stage intervals, sample arrays, provider fields, dates, and session identity remain ordinary normalized Sleep
fields. Dashboard, Health, Training, derived-metric, and MCP readers all dual-read the representation without changing
their existing public result shapes.

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

The Health foundation receives production COROS, Suunto, and Garmin records, and `/health` now provides the source-separated product surface. COROS, Suunto, and Garmin backfills keep their existing provider history controls rather than adding a foundation-wide migration.

A release that begins using these collections must apply compatible Firestore indexes and Rules before enabling provider writes or Health reads, then deploy the Health callables and application through the normal release workflow. The workout-evidence extension adds two read indexes and `queryActivityHealthRange`, but changes no Firestore schema, Rules, provider ingestion, or backfill behavior. Deploy the indexes before the callable and frontend.

The Sports Lib 20.3 transition uses a separate user-scoped admin migration; it does not refetch provider history,
change OAuth credentials, reconnect accounts, or alter webhooks. Deploy dual readers before new writers, then run
`migrate-health-sleep-sports-lib-data` in dry-run and bounded execution modes for `health` and `sleep` independently.
Every execution transaction re-reads the document and account-deletion guard, updates only `metrics` for Health or
`sportsLibData` for Sleep, and is idempotent. An opaque document ID returned as `nextStartAfter` resumes the next page.
After execution, repeat the dry run and require zero candidates and zero invalid documents before beginning the
observation window. The `sleepSessions.sportsLibData` map is excluded from automatic indexing; Health already disables
automatic indexing for the whole source-record document. Once that verification passes, the reviewed writer cleanup
stops persisting duplicate canonical scalars while retaining legacy readers. Removing those readers remains a separate
later change after the observation and rollback window.

After that window, the same bounded migration supports an explicit `--remove-legacy-scalars` cleanup mode. It first
strictly decodes and round-trips the stored Sports Lib envelope, then removes only duplicate Health canonical value/goal
maps and normalized Sleep aggregate paths. Cleanup is dry-run-first, deletion-guarded, idempotent, cohort-resumable, and
uses checkpoints that cannot be reused across additive migration, cleanup, dry-run, or execution modes. It preserves
provider-native Health values, Sleep/session structure, non-scalar score metadata, source fields, and legacy readers;
unexpected or conflicting data is left untouched and blocks cohort advancement.

Useful local verification:

```bash
npx vitest run src/app/shared/health.shared.spec.ts src/app/shared/sports-lib-health-data.shared.spec.ts src/app/services/app.health.service.spec.ts src/app/services/app.sleep.service.spec.ts src/app/helpers/health-workspace.helper.spec.ts src/app/helpers/health-metric-chart.helper.spec.ts src/app/components/health/health-workspace.component.spec.ts --reporter=verbose
npm --prefix functions test -- src/health/validation.spec.ts src/health/writer.spec.ts src/health/query.spec.ts src/health/callable.spec.ts src/health/activity-query.spec.ts src/health/activity-callable.spec.ts src/health/lifecycle.spec.ts src/health/sports-lib-data-migration.spec.ts src/sleep/writer.spec.ts src/firestore-indexes.spec.ts
npm run test:rules
npm --prefix functions run build
npm run build
```

The in-app Help, Suunto integration page, provider privacy copy, and shared Sleep/Health operations documentation describe production-wide Suunto availability and its independent rollback switch.
