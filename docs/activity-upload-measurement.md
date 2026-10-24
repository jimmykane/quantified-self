# Manual activity upload measurement

## Event contract

`UploadActivitiesComponent.processAndUploadFile` records `activity_upload_completed` after
`AppFitUploadService.uploadActivityFile` resolves with a nonempty event ID and a positive integer
`activitiesCount`. The current upload endpoint returns that acknowledgement after writing the event,
original file, processing metadata, and manual-upload origin. The file must already have passed the
supported activity-format check.

The event carries only `file_type`, one of `fit`, `gpx`, `tcx`, `json`, or `sml`. Text compression does not
change that base format. No filename, event/activity ID, account ID, timestamps, workout metrics, error
message, or file contents are added to its parameters. The acknowledgement's ID and activity count are
validated locally and are not sent. Existing Analytics user identification is unchanged.

The account that started the upload must still be signed in when the acknowledgement arrives. A sign-out
or switch to another account suppresses the event. File-read errors, unsupported formats, rejected HTTP
requests, and incomplete acknowledgements do not produce it. It runs before the quota-count refresh:
a later refresh failure does not undo the server's successful persistence acknowledgement.

The event uses `AppAnalyticsService.logEvent`, including its optional Analytics provider and current
collection policy. When forced collection is off, lack of tracking consent prevents emission. Current
environment files enable `forceAnalyticsCollection`; this feature does not change that existing override
or introduce a separate collection path. Do not describe it as a change to the app's consent policy.

## Interpretation

| Event | What it observes | What it does not prove |
| --- | --- | --- |
| `upload_file` | An attempted manual activity upload | A readable file, successful request, or saved workout |
| `activity_upload_completed` | An acknowledged manual activity-file persistence operation | A new unique workout, a first-ever import, successful analysis, or a payment |
| `subscription_started` | A browser observation of an active or trialing subscription, with local deduplication | A successful nonzero invoice payment or the later trial-to-paid transition |

One file can contain multiple workout legs; it still produces one completion event. A successful re-upload
or later acknowledged retry can produce another event. This is intentionally not an exactly-once ledger.
Do not use raw event counts as distinct workouts, subscribers, or an upload success percentage: rejected
requests can sometimes have persisted data before the client sees an error, browser collection can be
unavailable, and the attempt and completion populations need not match.

This covers manual activity uploads only. Provider imports, history jobs, saved routes, and direct delivery
to another service are separate workflows. A first-observed manual upload can support a prospective
activation funnel for a defined new-user cohort, but requires sequenced identity-compatible observations
and an explicit observation window. An upload observed after release is not proof that the user never
uploaded before release. There is no historical backfill or new first-user flag.

Invoice-paid outcomes need separate read-only Stripe reconciliation, including the first qualifying
nonzero payment per subscription, later invoices, currencies, refunds, and disputes. Neither this event
nor a current active/trialing status is a paid-conversion result. This change does not add billing events,
join customer identifiers into Analytics, register key events/custom dimensions, or claim revenue lift.

## Verification and rollout

The component spec verifies acknowledgement timing, normalized format, malformed acknowledgements,
read/request failures, account changes, and persistence followed by a failed quota refresh. The Analytics
service spec checks the exact bounded payload and collection refusal. Existing upload service specs
cover authenticated HTTP requests and failure propagation. Run these specs, the frontend policy guard,
and the production build before release.

Help's **Uploads & Imports** section already documents supported activity formats and the distinct route
workflow. No upload control, result, quota, haptic feedback, persistence contract, provider integration,
queue, Training behavior, or MCP surface changes here, so it needs no new user-facing help instructions.
Operational import dashboards and alerts are unchanged; this browser event is not a replacement for
committed-import monitoring in `docs/activity-import-monitoring.md`.

Merge and deployment require their separate approvals. Record the actual production cutover time and
release; a prepared PR is not deployed instrumentation. From a verified release checkout, the manual
hosting sequence is `npm ci`, `npm run build-production`, then
`npx firebase deploy --only hosting:production`.

After an approved release, use an approved test account and a synthetic workout to check the outgoing
event's name and exact parameter set. A rejected file must not produce a completion. Keep production
hostname and stream filters in processed reports, wait for processing, and use a fresh observation
window. This event is not automatically a GA4 key event. Review current definitions before separately
authorizing any admin change. Keep raw exports and customer-level analysis outside the repository.
