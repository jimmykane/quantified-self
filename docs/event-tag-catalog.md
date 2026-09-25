# Reusable event tag catalog

Event documents remain the source of truth for tag membership. The private
`users/{uid}/eventTagCatalog/{key}` collection stores distinct labels used for
filter choices and editor suggestions across date ranges. Each document has a
`name` field. Its ID is the SHA-256 hash of the normalized label in lowercase,
matching the shared event-tag case-insensitive identity. The first stored
spelling is retained. Removing a tag from an event, or deleting the event, does
not remove its catalog entry. Catalog removal is not available in this release.

Tag edits submit newly assigned names to
`users/{uid}/eventTagCatalogSubmissions/current` in the same transaction as the
event change. The app's single and bulk tag editors write this document under
owner-only, bounded Firestore rules; the MCP and Assistant mutation service
writes it server-side under its existing grant and approval checks. The common
server event writer also submits names when it creates or directly changes a
tagged event; untagged event writes add no submission.
`projectEventTagCatalogSubmission` listens only to that document and creates
missing catalog entries. Its writes are idempotent and check the account-deletion
guard inside each transaction. Owner clients may list or get the catalog; only
the server writes it. Both collections are under `users/{uid}`, so recursive
user deletion removes them. The app merges successful local edits into current
session suggestions while the projection catches up.

The existing `projectEventTagCatalog` event-write trigger remains deployed for
transition coverage. It receives every event create, update, or delete, even
when tags have not changed. Remove it only after the submission trigger, rules,
and tag-editing clients are live and verified, and after separately approving
the exact Function deletion. Future event writers must use the common writer or
submit new labels through the submission document.

## Backfill and rollout

The original event-write trigger is already deployed and the production
backfill was executed and verified. The catalog-reading UI and catalog rules
may still require release. For the lower-cost path:

1. Deploy the owner submission rules and `projectEventTagCatalogSubmission`.
2. Release clients that submit tag edits: the browser UI, MCP and Assistant
   Functions. Verify a tag added from each path appears in the catalog,
   including a tag outside the selected event date range.
3. Inspect logs and allow older browser clients to move off the previous tag
   editor. Re-run the dry-run backfill and require `missingEntries: 0` across
   all pages. Check that the submission trigger is processing new labels.
4. With separate approval naming `projectEventTagCatalog` in the production
   project, remove that Function in a later deployment. Do not run a broad
   `--only functions` deployment that implicitly deletes it.

The backfill can recover tags still present on events, including legacy
`benchmarkReviewTags`. It cannot recover labels removed from all events before
the backfill. Do not run `--execute` as part of ordinary local verification.
