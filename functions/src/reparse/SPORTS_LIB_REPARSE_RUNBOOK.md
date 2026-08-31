# Sports-Lib Reparse Runbook

## Purpose
This pipeline reparses existing events and activities from stored original files so event/activity data is upgraded to a fixed sports-lib target version.

Target version source of truth:
- `SPORTS_LIB_REPARSE_TARGET_VERSION`
- File: `functions/src/reparse/sports-lib-reparse.config.ts`

### FIT creator device metadata correction

When Quantified Self adopts the Sports Lib release that recovers a FIT activity creator from an explicitly local or
creator `device_info` message, new imports persist that source-provided device identity. A targeted source-backed
reparse also replaces legacy `Unknown` and `Unknown Device` creator placeholders with the newly parsed identity.
Meaningful existing creator names continue to win so user device renames survive reparsing.

Use the ordinary targeted reparse only for retained original FIT files whose persisted creator is a placeholder. Do not
patch activity documents directly, and do not enable the automatic scanner or launch a global campaign solely for this
correction. Files without suitable creator metadata remain unknown.

### Sports Lib 20.3.0 Health and sleep scalar JSON transition

Sports Lib 20.3.0 adds the exported Health and Sleep scalar classes plus strict canonical `fromJSON()` support used by
Quantified Self's normalized Health and Sleep storage boundary. This is not an event/activity parser migration. Do not
enable the automatic event/route scanner and do not enqueue original-file reparses solely for 20.3.0. Before deploying
the dependency update, verify that both automatic scanners are disabled: their strict target version follows the
installed Sports Lib version, so a scanner left enabled from an earlier rollout would otherwise treat 20.3.0 as a new
event/route reparse target even though this release has no parser transition.

New Health and Sleep writes add a versioned Sports Lib JSON envelope while retaining legacy scalars for rollback.
Existing `healthSourceRecords` and `sleepSessions` use the separate dry-run-first, UID-scoped
`migrate-health-sleep-sports-lib-data` command documented in `docs/sleep-sync-operations.md`. That migration reads only
already-normalized values; it does not download originals, refetch providers, alter event processing metadata, or
change `SPORTS_LIB_REPARSE_TARGET_VERSION` behavior.

### Sports Lib 20.1.1 native dive gas and tank record persistence

Sports Lib 20.1.0 introduced parser-provided FIT `dive_gas`, `tank_summary`, and `tank_update` messages as structured
source records on each Diving-group activity. Sports Lib 20.1.1 serializes those optional records in native Activity
JSON as `diveSourceRecords`. Gas percentages, tank pressures in bar, volume used in litres, timestamps, packed sensor
values, and parser enum values remain source-owned. The library does not turn them into numeric summary stats, infer
gas names or nitrogen values, associate a gas with a tank, or calculate consumption.

New imports and source-backed targeted reparses write the records through the normal sanitized activity writer. The
writer still removes streams, but retains `diveSourceRecords` in the activity document. Event Details also hydrates the
retained original as a legacy fallback for activity documents created before 20.1.1. The Diving summary tab renders the
records separately for each selected dive in **Gas & Tanks**.

The records remain nonnumeric source data: they do not become Training inputs, durability fields, derived schemas, or
MCP metrics and are not projected through MCP activity-detail responses. Use an ordinary targeted reparse only when a
specific retained original should persist its legacy records. A reparse cannot recover records for an original source
that is no longer retained; do not enable the automatic scanner or launch a global reparse for this release.

### Sports Lib 20.0.3 regenerated-event summary correction

Sports Lib 20.0.3 applies the Diving-group terrain rule when it regenerates a parent event summary. A parent made
entirely of Diving-group activities omits `Ascent`, `Descent`, `Minimum Altitude`, `Maximum Altitude`, `Average
Altitude`, `Minimum Grade`, `Maximum Grade`, and `Average Grade`. A mixed parent aggregates those eight values only
from its non-Diving child activities. The correction does not alter raw source streams or child activity source stats.

Quantified Self's ordinary source-backed reparse calls `EventUtilities.reGenerateStatsForEvent(...)` immediately before
the sanitized event/activity writer persists the result; event merges use `EventUtilities.mergeEvents(...)` before the
same writer. The installed Functions package advances the target version automatically. Use the normal targeted
reparse lifecycle only when an existing persisted parent summary needs to be rewritten. Do not synthesize summary
values or patch Firestore directly. Keep the automatic scanner disabled unless a separate operational campaign is
approved; an event without its retained original remains an honest terminal `NO_ORIGINAL_FILES` outcome.

