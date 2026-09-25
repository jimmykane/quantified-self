# Reusable event tag catalog

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

`projectEventTagCatalog` remains deployed during the transition. It receives
every event write, including writes unrelated to tags. Retire it only after all
tag-editing clients and server writers create catalog entries directly and the
catalog has been verified.

## Backfill and rollout

The original event-write trigger is already deployed and the production
backfill has been run and verified. Production deployment still requires
separate approval. Roll out the lower-cost path in this order:

1. Deploy the owner-create catalog Rules. Keep the event-write trigger running.
2. Deploy the updated MCP, Assistant, and server event writers, then release the
   updated app. Verify tags added from each path and simultaneous edits on
   different events. Confirm saved tags appear outside the selected date range.
3. Run `npm --prefix functions run backfill-event-tag-catalog -- --limit-users 100`
   as a full dry run, following `nextStartAfter` until `complete: true` and
   requiring `missingEntries: 0` across every page. Allow older app clients to
   finish moving to the new tag editor.
4. With separate approval naming `projectEventTagCatalog` in the production
   project, remove that Function in a later deployment. Do not run a broad
   Functions deployment that implicitly deletes it.

The backfill can recover tags still present on events, including legacy
`benchmarkReviewTags`. It cannot recover labels removed from all events before
the backfill. Do not run `--execute` as part of ordinary local verification.
