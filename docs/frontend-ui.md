# Frontend UI Composition

## Route headers

Authenticated product routes use the shared `app-page-header` primitive from
`src/app/components/shared/page-header/`. It owns the common route-heading hierarchy, Material theme typography, and
responsive action placement. Import the standalone component directly from a standalone route, or use its export from
`SharedModule` in an NgModule-owned route.

Use the `route` variant for a primary workspace heading and the `compact` variant for embedded workspace context such
as Dashboard Today. Both variants use the same visible Material `headline-small` title role and a 40 px title row;
`headingLevel` controls document semantics rather than visual size. This keeps Dashboard Today, Calendar, Training,
Routes, and signed-in Compare files aligned without promoting an embedded section to an `h1`. The component
provides:

- `title`, `titleId`, and `headingLevel` for the page or section heading.
- `eyebrow` and `subtitle` for concise context and data currency.
- `status` for a consistent pending or warning title state.
- `leadingIcon` for a static, theme-colored Material icon in the shared 26 px leading slot.
- `pageHeaderLeading` for an existing icon action. Set `leadingAction` to preserve its Material touch target while
  keeping the title visually compact. Do not combine `leadingIcon` and `pageHeaderLeading` on the same header.
- `pageHeaderContext` for projected, domain-specific status content that replaces the eyebrow without adding a banner.
- `pageHeaderTitleActions` for a compact workspace-wide control that must stay beside the title at every breakpoint,
  such as Health Sources. Keep this slot small; normal route actions belong in `pageHeaderActions`.
- `pageHeaderActions` for existing Material controls. Route actions move to a dedicated full-width row below 800 px;
  compact headers retain their inline action layout.

The Dashboard, Calendar, Training, Routes, signed-in Compare files, and Settings workspaces use this component. A
page should not add route-local heading font sizes, action-row breakpoints, or a second title treatment. Keep page CSS
limited to the surrounding layout and domain-specific action groups.

Guest and public marketing views may retain a distinct hero composition. Their heading styles must remain local to that
public surface and must not become a new authenticated workspace-header pattern.

Dashboard loading messages use a reserved single-line status/greeting row below the header. **Today**, its date,
and its calendar action remain mounted through preparation, refresh, failure, and completion. A small Material spinner
shows pending work; failures keep the accessible Retry action. The status row keeps its height when it clears, including
when Today or the owner greeting is hidden. Do not replace the page title with changing loading messages.

## Workspace Shells

Authenticated product workspaces, except Settings, use the shared `qs-workspace-page` shell from `src/styles.scss`. It
owns the 1440 px maximum page width, border-box sizing, and common responsive inline gutters. Apply it on the route root
alongside the route-specific class; do not add another outer width, margin, or padding rule in the component stylesheet.
Settings intentionally retains its centered 760 px form column, including its aligned fixed save action, rather than
stretching a form workflow across the workspace width.

## Sidebar navigation

Training remains a direct link to `/training`. Plans links to `/training/plans` as an indented subitem immediately below
it in a labelled Training group, without an expansion control. Only the Plans entry uses the Training Planning navigation
UID allowlist; other signed-in users retain the direct Training link. Calendar entry points and owner-scoped planning
access remain available. Training matches only its exact path (ignoring query parameters and fragments), so Plans has an
independent active state. Both links keep their existing close/haptic action.

## Material and accessibility

Use Angular Material controls for header actions: `mat-icon-button` for icon-only navigation, `mat-button` for secondary
route actions, `mat-stroked-button` for bounded retry or configuration actions, and `mat-button-toggle-group` for view
modes. The primitive uses Material system color and typography tokens; consumers should not override its internal
elements.

Give each primary route title a stable `titleId` and reference it from the route `main` or workspace region with
`aria-labelledby`. Keep a title status concise and expose failures with the supplied warning status or an equivalent
projected `role="alert"` state.

## Shared scrollbars

`src/styles/_scrollbars.scss`, included once by `src/styles.scss`, owns the app's thin, rounded QS scrollbar skin.
It applies globally with zero-specificity defaults, including document scrolling, Material dialog content/surfaces,
bottom sheets, menus, selects, autocomplete, nested lists/history, tables, textareas and custom scrollable panels.
CDK overlays live outside app-root and are covered without a per-dialog class. The existing `qs-scrollbar` class
remains supported, but forgetting it must not restore a stock scrollbar. Do not add per-component skins.

