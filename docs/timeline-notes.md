# Timeline notes

Timeline notes are private, user-created calendar context, independent of Health metrics, Sleep sessions, and workouts.
Every authenticated account can use the compact **Timeline notes** header action in Health and Training, without a
subscription or connected provider. Existing workspace entry-point rollout and provider import checks are unchanged.

## Contract and lifecycle

`shared/timeline-notes.ts` owns the contract. `users/{uid}/timelineNotes/{noteId}` contains category (sickness, injury,
vacation, travel, stress, other), a title of at most 120 characters, optional plain-text details of at most 2,000
characters, ISO calendar `startDate`, nullable inclusive `endDate`, captured IANA `timeZone`, revision, and
server-generated `createdAtMs`/`updatedAtMs`. Equal dates mean one day; null end means ongoing. Past and planned bounded
dates are allowed; ongoing periods must already have started. Editing preserves the captured zone and calendar labels.
“End today” uses that zone. Ongoing overlays stop today and never extend into a forecast.

`saveTimelineNote` and `deleteTimelineNote` require Authentication, App Check, and an originating UID matching the
authenticated account. They use the shared transactional account-deletion guard, explicit input allowlists and strict
validation. Creates hash an owner-scoped browser-safe UUID; identical retries are idempotent. Changed create retries
and stale revisions conflict rather than overwrite. Identical update retries are accepted only at the immediately
following revision. Deletion writes a content-free `{deleted: true}` receipt at
`users/{uid}/timelineNoteDeletions/{noteId}`; receipts have no TTL so delayed creates cannot resurrect deleted notes.

Browser reads are owner-only and bounded to 65 documents (64 plus lookahead). Browser writes, note descendants and
receipt reads/writes are denied. Notes are permanent leaves. The existing Delete User Data extension's recursive
`users/{UID}` cleanup removes notes and receipts. Provider disconnection retains them. No note text enters logs,
analytics events, public projections, provider syncing, MCP, or the Assistant. Details use Angular text interpolation;
chart tooltips HTML-escape titles. This version does not change a measurement or Training/readiness calculation.

## Loading and UI

`AppTimelineNotesService` scopes requests/cache to the active account. Closed periods query `endDate >= windowStart`
and `startDate <= windowEnd`; ongoing notes query `endDate == null` and the same upper start bound. The collection index
is `endDate ASC, startDate ASC, __name__ ASC`. Title and details have no automatic indexes. Each workspace load accepts
at most 512 records / 2 MiB, across 64-record pages; it reports explicit incomplete results. The manager separately
pages all notes, including future notes, newest start date first. No query parameters or navigation destination exist.

`TimelineNotesWorkspaceComponent` coalesces chart range registrations into a union and supplies explicit chart inputs.
The service deduplicates overlapping covered requests, fences stale account/range results, and invalidates on mutations
and returning to the workspace. Notes failing to load never block metric rendering. Provider/sport filters do not filter
notes. The global preference is `settings.appSettings.timelineNotes.showOnCharts`, default true. The Material manager
supports create/edit, confirmed delete, End today, retries and explicit conflict reload while preserving unsaved drafts.

## Chart boundary

`TimelineNotesChartBinding` and `addTimelineNotesToChart` append empty ECharts marker series with markLine/markArea;
they do not alter measurement series, axis bounds, legends, metric tooltips, gaps, reference bands or forecasts.
Overlaps group into neutral markers instead of blending category colors; each note retains its category and actual dates
in the escaped tooltip and manager. Single markers open the editor; grouped markers open the matching list. The header
manager provides the keyboard-accessible alternative to click/tap, without requiring hover.

Opt-in surfaces: Health detailed metrics (recorded timezone), normalized Sleep (sleepDate), Training readiness,
load/Form, freshness forecast (existing viewer-calendar convention), body weight, power-system history, weekly swimming
and weekly durability. Weekly overlays identify overlapping buckets but retain actual note dates in tooltips. All shared
inputs default null. Dashboard, priority mini-charts, workout details, calendar entries, public previews and non-calendar
charts are unchanged.

## Verification and release

Run the Timeline notes Functions, service, dialog, workspace, chart-helper/adapter and index tests, the affected chart
and workspace suites, full frontend/Functions suites, `npm run test:rules`, Functions build, and production Angular build.
Use only emulator-backed fixture accounts for browser mutations; verify desktop/mobile, keyboard navigation, themes,
range navigation, visibility, marker taps and create/edit/delete/End today. Deploying rules/indexes and the two callables
requires separate approval. No migration, backfill or scheduler is required.
