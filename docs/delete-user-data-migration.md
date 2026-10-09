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
Auth Eventarc source, 1 GiB, 540 seconds, retry enabled, one CPU and concurrency
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

## Comparison with the installed extension source

Reviewed on 9 October 2026 against the immutable source linked by the Firebase
Extensions Hub for version 0.1.30, commit
[`1ac8343194b1b009bbfee5d6da492ab499d4d030`](https://github.com/firebase/extensions/tree/1ac8343194b1b009bbfee5d6da492ab499d4d030/delete-user-data),
including `extension.yaml`, `config.ts`, `index.ts`, `recursiveDelete.ts`, the
search helpers and deletion tests. This compares the configured installation;
it does not claim feature parity with every optional extension setting.

| Behavior | Official 0.1.30 source / installed configuration | Prepared native owners |
| --- | --- | --- |
| Firestore roots | `users/{UID},customers/{UID}` in `(default)`, recursive mode | Same fixed roots and database; native `recursiveDelete` plus descendant readback |
| Recursion | SDK recursive deletion with a custom BulkWriter and three write attempts | SDK recursive deletion, including unknown subcollections and missing parents; failed invocation can retry |
| Storage boundary | `deleteFiles` with bare `users/<uid>` prefix | Exact object `users/<uid>` plus folder `users/<uid>/`; generation preconditions, 100-object pages, ten concurrent deletes |
| Failure/completion | Fixed-path handlers catch and log errors; final completion log can still run | Mandatory failures reject; current-attempt receipt requires scoped absence checks |
| Additional state | Configured roots only; discovery disabled | Explicit provider token, queue/DLQ, MCP, marketing and mail cleanup with existing retention exceptions |
| Optional features | RTDB paths, discovery/custom search, alternate databases and outgoing extension events are configurable | Not a generic replacement for these; no RTDB/discovery configured here. Verify no custom-search or outgoing-event consumer before retirement |
| Runtime | Installed Gen 1, 256 MB / 60 seconds; Auth retry unset | Gen 2 1 GiB / 540 seconds / retries; hardened transitional Gen 1 512 MB / 540 seconds / retries |

Source references:
[fixed-path handlers](https://github.com/firebase/extensions/blob/1ac8343194b1b009bbfee5d6da492ab499d4d030/delete-user-data/functions/src/index.ts#L226-L341),
[recursive helper](https://github.com/firebase/extensions/blob/1ac8343194b1b009bbfee5d6da492ab499d4d030/delete-user-data/functions/src/recursiveDelete.ts),
[extension specification](https://github.com/firebase/extensions/blob/1ac8343194b1b009bbfee5d6da492ab499d4d030/delete-user-data/extension.yaml).

**High impact, conditional ownership risk — installed Storage prefix.** With
prefix-related UIDs such as `example` and `example-long`, deleting the first
account matches both folders in the extension. This requires prefix-related
identifiers, such as custom/imported UIDs; this review found no evidence of an
actual cross-account deletion. The prepared native helper excludes the neighbour,
but cannot constrain concurrent extension writes. Do not describe keeping this
extension configuration active as unconditionally safe. Before approved overlap,
review a separately approved extension configuration change to the trailing-slash
folder boundary, with the native owner handling any exact bare object, or plan
separately approved retirement after replacement verification. Neither action is
performed here. Adding the bare path alongside a slash path would retain the risk.

**High impact, conditional target expansion — extension UID substitution.**
The published `replaceUID` helper passes the UID as the replacement-string
argument to `String.replace`. JavaScript interprets replacement tokens: a custom
UID consisting of `$'` produces Storage prefix `users/`, while `$$` becomes `$`.
This was reproduced locally by evaluating only the pinned source's pure helper,
with no SDK, credentials or remote I/O. No affected production UID is established.
The native implementation uses literal path segments and regression tests cover
all four replacement-token forms. A trailing slash alone does not fix literal
UID substitution. Extension overlap also requires excluding this case through
reviewed UID constraints or correcting the extension implementation under a
separately approved change; otherwise keep this as an unresolved cutover blocker.

**High reliability impact — extension error acknowledgement.** A successful
`clearData` invocation/log is not proof of erasure. The source catches fixed-path
errors, and the installed short timeout has already proved insufficient for a
large tree. Native failure propagation and readback address this gap; monitoring
and recovery remain production gates.

**Medium impact — concurrent callable receipt reset, fixed.** A successful Auth
lookup could become stale before `deleteSelf` wrote its pending marker. The marker
is now always checked and written in a transaction, preserving a completed receipt
even when a competing deletion finishes between those operations.

**Medium impact — mail reads and ownership, fixed.**
Mail cleanup previously fetched entire histories and deleted email matches without
respecting another explicit UID. It now pages 100 records, queries `uid`, `toUids`
and `marketing.uid`, rejects conflicting explicit owners,
pins batch deletes to the queried document revision and verifies remaining owned
matches. Confirmation mail remains retained. Mail selection is UID-only: there
is no email-address fallback. Historical email-only records, including old
development-update campaign mail, are outside the account-cleanup scope and do
not block completion. Records with a valid `expireAt` use the existing 90-day TTL;
records without expiry remain until separately remediated. The production audit
confirmed both cases exist, so completion does not certify removal of all mail
ever addressed to the user. No backfill or historical-mail deletion is included.

Registration welcome, all four subscription lifecycle writers and deletion
confirmations now store an inert `uid` field without changing delivery recipients.
Notifications and subscription gifts already use `toUids`; marketing uses
`marketing.uid`, and the MCP campaign uses `uid`. The CSV development-update script
now resolves the current Auth UID by email and skips deleted/missing accounts.
The manual template-test script also attaches UID for registered recipients;
an explicitly selected external test inbox has no app UID and remains email-only.
Both scripts check the shared deletion guard inside the write transaction for
registered accounts and abort on Auth lookup failures other than user-not-found.
Existing records are not backfilled. The installed Delete User Data extension
never selected `mail`; email cleanup was already owned by the custom Gen 1 handler.
`functions/AGENTS.md` requires all account-mail writers to preserve explicit UID
ownership and expiry, including administrative scripts, retries and confirmations.

**Medium impact — campaign tracking retention, fixed for future writes.** The CSV
sender's separate `development_update_email_tracking` receipt stores recipient
name/email independently of the `mail` document. Expiring or deleting mail alone
left that receipt behind. New receipts carry the resolved Auth UID and 90-day
expiry metadata inside the same deletion-guarded transaction. Cleanup now discovers
receipts by exact `uid` and uses the guarded recursive/checkpoint/readback path,
including recovery after a parent disappears. The email-derived document ID is
never treated as account ownership. Historical UID-less receipts remain outside
this cleanup scope, with no email fallback or backfill. `mail.expireAt` TTL does
not apply to this separate collection; no tracking TTL policy is activated here,
and account cleanup does not depend on one. Existing campaign deduplication is
unchanged. Agent instructions now explicitly cover recipient-tracking records.

**Client and campaign writers, fixed.** Existing browser sessions can outlive the
callable response. Rules now apply the active deletion tombstone check to every
previously permitted account write, including profiles, settings, legal records,
event/route/activity edits and checkout sessions. Reads remain available under
their existing rules. The MCP campaign script rechecks the shared deletion guard
inside each mail transaction after recipient selection; skipped deleted users
are counted separately. These changes require their own approved rollout.

Two **hardened native generations** may overlap temporarily. They use the same
fixed scope and durable checkpoints; superseded attempts retry. This adds work,
provider calls and possible transaction/precondition conflicts, so it is a staged
cutover, not a permanent operating arrangement. The installed extension does not
participate in those checkpoints. Never reuse an Auth UID for a different account
while old deletion events/retries or retained checkpoints can still exist: neither
implementation distinguishes account incarnations at the same path.

## Completion and retry contract

1. `deleteSelf` writes a non-expiring, server-only deletion fence before the
   individual Auth deletion. Marker-write failure aborts the Auth call. An
   ambiguous failed Auth RPC retains the fence; the authenticated user can retry
   `deleteSelf`. An already-missing Auth user does not prove data erasure or emit
   a fresh deletion event. Every callable marker write checks the receipt transactionally, including
   when Auth was present at lookup and disappears before deletion, so a stale
   request cannot reopen verified completion.
2. The Auth cleanup handler also creates/upgrades the fence, covering deletion
   initiated through Auth administration. It reads provider identifiers from
   credentials, archived follow-up tokens and UID-owned queues. Before removing
   those sources, it unions identifiers into the deletion checkpoint. A failed
   read/checkpoint preserves credentials and operational identity sources while
   independent Firestore, Storage, MCP and mail cleanup still proceeds.
3. Existing provider/account ownership exclusions remain in force, including
   shared accounts and provider IDs reassigned to another active owner. Source
   queue/DLQ tombstones commit atomically with the guarded root deletion.
   Queue, MCP and UID-owned campaign-tracking targets are checkpointed in the marker's server-only
   `operationalTargets` subcollection before recursive deletion. A retry can
   therefore find children after their query-visible parent has disappeared;
   paths stay within an explicit collection allowlist and current parent
   ownership is rechecked before replay. Every descendant/root delete uses a
   transaction that reads the selected parent revision (or continued absence),
   current cleanup attempt, and provider-only connected-token ownership before
   committing. Native recursive enumeration uses a custom BulkWriter with at
   most ten concurrent transactions; the root waits for all descendant deletes.
   Checkpoints retain minimal owner/provider/source-queue metadata, so a missing
   parent cannot bypass reconnect checks. Older provider-only checkpoints without
   attribution fail closed. Changed ownership retains the target and blocks
   completion for operator review. Provider-only lookups also require
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
confirmation email have their existing operational retention. Historical email-only
mail is excluded from this receipt, with expiry only where a valid TTL field
exists. Provider apps or watches can retain previously sent workouts. Stripe remains responsible for
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
failures, missing objects, literal replacement-pattern UIDs and a late object during final readback. Provider I/O
and Storage I/O in Firestore tests are synthetic. No live provider or account
mutation establishes this evidence. Functions build, secret/entrypoint checks,
cold-import benchmark and the public Help contract accompany the PR. All existing
owner behavior cases invoke the real Gen 2 SDK handler; additional tests cover the
raw Eventarc `oldValue` payload, original UID, tenant isolation and missing data.
A real Firestore overlap test proves a stale Gen 1 attempt cannot replace the Gen 2
receipt or erase another owner. Further regressions cover an 801-record mail
history, confirmation/other-UID retention, intentionally retained email-only
records with and without TTL, and reassignment between query and
batch commit. A 101-receipt campaign-tracking fixture verifies paging, interrupted
parent deletion, checkpoint recovery and other-owner/UID-less retention. Further review covers ownership reassignment before recursive
queue deletion, reconnect after a provider-only parent disappears, an operational
tree exceeding the SDK's 5,000-document stream page, `uid` mail ownership after
email changes, and client Rules/transaction-time campaign fences. These tests do not run Functions/Extensions
emulators or claim live Auth-to-Eventarc delivery.

After separate deployment approval, first deploy the client write fence and
UID-bearing registration/subscription mail writers. Account mail cleanup uses
explicit UID ownership only; historical email-only records are excluded.
Do not run the old unguarded campaign script against deleting accounts.

```sh
firebase deploy --project quantified-self-io --only firestore:rules,functions:sendRegistrationWelcomeEmail,functions:onSubscriptionUpdated
```

Then deploy the hardened legacy owner and callable, and verify their revision
and retry/secret/runtime options:

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

Resolve both installed-extension Storage-prefix and UID-substitution gates above before any
approved overlapping account deletion. Before production cutover, activate and verify the account-cleanup coverage in
#836; local tests do not replace overdue-pending alerts. Before deployment approval, verify the runtime identity can recursively delete/read
both Firestore roots and list/read/delete objects in the exact bucket; do not
copy the extension's broad RTDB/PubSub roles. Keep the installed extension and
its manifest/env declarations until an exact configuration/retirement scope is
separately approved; do not interpret their presence as overlap safety approval. After deployment, read back both
owners' generation, trigger type/location, default-project tenant behavior, retry,
timeout, memory, CPU/concurrency, region, runtime identity, secrets and bucket
permissions. Check native errors and Cloud Run metrics for `cleanupUserAccountsV2`
as well as the legacy function; the #836 activation must include both during overlap. Any
live test-account deletion needs its own exact target/scope approval. Record
complete Firestore/Storage/operational absence and actual native execution
success before proposing retirement. Fixed-root Firestore deletes are idempotent across owners; the extension Storage
prefix and UID-substitution exceptions above still apply. Event-file trigger bursts are not the
account Storage owner. Reconfirm `SEARCH_FUNCTION`, outgoing extension event
subscriptions and pending discovery/deletion Pub/Sub work before retirement;
optional features are not carried over by the native implementation.

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
