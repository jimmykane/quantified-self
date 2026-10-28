# Replace the Delete User Data extension with native account cleanup

The existing Gen 1 `cleanupUserAccounts` function takes ownership of the installed
Delete User Data extension's fixed Firestore and Storage scope. It retains its
Auth deletion trigger and provider cleanup, and adds durable checkpoints,
recursive erasure, exact Storage boundaries and verified completion. The target
is one native account-cleanup owner after the extension is retired.

This is a custom replacement of the configured extension scope. No Function is
added, and the Firebase SDK dependencies remain aligned with develop. Preparing
or merging this code does not deploy it or remove the installed extension.
See [the deletion matrix](user-deletion-workflow.html) and
[provider lifecycle guidance](provider-integration-guide.md#account-deletion).

## Production status — 23 October 2026

The separately approved deployment and extension retirement are complete in
`quantified-self-io`. The client write fence and mail/campaign guards were deployed
first, followed by the existing Gen 1 `cleanupUserAccounts` and `deleteSelf`.
Both deployed source archives matched the approved build from commit
`ddbbf9808904cdbf3d03b3bbf52248fcc8fb1d07` (2,414 files each).

An owner-performed account deletion exercised both cleanup handlers before retirement.
The native handler finished successfully in 6.796 seconds, recorded verified completion,
and reported a memory sample of approximately 247 MiB against its 1 GiB allocation.
Independent reads found Auth absent; no user/customer or provider-token descendants;
no live account Storage objects; no matching operational/MCP/campaign records; and
no unfinished operational checkpoints. The confirmation mail retained its 90-day expiry
and the completed receipt its seven-day expiry. There were no execution errors.
This account had no provider credentials; the check does not establish remote provider
revocation or large-account performance. Both handlers ran, so it is overlap evidence.

Pre-retirement readback found discovery disabled, no custom search or outgoing-event
consumers, zero backlog on both extension subscriptions, and no pending native cleanup
receipts. The approved removal used the official Firebase CLI:

```sh
firebase ext:uninstall delete-user-data --project quantified-self-io --immediate --force --non-interactive
```

Firebase removed the instance, its `ext-delete-user-data-clearData`,
`ext-delete-user-data-handleSearch` and `ext-delete-user-data-handleDeletion` Functions,
their subscriptions and the extension service account. The two retained topics had
no subscriptions and were removed under the same explicit approval:

```sh
gcloud pubsub topics delete projects/quantified-self-io/topics/ext-delete-user-data-discovery projects/quantified-self-io/topics/ext-delete-user-data-deletion --project=quantified-self-io --quiet
```

Readback at 08:12 UTC confirmed all nine inventoried resources absent. Repository
configuration no longer declares the instance, its deployment etag or its env file.
`cleanupUserAccounts` version 231 and `deleteSelf` version 230 remain ACTIVE with
unchanged runtime settings and secret bindings. Email and Stripe extension configuration
also remained unchanged and ACTIVE.

Monitoring coverage decision: **unchanged**. The existing native account failure/error
coverage has no filter dependency on the retired extension. Before/after readback
matched all nine cleanup metrics, seven enabled policies and the existing dashboard;
no monitoring configuration was applied during retirement.

Local retirement verification passed 103 focused Functions tests, nine Timeline
adapter tests, twelve cleanup-monitoring tests and the frontend test policy.
The former extension-config assertions now use the native recursive cleanup contract.
Exact JSON comparisons preserved all other Firebase configuration; documentation and
diagram checks passed without changing application runtime code.

**Native-only verification complete:** the owner deleted a fresh account with a new
UID after retirement. One native execution finished successfully in 6.844 seconds,
recorded verified completion at 08:24:16 UTC and logged no errors. Independent reads
at 08:26 UTC confirmed Auth absent; no user/customer or provider-token descendants;
no live account Storage objects; zero matches across 30 UID-based operational/MCP
queries; no campaign recipients; and no unfinished operational checkpoints. The only
remaining UID-owned mail was the delivered deletion confirmation with its 90-day
expiry. The completed receipt retained its seven-day expiry. A subsequent query found
no pending native cleanup receipts.

Post-deletion readback confirmed all nine retired extension resources still absent
and the native Functions, Email/Stripe extensions and monitoring configuration
unchanged. This completes the required native-only cutover check. The fresh account
had no provider credentials, so this verifies native trigger delivery and scoped local
completion without establishing remote provider revocation or large-account performance.

The source comparison and rollout procedure below retain the pre-retirement evidence
and recovery guidance; references to the installed extension describe that historical
configuration.

## Evidence and scope

Read-only inspection on 9 October 2026 found `delete-user-data` ACTIVE at
`firebase/delete-user-data@0.1.30`, configured for recursive Firestore paths
`users/{UID},customers/{UID}` and Storage `quantified-self-io/users/{UID}`.
Automatic discovery is off, and no Realtime Database paths are configured.
Its three Gen 1 Node 22 functions have 256 MB and a 60-second timeout; the Auth
cleanup trigger has no retry policy. An observed timeout left a large nested
user tree after other account-cleanup stages had returned successfully.
This document contains no incident account identifiers or exports.

`cleanupUserAccounts` remains a Gen 1 Auth deletion trigger in `europe-west2`,
using Firebase's existing `auth.user().onDelete` API. It has 1 GB memory,
a 540-second timeout and retries enabled. The existing eight provider secrets
and Gen 1 runtime identity are retained; verify the deployed identity is
`quantified-self-io@appspot.gserviceaccount.com` before cutover. Tenant users are
ignored because the fixed UID paths belong to default-project accounts.

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

| Behavior | Official 0.1.30 source / installed configuration | Prepared native owner |
| --- | --- | --- |
| Firestore roots | `users/{UID},customers/{UID}` in `(default)`, recursive mode | Same fixed roots and database; native `recursiveDelete` plus descendant readback |
| Recursion | SDK recursive deletion with a custom BulkWriter and three write attempts | SDK recursive deletion, including unknown subcollections and missing parents; failed invocation can retry |
| Storage boundary | `deleteFiles` with bare `users/<uid>` prefix | Exact object `users/<uid>` plus folder `users/<uid>/`; generation preconditions, 100-object pages, ten concurrent deletes |
| Failure/completion | Fixed-path handlers catch and log errors; final completion log can still run | Mandatory failures reject; current-attempt receipt requires scoped absence checks |
| Additional state | Configured roots only; discovery disabled | Explicit provider token, queue/DLQ, MCP, marketing and mail cleanup with existing retention exceptions |
| Optional features | RTDB paths, discovery/custom search, alternate databases and outgoing extension events are configurable | Not a generic replacement for these; no RTDB/discovery configured here. Verify no custom-search or outgoing-event consumer before retirement |
| Runtime | Installed Gen 1, 256 MB / 60 seconds; Auth retry unset | Existing Gen 1 owner, 1 GB / 540 seconds / retries |

Source references:
[fixed-path handlers](https://github.com/firebase/extensions/blob/1ac8343194b1b009bbfee5d6da492ab499d4d030/delete-user-data/functions/src/index.ts#L226-L341),
[recursive helper](https://github.com/firebase/extensions/blob/1ac8343194b1b009bbfee5d6da492ab499d4d030/delete-user-data/functions/src/recursiveDelete.ts),
[extension specification](https://github.com/firebase/extensions/blob/1ac8343194b1b009bbfee5d6da492ab499d4d030/delete-user-data/extension.yaml).

**High impact, conditional ownership risk — installed Storage prefix.** With
prefix-related UIDs such as `example` and `example-long`, deleting the first
account matches both folders in the extension. This requires prefix-related
identifiers, such as custom/imported UIDs; this review found no evidence of an
actual cross-account deletion. The prepared native helper excludes the neighbour,
but cannot constrain concurrent extension writes. The 23 October inventory below
found no matching UID prefixes, so this is not an observed blocker for those
accounts. If a pre-cutover recheck finds overlapping identifiers, resolve that
specific scope before overlap; changing the extension to a trailing-slash folder
boundary is one option requiring separate approval. The native owner also handles
an exact bare object. Adding the bare path alongside a slash path retains the risk.

**High impact, conditional target expansion — extension UID substitution.**
The published `replaceUID` helper passes the UID as the replacement-string
argument to `String.replace`. JavaScript interprets replacement tokens: a custom
UID consisting of `$'` produces Storage prefix `users/`, while `$$` becomes `$`.
This was reproduced locally by evaluating only the pinned source's pure helper,
with no SDK, credentials or remote I/O. The 23 October inventory found no `$`
characters in current Auth UIDs, Storage user-folder names or retained deletion
marker IDs.
The native implementation uses literal path segments and regression tests cover
all four replacement-token forms. A trailing slash alone does not fix literal
UID substitution. This remains a conditional risk for custom/imported identifiers,
not an established problem in the audited accounts. Recheck if the inventory or
UID creation/import paths change before retirement.

### UID investigation and upstream reports — 23 October 2026

Read-only production inspection reconfirmed the extension is ACTIVE at 0.1.30,
with `STORAGE_PATHS=quantified-self-io/users/{UID}`, recursive fixed Firestore paths
and auto discovery disabled. Paginated Auth reads selected only UIDs; Storage
reads listed immediate `users/` prefixes and bare object names without downloading
files; Firestore reads inspected retained deletion marker IDs. Identifiers were
compared in memory and only aggregate results were retained:

| Check | Result |
| --- | --- |
| Current Auth accounts | 2,939; every UID is 28 alphanumeric characters |
| Live Storage user folders | 1,083; every folder ID is 28 alphanumeric characters |
| Exact bare objects directly under `users/` | 0 |
| Retained deletion marker IDs | 13; every ID is 28 alphanumeric characters |
| Auth UIDs containing `$` or `/` | 0 |
| Auth UID prefix pairs, or a UID prefix matching a different Storage user root | 0 |
| Storage user folders without a matching current Auth UID | 0 |

The app's email/password and provider sign-in paths delegate account IDs to
Firebase. The only explicit production-source `createUser({uid})` helper found,
`createFirebaseAccount`, uses a 64-character hexadecimal SHA-256 result; no call
site for that helper was found in the inspected app/backend/tools sources. Neither
path accepts a user-chosen UID. All current Auth UIDs use the 28-character form.

Both extension behaviors reproduced locally with synthetic identifiers, and all
11 native Storage/helper unit tests passed, including the literal replacement-token
and prefix-neighbour cases. The current upstream `next` revision
[`c63cc320e7ac6ab351af16868372f59ab9546d93`](https://github.com/firebase/extensions/blob/c63cc320e7ac6ab351af16868372f59ab9546d93/delete-user-data/functions/src/index.ts#L272-L288)
still uses the bare prefix and replacement-string helper; its extension version
is still 0.1.30. Searches of Firebase extension issues, PRs, discussions and the web
found no exact public bug report or fix for these two edge cases. This is a search
result, not proof that no report exists.

Relevant upstream evidence, distinguished from our source reproductions:

| Source | Finding and applicability |
| --- | --- |
| [PR #152](https://github.com/firebase/extensions/pull/152), implementing [#148](https://github.com/firebase/extensions/issues/148) | Introduced prefix deletion intentionally to support folders. It does not discuss the UID-prefix collision. |
| [Issue #1498 and maintainer response](https://github.com/firebase/extensions/issues/1498#issuecomment-1568144815) | Historical 0.1.15 report of missed deletions during extension reconfiguration; maintainer described a reinstall gap. It is not a reproduction on 0.1.30, but argues against gratuitously reconfiguring the old extension during this cutover. |
| [Issue #2031 correction](https://github.com/firebase/extensions/issues/2031#issuecomment-2048568504) and [changelog](https://github.com/firebase/extensions/blob/c63cc320e7ac6ab351af16868372f59ab9546d93/delete-user-data/CHANGELOG.md) | Reporter narrowed incomplete recursion to auto-discovered documents; the changelog records related fixes in 0.1.21/0.1.22. Our installation is 0.1.30 with discovery disabled. |
| [Issue #2910](https://github.com/firebase/extensions/issues/2910#issuecomment-4995116894) | Open discussion of unsupported nested auto-discovery fields, not evidence that our configured fixed roots fail. Discovery is disabled here. |
| [Issue #1549](https://github.com/firebase/extensions/issues/1549#issuecomment-1587656549) | Bulk `deleteUsers()` does not emit per-user Auth deletion events. Our `deleteSelf` uses singular `deleteUser(uid)`; the recovery restriction below remains necessary. |
| [Discussion #1254](https://github.com/firebase/extensions/discussions/1254#discussioncomment-7586666) / [issue #1255](https://github.com/firebase/extensions/issues/1255#issuecomment-1814147237) | Duplicate cleanup with the Stripe extension can produce an already-deleted customer 404. This does not establish a UID boundary defect or certify remote Stripe cleanup. |

**Cutover consequence:** neither UID edge case is present in this inventory. No
extension reconfiguration is required solely for these two concerns in the audited
accounts. Use a brief, verified overlap and retire the extension after the native
owner passes the approved test deletion. Repeat the UID/prefix check immediately
before cutover and avoid custom UID creation/import during overlap. This snapshot
does not audit historical deletions, all possible delayed events or future Admin
writes, and it does not replace the runtime-permission and live-deletion checks.

### Other cleanup findings

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
Saved and unsaved admin campaign tests also resolve the actual recipient UID,
store it in `marketing.uid` and recheck deletion in the mail/quota transaction.
The initiating admin is not the recipient owner. Explicit external test inboxes
without an Auth account retain expiry but no invented UID. Lookup errors abort
without reserving quota or recording a successful test.
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

Campaign audience preparation also rechecks each account's deletion fence and
user root inside bounded recipient-write transactions. A selection made before
cleanup cannot recreate a recipient after deletion starts or completes. Cleanup
can remove unpublished snapshots from preparing, failed-draft or deleting
campaigns without requiring initialized counters; preparation publishes counts
from the remaining snapshot in its final transaction.

Repeated or overlapping native invocations use durable attempt/checkpoint guards;
a superseded attempt fails for retry and cannot replace a newer completion receipt.
The installed extension does not participate in those checkpoints. Never reuse an
Auth UID for a different account while old deletion events/retries or retained
checkpoints can still exist: neither implementation distinguishes account
incarnations at the same path.

## Integration with current lifecycle owners

The rebase preserves the current email delivery metadata (`queuedAt` and `delivery`) alongside UID
ownership/expiry, connection-history cleanup, monitoring instrumentation, current Rules and the
separate ordinary/emulator test runners. Connection-history `userID` is Firebase ownership;
`serviceName`/`providerUserId` are checkpointed provider attribution, never replacement UID authority.
Its roots and descendants use the same guarded recursive deletion/recovery path as other queues.

Activity sending now reserves `activitySendUploadCleanup` outside the user tree before Storage writes.
Account cleanup invokes that existing UID-scoped reconciler and refuses completion while any matching
reservation remains, including future reservations or active cleanup leases. It never erases those
claims as ordinary queue documents. The existing hourly owner can finish a delayed upload; an Auth
retry then rechecks Storage and records completion. New nested activity-send and Training state remains
covered by full `users/{uid}` recursive deletion. Existing failed-file debug captures keep their separate
14-day retention policy; this PR does not broaden the configured account Storage bucket scope.

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
   credentials, archived follow-up tokens, UID-owned queues and connection-history imports. Before removing
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
   Existing route-original, activity-send upload-reservation and service-disconnect reconcilers keep their leases
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

The existing [#836](https://github.com/jimmykane/quantified-self/issues/836) coverage is implemented,
activated and verified, as recorded in [account cleanup monitoring](account-cleanup-monitoring.md).
The existing Gen 1 owner preserves its fixed-label `CleanupHealth`
started/acknowledged/failed and partner-revocation observations. Coverage is
unchanged: the account policy already watches structured failures and non-OK
native `cleanupUserAccounts` executions, including hard timeouts without a final
application log. The existing dashboard, policy IDs and notification channels
remain in place; this replacement adds no monitoring resources or activation step.
Verify the existing coverage after the approved deployment.

Monitoring reports observed failure/retry age, not a global pending-account inventory. In particular,
it cannot establish that every non-expiring fence is current after event retries stop. Completed
retained markers must never be counted as pending. Inspect the authoritative receipt and exact
remaining scope during recovery; lack of a recent error is not proof of completion.

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
mutation establishes this evidence. Functions build, secret/entrypoint checks
and the public Help contract accompany the PR. Owner behavior cases invoke the
real Gen 1 SDK handler; additional tests cover the original UID, tenant isolation,
missing data and the deployed Auth/retry/memory/timeout/secret contract. A real
Firestore overlap test proves an older invocation cannot replace a newer verified
receipt or erase another owner. Further regressions cover an 801-record mail
history, confirmation/other-UID retention, intentionally retained email-only
records with and without TTL, and reassignment between query and
batch commit. A 101-receipt campaign-tracking fixture verifies paging, interrupted
parent deletion, checkpoint recovery and other-owner/UID-less retention. Further review covers ownership reassignment before recursive
queue deletion, reconnect after a provider-only parent disappears, an operational
tree exceeding the SDK's 5,000-document stream page, `uid` mail ownership after
email changes, and client Rules/transaction-time campaign fences. These tests do not run Functions/Extensions
emulators or claim live Auth trigger delivery.

## Rollout and extension retirement

1. Finish CI and merge the verified replacement. Before deployment, inspect the
   live extension configuration and permissions of the existing runtime identity.
   It must recursively delete/read both Firestore roots and list/read/delete the
   exact Storage bucket. Do not copy the extension's broad RTDB/Pub/Sub roles.
   Reconfirm the clean UID/prefix inventory above before overlapping account
   deletion; investigate any changed patterns rather than treating the two
   conditional source defects as confirmed production blockers. Keep its manifest/env
   declarations until a separately approved retirement; their presence is not
   proof that overlap is safe.
2. After separate deployment approval, deploy the client write fence,
   guarded campaign preparation/test-mail writers and UID-bearing registration/subscription mail writers first. Account mail cleanup
   uses explicit UID ownership only; historical email-only records are excluded.
   Use the updated, guarded campaign scripts for any separately authorized sends.

   ```sh
   firebase deploy --project quantified-self-io --only firestore:rules,functions:prepareMarketingCampaign,functions:sendMarketingTest,functions:sendRegistrationWelcomeEmail,functions:onSubscriptionUpdated
   ```

3. Deploy the updated existing cleanup owner and callable:

   ```sh
   firebase deploy --project quantified-self-io --only functions:cleanupUserAccounts,functions:deleteSelf
   ```

   Read back the deployed source revision, Gen 1 Auth deletion trigger,
   `europe-west2`, 1 GB memory, 540-second timeout, retries, existing runtime
   identity and eight provider secret bindings. Allow executions of the previous
   revision to finish before validating the replacement. Keep the existing
   account-cleanup failure/native-error monitoring active. A deployment ACK or
   absence of errors alone is not proof of erasure.
4. Verify an explicitly approved test-account deletion with representative nested
   data and a preserved neighbouring account. Record actual native handler
   delivery/success, the completed receipt, complete Firestore descendant
   absence, exact live Storage absence and operational cleanup. The local test
   suite uses synthetic provider/Storage I/O; production proof must inspect the
   exact approved target. Extension success alone is insufficient. Observe native
   duration/memory/errors and retained pending markers before proposing retirement.
5. Inventory the installed `delete-user-data` extension's three Functions,
   Pub/Sub resources and service account. Reconfirm `SEARCH_FUNCTION`, outgoing
   extension event subscriptions and pending discovery/deletion work; optional
   features are not carried over by this fixed-scope replacement. Obtain separate
   approval naming the exact extension/resource retirement scope, then remove
   that instance and update source-controlled declarations in the same cutover.
   Preserve the email and Stripe extension instances. **Keep `cleanupUserAccounts`**
   as the production account-cleanup owner; its export and secrets are not retired.
   Verify it remains active and monitored after extension removal, and record
   an independently approved post-retirement test deletion when validating sole
   ownership.

Event-file trigger bursts are not the account Storage owner. Fixed-root Firestore
deletes are idempotent across the native function and extension. The extension's
Storage prefix and UID-substitution edge cases were absent from the audited
inventory; recheck that assumption before overlap.

Do not run `ext:migrate` for this custom replacement: it can deploy/update/uninstall
resources. Do not treat `ext:export --mode functions` as read-only either; it can
detach extension-managed secrets. Restoring the previous Function revision leaves
unfinished markers active and does not restore deleted data; preserve checkpoints
for a later verified retry. Once the extension is retired, any rollback must retain
the replacement's Firestore and Storage cleanup responsibilities.