### Sports Lib 20.0.1 FIT parser transition

Sports Lib 20.0.1 uses FIT parser 5.0.2. On new FIT imports, session field 196 persists as canonical `Metabolic
Calories` (`kcal`), not `Resting Calories`. Existing native JSON `Resting Calories` values remain readable as their
recorded historical stat until a reparse replaces the source stats; the reparse path must not rename them or infer
`Metabolic Calories` from them. FIT `Average VAM` is converted from the parser's meters-per-second source value to the
public meters-per-hour metric before it is persisted.

The same version removes terrain ascent/descent, altitude minimum/maximum/average, and grade
minimum/maximum/average summaries from Diving-group event, activity, and lap data during FIT import and native JSON
hydration. It leaves raw source streams available for the existing dive views.

Run the ordinary targeted reparse for retained original FIT files that need these new or corrected persisted values.
The installed package version advances the reparse target automatically. Do not enable the automatic scanner or start a
global campaign solely for this transition without separate operational approval; missing original files remain an
honest terminal `NO_ORIGINAL_FILES` outcome.

### Sports Lib 19.1.0 source-native dive metrics transition

Sports Lib 19.1.0 imports parser-provided Diving-group summaries for average/maximum depth, dive timing and rates,
CNS/N2 load, oxygen toxicity, SAC, and RMV, plus continuous Depth, decompression, load, air-time, SAC/RMV, PO₂, and
dive-ascent-rate streams. The importer preserves sparse source values and parser-provided magnitudes. It does not derive
missing summaries, reconstruct streams, fill gaps, apply plausibility thresholds, promote lap-only summaries, or
flatten gas/tank messages.

The FIT importer also preserves Garmin's explicit dive sub-sport semantics: single-gas, multi-gas, and gauge diving
become canonical Scuba Diving activities, while apnea diving and apnea hunting become Free Diving. Other dive
sub-sports without an exact Sports Lib activity type remain canonical Diving instead of being guessed into a nearby
type.

New imports persist only the summary stats actually supplied by the source. Run an ordinary targeted reparse when a
specific retained historical source must persist those new parser-owned summaries or corrected explicit dive activity
type. Do not enable the automatic scanner or enqueue a global historical reparse solely for this release. Event Details
hydrates continuous dive streams on demand from retained originals, so that view requires no persistence rewrite. MCP
exposes persisted numeric summaries through its automatic catalog while its frozen continuous chart tools remain
unchanged. Unit-derived dive depth/rate classes are display-only: they convert canonical values after hydration and do
not change serialized source stats. They therefore require no reparse or Firestore rewrite. Saved routes, Training
disciplines, durability, and Training-derived schemas are unchanged.

### Sports Lib 19.0.0 stroke-rate semantics transition

Sports Lib 19.0.0 introduces canonical `Stroke Rate` stream and average/minimum/maximum stats for Swimming, Open Water
Swimming, Rowing, Indoor Rowing, Canoeing, Kayaking, Paddling, and Stand Up Paddling. New source imports and native JSON
activity hydration translate the Cadence-shaped source fields for those sports to Stroke Rate while leaving locomotion
Cadence unchanged for other sports.

Do not enable the automatic scanner or enqueue a historical source reparse solely for this transition. Quantified Self
canonicalizes pre-19 split event/activity documents at read time using their persisted activity type, and derived schema
18 rebuilds Training stroke-rate summaries from the already stored average stat. New writes use the canonical type.
Mixed or unresolved sport sets retain Cadence because its meaning is ambiguous. Saved routes and the registered MCP
output schemas are unchanged.

### Sports Lib 18.1.4 continuous dive-depth transition

Sports Lib 18.1.4 maps FIT record depth from millimeters into a canonical meter-based `Depth` stream while preserving
existing session maximum-depth statistics and Suunto depth behavior. New imports and ordinary reparses can therefore
render Event Details dive profiles for Diving, Scuba Diving, Free Diving, Snorkeling, and Mermaiding sources that
actually contain continuous depth samples. At that release, Event Details hydrated Depth, Temperature, and Heart Rate directly from the
retained original source; the stream is never added to compact Firestore event or activity documents.