Standard scrollbar properties and the existing WebKit fallback share Material on-surface colors, transparent tracks,
and the existing light/dark opacities. The document scrollbar also follows the body's theme (the
[viewport uses the root element's scrollbar color](https://www.w3.org/TR/css-scrollbars-1/#scrollbar-color), not body's);
forced-colors mode keeps system colors. The browser still owns scrolling and platform-specific thumb behavior.

The skin does not set overflow, heights, axes, gutters, overscroll behavior or touch handlers. Each component owns its
scroll layout: constrain the intended content region, keep dialog/sheet headers and actions reachable, and avoid
accidental nested scrollbars. Existing intentionally hidden sidebar/tab-rail scrollbars remain hidden via their more
specific rules. Do not hide a needed scrollbar or clip content to mask a layout bug.

For changes, run `src/styles/scrollbars.spec.ts` and the affected component suites, then a production build. Browser
QA must include genuinely overflowing content in dialogs, sheets and nested panels, horizontal tables, long textareas,
and light/dark desktop/320px views. Check computed styles, wheel/keyboard scrollability, no-overflow states and the
existing hidden navigation exceptions; JSDOM alone cannot prove painted scrollbar size or platform touch behavior.

## Account profile recovery

Firebase Auth identity and account-profile availability are separate states. Authenticated profile reads wait for
server snapshots; permission or App Check failures refresh both credentials with the existing bounded retry/backoff.
The recovery panel on `/login` explains that the user is still signed in. Its Retry action restarts the profile stream
and refreshes credentials without signing out, clearing persistence, or writing account data. Actual Auth sign-out or
an account switch cancels the old profile load and ends its recovery attempt.

The full Firestore SDK can return an incorrect persisted `NoDocument` result even through `getDocFromServer()`.
Before publishing a profile with missing required agreements or onboarding history (including a wholly missing profile),
`UserProfileVerificationService` checks the four profile documents through a lazily loaded Firestore Lite client.
The completeness check covers the onboarding guard's required policies plus completed onboarding, subscription
history, or existing paid/admin/grace-period access. This also protects free accounts when only the root document
appears missing and the legal document still exists. Server-confirmed unfinished setup continues to onboarding.
That client uses the same Firebase app's Auth and App Check providers, but does not use the watch/persistence cache.
Both readers share the same profile merge function. Failures remain recovery states; only verified missing data may
produce a new onboarding profile. Generation checks prevent an older asynchronous claim merge from reopening the
profile gate or continuing token retries during verification or a profile retry.

Complete profile snapshots add no Firestore reads. Incomplete snapshots require at most four additional document
reads per verification attempt; concurrent checks for the same snapshot and Auth session share one bounded request,
and identical listener snapshots do not repeat verification. Changed snapshots, a complete listener result, or a
restarted profile load invalidate the old shared result. Transient failures use the existing bounded retry budget.
The fallback does not clear or repair the broader SDK cache. An already completed account that recovers while on `/onboarding` leaves that route
without rewriting its completion flag or repeating completion analytics. The recovery behaviour applies to local,
beta, and production builds; only the App Check debug provider is development-specific.

## Surface elevation

### Shared compact rows

`CompactRowComponent` (`app-compact-row`) in `src/app/components/shared/compact-row/` is the flat content-row
primitive shared by Home, public feature pages, benchmark previews, Health, and Training Plans. It replaces the feature-specific
`CompactFeatureRowComponent` name; existing callers use the same component rather than a compatibility wrapper.

The default `layout="columns"` and `density="comfortable"` preserve the public feature presentation: optional icon,
heading, content, and action. `layout="stacked"` keeps an optional action beside the heading and gives content the
full row width at every breakpoint. `density="compact"` uses smaller icon/header spacing and Material text roles;
Health uses this combination for Highlights and source-separated charts. The primitive adds no card background,
rounded container, shadow, or nested content padding. `showDivider` controls the bottom divider.
Training Plans uses the same compact stacked rows for workouts, editable step/repeat blocks, and its history section;
workflow state and unit-aware workout summaries remain owned by Plans.

