# Account data cleanup: Gen 2 preparation and cutover

This change prepares the custom native `cleanupUserAccountsV2` owner using
Firebase's official `onUserDeleted` API from `firebase-functions/v2/identity`.
It covers the installed extension's fixed scope and preserves the verified
completion contract below. This is a custom Function conversion, not an import
of the Delete User Data function kit or an official extension migration.
No Function is deployed and no extension is updated, detached or removed here.
The Gen 1 `cleanupUserAccounts` export remains for the staged cutover.
See [the deletion matrix](user-deletion-workflow.html) and
[provider lifecycle guidance](provider-integration-guide.md#account-deletion).

## Evidence and scope

Read-only inspection on 9 October 2026 found `delete-user-data` ACTIVE at
`firebase/delete-user-data@0.1.30`, configured for recursive Firestore paths
`users/{UID},customers/{UID}` and Storage `quantified-self-io/users/{UID}`.
Automatic discovery is off, and no Realtime Database paths are configured.
Its three Gen 1 Node 22 functions have 256 MB and a 60-second timeout; the Auth
cleanup trigger has no retry policy. An observed timeout left a large nested
user tree after other account-cleanup stages had returned successfully.
This document contains no incident account identifiers or exports.

The new owner is a Gen 2 Auth deletion trigger in `europe-west2`, with a global
Auth Eventarc source, 512 MiB, 540 seconds, retry enabled, one CPU and concurrency
one per instance. It retains the eight provider secrets and explicitly runs as
`quantified-self-io@appspot.gserviceaccount.com`, the inspected Gen 1 identity,
rather than switching to the Compute default account. `IS_NOT_TENANT` makes the
SDK reject events from Identity Platform tenants; these UID paths belong only to
default-project accounts. The SDK dependency is upgraded to `firebase-functions`
7.4.0; the existing Admin 13.7.0 is within its supported peer range. Firebase CLI
15.31.0 recognizes this event type and its required global trigger location.

Firebase currently marks these [Gen 2 Auth events](https://firebase.google.com/docs/functions/auth-events)
**Preview**, with limited support and no SLA. Local preparation does not establish
production event delivery. The [Gen 2 migration guide](https://firebase.google.com/docs/functions/2nd-gen-upgrade)
requires a new export name and recommends preserving the runtime identity.
Both exports share the same cleanup implementation and attempt/checkpoint guards;
retiring the old trigger requires separate approval after live verification.
The Firestore database is `(default)` in `europe-west3`; the Storage target is
exactly the bucket named `quantified-self-io`, the exact object `users/<uid>`
and the folder `users/<uid>/` with a trailing slash. Prefix neighbours must never match. No arbitrary path, bucket, field,
auto-discovery, client input or Realtime Database cleanup is added. Default Storage
I/O fails closed outside project `quantified-self-io`, so a different deployment
cannot accidentally sweep this production bucket. Other projects need their own
reviewed configuration rather than inheriting the bucket target.

## Completion and retry contract

1. `deleteSelf` writes a non-expiring, server-only deletion fence before the
   individual Auth deletion. Marker-write failure aborts the Auth call. An
   ambiguous failed Auth RPC retains the fence; the authenticated user can retry
   `deleteSelf`. An already-missing Auth user does not prove data erasure or emit
   a fresh deletion event. A stale callable retry preserves an already verified
   completion receipt instead of reopening a pending fence.
2. The Auth cleanup handler also creates/upgrades the fence, covering deletion
   initiated through Auth administration. It reads provider identifiers from
   credentials, archived follow-up tokens and UID-owned queues. Before removing
   those sources, it unions identifiers into the deletion checkpoint. A failed
   read/checkpoint preserves credentials and operational identity sources while
   independent Firestore, Storage, MCP and mail cleanup still proceeds.
3. Existing provider/account ownership exclusions remain in force, including
   shared accounts and provider IDs reassigned to another active owner. Source
   queue/DLQ tombstones are persisted before recursive operational deletion.
   Queue and MCP top-level targets are checkpointed in the marker's server-only
   `operationalTargets` subcollection before recursive deletion. A retry can
   therefore find children after their query-visible parent has disappeared;
   paths stay within an explicit collection allowlist and current parent
   ownership is rechecked before replay. Changed ownership retains the target
   and blocks completion for operator review. Provider-only lookups also require
   the identifier to belong to the matching provider, not merely share its text.
   Discovery, deletion and readback page exact UID/provider queries at 100 rows;
   they do not scan unrelated queue collections. Canonical safe numeric legacy
   provider IDs are queried alongside their string forms, including Wahoo DLQ rows.
   Firebase UIDs remain literal strings throughout discovery, filtering and replay;
   trimming a custom UID must never change its account boundary.
   Required local failures are accumulated while other stages continue, then
   thrown so the existing retry policy can redeliver the Auth event.
4. Both fixed Firestore roots use native `recursiveDelete`, including children
   whose parents are missing and unknown/deeper subcollections. Storage cleanup
   pages 100 objects, deletes at most ten concurrently, and pins each deletion to
   the observed generation. Missing objects are idempotent; changed generations,
   listing failures and other failed deletes require another pass.
5. Readback checks both roots and their descendants, exact Storage prefix,
   selected operational queries and token children. Missing-parent references
   are inspected through `listDocuments`, not just normal collection queries.
   Existing route-original and service-disconnect reconcilers keep their leases
   and cursors; remaining records prevent completion even if their invocation
   returned successfully. No new scheduler or generic queue is introduced.
6. Only a fully successful, verified pass sets `cleanupStatus: complete`,
   `completedAt` and a seven-day `expireAt`. Pending markers have no TTL. The
   completion transaction checks the current invocation's attempt ID and an
   empty target-checkpoint collection. A superseded invocation cannot finish
   or remove a newer attempt's checkpoints. Each target checkpoint is removed
   only after descendant verification; completed TTL leaves no checkpoint
   children behind. The checkpoint's provider identifiers survive completed
   retention for duplicate events, without storing credentials. Completion means this scoped local
   cleanup passed; Auth deletion, an invocation acknowledgement, an email and
   successful provider HTTP alone are different outcomes.

Provider deauthorization and credential archival retain their existing
best-effort policy. Archived orphaned credentials may remain for bounded remote
revocation follow-up; queue tombstones, completion checkpoints and the deletion
confirmation email have their existing operational retention. Provider apps or
watches can retain previously sent workouts. Stripe remains responsible for
remote customer/subscription cleanup: its inspected `Auto delete` setting means
customers are **not** promised to be retained in Stripe. None of those remote
results is certified by the local completion marker. Read-only bucket inspection
also confirmed a 30-day Cloud Storage soft-delete policy. Completion verifies
absence of live objects; protected recovery copies expire under that existing
policy. This change does not disable retention or permanently purge those copies.

A running Storage upload cannot be transactionally fenced with Firestore. The
final listing detects objects visible at verification, while existing writer
lifecycle guards and deletion-surviving original-file reservations cover late
writes. This is not a guarantee against arbitrary unguarded future Admin writes.
Event retries are finite: a timeout or exhausted retry window can leave a
pending non-expiring fence requiring operator recovery, rather than falsely
recording success or releasing writers.

## Monitoring and recovery

Coverage is **deferred** in existing [#836](https://github.com/jimmykane/quantified-self/issues/836),
verified in Quantified Self IO Project 2. Existing generic error/heap views and
domain dashboards do not supply account-cleanup completion or overdue-pending
alerts. Reuse `tools/monitoring/` and native Function errors/duration for that
work; authoritative pending age must exclude completed retained markers.

New `[AccountDeletion]` summaries use fixed stages and `outcome=complete` or
`incomplete`, without UIDs, emails, provider IDs, credentials or raw errors in
metric labels. Use platform execution IDs for correlation. Existing detailed
cleanup/provider logs retain their established behavior. A hard timeout can
happen before an incomplete summary; native error/duration coverage is needed.
Do not interpret an absent summary as healthy zero.

For recovery, first inspect only the exact approved target and marker state.
Verify Auth absence, descendants (including missing parents), the Storage prefix,
operational rows and deferred cleanup intents before deciding what remains.
Replay or manually delete only after separate approval naming the account and
scope. Never bulk-delete Auth users as a substitute: `deleteUsers` does not emit
individual Auth deletion events. Keep unfinished markers and leased intents.
This PR adds no production inspection/export/replay script and performs no
account deletion.

## Verification and release gates

Local evidence includes targeted owner/callable/helper regressions and the
registered demo Firestore suite: a 4,955-descendant Health/Sleep/reservation tree,
missing parents, interrupted deletion, checkpoint recovery, concurrent guarded
writes, repeated cleanup, operational readback and other-owner preservation.
Additional regressions cover lost queue/MCP parents, superseded attempts,
provider ID collisions, reassigned or invalid checkpoint targets, stale callable
retries and token descendants below missing parents. Storage unit fixtures cover pagination, prefix collisions, generations, partial
failures, missing objects and a late object during final readback. Provider I/O
and Storage I/O in Firestore tests are synthetic. No live provider or account
mutation establishes this evidence. Functions build, secret/entrypoint checks,
cold-import benchmark and the public Help contract accompany the PR. All existing
owner behavior cases invoke the real Gen 2 SDK handler; additional tests cover the
raw Eventarc `oldValue` payload, original email, tenant isolation and missing data.
A real Firestore overlap test proves a stale Gen 1 attempt cannot replace the Gen 2
receipt or erase another owner. These tests do not run Functions/Extensions
emulators or claim live Auth-to-Eventarc delivery.

After separate deployment approval, first deploy the hardened legacy owner and
callable, then verify their revision and retry/secret/runtime options:

```sh
firebase deploy --project quantified-self-io --only functions:cleanupUserAccounts,functions:deleteSelf
```

Only after that verification, deploy the new owner under the approved scope:

```sh
firebase deploy --project quantified-self-io --only functions:cleanupUserAccountsV2
```

This ordering matters: an older deployed Gen 1 handler can remove credentials
before the new handler checkpoints their provider identifiers. Do not enable Gen 2
while that older implementation is still active. The prepared legacy and Gen 2
handlers safely share the attempt guards; a superseded pass requests retry and
cannot overwrite a newer completion receipt. Concurrency one limits work per
instance, not across instances or generations.

Before production cutover, activate and verify the account-cleanup coverage in
#836; local tests do not replace overdue-pending alerts. Before deployment approval, verify the runtime identity can recursively delete/read
both Firestore roots and list/read/delete objects in the exact bucket; do not
copy the extension's broad RTDB/PubSub roles. Keep the installed extension and
its manifest/env declarations during overlap. After deployment, read back both
owners' generation, trigger type/location, default-project tenant behavior, retry,
timeout, memory, CPU/concurrency, region, runtime identity, secrets and bucket
permissions. Check native errors and Cloud Run metrics for `cleanupUserAccountsV2`
as well as the legacy function; the #836 activation must include both during overlap. Any
live test-account deletion needs its own exact target/scope approval. Record
complete Firestore/Storage/operational absence and actual native execution
success before proposing retirement. Concurrent native/extension passes use
idempotent deletes; event-file trigger bursts are not the account Storage owner.

Retiring extension `delete-user-data` from project `quantified-self-io` is a
later, separately approved resource deletion. Inventory its three Functions,
Pub/Sub resources and service account first; define the exact retirement scope,
then update source-controlled declarations with the reviewed cutover. Preserve
email and Stripe instances. Retiring Gen 1 function `cleanupUserAccounts` in
`europe-west2` is another separately approved resource deletion; prepare removal of
its export and secret binding in source only when that cutover is approved.
Do not run `ext:migrate` during this phase: it can
deploy/update/uninstall resources. Do not treat `ext:export --mode functions`
as read-only either; it can detach extension-managed secrets. Restoring the
previous Function revision leaves unfinished markers active and does not
restore deleted data; preserve checkpoints for a later verified retry.

The official extension-to-function-kit path remains separate. Follow Firebase's
[migration guide](https://firebase.google.com/docs/extensions/users/migrate) and
[migration best practices](https://firebase.google.com/docs/extensions/migration-best-practices)
if that path is chosen. It is not implemented or executed by this PR. The installed
extension and its manifest remain unchanged. Extension management ends 31 March
2027; resources continuing to run is not a substitute for verified ownership.