Do not enable the automatic scanner or enqueue a historical reparse solely for the dive-profile UI. Existing retained
sources become chartable through Event Details source hydration without a persistence rewrite. An explicitly requested
ordinary reparse may serialize parser-owned summary changes, but it is not required to display the continuous profile.
Saved routes, Training disciplines, Training durability, and derived-metric schemas were unchanged.

### Sports Lib 18.1.3 snorkeling and mermaiding classification transition

Sports Lib 18.1.3 normalizes the lowercase `snorkeling` and `mermaiding` aliases to canonical activity types and
places both in the existing Diving group. New imports and ordinary reparses write those canonical types. The frontend
also resolves retained legacy aliases through the package, so calendar grouping, colors, filters, and the existing
`scuba_diving` icon work without rewriting historical documents.

Do not enable the automatic scanner or enqueue a historical reparse solely for this classification change. It adds no
parser-owned statistic, does not change Training discipline membership or derived-metric schema, and has no saved-route
effect. Reparse an individual source only when canonicalizing its persisted activity type is independently needed.

### Sports Lib 18.1.2 lap pace transition

Sports Lib 18.1.2 fills missing pace, swim-pace, and grade-adjusted-pace summary stats from compatible speed stats on
events, activities, and laps. Native JSON hydration applies this behavior in memory to existing speed-only Firestore
documents, so the Laps table benefits immediately without rewriting historical data. New imports and any ordinary
future reparse serialize the additive derived lap stats through the existing sanitized event/activity writers.

Do not enable the automatic scanner or enqueue a historical reparse solely for this change. Saved routes are unaffected,
and the MCP lap projection remains unchanged because it does not expose pace fields.

## Candidate Discovery Model

### Global mode (production path)
Global discovery is query-first on processing metadata:
- query: `collectionGroup('metaData')`
- filter: `where('processingEntity', '==', 'event').where('sportsLibVersionCode', '<', targetSportsLibVersionCode)`
- order: `orderBy('sportsLibVersionCode', 'asc').orderBy('__name__', 'asc')`
- path guard: only docs at `.../metaData/processing` are treated as reparse candidates
- entity discriminator: global event discovery requires `processingEntity: "event"`; run the event-entity backfill before enabling the scheduler with this query.

For each processing doc hit:
1. Derive identity from parent path only (`users/{uid}/events/{eventId}` from `processingRef.parent.parent`).
2. Load the parent event.
3. Enqueue reparse job if still eligible.

Identity hardening rule:
- never trust `uid`/`eventId` fields in processing payloads
- always derive from document path

Malformed processing metadata policy:
- invalid or inconsistent processing metadata is skipped and logged
- scheduler/script run continues

### UID override mode (safe testing)
When `SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.uidAllowlist` is set, scheduler switches to per-user event scans:
- query: `users/{uid}/events`

### Missing processing docs
Missing `metaData/processing` docs are not visible to the global processing query. Use the backfill script to create them before full rollout.

## Components

### 1. Scheduler scanner
- Function: `scheduleSportsLibReparseScan`
- File: `functions/src/schedule/sports-lib-reparse.ts`
- Frequency: `every 10 minutes`
- Region: `europe-west2`
- Queue: `processSportsLibReparseTask`

Responsibilities:
- discover candidates
- create/update `sportsLibReparseJobs/{jobId}`
- enqueue Cloud Tasks for worker execution

### 2. Task worker
- Function: `processSportsLibReparseTask`
- File: `functions/src/tasks/sports-lib-reparse-worker.ts`

Responsibilities:
- process one job at a time
- strict original-file parse
- rewrite event + activities
- update per-event status + job state

### 3. Local direct reparse script
- Command: `npm run reparse-sports-lib-events`
- File: `functions/src/scripts/reparse-sports-lib-events.ts`

Behavior:
- dry-run by default
- `--execute` enables writes
- global mode uses processing-query discovery (same as scheduler)
- scoped mode (`--uid` / `--uids`) uses per-user event traversal

### 4. Backfill script (one-time / periodic maintenance)
- Command: `npm run backfill-sports-lib-processing-code`
- File: `functions/src/scripts/backfill-sports-lib-processing-code.ts`