Optional `[compactRowTitlePrefix]` content appears beside the title inside its semantic heading, separately from
the body and action slot. Training sync uses this for the shared provider logo with its visible provider name;
decorative logos are hidden from assistive technology and do not become controls. The title can wrap while the
prefix retains its compact size. Existing rows without a prefix retain their layout and heading levels.

Compact **column** lists (currently Garmin permission grants) center icon, heading, description, and trailing status,
with 24px icons and tighter row padding. At narrow widths, the status stays beside the heading and the description
wraps underneath; grant labels reserve an equal width so changing status cannot shift the description column.
This density-specific layout does not change comfortable public rows or stacked Health/Training content.

For stacked chart rows, `[fillHeight]="true"` opts into stretching the row body within its allocated height; it is
ignored for column layouts and defaults to false. The Health metric explorer uses this on desktop to fill the space
beside the metric list, with a minimum plot height for multi-row grids. Mobile, Highlights, and public previews
retain their existing chart heights. The existing ECharts host observes the resized plot; no manual resize loop or
extra padding is needed.

Dashboard plots, Health metric/Sleep-stage plots, and Training's readiness, body-weight, power-systems,
swimming-performance, and durability plots opt into `EChartsHostController.deferUntilNearViewport`.
`ChartViewportQueue` observes the nearest scroll container (including the app shell and bottom sheets) with a 600px
preload margin and admits one plot per animation frame after the shared ECharts library is ready, so a cold
import cannot release multiple queued plots into the same render frame. Non-scrolling tab bodies and horizontal-only
wrappers are skipped when choosing that root, so their offscreen charts still wait for the page viewport.
Only plot initialization is deferred: Angular titles,
values, accessible descriptions, and controls remain present. Initialized plots stay mounted when scrolled away.
Dashboard map tiles similarly defer their renderer with Angular's viewport trigger. Their fixed-height body keeps
a placeholder until visible; titles, filters, drag handles and menus remain available. Once created, the map stays
mounted during scrolling and receives the latest inputs, avoiding WebGL/map-worker startup on the first screen.
Destroyed or replaced plot hosts cancel their pending work, including waits for a previous theme. A chart that
leaves the preload area while the library loads stays deferred until it returns. When data changes before first visibility, only the latest waiting
refresh may apply its data. Browsers without viewport observation use ordinary immediate initialization.
The shared host resizes only when its container dimensions or pixel ratio change, while preserving the first
resize that releases fixed preview dimensions. Charts with size-dependent options can use its `onContainerResize`
callback; Recovery and generic pies rebuild their legend and center typography after real size changes, retaining
the ECharts instance. The host remains reusable and resizable without `ResizeObserver` through the shared viewport
fallback. Dashboard section layout is recalculated only when its column count
or row-height mode changes, so browser toolbar height changes do not rebuild an unchanged layout.

An open chart picker keeps its original Material shell when the viewport crosses a breakpoint. Its mobile sheet
can widen to accommodate the desktop list and preview, while a desktop dialog retains content insets when narrowed.

`title`, optional `titleId`, and `headingLevel` (2, 3, or 4) own heading semantics; `summary`, `icon`, and `iconTone`
provide optional context. Default projected content can contain existing charts, tables, or metric displays.
`compactRowAction` projects a Material control into the action slot. The row is presentational: consumers retain
their existing Sports Lib formatting, data loading, accessible chart descriptions, and single haptic action owner.

Health's explorer, Sleep chart, and loading/empty states are not wrapped in additional card surfaces. Sleep-stage
legend columns wrap to the available card width, including the narrow columns in tablet Highlights.
Highlight **Open** actions scroll to and focus the explorer heading, including when that metric is already selected.
They preserve the selected date range and source filters; opening the current metric does not save preferences again.

### Bounded surfaces

