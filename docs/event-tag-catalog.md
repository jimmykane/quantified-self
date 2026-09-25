# Reusable event tag catalog

Event documents remain the source of truth for tag membership. The private
`users/{uid}/eventTagCatalog/{key}` collection stores distinct labels used for
filter choices and editor suggestions across date ranges. Each document has a
`name` field. Its ID is the SHA-256 hash of the normalized label in lowercase,
matching the shared event-tag case-insensitive identity. The first stored
spelling is retained. Removing a tag from an event, or deleting the event, does
not remove its catalog entry. Catalog removal is not available in this release.

`projectEventTagCatalog` watches event writes and adds newly assigned canonical
or legacy tags. Its writes are idempotent and check the account-deletion guard
inside each transaction. Owner clients may list or get the catalog; only the
server writes it. The catalog is under `users/{uid}`, so recursive user deletion
removes it. The app reads the catalog directly and merges successful local edits
into the current session while the projection catches up.

## Backfill and rollout

Production deployment and backfill execution require explicit approval. Prepare
and verify the code locally, then roll out in this order:

1. Deploy the catalog rules and `projectEventTagCatalog` trigger. Keep the old UI
   active while the trigger begins capturing new tag assignments.
2. Run `npm --prefix functions run backfill-event-tag-catalog -- --limit-users 100`
   as a dry run. It reads only the two tag fields on event documents containing
   at least one of those fields.
   Review `missingEntries`, `skippedUserDeletion`, and `nextStartAfter`.
3. After approving the data write, rerun with `--execute`. If `complete` is false,
   repeat with `--start-after <nextStartAfter>` until complete. The operation is
   idempotent; after interruption, rerun the last page from its prior cursor.
4. Run a full dry run again. Require `missingEntries: 0` and `complete: true`
   across every page before releasing the catalog-reading UI. Spot-check a
   legacy-tag account and an account with tags outside the current dashboard
   range.
5. Release the catalog-reading UI.

The backfill can recover tags still present on events, including legacy
`benchmarkReviewTags`. It cannot recover labels removed from all events before
the backfill. Do not run `--execute` as part of ordinary local verification.