Behavior:
- creates missing processing docs with sentinel version/code
- patches missing or mismatched `sportsLibVersionCode`
- logs + skips malformed versions (does not abort)
- dry-run by default

## Data Model

### Checkpoint doc
- Path: `systemJobs/sportsLibReparse`

Fields used:
- `cursorProcessingDocPath`
- `cursorProcessingVersionCode`
- `overrideCursorByUid`
- `lastPassStartedAt`, `lastPassCompletedAt`
- `lastScanAt`, `lastScanCount`, `lastEnqueuedCount`
- `targetSportsLibVersion`

### Job docs
- Collection: `sportsLibReparseJobs/{jobId}`
- `jobId` is deterministic from `uid + eventId + targetSportsLibVersion`

Key fields:
- `status` (`pending|processing|completed|failed|superseded`)
- `attemptCount`, `lastError`
- `enqueuedAt`, `processedAt`, `expireAt`
- `supersededAt`, `supersededBySportsLibVersion` for jobs from an older rollout target

TTL:
- `TTL_CONFIG.SPORTS_LIB_REPARSE_JOBS_IN_DAYS` (currently `30`)

### Per-event status doc
- Path: `users/{uid}/events/{eventId}/metaData/reparseStatus`

Common outcomes:
- `status=completed`
- `status=skipped, reason=NO_ORIGINAL_FILES`
- `status=failed, reason=REPARSE_FAILED`

### Processing metadata doc
- Path: `users/{uid}/events/{eventId}/metaData/processing`

Expected fields:
- `processingEntity: "event"`
- `sportsLibVersion: string`
- `sportsLibVersionCode: number`
- `processedAt`

Notes:
- this doc is user-writable by product decision
- users can influence only their own eligibility by modifying it

## Parse + Write Rules
- Supported source types: `fit`, `gpx`, `tcx`, `json`, `sml` (also `.gz` variants)
- Strictness: if any source file parse fails, event fails for that run
- Multiple source files are merged into one final parsed event

Preserved user-editable fields:
- `description`
- `privacy`
- `notes`
- `rpe`
- `feeling`

Activity identity strategy:
- regenerate activity IDs deterministically on every reparse (eventId + sourceActivityKey)
- derive sourceActivityKey from source-content hash + activity signature (order-independent)
- `assignReimportActivityIds(...)` performs strict sourceActivityKey restamping and fails fast if any activity still lacks a valid SHA-derived key (no fallback key generation)
- use deterministic matching for creator-name carryover (prefer sourceActivityKey, then signatures)
- delete stale old activities not present in the new parsed ID set

## Bucket Fallback + Auto-Heal
To handle incorrect bucket metadata safely, reparse download tries the known canonical buckets and auto-heals metadata when fallback succeeds.

Code constants:
- `SPORTS_LIB_PRIMARY_BUCKET = 'quantified-self-io'`

Download candidate order:
1. metadata bucket from source-file metadata (if present)
2. explicit primary bucket
3. runtime Admin default bucket (`admin.storage().bucket().name`)

If fallback bucket is used successfully:
- reparse continues
- source metadata bucket fields are rewritten to resolved bucket in same write path

## Access / Entitlement Behavior
Reparse candidate eligibility no longer depends on entitlement checks.
All users with candidate events are eligible in scheduler, worker, and local script paths.

## Runtime Controls (Code Constants)
File:
- `functions/src/reparse/sports-lib-reparse.config.ts`

Constant:
- `SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS`

Fields:
- `enabled`
- `scanLimit`
- `enqueueLimit`
- `uidAllowlist`

## Required Firestore Index
Global processing-query discovery requires:
- single-field override on collection group: `metaData`
- field: `sportsLibVersionCode`
- index: `COLLECTION_GROUP ASCENDING`

Defined in:
- `firestore.indexes.json`

## Local Commands
Run from `functions/`.

### Reparse script
Dry-run global:
```bash
npm run reparse-sports-lib-events
```

Dry-run scoped:
```bash
npm run reparse-sports-lib-events -- --uid <uid> --limit 100
npm run reparse-sports-lib-events -- --uids <uid1,uid2> --limit 200
```

Execute:
```bash
npm run reparse-sports-lib-events -- --execute --uid <uid> --limit 100
```