Use `.qs-glass-card-panel` for shared content surfaces that are not already represented by an ordinary Material card.
Both that primitive and default Material cards are intentionally flat through `--qs-card-shadow: none`; their border is
the primary separation from the workspace background. Floating menus, dialogs, datepickers, configuration submenus,
and bottom sheets use `--qs-overlay-shadow` so their temporary layer remains visually distinct. Do not reuse the overlay
shadow for in-flow cards or add route-local card shadows.

## Dashboard calendar popup

The Today month popup uses the existing compact calendar with `fillHeight=false` on both its tile and grid.
The grid opts into `activity-calendar--picker`: readable 28px date badges, 64px rows, and a separate
indicator row for activity circles and Timeline notes. Note colors sit under the note icon; planned workouts use
a short bottom rail. Only wholly empty trailing weeks are omitted (4–6 weeks remain, with weekday alignment preserved).
The sheet's content scrolls when the viewport cannot accommodate the month. The header stays outside that scroll area,
and the content respects the bottom safe-area inset. Do not constrain this popup to the dashboard tile's fixed height.
The default `fillHeight=true` makes dashboard tiles and chart-library previews distribute their visible weeks evenly
across the available height at all viewport widths. Compact month grids with hidden outside dates omit wholly empty
trailing weeks in both layouts, while retaining leading blanks and the original 42-day source/query model. Preview
wrappers pass their fixed height through to the grid. Full Month, Week, and Year grids retain their existing rows and
do not opt into the compact height-filling class.

## Dashboard chart picker

Owners use a compact **Add to dashboard +** action in the dashboard header (an accessible **+** button on phones).
One dashboard-scoped `DashboardChartLibraryComponent` with `allSections=true` owns the overlay and handles section
add actions and existing-tile editing. Its Material section selector exposes every lane, including hidden ones. Opening
from the top prioritizes unseen additions, then an available section; it avoids landing on a completed preset list.
Empty KPI/main sections are omitted from the dashboard. Populated sections retain right-aligned Add KPI, Add chart,
Add map, or mixed Add tile actions, delegated to the same picker. A section action is hidden when no presets remain;
Activity Overview retains custom creation and its direct action opens properties when complete. Adding a first tile
reveals its section, removing the last hides it, and restoring the tile restores the section. The global picker remains
mounted through those changes, so overlay state and editing do not depend on section visibility. An entirely empty
owner dashboard offers Add tiles and Use starter dashboard through the existing confirmation/persistence flow.
Shared/read-only dashboards do not instantiate the picker or its actions. `DashboardChartLibraryState` still permits one
open section and one local draft. All custom activity metric charts and presets belong in Activity Overview, which is the only
section offering Create custom chart. This grouping is computed for existing tiles too, including shared dashboards;
there is no separate Custom Charts section or persisted section migration. Curated charts, KPIs, and maps retain their
existing destinations. The browser shows all available entries in a scrollable Material action list with section search, KPI group filters, and Health categories. Health search spans categories; KPI search retains its group filter.
KPI filters use one horizontally scrollable row with Material's single-selection indicator hidden, retaining the selected
color and accessible state. Their height stays stable during opening and selection; the rail reserves touch/focus space
and permits narrow-screen overflow without overriding Material internals.
Rows show the title, format, availability label, and a small chart beside the chevron; only the selected chart mounts a full preview renderer.
Desktop opens with the first available chart selected, without extra haptic feedback or any save. Mobile starts with
the list and opens details on selection. Back from a mobile preview restores focus to the selected row, scrolling it
into view if needed. Selecting the same entry again is a silent no-op that preserves preview scroll
and focus. Search/group changes release an unchanged preview if it no longer matches, so Add cannot target a hidden
choice. Filtering never discards a configured or modified draft, and filter controls are locked during saves.
The entry component opens its picker template in a wide Material dialog on desktop and a 92dvh Material bottom sheet
below 960 px, using the shared overlay theme. The documented `qs-chart-picker-sheet` sizing exception lets the
Material container fill the configured pane instead of applying its default 80vh cap. The gallery never expands the dashboard.
Desktop gives the selected chart most of the width beside a compact list; each pane scrolls independently. Mobile
selection opens details with Back. Full chart previews render at native text size without CSS scaling, and KPI details
use a shorter preview suited to their headline and sparkline. The shared ECharts host explicitly
returns to automatic dimensions on resize so initialization fallback sizes cannot pin a chart to a tiny canvas.
Creating a custom chart, editing a configurable tile, or choosing its settings replaces the gallery with a dedicated properties
workspace. Properties and the live preview scroll independently on desktop; mobile puts properties before the preview
in a single scrolling column. New custom charts omit the redundant category selector and use an explicit Create custom
chart title. The type-specific settings action sits above the preview so it is immediately discoverable, and stays
right-aligned when longer labels wrap onto a second row on narrow screens. Settings are offered only for generic metric
charts and maps, using `hasDashboardTileSettings`. Curated charts, KPIs and the calendar have fixed configuration:
their menu opens details without properties or a Save button. Their existing inline range/source controls remain
available on the dashboard, and library previews retain Add. Recovery uses smaller centre text and a wrapped total
inside a larger donut opening at narrow chart widths; metric values still use canonical formatting.
`dashboard-tile-presentation.helper.ts` owns the presentation kinds and terminology for chart, KPI, map, calendar,
and generic tile. It resolves the existing stored renderer types; KPIs and Activity Calendar are stored as Chart but
have their own UI kinds. Section terminology uses the full catalog, so adding presets or filtering the list cannot
rename the section action. Draft terminology is recomputed after editor changes. Future renderer kinds belong in this
resolver and label registry, with generic tile as the safe fallback. This does not change persistence or section routing.
Chart and map action components use the same `tile-actions-menu.html` and base edit handler; catalog dismissal is synchronized in the common action persistence path, with legacy
chart dismissal retained in the chart component. Keep every `mat-menu-item`, including Remove, in the menu template itself:
Material cannot include items inside a child component’s view in its keyboard navigation. All menu mutations and
editing are disabled during a pending save, with a spinner in the original action button. Rows and Columns use
standard Material submenus with checked choices so arrow-key navigation can reach every layout setting.
The header and Add/Save footer stay outside the scrolling content. The editor stays in the picker and reuses `DashboardTileConfiguration` for existing validation, defaults, uniqueness,
suggestion dismissal, and preset identity rules. Close, Back, backdrop taps, Escape, section switches, and bulk actions protect dirty drafts. Pending saves prevent
dismissal. Owner/context destruction closes overlays and releases their preview subscriptions. On successful save,
the dashboard waits for the overlay to close and the chart layout to refresh before focusing and revealing the saved
chart; cancellation restores the original trigger focus. Existing-tile editing restores the tile's persistent action
button instead of the dismissed menu item, including sections with no add action. Latest-add Undo stays on the dashboard.

