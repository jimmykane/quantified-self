# Timeline notes

Timeline notes are private, user-created calendar context, independent of Health metrics, Sleep sessions, and workouts.
Every authenticated account can use the compact **Timeline notes** header action in Health, Training, and Calendar, without a
subscription or connected provider. Existing workspace entry-point rollout and provider import checks are unchanged.

## Contract and lifecycle

`shared/timeline-notes.ts` owns the contract. `users/{uid}/timelineNotes/{noteId}` contains category (sickness, injury,
vacation, travel, stress, other), a title of at most 120 characters, optional plain-text details of at most 2,000
characters, ISO calendar `startDate`, nullable inclusive `endDate`, captured IANA `timeZone`, revision, and
server-generated `createdAtMs`/`updatedAtMs`. Equal dates mean one day; null end means ongoing. Past and planned bounded
dates are allowed; ongoing periods must already have started. Editing preserves the captured zone and calendar labels.
“End today” uses that zone. Ongoing overlays stop today and never extend into a forecast.
Optional `showOnCharts` controls each note's chart and Calendar visibility; missing means true for existing notes.
New editor saves include the boolean. The existing save transaction validates it and includes it in revision/retry
comparisons; older-client updates that omit it preserve the stored choice. Omitted and explicit true are equivalent for
legacy create retries. No migration, new endpoint, index, or Security Rules change is needed.
Optional `color` is an allowlisted presentation key (`default`, `blue`, `purple`, `pink`, `orange`, `red`, `green`),
not arbitrary CSS. Missing and `default` use the shared neutral gray (`AppColors.DarkGray`) in charts, Calendar, and the
note editor/list. Mixed-color group markers use that same neutral; labels retain theme-aware text contrast. The same save transaction checks color in retries,
preserves it when older clients omit it, and accepts explicit `default` to reset it. No category/icon is inferred from color.

`saveTimelineNote` and `deleteTimelineNote` require Authentication, App Check, and an originating UID matching the
authenticated account. They use the shared transactional account-deletion guard, explicit input allowlists and strict
validation. Creates hash an owner-scoped browser-safe UUID; identical retries are idempotent. Changed create retries
and stale revisions conflict rather than overwrite. Identical update retries are accepted only at the immediately
following revision. Deletion writes a content-free `{deleted: true}` receipt at
`users/{uid}/timelineNoteDeletions/{noteId}`; receipts have no TTL so delayed creates cannot resurrect deleted notes.

Browser reads are owner-only and bounded to 65 documents (64 plus lookahead). Browser writes, note descendants and
receipt reads/writes are denied. Notes are permanent leaves. The existing Delete User Data extension's recursive
`users/{UID}` cleanup removes notes and receipts. Provider disconnection retains them. No note text enters logs,
analytics events, public projections, or provider syncing. Details use Angular text interpolation;
chart tooltips HTML-escape titles. This version does not change a measurement or Training/readiness calculation.

## Explicit read-only AI access

