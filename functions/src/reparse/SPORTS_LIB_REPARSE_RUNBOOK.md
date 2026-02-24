# Sports-Lib Reparse Runbook

## Purpose
This pipeline reparses existing events and activities from stored original files so event/activity data is upgraded to a fixed sports-lib target version.

Target version source of truth:
- `SPORTS_LIB_REPARSE_TARGET_VERSION`
- File: `functions/src/reparse/sports-lib-reparse.config.ts`

## Candidate Discovery Model

### Global mode (production path)
Global discovery is query-first on processing metadata:
- query: `collectionGroup('processing')`
- filter: `where('sportsLibVersionCode', '<', targetSportsLibVersionCode)`
- order: `orderBy('sportsLibVersionCode', 'asc').orderBy('__name__', 'asc')`

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
- `status` (`pending|processing|completed|failed`)
- `attemptCount`, `lastError`
- `enqueuedAt`, `processedAt`, `expireAt`

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
- preserve activity IDs by index
- preserve creator name when present
- delete stale old activities not present in new parsed set

## Bucket Fallback + Auto-Heal
To handle legacy or incorrect bucket metadata safely, reparse download tries multiple bucket candidates and auto-heals metadata when fallback succeeds.

Code constants:
- `SPORTS_LIB_PRIMARY_BUCKET = 'quantified-self-io'`
- `SPORTS_LIB_LEGACY_APPSPOT_BUCKET = 'quantified-self-io.appspot.com'`

Download candidate order:
1. metadata bucket from source-file metadata (if present)
2. explicit primary bucket
3. explicit legacy appspot bucket
4. runtime Admin default bucket (`admin.storage().bucket().name`)
5. appspot/non-appspot variants of candidates above (deduped)

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
- collection group: `processing`
- fields: `sportsLibVersionCode ASC`, `__name__ ASC`

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

### Backfill script
Dry-run:
```bash
npm run backfill-sports-lib-processing-code -- --limit 1000
```

Execute:
```bash
npm run backfill-sports-lib-processing-code -- --execute --limit 1000
```

Scoped:
```bash
npm run backfill-sports-lib-processing-code -- --execute --uid <uid> --limit 2000
npm run backfill-sports-lib-processing-code -- --execute --uids <uid1,uid2> --limit 2000
```

## Rollout Order
1. Deploy Firestore index and wait until READY.
2. Deploy code that writes `sportsLibVersionCode` in ingestion/reparse/frontend paths.
3. Run backfill script dry-run, then execute in batches.
4. Enable scheduler with conservative limits and optional UID allowlist.
5. Expand scope by removing allowlist and increasing limits.

## Observability
Check:
- scheduler checkpoint: `systemJobs/sportsLibReparse`
- job outcomes: `sportsLibReparseJobs`
- per-event status: `metaData/reparseStatus`
- per-event processing metadata: `metaData/processing`

Admin dashboard queue cards:
- `Cloud Tasks` (total)
- `Cloud Tasks (Workout)`
- `Cloud Tasks (Reparse)`
- Shared dispatch semantics and `ALREADY_EXISTS` behavior:
  `functions/src/shared/CLOUD_TASKS_DISPATCH_NOTES.md`

## Exports / Entry Points
Functions exports in `functions/src/index.ts`:
- `scheduleSportsLibReparseScan`
- `processSportsLibReparseTask`

Local npm commands in `functions/package.json`:
- `reparse-sports-lib-events`
- `backfill-sports-lib-processing-code`