`dashboard-chart-catalog.helper.ts` adapts the shared preset registry and uses the same preset-equivalence rules for
availability and bulk additions. Special chart identity includes power discipline; map identity includes its source.
Custom equivalence uses metric, chart style, aggregation, axis, and time bucket rather than order, size, or activity filters.
New catalog entries need an example and catalog coverage. Homepage signal fixtures are re-exported from the shared
`dashboard-chart-example-signals.helper.ts`; homepage renderers and dashboard previews remain the existing app charts.

New accounts start with Today, Weekly Training Time (90-day weekly columns grouped by sport), and Calendar. The
same fixed layout is available through **Reset to starter dashboard**, with a confirmation dialog. Reset requires no
eligibility reads. Existing layouts, deliberate empty arrays, and saved ranges are preserved; there is no Calendar or
Routes auto-add subscription. New Intensity/Efficiency tiles use 12 weeks; legacy missing-range normalization stays at
one year. Sleep/HRV windows and personal-range calculations are unchanged.

`dashboard-chart-discovery.helper.ts` ranks up to two ready, unadded, undismissed choices per section: Form → Sleep →
HRV → Intensity; cycling → running Power Curve; Weekly Training Time → Calendar → Time by sport; Saved Routes →
Activity Map; ACWR → Training Balance. Search and KPI groups apply before ranking. Suggestions appear once, followed
by unseen releases and remaining entries. Availability updates never replace a selected draft. `autoTiles` now also
stores `preset:<catalog-id>` states for every preset, falling back to legacy dismissal records. Tile-menu removal,
Remove all, Add, and Undo share this state; dismissing suggestions never hides the manual catalog. Setup/provider
prompts remain independent.