The existing MCP endpoint exposes full titles/details, category, fixed dates and captured timezone through
`query_timeline_notes` only with the independent `timeline-notes:read` grant. The external consent checkbox is selected
by default when requested; the owner can uncheck it before approving. Existing connections must reauthorize.
Chart-hidden notes are included; color/visibility, IDs, revisions, audit timestamps and
deletion receipts are not returned. External clients receive full private text and may retain received copies after
revocation. The [MCP guide](mcp-server.md#timeline-notes) defines overlap, frozen ongoing cutoffs, ordering, bounds and
encrypted continuation. No additional notes storage, index, migration or Cloud Function is needed.

The built-in [Assistant](assistant.md#optional-timeline-notes-context) uses the same tool through a separate default-off,
server-owned per-chat choice. Changing it starts a fresh chat and preserves the independent location choice; New chat
turns both off. Relevant answers may quote notes under the existing conversation retention policy. Text is context,
not instructions, a verified diagnosis, causal proof or authorization for writes. Notes do not alter calculations or
add Assistant chart overlays. Provider disconnect retains them and account cleanup still removes notes and receipts.

## Loading and UI

`AppTimelineNotesService` scopes requests/cache to the active account. Closed periods query `endDate >= windowStart`
and `startDate <= windowEnd`; ongoing notes query `endDate == null` and the same upper start bound. The collection index
is `endDate ASC, startDate ASC, __name__ ASC`. Title and details have no automatic indexes. Each workspace load accepts
at most 512 records / 2 MiB, across 64-record pages; it reports explicit incomplete results. The manager separately
pages all notes, including future notes, newest start date first. No query parameters or navigation destination exist.

`TimelineNotesWorkspaceComponent` coalesces chart range registrations into a union and supplies explicit chart inputs.
Health Highlights register their own fixed trend windows alongside the metric explorer's selected window, so navigating
the explorer into older history does not drop recent Highlight notes. All use the same bounded, account-scoped load.
The service deduplicates overlapping covered requests, fences stale account/range results, and invalidates on mutations
and returning to the workspace. Notes failing to load never block metric rendering. Provider/sport filters do not filter
notes. The global preference is `settings.appSettings.timelineNotes.showOnCharts`, default true. The Material manager
supports create/edit, confirmed delete, End today, retries and explicit conflict reload while preserving unsaved drafts.
Failed history-page requests retry that same page; failed visibility saves restore the persisted checkbox state.
The global toggle remains the master switch. A note appears only when it and the global setting are enabled; switching
the global toggle off/on never rewrites individual choices. The editor's **Show this note on charts and calendar**
checkbox is a draft saved with **Save**, not an immediate write. Failed saves retain it and conflict reload restores the
latest stored choice. The manager lists hidden notes with a **Hidden** label, even while global visibility is off.
Category options and note lists use Material category icons. The editor's named color selector uses the existing app
palette, with text labels so color is never the only identifier. Both are draft changes until Save. Material datepicker
inputs reuse the app's Dayjs adapter and localized formats; the note-scoped adapter strictly rejects invalid typed dates
instead of silently rolling them forward. Date-only values use a UTC calendar carrier so even a date skipped by the
browser's zone remains editable; persistence still uses fixed date labels, not converted timestamps. The calendar's
today indicator, ongoing-date limit, and End today all follow the note's captured zone. End dates are inclusive and
cannot precede the start; ongoing starts cannot be in the future. An unfinished range end is retained as draft input
but disabled outside range mode so its validation cannot block saving a single-day or ongoing note.
Range paging still loads/counts hidden records within the existing caps; filtering happens before workspace projection,
with the chart/Calendar helpers also excluding hidden notes from groups, tooltips, counts, and day details. A queued
marker selection is checked against current visibility before opening. Hidden is a display choice, not deletion or a
new access-control boundary; all notes remain private owner-readable records.

## Chart boundary

`TimelineNotesChartBinding` and `addTimelineNotesToChart` append empty ECharts marker series with markLine/markArea;
they do not alter measurement series, axis bounds, legends, metric tooltips, gaps, reference bands or forecasts.
Markers and period bands use the selected color; text retains its theme contrast. Mixed-color overlaps group into neutral
markers instead of blending colors; same-color groups keep that color. Each note retains its category and actual dates
in the escaped tooltip and manager. Date ranges have inward-facing native ECharts arrows at the start and inclusive end,
joined by the existing subtle period band, with the title shown only at the start. Both boundaries open the same note/group.
Period fills are non-interactive (`markArea.silent`) with tooltips and emphasis disabled, so hovering/tapping anywhere
inside the band retains the chart's metric tooltip. Note tooltips and selection live on the title and boundary markers;
the binding ignores area clicks. Keep this boundary covered by real-renderer pointer tests, not only option assertions.
Ongoing periods use an open end marker at today in the note's zone; boundaries clipped by the visible window also use open
markers, avoiding a false start/end. Single-day notes and periods collapsed into one weekly bucket retain one dot marker.
Single markers display the note title as plain, single-line text, with native ECharts
ellipsis for long titles (100px in compact charts, 160px otherwise). Compact charts stagger adjacent labels onto two rows
without adding chart padding. A formatter callback prevents title text from being
interpreted as ECharts template placeholders. The full title remains in the escaped tooltip and editor. Grouped markers
keep their note count instead of labeling several notes as one. Single markers open the editor; grouped markers open the matching list. The header
manager provides the keyboard-accessible alternative to click/tap, without requiring hover.
Distinct dates projected onto the same weekly bucket or clipped endpoint share one selectable marker, preserving access
to every note and its actual dates. Grouping single-day notes does not create a period band between them.
Note tooltips reuse the shared ECharts tooltip card and chrome with the active chart theme and responsive typography.
Titles wrap above their actual dates, grouped notes remain separate, and the chart's existing tooltip positioning is retained.

Opt-in surfaces: Health Highlights and detailed metrics (recorded timezone), normalized Sleep (sleepDate), Training readiness,
load/Form, freshness forecast (existing viewer-calendar convention), body weight, power-system history, weekly swimming
and weekly durability. Weekly overlays identify overlapping buckets but retain actual note dates in tooltips. All shared
inputs default null. Dashboard, workout details, public previews and non-calendar charts are unchanged.
The authenticated full Calendar integration is described below.

## Calendar boundary

The full `/calendar` page registers its visible date labels through the workspace component's `visibleRange` input.
Month includes adjacent grid dates; Year excludes hidden outside-month cells. It reuses the same owner-scoped loader,
limits, stale-response fences, refreshes, and `showOnCharts` preference (labelled **Show on charts and calendar**).
`calendar-timeline-notes.helper.ts` maps inclusive note periods onto those fixed dates, resolving ongoing end dates once
per note in its captured zone. No activity or metric document, totals, or duration-circle semantics change.
Calendar refreshes its current-day clock on window focus and tab visibility, so returning after midnight updates ongoing
note cutoffs alongside the notes reload without extending them into future dates.

A category icon in the selected color marks a single-note day, even without activities. Multiple notes share an
`event_note` indicator (neutral for mixed colors) and accessible count. The day sheet shows each note's own icon/color.
A slim leading edge makes note days visible in Week, Month, and Year. It contains a separate segment for each distinct
note color, preserving mixed-color overlaps without blending them or replacing activity-circle colors. The default
color is the shared neutral gray used by chart note markers, not theme-primary blue. The edge is decorative and never intercepts day selection,
changes cell sizing, or reveals note titles in the grid; hidden notes contribute no segment.
Selecting a day opens its
existing Material sheet, with a plain-text notes list above activities. Selecting a note dismisses the sheet and opens
the shared note editor. Sheet notes stay reactive to loading/edits, visibility, and account changes; delayed selections
are checked against the current owner and notes before opening. Note and activity failures remain independent.
The shared grid's notes input defaults empty; dashboard tiles/popovers and public calendars remain unannotated.

## Verification and release

Run the Timeline notes Functions, service, dialog, workspace, chart-helper/adapter and index tests, the affected chart
and workspace suites, full frontend/Functions suites, `npm run test:rules`, Functions build, and production Angular build.
Use only emulator-backed fixture accounts for browser mutations; verify desktop/mobile, keyboard navigation, themes,
range navigation, visibility, marker taps and create/edit/delete/End today. Deploying rules/indexes and the two callables
requires separate approval. No migration, backfill or scheduler is required.
For per-note visibility and color, release the updated existing `saveTimelineNote` callable before the frontend; the old
callable rejects the new fields. `deleteTimelineNote`, Rules, and indexes do not need a deployment for these additions.
Already-open older frontends need a refresh to display the choices, but their edits preserve them on the server.
