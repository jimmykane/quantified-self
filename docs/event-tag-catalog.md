# Reusable event tag catalog

Event documents remain the source of truth for tag membership. The private
`users/{uid}/eventTagCatalog/{key}` collection stores distinct labels used for
filter choices and editor suggestions across date ranges. Each document has a
`name` field. Its ID is the SHA-256 hash of the normalized label in lowercase,
matching the shared event-tag case-insensitive identity. The first stored
spelling is retained. Removing a tag from an event, or deleting the event, does
not remove its catalog entry. Catalog removal is not available in this release.

This revision no longer exports `projectEventTagCatalog`. Removing its source
does not delete the deployed Function: it continues to receive every event
write until a separately approved cloud deletion. Direct catalog writes from
the app, MCP, Assistant, and server event writers must be deployed and verified
before that deletion. The catalog remains under `users/{uid}`, so recursive
account deletion covers it. Deleting the trigger does not delete saved tags.

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