Global cursor start-after (event path or processing path):
```bash
npm run reparse-sports-lib-events -- --start-after users/<uid>/events/<eventId> --limit 200
npm run reparse-sports-lib-events -- --start-after users/<uid>/events/<eventId>/metaData/processing --limit 200
```

Notes:
- `--uids` mode ignores `--start-after`
- supports both `--arg value` and `--arg=value`

### Backfill scripts
Dry-run:
```bash
npm run backfill-sports-lib-processing-code -- --limit 1000
npm run backfill-event-processing-entity -- --resume --limit 1000
```

Execute:
```bash
npm run backfill-sports-lib-processing-code -- --execute --limit 1000
npm run backfill-event-processing-entity -- --execute --resume --limit 1000
```

Scoped:
```bash
npm run backfill-sports-lib-processing-code -- --execute --uid <uid> --limit 2000
npm run backfill-sports-lib-processing-code -- --execute --uids <uid1,uid2> --limit 2000
npm run backfill-event-processing-entity -- --execute --resume --uid <uid> --limit 2000
```

Use `backfill-event-processing-entity` when only legacy event processing docs need the `processingEntity: "event"` discriminator. Use `backfill-sports-lib-processing-code` when missing processing docs or missing `sportsLibVersionCode` also need to be repaired.

`backfill-event-processing-entity --resume` reads its checkpoint in dry-run mode but advances the checkpoint only during successful `--execute` batches. It supports global runs or a single `--uid`; it intentionally rejects `--uids` because the checkpoint is a single cursor.

## Rollout Order
1. Deploy Firestore index and wait until READY.
2. Deploy code that writes `sportsLibVersionCode` in ingestion/reparse/frontend paths.
3. Run backfill script dry-run, then execute in batches.
4. Enable scheduler with conservative limits and optional UID allowlist.
5. Expand scope by removing allowlist and increasing limits.

### Version overlap during a functions rollout

Cloud Tasks can briefly deliver jobs created by one functions revision to another revision while a rollout is moving traffic. The worker compares the job target with the installed sports-lib package version reported by `resolveRuntimeSportsLibVersion()`—not a checkpoint value—and classifies that relationship before activity-duration routing or parsing:

- Job target equals the worker runtime target: process normally.
- Job target is older than the worker runtime target: mark only the job `superseded`, record the newer version, and log at INFO. Do not parse the source files or overwrite the event's current `reparseStatus`.
- Job target is newer than the worker runtime target: throw for Cloud Tasks retry and log at WARN. Do not change the job or event status, because a newer revision should receive the retry after rollout.
- Invalid version metadata is a terminal job failure because retry cannot repair it.

The scheduler treats `superseded` as settled. A later candidate scan can create the version-specific job ID for the current target if the event still needs reparsing.

## Observability
Check:
- scheduler checkpoint: `systemJobs/sportsLibReparse`
- job outcomes: `sportsLibReparseJobs`
- per-event status: `metaData/reparseStatus`
- per-event processing metadata: `metaData/processing`

Admin dashboard queue cards:
- `Cloud Tasks` (total)
- `Cloud Tasks (Workout)`
- `Cloud Tasks (Reparse Normal)`
- `Cloud Tasks (Reparse Heavy)`
- `Current Target Failures`: failed jobs for the running target version; these are actionable
- `Historical Failures`: failed jobs from older target versions; these are retained context, not current incidents
- `Superseded Jobs`: older rollout jobs safely settled by a newer runtime

The attention/history table always includes up to ten current-target failures before adding non-duplicate entries from the ten most recent failure or superseded outcomes. It labels active, historical, and superseded rows separately. Only active failures can be manually retried on the heavy queue. If a differentiated count query is unavailable, the admin UI shows that count as unavailable instead of reporting a false zero.

- Shared dispatch semantics and `ALREADY_EXISTS` behavior:
  `functions/src/shared/CLOUD_TASKS_DISPATCH_NOTES.md`

## Exports / Entry Points
Functions exports in `functions/src/index.ts`:
- `scheduleSportsLibReparseScan`
- `processSportsLibReparseTask`

Local npm commands in `functions/package.json`:
- `reparse-sports-lib-events`
- `backfill-sports-lib-processing-code`
- `backfill-event-processing-entity`
