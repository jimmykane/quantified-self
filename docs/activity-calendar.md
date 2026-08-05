# Activity Calendar

This document is the implementation and maintenance guide for the Activity Calendar. User-facing guidance lives in the in-app [Activity Calendar help article](../src/app/shared/help.content.ts), and public product content lives at `/features/activity-calendar`.

## Product surfaces

- The dashboard Activity Calendar tile shows the current month in a compact 1 x 1 tile and opens the full calendar. This is the creation default; persisted user-selected dimensions are not rewritten.
- New dashboards include the tile by default. An existing editable dashboard that does not contain it receives a one-time automatic addition with an Undo action.
- The authenticated `/calendar` route provides Week, Month, and Year views, period navigation, totals, activity-group bars, and day details.
- Selecting an active day opens an Angular Material bottom sheet with day totals, the shared activity-group duration bars and available distance/ascent/descent totals, plus recorded distance/ascent/descent for each individual activity, and links to individual events.
- The public `/features/activity-calendar` route explains the feature without reading or exposing user activity data.

## Query and state model

`src/app/helpers/activity-calendar.helper.ts` owns route-state parsing, navigation, query-window calculation, and view-model construction.

- Week spans seven local calendar days aligned to the user's configured start of week.
- Month uses a fixed 42-day grid so adjacent dates render consistently. Period totals include only dates in the selected month.
- Year queries January 1 through the following January 1 and renders all 12 months.
- The full route stores `view` and `date` in query parameters. Previous and next controls move by the selected view; Today changes the anchor to the current local date.
- The dashboard tile owns its current-month query. The full calendar owns its visible-period query. Neither reuses the dashboard event table, custom-chart range, or map-tile filters.

Dashboard migration state uses the shared automatic-tile framework:

- `DashboardAutoTileService` treats Activity Calendar as always eligible when the signed-in user opens their own editable dashboard. Public, shared, and other read-only dashboards do not run this migration.
- `settings.dashboardSettings.autoTiles.activityCalendar` records `added` or `dismissed` state. An existing tile or either state prevents duplicate automatic additions.
- Undo, direct tile deletion, replacing the tile in Dashboard manager, and **Remove all** persist `dismissed`. Adding Activity Calendar manually after dismissal persists `added`.
- Failed additions, Undo operations, and dashboard edits restore the previous tiles and automatic-tile metadata before reporting the error.

`src/app/services/activity-calendar.service.ts` reads lightweight event summary documents by `startDate`. It excludes merge and benchmark documents, maps only calendar-required fields into `EventInterface` values, and sorts results by start time. Exact user and query-window results are cached for five minutes with at most 12 entries; a cached value is emitted immediately while the live listener supplies current data.

## Day markers

Activities are grouped with the shared Sports Lib activity-type groups and app colors. Events containing more than one group are represented as Multisport.

- A marker color identifies an activity group.
- Marker size reflects the group's summed recorded duration for that day.
- Duration uses square-root scaling, capped at three hours, with a 24 percent minimum size so short activities remain visible.
- Standard markers range from 8 to 30 px. Compact concentric markers range from 4 to 18 px and preserve at least a 14 percent size difference between visible layers.
- At most three groups are drawn in a day cell; an overflow count represents additional groups.
- Week and Month layouts separate markers when space allows. Compact tiles, narrow layouts, and Year view use concentric markers.
- Date cells do not use Material tooltips. This preserves native touch scrolling; their accessible names contain the date, activity count, duration, and group summary.

## Period summaries

The top summary shows distance, duration, and ascent for the selected primary period. The Activities section groups the same period by activity group and compares each group's recorded duration with the longest-duration group.

- Duration is the bar metric. Positive recorded duration, distance, ascent, and descent values appear beneath the bar.
- The day-details sheet reuses these exact group rows for the selected local day; its bars compare only that day's activity groups.
- Missing values remain unavailable rather than being inferred. A group without recorded duration uses `--` and has no progressbar semantics.
- `AppEventUtilities.shouldExcludeAscent` and `shouldExcludeDescent` apply shared sport rules. Lift-served downhill types can contribute descent without contributing ascent.
- User `removeAscentForEventTypes` and `removeDescentForEventTypes` summary settings are applied in addition to the shared sport rules.
- Display values use the user's unit settings and the active locale.

## UI and accessibility

Use Angular Material controls for view selection, navigation, progress, retry, the explanatory info tooltip, and the day-details bottom sheet. Reuse app surface and glass-card tokens rather than introducing calendar-only colors or overlay containers.

Keep these interaction contracts:

- Previous and next controls have period-specific accessible labels.
- The period label announces navigation changes.
- Loading occupies a stable progress slot so cached and live emissions do not move the page.
- Active days are buttons; empty days are non-interactive cells.
- Activity bars expose progressbar semantics only when recorded duration exists.
- Start-of-week and weekend treatment must follow the user's settings and shared theme tokens.

## SEO and privacy

- `/features/activity-calendar` is a prerendered public page included in the sitemap and public startup-route allowlist.
- `/calendar` requires authentication, uses `noindex, follow`, is excluded from the sitemap, and is disallowed in `robots.txt`.
- Public page metadata and structured data describe the feature only. They must never include activity values, account identifiers, or examples derived from a user's calendar.

## Test map

- `src/app/helpers/activity-calendar.helper.spec.ts`: route state, date windows, grouping, marker sizing, period totals, and exclusions.
- `src/app/services/activity-calendar.service.spec.ts`: summary queries, filtering, mapping, sorting, and cache behavior.
- `src/app/helpers/dashboard-auto-tile.helper.spec.ts` and `src/app/services/dashboard-auto-tile.service.spec.ts`: Calendar identity, one-time dashboard migration, duplicate prevention, dismissal, Undo, and rollback behavior.
- `src/app/components/calendar/**.spec.ts`: page, grid, tile, day details, responsive behavior, and Material interaction contracts.
- `src/app/components/public-seo/public-seo-pages.content.spec.ts`: public page metadata, links, and structured data.
- `src/app/app.routing.module.spec.ts`, `src/app/app.routes.server.spec.ts`, and `src/app/shared/public-startup-route.spec.ts`: public and authenticated route contracts.
- `src/firebase-hosting.config.spec.ts`: sitemap, robots, and hosting behavior.

When changing calendar behavior, update the focused in-app help article and this document in the same change, then run the narrow helper, service, component, routing, and hosting specs affected by the edit.