`dashboard-chart-availability.helper.ts` supplies one status/reason to suggestions, thumbnails, and preview details.
Readiness requires actual plotted values: usable TSS results, sleep points, individual or overnight HRV, sport-specific
power-curve points, qualifying intensity/efficiency samples, valid GPS coordinates, or renderable route previews.
Average power alone cannot qualify a curve; an HRV personal range is optional. Explicit insufficient-comparison history
uses **Needs more history**. Completed empty sources use **No data in this period**, while loading, pending/stale metric
snapshots, and errors remain distinct. Last available values may render during updates/errors but are not suggested.
Synthetic examples are labelled and cannot qualify a suggestion.

Catalog release notifications use each preset's explicit `introducedIn` revision and
`appSettings.dashboardChartLibrarySeen[section]`. Keep `DASHBOARD_CHART_LIBRARY_BASELINE_REVISION` at 1 and stamp all
original entries at 1. For an actual new chart type, increment `DASHBOARD_CHART_LIBRARY_CURRENT_REVISION` and stamp
only the new entries; renames, styling, and description changes retain their revision. New accounts initialize all
sections to the current revision; existing profiles without metadata use the rollout baseline. The Material **New**
badge considers unseen, unadded catalog entries regardless of data eligibility. It is absent from shared/public views
and included in the add action's accessible label.

The top action aggregates unseen additions across all lanes without reading chart data. Opening a section's browse list snapshots its unseen IDs for that session and acknowledges that section only. Switching sections keeps the same overlay, resets section search/filters, and loads only that section's evidence; session New labels survive revisiting a section. Editing
an existing tile does not acknowledge. `DashboardChartDiscoveryService` derives badges from bundled metadata and the
already-loaded owner settings: no polling or chart reads. It writes only advancing acknowledgements using a Firestore
transaction that keeps the maximum revision. Full profile settings saves preserve those maxima transactionally too,
so an older device cannot replay stale acknowledgement state. Dashboard resets patch dashboard settings only.
Acknowledgement failure never blocks navigation/Add and retries on a later opening, without a background retry loop.
Successful local acknowledgements are cached by owner; profile-only refreshes do not restart preview subscriptions.

`DashboardChartPreviewService` reads only. Row thumbnails use the shared ECharts host and a bounded, decorative shape
from the existing preview view model, with no axes, values, tooltips, focus targets, or haptic handlers. The row's
accessible description includes its format and data source. Preview models are cached across search/group filtering;
closing the picker disposes its thumbnail charts. Opening any section subscribes to its missing sources, scoped to the
current owner: one combined prepared-metric subscription, one activity read per date range, 14 days of sleep, the shared
HRV adapter, and up to 50 recent routes as needed. Reused dashboard contexts remain live rather than being copied into
the library's fetched state, so later imports or removals update previews without another read. Pending or failed metric
snapshots retain last available values; a completed empty result clears them. Per-metric read failures are reported
explicitly rather than appearing as an indefinitely missing snapshot. List and detail previews share
these results and per-source loading/error states; selecting an empty or failed result does not repeat the read.
Filtering does not resubscribe, one failed source does not block other rows, and closing or changing owners releases
all reads. Activity windows stay separate, with activity-type filters applied after the shared read; changing custom
settings to another range loads that range for its detail preview.

KPI trends and semantic colors come from `dashboard-kpi-sparkline.helper.ts`. Other thumbnails reuse the full charts’
activity-group colors, category palette, pie grouping, date/activity segmentation, sleep stage definitions, Power colors,
and HRV range/status renderer. Form retains its two panels, weekly derived charts respect their configured range, and
Sleep includes available stages, naps and vitals. The render is sampled to at most 48 points per series, without labels
or interactive overlays. A real headline without history stays real, with no invented sparkline. Shared series definitions
live in `dashboard-chart-series.helper.ts`; public homepage examples remain synthetic.

