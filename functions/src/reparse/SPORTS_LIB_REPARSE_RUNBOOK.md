# Sports-Lib Reparse Runbook

## Purpose
This pipeline reparses existing events and activities from their stored original files so data can be upgraded to a fixed target sports-lib parser version.

Current target version source of truth:
- `SPORTS_LIB_REPARSE_TARGET_VERSION = '9.1.2'`
- File: `functions/src/reparse/sports-lib-reparse.service.ts`

An event is a candidate when:
- `users/{uid}/events/{eventId}/metaData/processing` is missing, or
- `processing.sportsLibVersion !== '9.1.2'`

## Components

### 1. Scheduler scanner
- Function: `scheduleSportsLibReparseScan`
- File: `functions/src/schedule/sports-lib-reparse.ts`
- Frequency: hourly (`every 1 hours`)
- Region: `europe-west2`
- Responsibility:
  - find candidate events
  - write/update job docs
  - enqueue Cloud Tasks (`processSportsLibReparseTask`)

### 2. Task worker
- Function: `processSportsLibReparseTask`
- File: `functions/src/tasks/sports-lib-reparse-worker.ts`
- Responsibility:
  - process one job (`jobId`) at a time
  - strict parse original files
  - rewrite event + activities
  - update status + job state

### 3. Local direct script
- Script entry: `npm run reparse-sports-lib-events`
- File: `functions/src/scripts/reparse-sports-lib-events.ts`
- Responsibility:
  - run discovery and reparse directly (no queue required)
  - default is dry-run (omit `--execute`)

## Data Model

### Checkpoint doc
- Path: `systemJobs/sportsLibReparse`
- Key fields:
  - `cursorEventPath`
  - `overrideCursorByUid`
  - `lastPassStartedAt`, `lastPassCompletedAt`
  - `lastScanAt`, `lastScanCount`, `lastEnqueuedCount`
  - `targetSportsLibVersion`

### Job docs
- Collection: `sportsLibReparseJobs/{jobId}`
- `jobId` is deterministic from `uid + eventId + targetSportsLibVersion`
- Key fields:
  - `status` (`pending|processing|completed|failed`)
  - `attemptCount`, `lastError`
  - `enqueuedAt`, `processedAt`, `expireAt`
- TTL:
  - `TTL_CONFIG.SPORTS_LIB_REPARSE_JOBS_IN_DAYS` (currently `30`)

### Per-event status doc
- Path: `users/{uid}/events/{eventId}/metaData/reparseStatus`
- Used for outcomes like:
  - `status=completed`
  - `status=skipped, reason=NO_ORIGINAL_FILES`
  - `status=failed, reason=REPARSE_FAILED|USER_NO_PAID_ACCESS`

### Per-event processing metadata
- Path: `users/{uid}/events/{eventId}/metaData/processing`
- Updated with:
  - `sportsLibVersion='9.1.2'`
  - `processedAt=serverTimestamp`

## Parse and Write Rules
- Supported source types: `fit`, `gpx`, `tcx`, `json`, `sml`, including `.gz`
- Strictness: if any source file parse fails, the event fails that run
- Multiple source files are merged into one final event
- Preserved from old event only:
  - `description`, `privacy`, `notes`
- Activity identity handling:
  - preserve activity IDs by index
  - preserve creator name when present
- Stale activities are deleted

## Access / Eligibility Behavior
Default behavior (`SPORTS_LIB_REPARSE_INCLUDE_FREE_USERS=false`):
- only paid/grace users are processed (`basic|pro|active_grace`)
- this applies to scheduler, local script, and worker

Include-free behavior (`SPORTS_LIB_REPARSE_INCLUDE_FREE_USERS=true`):
- entitlement checks are skipped
- all candidate users/events are eligible (subject to other filters/limits)

## Runtime Controls
All are env-driven and read at runtime:

- `SPORTS_LIB_REPARSE_ENABLED`
  - scheduler on/off
  - default: `false`
- `SPORTS_LIB_REPARSE_SCAN_LIMIT`
  - scheduler scanned events per run
  - default: `200`
- `SPORTS_LIB_REPARSE_ENQUEUE_LIMIT`
  - scheduler max enqueued jobs per run
  - default: `100`
- `SPORTS_LIB_REPARSE_UID_ALLOWLIST`
  - comma-separated UIDs
  - when set, scheduler switches to user-scoped scan mode
  - script uses it when `--uid/--uids` are not given
- `SPORTS_LIB_REPARSE_INCLUDE_FREE_USERS`
  - `true` to include free users
  - default: `false`

## Local Script Usage
Run from `functions/`.

### Dry-run all candidates (default)
```bash
npm run reparse-sports-lib-events
```

### Dry-run one user only
```bash
npm run reparse-sports-lib-events -- --uid <uid> --limit 100
```

### Dry-run multiple users
```bash
npm run reparse-sports-lib-events -- --uids <uid1,uid2,uid3> --limit 200
```

### Execute writes (single user)
```bash
npm run reparse-sports-lib-events -- --execute --uid <uid> --limit 50
```

### Execute writes (multiple users)
```bash
npm run reparse-sports-lib-events -- --execute --uids <uid1,uid2> --limit 200
```

### Start-after cursor (single UID or global mode)
```bash
npm run reparse-sports-lib-events -- --uid <uid> --start-after <eventId> --limit 100
```

Notes:
- In multi-UID mode (`--uids`), `--start-after` is ignored.
- CLI args currently support `--flag value` format only. `--flag=value` is not parsed.
- Precedence for UID scope:
  1. `--uid`
  2. `--uids`
  3. `SPORTS_LIB_REPARSE_UID_ALLOWLIST`

### Include free users in local script
```bash
SPORTS_LIB_REPARSE_INCLUDE_FREE_USERS=true npm run reparse-sports-lib-events -- --execute --uids <uid1,uid2>
```

## Scheduler / Worker Operation

### Safe rollout pattern
1. Deploy with scheduler disabled:
   - `SPORTS_LIB_REPARSE_ENABLED=false`
2. Run local dry-runs against test UIDs.
3. Run local execute for test UIDs.
4. Enable scheduler with low limits and UID allowlist:
   - `SPORTS_LIB_REPARSE_ENABLED=true`
   - `SPORTS_LIB_REPARSE_UID_ALLOWLIST=<test_uid1,test_uid2>`
   - low `SCAN_LIMIT`/`ENQUEUE_LIMIT`
5. Remove allowlist for full population when stable.

### Include free users in scheduler+worker
Set this env for deployed Functions runtime:
- `SPORTS_LIB_REPARSE_INCLUDE_FREE_USERS=true`

This must be visible to both:
- `scheduleSportsLibReparseScan`
- `processSportsLibReparseTask`

## Observability / Checks
- Check scheduler progress in `systemJobs/sportsLibReparse`
- Check job outcomes in `sportsLibReparseJobs`
- Check per-event status in `metaData/reparseStatus`
- Check final parser version in `metaData/processing.sportsLibVersion`

## Exports and Entry Points
- Exported in `functions/src/index.ts`:
  - `scheduleSportsLibReparseScan`
  - `processSportsLibReparseTask`
- Local command in `functions/package.json`:
  - `"reparse-sports-lib-events": "ts-node -r dotenv/config src/scripts/reparse-sports-lib-events.ts"`
