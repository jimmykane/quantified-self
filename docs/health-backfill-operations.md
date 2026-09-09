# Existing-user Health history catch-up

`functions/src/scripts/backfill-existing-health.ts` is an operator CLI for existing
eligible Pro connections. Automatic history import after connecting is a separate
enhancement, [#681](https://github.com/jimmykane/quantified-self/issues/681), under
the [Health epic #609](https://github.com/jimmykane/quantified-self/issues/609).

This script is not a deployment or a scheduled job. Running its execute mode is a
production write and needs separate explicit approval for the project, users,
providers, and range. Building the script and running `--help` do not contact Firebase.

## Scope

| Provider | Work submitted | Historical boundary |
| --- | --- | --- |
| Garmin | One durable `garmin_health_backfill` cursor for the ten existing Health families | Latest rolling five calendar years at request time, clipped by stored/provider minimums |
| Suunto | `suunto_health_poll` jobs in at most 28-day windows, recent windows first | Requests from January 1, 2000; only history available from Suunto can be returned |
| COROS | `coros_poll` daily-data jobs, which import both Health and Sleep | Current three-month lookback, split using the existing inclusive date-range helper |

Garmin and Suunto **Sleep-only** history is not requested by this script. The normal
Connectivity history actions remain available and unchanged. There are no direct
provider HTTP calls, token refreshes, identity migrations, or local Cloud Tasks
dispatches. Existing deployed workers perform credential validation, provider
requests, retries, and lifecycle-fenced persistence. The deployed queue dispatcher
must be enabled; jobs may wait until its next scheduled pass.

The presence of some Health records or an old Sleep history marker is not proof of
a full Health backfill. This script intentionally does not scan measurements or
guess missing history from the earliest stored record. Pre-script imports cannot
always be proven complete; review the requested scope before starting a campaign.

## Preparation and dry run

Use an operator environment with Application Default Credentials and the repository's
Functions dependencies installed. No provider secrets are required by the CLI; the
workers use their deployed secrets. The CLI refuses emulator environment variables
to prevent an accidental mixture of production Auth and emulator Firestore.

```bash
npm --prefix functions run build
npm --prefix functions run backfill-existing-health -- --help
npm --prefix functions run backfill-existing-health -- --project quantified-self-io --provider all --end 2026-09-06
```

Dry run is the default and performs **no writes**. It reads projected token metadata,
Auth eligibility, connection/binding/deletion state, and queue/checkpoint metadata.
It does not print Firebase UIDs, provider account IDs, credentials, callback URLs,
or measurements. Internal references are kept in memory only; import receipts use
opaque account/range digests. Runtime error objects are never serialized in reports.

`--end` is mandatory: it names an inclusive, fully completed UTC day. Use the same
project, provider, start, and end dates for every retry of a campaign. Omitting
`--start` uses January 1, 2000 as a stable requested campaign boundary. The shared
`getHealthBackfillStartMs` policy narrows it separately for each provider: Garmin to
five calendar years before **execution time**, Suunto to 2000, and COROS to three
calendar months before execution time. These are request limits, not promises of
available data. Rolling limits are not relative to the requested end date; a wholly
expired range is skipped. On resume, an aging oldest window is clipped. Garmin's
initial cursor, request count, and progress state are kept aligned with that clipped
range before queue creation; existing queued cursors are not reset.

Optional limits:

- `--uid UID`: inspect or submit only one owner, using an owner-scoped token query.
- `--max-users 5`: at most five owners receive new work in an invocation (maximum 100).
- `--max-jobs 25`: at most 25 new queue jobs per invocation (maximum 250).
- `--max-pending 100`: pause new admission when the shared Sleep/Health queue already
  has this many unprocessed jobs (maximum 1,000). This is backpressure, not a global
  atomic rate limiter; existing workers retain their concurrency/rate limits.
- `--scan-limit 1000`: token metadata scan cap per provider (maximum 10,000). Discovery
  uses 100-document pages and explicitly reports a truncated scan.

Dry runs inspect the bounded candidate set; `max-users` and `max-jobs` bound **writes**,
not the preview. Start with a single provider and a small approved batch, inspect
its progress and errors, and only then continue the same campaign. Do not start
multiple bulk commands in parallel.

## Execution and resume (only after approval)

Append `--execute` to the exact dry-run command. Bulk execution also requires
`--confirm-all-users`; a single-owner `--uid` command does not. There is no force
override for Pro eligibility, deletion, missing permissions, or a changed
connection. Provider permissions are checked from server-owned metadata where
available and verified by the worker when using the credential. Stale metadata can
still result in a worker authorization failure; a dry run is not a live token test.

The CLI checks for other pending history work, respects the normal provider history
cooldown, and claims a per-owner/provider lease before writing. Accounts from one
Suunto owner may be processed on successive invocations while earlier account jobs
are pending. A campaign can resume through its own cooldown but cannot override a
new history request's cooldown by default. It never waits inside an OAuth callback or imports
anything automatically after a connection.

After separate, explicit operator approval, `--override-cooldown-until` accepts the
exact observed `nextBackfillAllowedAtMs` as a UTC ISO timestamp (including milliseconds).
This exception requires `--uid` and a single provider; use the same approved campaign
range in dry run and execute. It bypasses only that matching application cooldown,
checked again inside the lease transaction. A changed future cooldown still blocks.
It does not bypass other pending history, leases, eligibility, permissions, deletion,
connection fences, duplicate receipts, or provider pacing/rate limits. The cooldown
is never cleared or shortened, and a new run receipt records the overridden timestamp.
This is a local operator CLI option, not a browser or deployed Function capability.

Submission checkpoints live at:

`users/{uid}/sleepSyncState/{provider}/adminHealthBackfills/{opaqueRun}/jobs/{opaqueWindow}`

A sibling `control` document serializes script executions for this owner/provider.
These server-only import receipts intentionally survive queue TTL and provider
disconnect alongside imported history. They cannot authorize work after a disconnect
or reconnect: every write checks the captured token/root/binding/connection fields,
user existence, and the deletion tombstone. A changed lifecycle requires operator
review, not automatic checkpoint reset. Recursive account deletion removes the entire
subtree. Existing Rules deny browser access to these descendants. No new Rules,
indexes, scheduled Functions, or TTL policy is needed.

The script reserves the exact opaque queue ID **before** enqueueing. Queue admission
uses the opt-in `preserveExisting` behavior to atomically preserve pending jobs,
completed jobs, retry state, and Garmin cursor progress. A crash between queue write
and checkpoint completion is recovered by inspecting the deterministic queue ID;
it is not an excuse to restart an import. An unsubmitted ambiguous reservation is
retryable only within 24 hours. Older ambiguous reservations fail closed as unknown.

Repeat dry runs for a read-only status report. Repeat execution mode to submit the
next bounded batch **and save observed terminal results in the receipts**. Do this
before the existing seven-day queue/DLQ retention removes the evidence. No new
background status reconciler is installed. A process that dies holding its lease
can be retried after 15 minutes; do not manually delete the lease or receipts.

## Interpreting the report

- `jobsPlanned`: total windows/cursors in the eligible candidate plans, including
  previously submitted work. It is not a count of new writes or measurements.
- `jobsSubmitted`: submissions acknowledged and checkpointed during this invocation.
  A reported failure may still have durably admitted a queue job; resume the same
  campaign to resolve an ambiguous outcome.
- `jobsAttempted`: enqueue attempts, including ambiguous failures. Both the job
  and owner admission caps count these attempts, not only acknowledged submissions.
- `observed.new` / `reserved`: work not yet known to have been submitted.
- `observed.pending`: the exact queue job is still unprocessed.
- `observed.success`: the worker reported successful processing, including valid
  empty provider responses. **For Garmin this only means the outbound history
  requests finished, not that all asynchronous callbacks arrived.**
- `observed.skipped`: the worker intentionally skipped the job; not complete coverage.
- `observed.failed`: a matching DLQ entry or a previously saved failure was found.
- `observed.unknown`: evidence expired or a job has an unrecognized terminal outcome.
  This never becomes success or automatically causes a re-import.
- `skipped`: fixed eligibility/backpressure reasons, not raw provider errors.
- `incomplete`: a write/scan limit or queue backpressure stopped this invocation;
  it is not a claim that provider history itself is incomplete.
- `failed`: sanitized operational errors during discovery/admission/checkpoint work.

Nonzero operational failures, failed jobs, or unknown outcomes give exit code 1.
Eligibility skips are reported without bypassing them. Use the existing queue
monitor/Cloud Logging and a separately approved, targeted recovery for DLQ or
unknown outcomes; this script deliberately has no destructive reset/retry switch.

Monitor both `processSleepSyncTask` and `processGarminHealthBackfillTask`, ingress
errors, queue lag, DLQ growth, and Health writes. Garmin uses its existing paced
90-day cursor and dedicated one-at-a-time worker; the other providers use the
existing Sleep/Health queue. Stop issuing new batches if failures or queue lag grow.

## Verification

Suunto Health retry logs classify the original exception before replacing its message for durable retry storage. Inspect `failureStage`, `failureCategory`, `errorName`, and bounded `processingElapsedMs`; recognized request failures additionally retain validated `providerStatusCode` or an allowlisted `transportCode`, and recognized RPC failures retain numeric `rpcStatusCode` (1–16). RPC codes are not proof of an upstream HTTP failure. Feed request/mapping, token, lifecycle, record-write, checkpoint and sync-state stages identify the failing operation without logging user/account identities, URLs, credentials, response bodies, raw exception messages, stacks or causes in diagnostic fields. Unrecognized values stay `unclassified`/`UnknownError`; absence of an upstream status must not be reported as a Suunto HTTP 500. These diagnostics do not change retry, continuation, write or deletion semantics.

Suunto `response_item_limit` is a mapper cardinality failure, not a provider HTTP 500. The worker adaptively narrows oversized windows while preserving complete local days and all existing parser limits. If the error persists at its minimum window or a pull/result budget is exhausted, pause admission and investigate; repeated retries are not proof of recovery. A locally prepared worker fix does not change production until separately approved and deployed. Existing pending jobs can retry on the new worker; a job already in the DLQ needs separately authorized targeted recovery, not a receipt reset or blind re-import.

Targeted suites cover parsing, ranges, opaque identities, dry-run non-mutation,
metadata projections, eligibility, paging and caps, crash recovery, queue expiry,
empty/success/skipped/failed semantics, lifecycle/deletion races, and transactional
preservation of existing queue work. The script adds no provider mapper, schema,
manual measurement, Training, MCP, or frontend behavior.