A historically navigated event/sleep window cannot supply a current preview. Preview event reads exclude merged events.
Preview data paths never call metric ensure/rebuild APIs or persist settings. Catalog acknowledgement is a separate settings-only action. Synthetic examples remain labelled during loading
and on failure. Calendar previews use the stateless calendar grid, so browsing cannot read or edit planned workouts.
All canonical values continue through existing chart renderers and Sports Lib with the signed-in user's unit settings.

Dashboard tooltip metric rows use the shared `dashboard-echarts-style.helper.ts` renderer. Labels and values can wrap
within the card's bounded width, with wrapped values remaining aligned to the end. Column-chart sport breakdowns keep
the canonical metric on the main row and put the percentage of the total and activity count on a separate detail line,
so long durations do not overlap sport names in compact tiles. Percentages appear only for total aggregation.

The optional HRV preset (`HrvTrend`) belongs in Training State beside Sleep. `DashboardHrvService` supplies both the
saved tile and picker with the same normalized Health/Sleep sources as the Health workspace. It reads one bounded,
live Health HRV history alongside native Sleep history. The same Health records supply Sleep enrichment and separate
visible-window/60-day-baseline projections through `projectLoadedHealthRange`; each projection preserves the Health
query window limit even for a one-year view. Rare provider dates outside that history request only the additional
non-overlapping days needed for Sleep enrichment. `HrvHistoryService` shares matching owner/date reads with Sleep
consumers, and `DashboardHrvService` shares complete matching tile/preview contexts. Both release their cached result
and listeners when the last subscriber leaves. Every Health page stays live, with 32-record pages and a combined
2,048-record/16 MiB budget; incomplete or oversized history fails rather than producing a partial personal range.
`dashboard-hrv-context.helper.ts` reuses Health's series models, personal-range calculation, status colors and canonical
Sports Lib display. `ChartsHrvComponent` renders `HealthMetricSeriesChartComponent`; thumbnails use the same ECharts
option builder, including its historical band. No competing HRV renderer or baseline algorithm exists. Sources remain
separate, and the full chart initially honors the user's Health highlight source preference. Source changes within
the dashboard are local display choices, with selection haptics; the shared chart host owns tooltip feedback. HRV uses
the same 8px vertical and 10px header inset as Sleep, dashboard title/value typography, and a title info action.
Only its title row reserves room for range/menu controls; date and source context can use the full content width.

HRV and Sleep have independent saved date ranges and navigation; HRV uses Health's calendar-day windows. Loading, empty and
failed reads remain explicit; incomplete Health loads do not produce a misleading personal range. While paging, the
last complete chart keeps its original dates and an update notice identifies the requested period. A failed refresh
retains that chart with an error notice. Changing owner or units clears the previous display. Preview fallbacks
remain labelled examples, and historical dashboard windows cannot masquerade as the current 14-day preview. HRV and
Sleep remain independently addable/removable; HRV has no automatic tile or derived-metric identity.

`DashboardConfigurationService` persists owner-scoped dashboard patches through Firestore transactions. It compares the
fields being changed against the draft baseline and refuses stale saves. Both sides use the profile hydration
normalizer, so defaults and legacy tile migrations do not look like concurrent edits. It merges only dashboard settings, preserving
server-managed Training settings. Existing tile resize/reorder/removal and filter/display changes use the same transaction
path. No backend callable or schema migration is introduced. Latest-add Undo retains before/after values only for the
fields in the chart write, checks those fields locally and transactionally, and preserves auto-tile dismissal when
removing the addition. Event-table filters and dates remain untouched and cannot cause an unrelated Undo conflict.
Another change to the affected chart fields disables that Undo. Undo asks before discarding an open draft and closes
its stale editor after success.
Preview construction also covers duplicate selections that cannot be saved, so details and discard protection always
follow the current form. Edits retain the original tile as the source of saved display settings; settings are inert while
a save is pending. Failed saves retain drafts and report the error; tile menu mutations roll back only their own
unchanged optimistic fields. Removing the final chart is supported.

Visual verification uses synthetic data with the real Angular components and Material theme. Review captures:
[desktop](images/dashboard-chart-library/desktop.png), [mobile list](images/dashboard-chart-library/mobile.png),
and [mobile preview](images/dashboard-chart-library/mobile-preview.png).
These captures contain no account data; the “Your data” label reflects synthetic input injected as loaded dashboard state.
Physical haptics require a supported device; browser emulation only verifies interaction wiring and layout.

