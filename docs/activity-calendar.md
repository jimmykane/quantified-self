# Activity Calendar

This document is the implementation and maintenance guide for the Activity Calendar. User-facing guidance lives in the in-app [Activity Calendar help article](../src/app/shared/help.content.ts), and public product content lives at `/features/activity-calendar`.

## Product surfaces

- The dashboard Calendar tile lives in its own full-width section immediately after Today and before KPIs; Activity Overview contains activity charts. The section header links to `/calendar` rather than offering another add action. The tile shows the current month and keeps a selected-day preview beside the grid when wide or below it when the tile itself is narrow. Its own heading is suppressed because the section names it; the month controls stay with the grid. The selected-day preview scrolls within a fixed-height panel, so changing dates does not resize the tile; its Full day link stays visible. The preview shows at most two activities, notes, and planned workouts from each group, with remaining counts and a link to the complete day. Selecting today omits the health summary already shown in Today and avoids a redundant health read; other dates retain date-specific health. New tiles use four columns. Existing owner tiles receive a one-time versioned size migration; later manual resizes are honored and all other tile settings are preserved.
- New dashboards include the tile by default. Existing intentionally empty dashboards are preserved; the starter layout supplies Calendar only for new users. Removing the tile hides its section; the global Add to dashboard picker exposes Calendar as a single-purpose section so it can be restored without an empty placeholder or a duplicate Activity Overview entry.
- The authenticated `/calendar` route provides Week, Month, and Year views, period navigation, totals, activity-group bars, and an inline selected-day panel. The Today mini-calendar retains its day-details sheet.
- The authenticated `/calendar/day/:date` route opens the selected day on its own page. It reuses Health's sleep-stage chart for that date's latest overnight session when stage readings exist; the chart uses the same bounded sleep read as the day summary. A timeline combines date-only notes and plans with timed overnight sleep and completed activities. Factual highlights appear only when a visible note or an unlinked past workout warrants one; no baseline is inferred from a one-day read. The day's activity-group analysis remains below the timeline. **Full day** in the dashboard tile and **Open full day** in the Calendar panel or Today day sheet link there; browser Back restores the originating date and reopens the Today day sheet when that was the starting point, while the day page's **Calendar** action returns to that date in the month grid.
- Private [Timeline notes](timeline-notes.md) mark their dates in all three full-calendar views, including note-only days.
  The shared header manager and **Show on charts and calendar** preference apply; dashboard tiles/popovers stay unchanged.
- Every rendered date is selectable. The route and dashboard panel keep planned workouts separate from completed activity totals and rows, and link to a planned-workout editor or individual activity. The Today mini-calendar uses the same health context inside its existing sheet.
- Standalone workouts and workouts from the active plan appear on the full Calendar, dashboard tile, and Dashboard Today mini-calendar. Inactive-plan workouts remain in `/training/plans`; skipped workouts remain visible with a distinct marker.
- The public `/features/activity-calendar` route explains the feature without reading or exposing user activity data.

## Query and state model

`src/app/helpers/activity-calendar.helper.ts` owns route-state parsing, navigation, query-window calculation, and view-model construction.

- Week spans seven local calendar days aligned to the user's configured start of week.
- Month uses a fixed 42-day grid so adjacent dates render consistently. Period totals include only dates in the selected month.
- Year queries January 1 through the following January 1 and renders all 12 months.
- The full route stores `view` and `date` in query parameters. Selecting a date updates both the URL and inline day panel; Back/Forward restore it. On narrow screens, selecting a Year date opens its Month view to keep the day panel near the selection; Back returns to Year. Previous and next controls move by the selected view; Today changes the anchor to the current local date.
- The standalone day route stores its local date in the path. Previous and next controls move one local day, and Back/Forward restore the exact day. The selected date is the page heading; a compact action row returns to the same selected month or opens Timeline notes. At phone widths, date navigation stays visible while scrolling and shows a shortened visual date with the full date retained as the accessible name. Activity and Timeline-note reads are bounded to that date; the existing shared panel still performs its own selected-date health read. No month-wide health read is added.
- Selected-date sleep and HRV evidence render as soon as their bounded reads finish, while derived readiness or recovery can remain in a distinct loading state. A later derived snapshot updates those values without re-reading sleep or HRV or substituting another night's sleep-stage chart.
- The standalone timeline does not create additional reads. Date-based notes appear as **All day** and planned workouts without a time appear as **No time set**; both appear before timed entries. Sleep is placed at its recorded wake time and completed activities at their recorded start times. Sleep jumps to its stage breakdown without changing the route. The compact Calendar panel and Today sheet retain their previous presentation. The day-only workout menu keeps both plan and standalone creation, and activity links still prepare return navigation.
- The dashboard tile owns its current-month query. The full calendar owns its visible-period query, and the standalone day route queries only its local day. None reuses the dashboard event table, custom-chart range, or map-tile filters.

Dashboard automatic-tile and layout migration state:

- The current starter dashboard includes Calendar; no automatic addition runs for existing or intentionally empty layouts. Public, shared, and other read-only dashboards do not run the size migration.
- `settings.dashboardSettings.autoTiles.activityCalendar` continues to record `added` or `dismissed` for suggestions and Undo. The independent `calendarDayContextLayoutVersion` marks the one-time width migration.
- Undo, direct tile deletion, replacing the tile in Dashboard manager, and **Remove all** persist `dismissed`. Adding Activity Calendar manually after dismissal persists `added`.
- Add/Undo and dashboard edits keep their existing rollback behavior. A failed width migration restores its local draft; a later owner load can retry it.

`src/app/services/activity-calendar.service.ts` reads lightweight event summary documents by `startDate`. It excludes merge and benchmark documents, maps only calendar-required fields into `EventInterface` values, and sorts results by start time. Exact user and query-window results are cached for five minutes with at most 12 entries; a cached value is emitted immediately while the live listener supplies current data.

For accounts allowed by the shared Training Planning UI rollout, `TrainingPlansService.watchSchedule()` independently
reads the owner-visible current plan, workout, and state documents. Other accounts do not start this listener and see
no planning overlays, planning actions or planning-specific accessible announcements, including in an already-open day
sheet after an account change. Dates, completed activities and Timeline notes remain available. The detailed rollout
contract lives in [Training workspace](training-workspace.md); it is not backend authorization.
`planned-workout-calendar.helper.ts` projects only standalone workouts and workouts belonging to the active plan into a
local-date map. The activity and planning listeners stay separate so a plan read failure cannot turn recorded activity
data into an empty result, and a planned workout can never become an `EventInterface` or enter activity summaries.

## Day markers

Activities are grouped with the shared Sports Lib activity-type groups and app colors. Events containing more than one group are represented as Multisport.

- A marker color identifies an activity group.
- Marker size reflects the group's summed recorded duration for that day.
- Duration uses square-root scaling, capped at three hours, with a 24 percent minimum size so short activities remain visible.
- Standard markers range from 8 to 30 px. Compact concentric markers range from 4 to 18 px and preserve at least a 14 percent size difference between visible layers.
- At most three groups are drawn in a day cell; an overflow count represents additional groups.
- Week and Month layouts separate markers when space allows. Compact tiles, narrow layouts, and Year view use concentric markers.
- Planned and skipped-workout icons are independent from the duration-scaled activity markers. Their count does not change marker size or overflow.
- Planned icons use the associated plan's saved color (or theme primary for Default/legacy plans); standalone icons use
  the theme's neutral foreground. Day-details planned rows repeat the accent on their leading edge. Colors resolve from
  live plan records through `training-plan-appearance.helper.ts`, so recoloring a plan or moving a workout changes all
  calendar surfaces without rewriting workouts. Configure colors in **Plans -> Plan actions -> Plan color** or when
  creating a plan. Only named palette values are stored; activity circles, Timeline note colors, and weekend shading
  are unchanged. Week/Month show up to two planned icons and an overflow count; when standalone and active-plan workouts
  share a day, one marker represents each scope. Compact/Year use slim right-edge color segments instead, below any note
  icon and opposite the note-color edge; skipped markers are dashed. Visual overflow counts are omitted in these small
  cells to avoid covering activities, but complete counts remain in accessible date names and day details.
- Date cells do not use Material tooltips. This preserves native touch scrolling; their accessible names contain the date, activity, planned-workout, and visible note counts, duration, and group summary.
- Note days add a category icon (or grouped `event_note` indicator), an accessible note count, and a slim colored edge,
  separate from activity circles. The edge retains a segment for each distinct note color when notes overlap, with
  the shared neutral gray used by chart note markers for Default. It does not change cell sizing or activity marker colors. The selected-day panel and Today sheet list
  note titles, categories, and actual dates above activities; selecting a note opens the shared editor. Inclusive periods,
  future bounded dates, and ongoing periods through today in their captured zone are supported without changing totals.
  Window focus and returning to a visible tab refresh the current-day clock, including ongoing note cutoffs after midnight.
  Calendar owns the bounded notes load for its visible labels (including adjacent Month dates); the grid never fetches.
  The inline panel and Today sheet receive owner-fenced reactive notes, and stale selections cannot open another account's note.
  A notes failure leaves activity rendering intact, and an activities failure still permits viewing notes.
  Note days can be selected before activity loading finishes: the panel shows loading/error status instead of falsely reporting
  no workouts, and its activities update when the selected day's data arrives.

## Period summaries

The top summary shows distance, duration, and ascent for the selected primary period. The Activities section groups the same period by activity group and compares each group's recorded duration with the longest-duration group.

