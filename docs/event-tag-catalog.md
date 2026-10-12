# Reusable event tag catalog

## Tags workspace

The authenticated, client-rendered `/tags` route uses a searchable tag library beside the existing events table.
`?tag=<label>` restores the selected tag without initial haptic feedback. The route uses the shared workspace shell,
Material controls, and the global scrollbar skin. The selector stacks above the table on phones. Table metrics continue
to use the signed-in user's unit settings through the existing Sports Lib display path.
The shared table's `tag-library` presentation matches the selected mockup: compact tag links that wrap on phones,
text column headings, activity name and sport grouped together, and split date/time cells. Its initial columns are
Date, Activity, Distance, Duration, and Tags, with five rows per page. Column, sort, and page-size choices stay local
to the Tags page instead of changing Dashboard preferences. Paging/completeness controls sit below the table.
An ISO activity name equal to its recorded start time is treated as a generated timestamp name and hidden in Tags.
Its sport becomes the activity link, with the sport and date identifying accessible controls. Custom names and the
existing description/untitled fallbacks remain visible. Display-only labels do not modify stored names or descriptions;
search still covers the original fields, and Activity sorting follows the visible name or sport. Dashboard is unchanged.

History starts with the newest 250 event documents, ordered by `startDate` descending. **Load older activities** uses
`AppEventService.getEventsPageOnceByWithMeta` and the last document snapshot cursor, including its implicit document-ID
tie-breaker. Pages read one lookahead document and never display that lookahead until the next page. The Tags route
requires server-only reads so an offline cache cannot be mistaken for the end of history. Reads add no indexes, stored
fields, callable Functions, streams, or activity subcollection loads. Tags are matched locally, case-insensitively,
through `getEventTags`, including its legacy fallback and canonical empty-array precedence. An exact Firestore
`array-contains` query would miss differing capitalization and legacy labels, so this revision does not use one.

Counts and table search/sorting/pagination describe only loaded activity history while more pages remain. A saved tag
with zero loaded matches is explicitly provisional. A zero-membership empty state is conclusive only after the final
server page. Read failures retain loaded rows and the previous cursor for retry. Refresh restarts from the newest page;
this is a paginated browsing session, not a live history listener or an atomic snapshot across concurrent edits.
The catalog is independent of the loaded history. Counts deduplicate normalized tag identity per event, and the catalog
spelling is preferred. Locally observed and deep-linked labels remain selectable even if catalog loading fails.
Catalog responses merge with labels retained during an in-flight edit, so a late read cannot drop an observed label
after its last loaded activity loses the tag. Display-row rebuilds preserve the caller's history-loading state.

The table's optional `eventsChange` output reconciles successfully saved single/bulk tags and deleted rows with the
library's owner-scoped history using explicit tag patches, deleted IDs, and the operation's captured owner UID.
Callbacks from another owner are ignored even before Angular detaches the previous table. It never infers deletion from a table
snapshot or the currently selected tag, so late callbacks cannot remove unrelated rows or replace newer metadata.
Tag patches are emitted when a save succeeds rather than replayed when its dialog closes. Bulk deletion reports
successful IDs even when another deletion in the batch fails. The confirmed owner and IDs are captured before opening
the confirmation dialog; bulk deletion keeps table search and sort subscriptions alive. Saved/observed labels remain in the current
session after their last matching activity is removed. Existing transaction and deletion paths enforce writes;
the page introduces no write API.
Confirmed tag patches and deletions are also applied to any history read already in flight, so that response cannot
restore a deleted activity or overwrite its confirmed tags. This protection ends with that read; later reads can show
newer server values. Newly saved labels enter the library even when their edited activity is outside loaded history.
The shared table also checks the captured owner UID and component lifetime before applying tag-save/deletion results,
emitting changes, or showing completion feedback. An already-started write still belongs to its captured owner.
Requests are fenced by the current Firebase owner object, an account/refresh
generation, and component teardown so late results cannot replace a different account's data.

MCP/Assistant impact: no public tools, stored event fields, metric semantics, scopes, consent, or mutation contracts
change. The route reuses current tag reads and writes and does not extend Training planning or provider delivery.
Queue/monitoring impact is unchanged: this is a browser read surface with no worker, queue, schedule, or provider change.

## Catalog storage

Event documents remain the source of truth for tag membership. The private
`users/{uid}/eventTagCatalog/{key}` collection stores distinct labels used for
filter choices and editor suggestions across date ranges. Each document has a
`name` field. Its ID is the SHA-256 hash of the normalized label in lowercase,
matching the shared event-tag case-insensitive identity. The first stored
spelling is retained. Removing a tag from an event, or deleting the event, does
not remove its catalog entry. Catalog removal is not available in this release.

Tag edits create missing catalog entries in the same transaction as the event
change. The app can read the collection and create owner-scoped entries with
normalized names and 64-character hash keys; Rules deny updates and deletes.
MCP and Assistant use their existing approved mutation transaction, and the
common server event writer creates entries for newly tagged imports. Server
writes check the account-deletion guard. Untagged event writes add no catalog
reads or writes. The catalog stays under `users/{uid}`, so recursive account
deletion covers it. The app still merges successful local edits into current
session suggestions while its catalog read cache refreshes.

The browser and server compute SHA-256 from the normalized lowercase label.
Firestore Rules validate the label and hash-key shape. Rules lowercase Unicode
differently from JavaScript for some labels, so they do not recompute the hash;
the owner controls this private list, and catalog reads deduplicate names
case-insensitively. Keep browser/server key parity tests for Unicode labels.

This revision no longer exports `projectEventTagCatalog`. Removing its source
does not delete the deployed Function: it continues to receive every event
write until a separately approved cloud deletion. Direct catalog writes from
the app, MCP, Assistant, and server event writers must be deployed and verified
before that deletion. Deleting the trigger does not delete saved tags.

## Backfill and rollout

The production backfill has been run and verified. This trigger removal is the
final rollout step; do not deploy a Functions manifest from this revision until
all of these prerequisites are met:

1. Deploy the owner-create catalog Rules while the trigger stays deployed.
2. Deploy the direct-writing MCP, Assistant, and server event writers from a
   revision that still exports the trigger, then release the updated app.
   Verify tag additions from each path, simultaneous edits on different events,
   and suggestions outside the selected date range.
3. Run `npm --prefix functions run backfill-event-tag-catalog -- --limit-users 100`
   as a full dry run. Follow `nextStartAfter` until `complete: true` and require
   `missingEntries: 0` across every page. Confirm old app versions that edit
   tags without creating catalog entries are no longer supported or can no
   longer write event tags.
4. Obtain separate explicit approval to delete `projectEventTagCatalog` in the
   production project's `europe-west2` region. A broad Functions deployment
   from this revision may propose that deletion; do not accept it as an
   incidental part of another deployment.

If a dry run finds missing entries, obtain separate approval before rerunning
with `--execute`. If `complete` is false, repeat with `--start-after
<nextStartAfter>` until complete, then repeat the full dry run. The backfill is
idempotent and can resume from the last page's prior cursor. It can recover
tags still present on events, including legacy `benchmarkReviewTags`, but not
labels removed from every event before backfill. Do not run `--execute` as part
of ordinary local verification.