### Dashboard Health tiles

`DashboardLibraryModule` owns the reusable picker and tile UI without dashboard routing; Dashboard and Health import it. Health provides its own scoped `DashboardChartLibraryState`. Its pin shortcut opens a selected preview, copies range length (latest period), seeds the provider filter, and does not acknowledge the section. Back enters the browse list and acknowledges normally. Already-added metrics route to `/dashboard?healthMetric=…`; Summaries focuses that metric's tile and removes the query parameter.

The Health lane follows Training State and uses Health's existing catalog groups and hidden-metric exclusions. Generic `HealthMetric` presets identify one `healthMetric.metric`; source and range are independent tile settings. Duplicate matching uses metric identity across all sections. Sleep/HRV keep their old renderer IDs and introduction revision; the 33 new presets use revision 2. Legacy tiles without `healthSection` stay in Training State; new Sleep/HRV presets set Health. Move changes only placement, preserves configuration, uses the transaction boundary, and supports guarded Undo. Starter and empty layouts are unchanged.

`DashboardHealthChartComponent` adapts the shared Health projection to one chosen source/reading. List thumbnails, selected previews, and owner tiles use the same model and colors. Full-series opaque IDs preserve provider accounts, aggregation, semantic variants and reading methods; an explicit missing ID remains selected. Source defaults are deterministic, with the HRV Highlight preference used only as an initial account hint. Date length persists independently, while older/newer anchors are local. A thumbnail is inert; its row owns activation feedback. Preview initialization and hydration are silent.

Health tile reads depend on owner, metric and window, independently of source selection and unit formatting.
Changing those display choices reprojects retained evidence without resubscribing or resetting loading state.
Persisting an automatically selected source preserves the existing chart model instead of building it twice.

The loading bar sits at the date toolbar's lower edge without reserving an extra flex row. The latest-value/source row follows its content height, retaining Material button touch targets when a selector is present. Embedded Sleep (`hideTitle`) removes its own top padding because the dashboard wrapper already supplies that spacing; standalone Sleep keeps its existing layout.

Health category chips retain the existing single-row overflow rail. `ChartSourcePickerComponent` keeps source attribution beside the latest value in owner Health/HRV tiles and their previews. Sleep overview places the picker in its date-control row when there are alternatives; its renderer already includes provider attribution. A sole selected source is plain text. Alternatives open a shared `qs-menu-panel` Material menu with wrapped full provider/account and reading details, checked state, keyboard navigation and focus restoration. This nested menu keeps the mobile add-chart sheet open. `chart-source.helper.ts` shortens only the visible label; identities and full provenance remain unchanged. Opening owns one selection haptic and makes no data request; the chart owns feedback for an accepted source change. Both renderers receive the workspace's shared Timeline notes context. New metric tiles are removed from public view models before rendering; private Health loading additionally requires a matching signed-in owner. Existing Sleep/HRV public renderers and deterministic homepage examples remain separate from these owner reads.

Health thumbnails reuse completed browser evidence for the same owner, metric, range and source while their visible subscription hydrates. Their latest value uses the existing canonical display string. The inert ECharts sparkline fits the span of recorded points, preserving values, gaps and colors; single readings and zero-valued bars remain visible. Full charts retain their selected date axis. Source options require drawable points in the selected window (or renderable Sleep sessions). A saved missing source retains its identity and displays `Source unavailable` with an explanation. The menu offers available replacements without silently substituting one; with no replacements it remains plain attribution.

The shared Health projection includes recorded Sleep duration/score, average/minimum sleep heart rate, resting heart rate, maximum sleep oxygen and average sleep respiration even without separate Health reference records. Compact labels retain distinctions such as Sleep minimum, Sleep maximum and Nap average; the menu retains the full reading description. Health's provider filters count these readings too. A failed or pending companion source does not hide available readings, and an empty state waits for the relevant bounded reads. See `docs/unified-health-data.md` for the projection and source-separation contract.