- Duration is the bar metric. Positive recorded duration, distance, ascent, and descent values appear beneath the bar.
- The inline selected-day panel and Today day-details sheet reuse these exact group rows for the selected local day; their bars compare only that day's activity groups.
- Planned workouts never contribute to distance, duration, ascent, descent, activity counts, group bars, or the activity table. Day details render them in a separate **Planned workouts** section.
- Missing values remain unavailable rather than being inferred. A group without recorded duration uses `--` and has no progressbar semantics.
- `AppEventUtilities.shouldExcludeAscent` and `shouldExcludeDescent` apply shared sport rules. Lift-served downhill types can contribute descent without contributing ascent; Diving, Scuba Diving, Free Diving, Snorkeling, and Mermaiding contribute neither elevation metric because their vertical movement is depth.
- User `removeAscentForEventTypes` and `removeDescentForEventTypes` summary settings are applied in addition to the shared sport rules.
- Display values use the user's unit settings and the active locale.

## UI and accessibility

Use Angular Material controls for view selection, navigation, progress, retry, the explanatory info tooltip, and the Today day-details bottom sheet. Reuse app surface and glass-card tokens rather than introducing calendar-only colors or overlay containers.

Keep these interaction contracts:

- Previous and next controls have period-specific accessible labels.
- The period label announces navigation changes.
- Loading occupies a stable progress slot so cached and live emissions do not move the page.
- Every rendered date is a button, including dates with neither a planned workout nor a completed activity. Empty dates still show the selected-day panel and workout creation choices where planning access is available.
- In a stacked layout, explicit day selection reveals the start of the inline panel while keeping the selected date visible. Restoring a date from navigation does not move the user's scroll position.
- Activity bars expose progressbar semantics only when recorded duration exists.
- Start-of-week and weekend treatment must follow the user's settings and shared theme tokens.

## SEO and privacy

- `/features/activity-calendar` is a prerendered public page included in the sitemap and public startup-route allowlist.
- `/calendar`, `/calendar/day/:date`, and `/training/plans` require authentication, are client-rendered, and are excluded from the sitemap. They use `noindex, follow` route metadata and hosting `noindex` headers; `robots.txt` permits crawling so those directives can be read. Neither workspace is a public product page.
- Public page metadata and structured data describe the feature only. They must never include activity values, account identifiers, or examples derived from a user's calendar.

## Test map

- `src/app/helpers/activity-calendar.helper.spec.ts`: route state, date windows, grouping, marker sizing, period totals, and exclusions.
- `src/app/services/activity-calendar.service.spec.ts`: summary queries, filtering, mapping, sorting, and cache behavior.
- `src/app/helpers/dashboard-auto-tile.helper.spec.ts` and `src/app/services/dashboard-auto-tile.service.spec.ts`: Calendar identity, one-time dashboard migration, duplicate prevention, dismissal, Undo, and rollback behavior.
- `src/app/components/calendar/**.spec.ts`: page, grid, tile, day details, responsive behavior, and Material interaction contracts.
- `src/app/helpers/calendar-day-health.helper.spec.ts` and `src/app/services/calendar-day-health.service.spec.ts`: exact-date evidence, source labels, partial failures, owner fences, and bounded selected-day reads.
- `src/app/helpers/dashboard-calendar-layout.helper.spec.ts` and `src/app/components/summaries/summaries.component.spec.ts`: one-time full-width migration and later user resizing.
- `src/app/helpers/planned-workout-calendar.helper.spec.ts` and `src/app/services/training-plans.service.spec.ts`: active-plan/standalone overlay selection, inactive-plan exclusion, skipped visibility, and owner-current schedule reads.
- `src/app/components/public-seo/public-seo-pages.content.spec.ts`: public page metadata, links, and structured data.
- `src/app/app.routing.module.spec.ts`, `src/app/app.routes.server.spec.ts`, and `src/app/shared/public-startup-route.spec.ts`: public and authenticated route contracts.
- `src/firebase-hosting.config.spec.ts`: sitemap, robots, and hosting behavior.

When changing calendar behavior, update the focused in-app help article and this document in the same change, then run the narrow helper, service, component, routing, and hosting specs affected by the edit.

## Selected-day health

`CalendarDayHealthService` reads only the selected date using the bounded Health/Sleep readers and watches the existing derived-metric snapshots. The shared `CalendarDayContextComponent` renders that evidence in the dashboard tile, full Calendar, and Today sheet. Sleep and HRV require an exact local date match and name their source; a last-known reading is never substituted. Sleep shows its score when available, otherwise its recorded duration. The one-day HRV read includes sample-only measurements; if that read fails, an available Sleep HRV reading remains visible with a partial-source warning. Past readiness requires an exact stored daily score, while today uses the same live readiness inputs as the Today card. Recovery-left is present only for today. Sources distinguish empty and failed reads, while derived readiness and recovery identify an update in progress and refresh in place when their snapshot changes. Derived updates reuse the completed Sleep/HRV reads. Owner checks prevent private reads from shared dashboards; abort and subscription cleanup prevent stale results replacing a newer selection. No month-wide health query or new calculation is performed.

`dashboard-calendar-layout.helper.ts` expands existing Calendar tiles once, using `calendarDayContextLayoutVersion` in owner dashboard settings. The dashboard board lets only the Calendar row grow with day content. User resizing after the version is stored is left untouched.
