# Delete User Data: native cleanup and cutover

This is the first, deletion-only extension migration. It prepares the existing
`cleanupUserAccounts` owner to cover the installed extension's fixed scope. It
neither deploys Functions nor removes or updates an extension. Trigger generation,
region, provider secrets and billing ownership stay unchanged in this phase.
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

The owner remains the existing Gen 1 Auth `onDelete` function in `europe-west2`,
with 512 MB, 540 seconds, retry enabled and its existing eight provider secrets.
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
   a fresh deletion event.
2. The Auth cleanup handler also creates/upgrades the fence, covering deletion
   initiated through Auth administration. It reads provider identifiers from
   credentials, archived follow-up tokens and UID-owned queues. Before removing
   those sources, it unions identifiers into the deletion checkpoint. A failed
   read/checkpoint preserves credentials and operational identity sources while
   independent Firestore, Storage, MCP and mail cleanup still proceeds.
3. Existing provider/account ownership exclusions remain in force, including
   shared accounts and provider IDs reassigned to another active owner. Source
   queue/DLQ tombstones are persisted before recursive operational deletion.
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
   checkpoint's provider identifiers survive completed retention for duplicate
   events, without storing credentials. Completion means this scoped local
   cleanup passed; Auth deletion, an invocation acknowledgement, an email and
   successful provider HTTP alone are different outcomes.

Provider deauthorization and credential archival retain their existing
best-effort policy. Archived orphaned credentials may remain for bounded remote
revocation follow-up; queue tombstones, completion checkpoints and the deletion
confirmation email have their existing operational retention. Provider apps or
watches can retain previously sent workouts. Stripe remains responsible for
remote customer/subscription cleanup: its inspected `Auto delete` setting means
customers are **not** promised to be retained in Stripe. None of those remote
results is certified by the local completion marker.

A running Storage upload cannot be transactionally fenced with Firestore. The
final listing detects objects visible at verification, while existing writer
lifecycle guards and deletion-surviving original-file reservations cover late
writes. This is not a guarantee against arbitrary unguarded future Admin writes.
Gen 1 event retries are finite: a timeout or exhausted retry window can leave a
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
Storage unit fixtures cover pagination, prefix collisions, generations, partial
failures, missing objects and a late object during final readback. Provider I/O
and Storage I/O in Firestore tests are synthetic. No live provider or account
mutation establishes this evidence. Functions build, secret/entrypoint checks,
cold-import benchmark and the public Help contract accompany the PR.

After separate deployment approval, deploy only the prepared owners:

```sh
firebase deploy --project quantified-self-io --only functions:cleanupUserAccounts,functions:deleteSelf
```

Before that approval, verify the runtime identity can recursively delete/read
both Firestore roots and list/read/delete objects in the exact bucket; do not
copy the extension's broad RTDB/PubSub roles. Keep the installed extension and
its manifest/env declarations during overlap. After deployment, read back the
trigger, retry, timeout, memory, region, secrets and bucket permissions. Any
live test-account deletion needs its own exact target/scope approval. Record
complete Firestore/Storage/operational absence and actual native execution
success before proposing retirement. Concurrent native/extension passes use
idempotent deletes; event-file trigger bursts are not the account Storage owner.

Retiring extension `delete-user-data` from project `quantified-self-io` is a
later, separately approved resource deletion. Inventory its three Functions,
Pub/Sub resources and service account first; define the exact retirement scope,
then update source-controlled declarations with the reviewed cutover. Preserve
email and Stripe instances. Do not run `ext:migrate` during this phase: it can
deploy/update/uninstall resources. Do not treat `ext:export --mode functions`
as read-only either; it can detach extension-managed secrets. Restoring the
previous Function revision leaves unfinished markers active and does not
restore deleted data; preserve checkpoints for a later verified retry.

Gen 2 migration and SDK uplift are separate from this deletion reliability fix.
The installed SDK is not upgraded here. The Google function-kit's published
stable placeholder is not an executable replacement; its reviewed release
candidate still catches per-path cleanup failures, so merely importing it does
not implement this completion contract. Follow Firebase's
[migration guide](https://firebase.google.com/docs/extensions/users/migrate) and
[migration best practices](https://firebase.google.com/docs/extensions/migration-best-practices)
when preparing that later phase. Extension management ends 31 March 2027;
deployed resources continuing to run is not a substitute for verified ownership.
