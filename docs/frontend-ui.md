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

The Dashboard, Calendar, Training, Routes, Send activities, signed-in Compare files, and Settings workspaces use this component. A
page should not add route-local heading font sizes, action-row breakpoints, or a second title treatment. Keep page CSS
limited to the surrounding layout and domain-specific action groups.

Guest and public marketing views may retain a distinct hero composition. Their heading styles must remain local to that
public surface and must not become a new authenticated workspace-header pattern.

Dashboard loading messages use a reserved single-line status/greeting row below the header. **Today**, its date,
and its calendar action remain mounted through preparation, refresh, failure, and completion. A small Material spinner
shows pending work; failures keep the accessible Retry action. The status row keeps its height when it clears, including
when Today or the owner greeting is hidden. Do not replace the page title with changing loading messages.

Today's summary also reserves space for the completed readiness/confidence/recovery content and the HRV personal-range
details before the initial reads settle. Its primary cells align content to the top, and the loading progress bar and
completed score share one slot. Load warnings replace the explanation in its existing slot, retaining an accessible
status rather than adding a row. Keep these minimum block sizes independent of loading, missing-data and recovery states;
removing a reservation when a read finishes reintroduces scroll jumps. Small phones reserve extra wrapped-text space,
and tablets place the four drivers below the primary summaries instead of squeezing them into narrow columns. These are
minimums, not clipped or fixed heights: enlarged text and longer messages may still expand. Check loading-to-complete
geometry around responsive breakpoints as well as ordinary desktop/phone screenshots when changing Today copy or layout.

Above 720 px, Today uses tighter cell padding and smaller minimum heights for the primary summaries, four drivers,
and optional recovery band. Phone spacing and wrapped-text reservations stay unchanged. Desktop cells still grow
with their content; do not truncate recovery messages or HRV range details to meet the compact minimums.

Today distinguishes calculation evidence from same-day presentation. Once both initial reads settle, it withholds the
Readiness score, confidence and signal indicators until the latest eligible completed main night ends on the current
browser-local date. It says **Awaiting today’s sleep**, retaining the independent TSS-only Training state, eligible
previous-night Sleep and Overnight HR values labelled **Last available** with their date, and the weekly HRV average
with its latest reading's date. A failed Sleep read says **Readiness unavailable** and clears that evidence. The existing
refresh timer also reevaluates at local midnight using calendar arithmetic, including DST, and remains owner/disposal
scoped. The score slot and minimum layout reservations remain mounted while awaiting sleep. This is a Dashboard Today
presentation change: the shared 48-hour formula, Training workspace, saved daily history, Calendar and MCP/Assistant
contracts, consent, queries and mutations are unchanged. No backend deployment or data migration is required.

## Workspace Shells

Signed-in navigation uses flat, labelled sections: **Overview** (Dashboard, Calendar), **Training & health**
(Training, Plans, Health, Timeline notes, Assistant), **Explore** (Routes, My Tracks), then the existing **Tools**,
**Account**, and **Preferences**. Reuse the existing section heading and full-level row styling; no expansion controls
or nested guide rails. Guest navigation keeps its existing destinations without empty signed-in section headings.
**Timeline notes** retains the existing `event_note` icon.
Its native Material list link closes the drawer and navigates to `/health/compare`, where saved-note rows open their
existing comparison charts. **Manage notes** separately opens the existing editor/manager; navigation never launches a
creation dialog. The lazy landing page reuses the owner-scoped paginated note service, appearance helpers and shared page
header, without a second CRUD implementation. It keeps the regular row highlight on both the landing and selected-note
routes; the Health overview link uses exact-path matching.

Health All and the owner Dashboard Today share the surface-free summary from
`components/shared/health-change-summary/`. Its presentation delegates to
`components/shared/summary-disclosure/`, shared with the saved-note and public-example
`components/shared/note-comparison-summary/`. The shell owns headings, flat/rail layout, Material disclosure, haptics
and local scope resets only; its plain variant keeps just the disclosure control and accessible region label without
visible headings or a surrounding border. Domain adapters retain their existing calculations. Note comparisons keep source-labelled
differences and coverage visible and put the median table under **Show details**, without hiding the history chart.
Their rail stays neutral regardless of the sign of a difference. Health keeps **Your recovery** with established changes visible while evidence details are collapsed.
Health and note comparisons use the existing Material Show/Hide button pattern with `aria-expanded`, `aria-controls`
and a mounted hidden region when details are available; Dashboard does not mount a details region.
do not add a raised card or expansion panel. Evidence rows stack at narrow phone widths, preserving 44px button targets.
The local disclosure resets on owner change without feedback or persistence. This overview is additive: saved Dashboard
charts remain mounted and controlled by their existing settings, including the Show/Hide Today choice.
Keep the collapsed copy brief and use athlete-facing wording about readings and the user's usual range. On Health,
comparison counts stay visible alongside the headline and any outside-range readings; Show details contains the
source and range breakdown. The visible scope names Sleep and nightly HRV. Dashboard uses the component's compact
**At a glance** mode: a surface-free accent rail, compact stacked label and one sentence using the existing Readiness,
training state, Sleep, HRV and overnight-HR assessments, wrapping
naturally on mobile, without extra metadata rows or disclaimer copy. The 3px logical-start rail uses the same dominant
evidence state as the sentence, without a standalone status icon or an empty icon column. Available/within-range uses the app success token;
existing caution/outside-range uses the Material accent, unavailable uses the error token, and loading, insufficient or merely recorded
evidence stays neutral. Pair color with the explicit sentence, never an implied all-metrics all-clear.
Dashboard is sentence-only in every state, including Mixed/Recover, unavailable, missing and loading evidence. It has
no disclosure button, extra touch-target row or mounted evidence breakdown: Today already contains the metrics and context.
Do not add a box, fill, shadow or bottom divider to this compact presentation. Normal days combine
the existing Ready label, training-state label and recorded sleep in one sentence, without a second score. Sleep has no
new good/bad threshold, and overnight HR is distinct from daily resting HR. Do not summarize unassessed metrics
as normal. On Dashboard, the heading's bottom margin and the summary's top padding do not stack. Preserve the reserved
status line and source/error distinctions; Health retains its disclosure's 44px touch target. This is presentation only; no metric,
readiness calculation, query, persistence, or MCP/Assistant contract changes.

Authenticated product workspaces, except Settings, use the shared `qs-workspace-page` shell from `src/styles.scss`. It
owns the 1440 px maximum page width, border-box sizing, and common responsive inline gutters. Apply it on the route root
alongside the route-specific class; do not add another outer width, margin, or padding rule in the component stylesheet.
Settings uses a centered 800 px overview, with **Preferences** followed by **Privacy & account** in one column
on desktop and phones. Theme is directly editable above eight sections: Units & formatting, Dashboard, Training load,
Charts, Maps, Privacy & emails, Account, and Data management. Each section uses a surface-free Material button disclosure with
`aria-expanded` and `aria-controls`; all form panels remain mounted while collapsed. At most one section is open.
An absent or invalid `section` query parameter shows the collapsed overview, and valid section links open their
panel; legacy `profile` links open Account, `delete-account` opens Data management, and `app` shows the inline Theme control. Closing a panel removes the section parameter.
Account contains profile details. Data management is the final section and contains the account-deletion action;
its controls stay hidden when Account or the profile shortcut is open. Deletion uses a flat subsection with an
explicit button and the existing confirmation dialog, without a Danger Zone card. Direct links use `section=data-management`.
The group/disclosure/subsection heading levels are H2/H3/H4. Save changes is the only submit action; account deletion
is an explicit button action and is blocked during saving. The overview is inert while saving or deleting so the
loading shade cannot leave keyboard edits available; save progress remains outside that inert region.
The sticky Save changes bar appears only while the form is dirty or saving and applies the whole form. It remains
available across section switches, uses the theme surface and safe-area padding, and reports failures without discarding edits.
Pristine implicit submits are ignored. Section summaries follow staged form values (including disabled consent fields),
and untouched consent summaries refresh with the user input. Profile details and name live in Account, watermark
text lives in Charts, and week start lives in Units & formatting. Customize units is a second Material disclosure;
its fields remain mounted and preserve edits while hidden. A unit preset is selected only when distance, speed,
pace, swim pace, and vertical speed all match it; mixed choices show Custom unit choices and allow reapplying
either preset. Presets preserve weight, week start, and regional format and require Save changes.
Narrow column layouts use container queries to stack fields and preserve Material touch targets.

Settings separates the inline **Theme** control from **Privacy & emails** (usage analytics and marketing emails). The Privacy
section is addressable at `/settings?section=privacy`; its switches retain the existing legal-consent form controls
and require **Save changes**. Explicit off choices persist as false booleans, while untouched consent fields are
omitted from updates. Section disclosures preserve unsaved form edits and emit selection feedback for expansion
or collapse, with no feedback during route hydration or while busy.
Background profile updates refresh untouched consent switches while preserving explicit local edits. Privacy switches
are disabled during saving, duplicate submissions are ignored, and failed saves retain the user's choice for retry.

### Connection feature cards

Connections feature cards keep one title, description and action. They do not repeat a promotional checkmark line or a generic cooldown duration. History import keeps actual last-requested and next-available dates together as quiet metadata, with activity and Sleep/Health timings separate. A request date is not a completed-delivery date. Existing pending/error states, provider limits, eligibility checks and exact expiry timers remain unchanged; presentation reuses already-loaded metadata without new provider reads or mutations. Monitoring and MCP contracts are unchanged.

## Dialog actions and haptic ownership

Use the global Material dialog surface with `mat-dialog-title`, a bounded `mat-dialog-content` scroll owner, and
`mat-dialog-actions`. Confirmation, account-linking, sign-in error, browser guidance and CSV export use these same
shell conventions. Merge uses compact Material radio options with explicit stats/comparison consequences instead of
custom selectable cards. Confirmations keep text Cancel and the themed primary/destructive action alongside each other
when they fit on a phone; long labels wrap instead of forcing every confirmation into two full-width button rows.
Activity deletion names the activity/selection and limits its warning to those activities, their data and original files.
CSV export keeps its actions outside the scrolling column list and has one `ngSubmit` owner, without a duplicate
button-click export. Its visible option labels are sufficient; redundant Include-in-export tooltips are removed so
swiping across the labels keeps native touch scrolling.

Haptics belong to the accepted user action, not the overlay opening lifecycle. Use `appHapticTap` for unconditional
enabled dismissals such as tag-editor Cancel. Handler-owned feedback follows guards for rename submissions, merge
choices/actions, benchmark selection/swap/alignment, account-linking methods, CSV submission and account-deletion
acknowledgement. Material change events cover toggles and checkboxes; they do not vibrate for programmatic form
hydration or typing. Duplicate/unchanged choices, invalid submissions and busy actions stay silent. The dialog uses
selection feedback when returning a draft or starting an operation; the existing mutation owner retains success/error
feedback after persistence. Destructive confirmations retain warning feedback, without pretending the deletion has
already completed. Do not combine a directive and handler for the same action.

Reuse `AppHapticsService` so unsupported devices, reduced motion, pointer type and rate limiting keep their existing
behavior. Tests mock this service and cover initialization, no-ops, disabled actions and accepted outcomes. Browser
checks verify control wiring, wrapping, focus and scroll ownership; actual vibration still requires a supported phone.
These changes affect presentation and local feedback only; event, plan/workout, provider and MCP contracts remain
unchanged.

## Dashboard unit setup

The Dashboard Default units prompt uses `appSettings.unitSetupCompleted === false` and is owner-only, including
empty dashboards. New-account defaults set this flag; legacy accounts without it are not re-prompted. The browser
region suggests the initial preset. Apply saves the preset and the completion flag in one settings merge while
preserving weight, week start, and other app settings. The prompt has no skip/dismiss action; it remains until
Apply succeeds or changed unit preferences are saved in Settings. Busy view models update before awaiting a write; repeat
actions, preset changes, and Advanced settings navigation are blocked until it settles. Failed writes leave setup
incomplete and keep an inline retryable error. A late result cannot update a different signed-in account.
Successful saves publish a fresh User input while retaining its prototype so dashboard display inputs refresh.
Advanced settings still opens `/settings?section=units`; saving changed unit preferences there completes setup.

## Recorded swim distance units

`createSwimDistanceDisplayStat` in `shared/unit-aware-display.ts` selects Sports Lib's display-only
`SwimDistanceUnits` from the first normalized swim-pace preference. Recorded swim length rows, splits, set totals,
homogeneous swimming summaries, swim lap tables, detailed statistics and length/lap chart tooltips use this instance
before resolving the shared unit-aware display. General distance preferences do not override swim units; missing or
invalid swim preferences retain meters. Mixed-sport summaries keep general distance units. Source values and JSON
remain canonical meters. Root and Functions manifests and lockfiles pin the released Sports Lib 21.5.0 package,
which supplies the optional `DataSwimDistance` display-unit constructor. No activity/route reparse, data migration or
derived recomputation is required. MCP numeric metrics,
`distanceMeters`/`poolLengthMeters`, scopes and strict schemas are unchanged; this does not alter planned-workout
display or delivery. Existing Settings interaction/save behavior supplies the unit preference.

`event-swim-distance-display.helper.ts` adds a conservative nominal-yard presentation for complete Suunto pool
recordings. Every source length row must normalize successfully, so filtering malformed records cannot establish
completeness. The activity's recorded Active Lengths count must match all active rows; every length must retain the
same positive pool/distance, a unique ordered index/start, and numeric FIT speed/elapsed fields at their 1/1000
resolution. The intersection of all speed-times-elapsed half-quantum bounds must support exactly one 25- or
50-yard pool and exclude the recorded fractional pool. The native activity total must also agree with the summed
bounds, allowing only FIT summary distance's 1/100 metre resolution. These source fields corroborate a display
choice; they do not independently measure the physical pool. Missing, conflicting, partial, custom, zero-distance,
unknown-length and open-water contexts keep the existing display.

Length rows, rest-delimited splits and set headers pass nominal length counts to the shared display factory.
The returned Sports Lib swim-distance instance delegates only display value/unit to a nominal amount; `getValue`,
`getUnit` and native JSON retain the original canonical amount. Meter preferences ignore the nominal amount.
Pace, recorded/normalized SWOLF, accumulated source statistics, streams, TSS and Training calculations never consume it.
Lap rows, selected lap distance summaries and chart tooltips opt in only for independently corroborated laps:
ordered non-rest sets and positive-distance laps must form a complete pairing. Any recorded active count must be
finite and match its set; absent counts retain the independent timing/distance fallback. Centisecond timing and
the summed speed/elapsed distance bounds must agree. Explicit rest laps never opt in.
Selected distance averages may include recorded zero-distance laps alongside corroborated laps; their zeroes
contribute unchanged. Missing or uncorroborated positive distances retain the existing selected-average display.
Rounded `lapIndex` ownership is not used as proof and is not repaired by this change.

This is a frontend presentation change with no persistence or MCP wire impact. The existing MCP activity-detail
allowlist still returns recorded `distanceMeters` and `poolLengthMeters`; numeric metrics, registered schemas,
scopes, consent, plugin guidance, provider integrations and planning/delivery capabilities remain unchanged.
Existing eligible activity documents benefit without original files, source reparsing, a derived rebuild or a
Sports Lib package change. Parser corrections in later library releases retain their separately authorized
source-backed transition; this display rule does not repair stored canonical data.

Event-level distance summaries classify all activities contributing to the total, even when only a swimming activity
is selected. Summary display caches refresh when unit settings change. Merge and benchmark comparison helpers apply
the same swim display preference to distance differences and their metric keys; the comparison grid refreshes these
differences when the unit settings signal changes. Canonical values and percentage calculations remain unchanged.

Recorded swim sets retain their existing boundaries (through the following idle/rest length) and every expanded
length row. Headers label active length timing as **Swim**, idle/rest timing as **Rest**, and preserve the previous
combined duration as **Total** when both are present. Rest-only groups show Rest without an invented active duration.
Each duration prefers the source `timerTime`, falling back to `elapsedTime` only when timer time is absent; explicit
zeroes remain zero, missing values remain blank, and sums retain the existing finite-value behavior. Unknown rest or
paused gaps are not inferred from timestamps. The shared display resolver's `durationMilliseconds` option preserves
Sports Lib's existing fractional length formatting. Set pace now uses non-rest distance/time, while row durations,
distances, pace and other detail metrics and aggregate totals retain their existing source values. Stable group keys
preserve disclosure state across unit refreshes. Header timings wrap at phone widths, and user disclosure clicks and
Enter/Space toggles use app haptics without feedback for initialization or unit refreshes. This is a frontend display
change; import/storage, event/lap totals, chart markers, Training and MCP contracts are unchanged.

Swimming lap defaults also include the categorical **Stroke** column, selectable through the existing per-sport
Laps column picker. Explicit saved lists, including empty lists, take precedence over the defaults. Stroke labels
come from recorded non-rest swim lengths using their one-based `lapIndex` in the complete activity lap list, before
lap-type filtering; lap IDs and visible row numbers do not determine the association. The same pure label helper
supplies the default swim set header: one recorded stroke is named, different strokes show Mixed, and missing or
rest-only stroke data stays blank. Stroke is display metadata with no numeric average or selected-summary value.
For older FIT imports with overlapping rounded lap windows, the display helper corrects a length's lap reference
only when its active/rest type contradicts the recorded **Active Lap** flag and exactly one lap with the matching
flag starts at that length's recorded start time. Missing or ambiguous metadata preserves the source index; an
explicitly inactive lap never receives a stroke label. This also corrects the expanded length table's Lap column
without changing source records, timing, distance, chart boundaries, Training or MCP data.
The existing per-sport settings write path stores its visibility choice; source activity/lap/length data is unchanged.
Pinned swim-length numbers and lap number/selection cells use an opaque theme surface, including their headers,
so horizontally scrolling values cannot bleed through the fixed identifiers in either theme.
Pending column choices survive background preference refreshes. A failed save restores only that sport's previous
layout, preserving changes to other sport layouts and the temporary lap selection.

Swim lap rows also expose recorded FIT lengths through a surface-free Material disclosure. The expanded row reuses
`EventCardSwimLengthsComponent` in a lap-scoped inline mode; the independent Swim Lengths section, grouping,
recorded SWOLF, and swim/rest/total timings remain available. Membership uses the corrected complete-list lap index.
No 25-yard splits are synthesized: a six- or ten-length rep expands into six or ten recorded rows only if present.
Disclosure state and temporary selection survive unit/column refreshes; controls expose expanded state and region
IDs and emit one selection haptic per accepted toggle. Rest rows have both a label and a theme-based shade, including
opaque pinned cells. Explicit active length messages or a positive integer Active Lengths stat take priority over
an inferred inactive Active Lap flag, including when individual length details are missing or incomplete;
otherwise the recorded flag takes priority, then idle/rest length types. Zero distance plus zero recorded stroke
rate is a fallback only without that metadata, preserving active zero-stroke drills.

The lap table groups consecutive confirmed zero-distance rests only when their chronological windows touch without
overlap and their lap types match. Grouping uses the complete recorded lap sequence before table filtering;
an intervening active/unknown lap, changed type, gap, invalid date or overlapping window prevents merging.
Each display block retains its original laps and shows their table-number range. Its disclosure reuses the lap table
for individually selectable original rows, with existing length disclosures beneath them. Block selection is derived
from constituent selections, including an indeterminate state; selection coverage and Selected avg still count and
average original laps. Keys include the original complete-list index so repeated lap IDs cannot collide.
Block duration is the sum of recorded lap durations, never lap plus length time or a substituted wall-clock span.
Average HR is an estimate weighted by each available original lap's duration; minimum/maximum HR use the extrema.
Partial HR coverage is visible, and unsupported aggregate metrics remain blank while their original rows are available.
This is a presentation-only projection: stored laps, source files, chart boundaries, Training and MCP read contracts
remain unchanged. It requires no Sports Lib change, source reparse or historical-data transition.

Event lap tables use `getEventLapTableGroups` to append one Session end segment to a single unambiguous sequence.
Its positive recorded interval must follow non-overlapping laps inside the activity and end at the activity boundary
(allowing one second of end-time rounding). Recorded pause gaps are allowed. The final row continues the numbering
and has a compact **Final lap** label without widening the 48px number column. Mixed types, multiple session endings,
missing/overlapping intervals and cross-leg laps retain separate groups. Grouping is per activity, never across sports.
Rows keep their original lap objects, types, metrics and source-index selection/disclosure keys, including when
hydrating another lap type makes an assignment ambiguous. Only the table projection changes: source files, storage,
chart/map marker exclusions, Training and MCP contracts remain unchanged; no reparse or migration is needed.

The persistent lap Summary row appears only when an activity/display-group table contains at least two visible original
laps and has summary metrics. A single lap retains its recorded row without a duplicate summary. Count original laps
including any appended final segment before rest-block grouping, not the number of collapsed display rows. Column availability follows the same rule:
session-only Max HR cannot advertise a column in a single-lap table without its own recorded peak. Temporary selection
summaries remain available, including when one lap is selected. Changing the visible lap set recomputes this presentation.

Ordinary lap numbers use a 48px pinned column with 8px inline cell padding instead of the former 88px column. The
independent selection column keeps its 48px checkbox target. Persistent and selected summary labels span those two
columns, with their combined width derived from the same local CSS variables so metric columns remain aligned.
Summary and ordinary rows use separate Material row definitions: CDK measures sticky offsets per definition,
so a spanning Summary label must not shift the number cells over the duration cells in ordinary rows.
Cross-leg context tables retain a 128px number/context column; rest ranges and context labels wrap rather than clip.

Swimming defaults add **Total strokes** and **Normalized SWOLF** to the existing per-sport catalog. Saved lists,
including empty lists, retain precedence. The display-only `DataNormalizedSwolf` extends Sports Lib's numeric data
class. Stroke, total strokes and normalized SWOLF choices are limited to swimming in both the chooser and the
resolved column list, so cycling crank cycles cannot appear under the swim strokes label. The normalized SWOLF
class uses `ActivityUtilities.computeSwimSwolf` and rounds the displayed result to one decimal. The header labels
its reference via the shared swim-distance display: 25 meters or 22.86 canonical meters (25 yards), following the
first normalized swim-pace preference. The score is `(activeSeconds + totalStrokes) * referenceMeters / activeMeters`.
Recorded provider SWOLF stays separate. Complete active timing, distance and counts are required for length-derived
SWOLF and totals. When Active Lengths is a valid integer, the available active-length count must also match before
using length-derived interval metrics or average weights. Expansion always retains the actual recorded rows.
Missing fields or a mismatched count can fall back to valid native interval metrics only without recorded rest
lengths; mixed swim/rest intervals keep unavailable active metrics blank instead of using combined lap totals.
Native lap strokes/time/distance or native pace/stroke rate can supply the score; no stroke count is inferred from
cadence. Physical pool length and stroke still affect efficiency comparisons.

Swim lap performance values use active length records when present, preserving native lap duration/distance totals.
Top and selected swim averages exclude known rest: pace and SWOLF weight by active distance; cadence/stroke rate
weight by active duration. Available cadence fields use that time weighting, with stroke-count/time fallback if no
rate is recorded. Zero stroke rates contribute normally for active drills.
An existing legacy cadence column also uses the active rate and its recorded sample-duration coverage; a missing
native cadence column remains unavailable instead of becoming a duplicate of stroke rate.
Selected accumulated averages retain existing duration/distance/energy coverage and report contributing lap counts.
Other sports retain their average
semantics. Active length distance uses recorded pool length when its distance is missing, consistently in length
rows, interval analytics, set totals, splits, pace and normalized SWOLF. Rest rows retain only their recorded distance.
Set pace and normalized SWOLF require complete active timing and distance; available individual rows and recorded
timing remain visible when a performance input is missing. Set summaries also exclude rest from stroke totals,
cadence and efficiency. Importers, persisted numeric metrics, chart timing, Training metrics and MCP read/write
contracts are unchanged; these are event-view calculations.

## Activity details spacing

Activity details use the workspace shell's inline gutters once. The primary summary, Training impact, metadata,
activity selector, statistics, map, charts, and lap/jump/swim sections align to the same content edges without extra
section-wide side insets. Section headings omit redundant top padding and retain an 8px gap below. Material controls,
table cells, chart axes, overlays, and fullscreen/export frames keep their internal spacing.
Summary metric tabs use `--header-stats-padding: 8px 0 0` so the tab header's 8px offset and the summary's 16px
section gap or bottom padding leave equal space above and below the metric cards, including on phones.
Desktop tab height follows the selected category's intrinsic content, retaining resize/font measurements and the
small rounding tolerance without reserving blank space for a taller hidden category. Phones retain natural sizing.
The Jumps divider reuses the performance-chart divider's 16px top and 8px bottom margins in addition to the section
stack's existing gap, so the heading is separated from the preceding lap table or chart. No divider is rendered when
no selected activity has jumps. A single jump-bearing activity renders its table directly, matching Laps and Swim
Lengths; mixed selections with only one jump-bearing activity retain its source label as compact secondary text.
Multiple jump-bearing activities retain the existing Material tabs. Table sorting, units and horizontal
scrolling are unchanged, without adding a card or extra inline padding.
The shared summary's `--summary-primary-info-padding-inline` and section header's `--event-section-header-padding`
hooks are set only by activity details; saved-route summaries and headers retain their default spacing.
At tablet widths, activity details set `--summary-primary-info-metrics-order` to keep summary actions beside the
identity and place the hero metrics below them, rather than creating a third header row.
The activity chart shell uses a `minmax(0, 1fr)` column so a previously rendered canvas cannot force its grid back to
desktop width when the viewport narrows. The shared chart host then resizes to the available content width.

## Sidebar navigation

Training remains a direct link to `/training`. Plans links to `/training/plans` as a full-level row immediately after
it in **Training & health**, without an expansion control. Plans is available to every signed-in user; Calendar entry
points retain their owner-scoped planning access. Training matches only its exact path (ignoring query parameters and
fragments), so Plans has an independent active state. Both links keep their existing close/haptic action.

## Material and accessibility

Use Angular Material controls for header actions: `mat-icon-button` for icon-only navigation, `mat-button` for secondary
route actions, `mat-stroked-button` for bounded retry or configuration actions, and `mat-button-toggle-group` for view
modes. The primitive uses Material system color and typography tokens; consumers should not override its internal
elements.

Give each primary route title a stable `titleId` and reference it from the route `main` or workspace region with
`aria-labelledby`. Keep a title status concise and expose failures with the supplied warning status or an equivalent
projected `role="alert"` state.

### Benchmark device appearance

The Device colors dialog opens with the Standard palette selected. Choosing Use Okabe–Ito preset stages the
published palette before the existing account-settings transaction.
The first four swatches are vermillion, blue, black, and reddish purple; the remaining four retain the published values.
Named Standard swatches also include dark gray and tan. The preset supports at most eight listed devices and never
silently repeats colors. Individual colors and Automatic reset remain available; Cancel discards every staged change.
Swatches expose color names, hex values, and pressed state. Accepted actions and completed writes use shared haptics.

`device-chart-appearance.helper.ts` applies device colors to merged/benchmark panels after either worker or synchronous
numeric builds. The account chart setting `useDistinctComparisonLinePatterns` defaults to false. A **Distinct line
patterns** toggle lives below **Line Width** in Settings → Charts and uses Save Changes. Settings writes this preference
only when the toggle is edited; untouched toggles follow account refreshes even while other form fields are dirty.
The same toggle appears in **Chart options** on merged and benchmark event details and saves immediately. The event
chart owns optimistic presentation, pending feedback, rollback and mutation haptics; the actions component owns menu
opening feedback. Writes verify the signed-in account UID, independently of the event's display user. Sign-out or an
account switch invalidates pending feedback, including a new session for the same UID; destroyed charts ignore
completions. Guests cannot change this account preference. The observed settings refresh cached chart presentation.
Compare’s header keeps the **Device colors** action and does not own chart-setting mutations. The device-color
button uses its intrinsic width there rather than the full-width mobile table-action treatment. Color
preferences and line patterns are independent: either can change without resetting the other.
With patterns off, charts retain solid lines, normal widths/overlay opacity, and dot
legends. ECharts merge updates explicitly reset line types to solid when patterns are removed. With it on,
full event order assigns solid, dashed, dotted, and dash-dot patterns, repeating after four activities;
filtering activities or missing metrics does not shift a remaining activity's pattern. The same patterns appear in
primary/overlay lines and accessible legend samples. Enabling patterns leaves primary and overlay stroke widths
unchanged, including configured widths below 2px; legend samples match the rendered widths. Patterned overlays and
legends keep full opacity. The overlay metric is identified by its legend and tooltip labels. Comparison charts suppress zone and altitude-grade coloring to
retain device identity. Normal activity charts retain metric and zone coloring. Saved preferences are observed by
the chart; theme changes also refresh presentation when only timeline markers need rebuilding. Rendered series and
timeline-marker colors blend toward theme foreground when necessary to meet 3.5:1 contrast against conservative
light/dark surface colors before marker opacity is applied, leaving stored hex values unchanged. Dark-map
brightening preserves achromatic black/gray rather than adding red saturation. Palette provenance:
https://jfly.uni-koeln.de/color/index.html#pallet. Simulation and contrast checks do not replace user testing on actual
benchmark charts, particularly overlapping lines and map backgrounds.

### Saved comparison R–R statistics

The Compare Files / Saved comparisons table places one **R–R & HRV** column after HR. Per-recording lines follow the
same activity order as Devices, distance and elevation, displaying canonical saved RMSSD, **Stats available** when only
other valid R–R metrics exist, or a dash when loaded stats are unavailable. One Material button opens the full set of
saved catalog metrics grouped by eligible recording, preserving device identity and colors without grading HRV magnitude.
The dialog links to Event Details; charts are opened there with **Show charts**. Table cells use a minimum 44px target
and retain the existing horizontal scroll owner; the dialog wraps labels and keeps its standard scrollable content/actions.

This display reuses the existing page-limited, cache-first activity hydration (`preferCache: true`, `warmServer: false`).
It adds no reads, writes, stream inspection, parsing, workers, backend fields or indexes. Metadata-only drafts retain
their existing skipped hydration and show **Not loaded**, including after an unsuccessful/empty activity load. This state
is deliberately distinct from a loaded recording with no saved HRV. Additional metric formatting happens only when the
dialog opens. Help describes the data boundary; there is no MCP contract or consent change.

### Event R–R summaries and plots

All Event Details pages with valid saved R–R metrics expose a separate **R–R & HRV** summary category (`rr`),
immediately before Device, preserving category IDs for remembered selections. It is not part of Device or Physiological. The existing metric-card renderer
shows up to seven primary statistics with short contextual labels, matching the other summary tabs without extra
headings, recording captions or explanatory paragraphs. The shared plain disclosure passes its existing **Show/Hide details**
control to an overview template, placing it in the metric renderer's grid/chip suffix beside the readings, with no footer row.
Expanded details remain below that overview. The same control keeps its state, ARIA target and single haptic owner.
If only secondary statistics exist, they appear immediately. Missing/invalid values are omitted
and recorded zero remains zero. `rr-metrics.ts` owns the common catalog; values and units remain Sports Lib's.
Each selected activity is inspected separately; parent-event and multisport aggregates are never used for R–R.
A local Recording selector preserves source identity across filtering. Two-source benchmarks use the shared stat
delta formatter and card treatment, restricted to types valid in both sources. Explicit multisport merges and
ordinary events have no R–R comparison deltas. Initialization and unchanged selections stay silent; accepted source
and category changes and the shared disclosure own one selection haptic. This summary does not inspect streams,
start a worker, fetch originals, reparse, persist statistics or add backend reads. MCP metric projections, consent,
catalog discovery and query/index contracts are unchanged; this is presentation of already-adopted saved metrics.

`BenchmarkReportComponent` includes the seven primary R–R metrics as a
reference/test table, using the exact report participant IDs and the common canonical formatter. It omits all-missing
rows, preserves one-sided and zero values, and includes available artifact counts, pair rates and DFA ranges. Neutral
absolute/percentage differences require valid values in both recordings. Symmetric percentages use the mean absolute
magnitudes, so opposite-signed DFA values cannot cancel the denominator. These whole-recording summaries are not
trimmed to the aligned benchmark overlap. R–R metrics are excluded from stat-difference chips and the hardware
agreement grade. Stale reports, unresolved or ambiguous participant links and missing activities do not show current
R–R values. The section is inside the existing share/image export frame and uses the global scrollbar skin on phones.
Image exports hide the screen-only horizontal-scrolling hint, including when generated from a phone viewport.
It reads no streams, starts no worker and changes no saved report schema, Firestore query/index or MCP contract.

The shared public reviewer showcase also includes an R–R/HRV row on Home and the comparison feature page. A fixed,
approved excerpt contains only the first 90 seconds of relative beat times, intervals and version-one classification flags
from one recorded source. Its three verified full-recording summaries remain separate from excerpt data. There are no account,
event, device, calendar-time or location fields. The sample is independent of the existing multi-device HR/altitude examples.
Use the shared R–R option builder and viewport-deferred ECharts host; the public preview does not parse originals, run analysis
workers, query accounts or add input listeners. Keep its numeric example under `data-nosnippet`, with capability copy in ordinary
prerendered HTML outside that boundary. The phone layout stacks the plot and a wrapping two-column metric table without horizontal
scrolling. Chart initialization/drawing failures retain the summary table and show a short fallback over the chart's
reserved space. Keep its host measurable and observable (visibility/ARIA hiding, never `display: none`) so a later theme
refresh can recover. Pass the same concise description to the HTML host and ECharts ARIA option; do not replace the
excerpt/full-recording context with an automatically generated list of coordinates.

`BenchmarkRRComponent` is shared by ordinary workouts, explicit multisport merges and benchmarks. Event Details
mounts it after the performance/dive charts only when a selected activity has valid saved R–R statistics or an original
IBI stream with usable timing metadata. The panel independently filters to those same eligible recordings; no-data
selections leave no empty section or host in the summary stack. It follows selected activities and full-event device
color assignments, preserving each multisport leg's original timing without combining its statistics with other legs.
It does not change Training impact, benchmark reports, alignment or accuracy grades, persistence, or MCP contracts.
The panel starts collapsed as a compact section-header row. The surface-free **Show/Hide charts** Material button
owns one selection haptic and a stable `aria-controls` target; collapsed content neither materializes beats nor starts a worker.
Expanding opens charts directly. A compact top legend uses the ordinary chart typography and shows each plotted source's
seven available primary saved statistics, with quality details in tooltips. At phone widths the source names and metric
pairs wrap inside the panel, keeping all available values visible without a sideways gesture. The artifact/pair key takes
its own row below the chart heading. Wider layouts retain a bounded horizontal legend with the shared scrollbar skin and
keyboard access. Values and units use Sports Lib classes through
the shared unit-aware resolver. Missing saved values remain unavailable, never zero, combined totals or worker-generated replacements.
**Show/Hide statistics** reveals the full table and its 20-metric selector. The table follows the local recording selection,
keeps metric labels sticky, and uses the global scrollbar skin with a phone scrolling hint.
The multi-select **Recordings** picker includes only selected event recordings with original R–R intervals or valid saved
R–R/HRV statistics, defaulting to all eligible sources and preserving IDs (or full-event positions
for unsaved/duplicate IDs), colours and distinct full-event-order line patterns. It overlays two or more original R–R and DFA
series on shared axes. Beat and window times retain each recording's start offset relative to the earliest plotted source;
no resampling, concatenation or per-device zero alignment is introduced. Markers and tooltip series names retain source identity.
If the parent event selection removes every locally chosen source, the remaining event sources become selected. A deliberate
local clear stays empty, with the picker still available even for one remaining source. Chart legends omit sources without
usable analyzed intervals, including saved-summary-only recordings and failed/empty analyses. Their valid saved values remain
available in the statistics table, and failed analyses keep their named retry message. Filtering never renumbers full-event
line styles, alters the parent activity selection or hides devices from other event charts.
Same-event metadata refreshes preserve disclosure and local recording choices. A different event ID resets both;
unsaved events use object identity. Analysis caches are still invalidated when event/activity inputs refresh.

Charts are lazy: expansion analyzes already-loaded original `IBIStream` sources sequentially in a component-scoped module worker.
The collapsed panel inspects eligibility only; it does not expand or copy beat arrays. Each activity is analyzed independently;
completed analyses are cached only in component memory and reused across local source changes and collapse/reopen. Input changes
invalidate that cache. A source failure leaves successful plots and all saved summaries available; Retry reruns only failed sources.
Collapsing cancels pending work, disconnects/disposes both hosts and fences late results. Unreadable timing is handled inside
its source request, leaving other recordings usable.
Eligibility and analysis ignore any stream display filter and preserve the original unsmoothed intervals.
Regular one-second `Stream` data is ineligible. Original elapsed beat times and invalid-observation barriers are preserved.
The worker calls Sports Lib's `analyzeRRIntervals`; QS does not implement another artifact or DFA algorithm.
Sports Lib 23.5.0 has no analysis-only public entry, and its root barrel emits unused parser chunks in a separate
worker build. The worker therefore imports the pinned pure ESM implementation directly. The compiled-worker test
checks parity with the public API, a single small output and absence of parser/Angular/Firebase runtime. Review this
path on library upgrades and replace it with a public analysis-only entry when available; do not copy the algorithm.
Analysis stays in memory, with cancellation on source/input changes and teardown, a 30-second timeout, and stale-result
fences for both calculation and chart initialization. Worker failures keep saved summaries available and offer Retry.
Chart rendering failures dispose both hosts, including a partially initialized partner, before offering Retry.
This panel introduces no Firestore query, write, index, reparse, original-file fetch or server endpoint.

The local **Time series / Poincaré** Material toggle defaults to Time series. Poincaré lazily replaces the two time hosts
with one unconnected scatter host using the same cached source analyses, source selection, unit preferences, theme and
shared mobile tooltip/haptic handling. Switching views preserves timeline zoom; changing source/event or closing the
panel retains the existing disposal/cancellation policy. Failed or stale scatter initialization is fenced and disposed,
and the existing Retry path reuses successful analyses. Saved-only sources stay in statistics, outside the plots.

`benchmark-rr-poincare.helper.ts` pairs original adjacent analyzed observations within a source segment before applying
quality filters. Invalid/nonpositive intervals, invalid time and non-increasing time break pairing. A point is artifact-flagged
when either member has an artifact classification; otherwise either suspected-ectopic classification gives a ring.
Removing flagged points never creates a new neighbouring pair. Each source preserves its full-event symbol assignment
(circle, square, triangle, diamond) and device color. A two-pass scan bounds allocations/rendering to 4,000 points per
category per recording, sampling ranks across the complete domain with first/last retention. Counts include all eligible
pairs; axis extents include all pairs before filtering/sampling so rare extremes remain within the plot. Axes use equal
canonical interval bounds and a square plot region. This is interval-pair geometry, not another classifier, an SD1/SD2
implementation or a new persisted metric. Native ECharts point tooltips escape source labels. The keyboard/touch **Next
flagged pair** action inspects displayed flagged points; its interval/time values use the shared canonical formatter.
The adjacent-pair count is deliberately distinct from Sports Lib's suspected ectopic-pair count.

MCP impact: this browser-only plot exposes no new MCP field, numeric class, parser/persistence change, grant or query.
Raw beats/classifications remain outside the existing MCP surface. No original-file fetch, Firestore read/write/index,
backend computation, reparse or Training change is introduced.

The two time-series ECharts hosts share native zoom/hover with matching zoom IDs (including the DFA host's hidden slider).
Reset uses the shared sync-source suppression so the button owns its single haptic response. Chart gestures use the
shared ECharts feedback helper. Shared host lifecycle, theme/contrast, tooltip and resize helpers remain authoritative.
Flag exclusion masks plot values only; null windows and recording segment boundaries stay gaps. Native LTTB is disabled
because it can join unrelated points around null barriers. Dense artifact/pair markers are capped at 4,000 per kind per recording by
sampling the complete time domain, with a visible notice; recorded summary counts remain complete. Zoom and exclusion
never recalculate persisted statistics. DFA guides at 0.75 and 0.50 carry no automatic intensity or medical conclusion.
Axis ticks stay compact; hover timing retains canonical seconds. Tooltip metric values use
strict numeric validation, preserving a missing value instead of coercing it to zero.

MCP impact review: browser-only benchmark presentation, with no version/parser/persistence or wire-contract change.
The existing canonical numeric metric catalog and consent stay unchanged; benchmark events remain excluded from that
catalog's activity history. Raw beats, classifications, detailed windows and device labels are not added to MCP.
The existing R–R numeric adoption boundary is documented in `docs/mcp-server.md`.

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

## Firestore HTTP error responses

The Firebase adapter installs `firestore-http-response-guard.ts` before browser RPCs run. The full SDK's XHR
callback calls `getResponseJson()` on HTTP error responses without catching JSON parse failures. An empty or
HTML gateway response can therefore escape the callback and leave the request promise pending, bypassing
application error handling. This is separate from activity-file parsing and persisted-profile recovery.

The temporary guard uses the SDK's exported `XhrIo` parser and only intercepts `SyntaxError` for HTTP errors
with a status from 400 through 599. It returns an absent backend error object so the SDK takes its existing
`unknown` / `Server responded with status ...` rejection path. Valid successful responses and structured
backend errors, including permission errors, retain their original parsing and codes. Invalid successful
responses and other exceptions remain visible. The guard adds no requests, retries, response-body logging,
or Firestore writes; a later user/application retry can make a fresh request after a failure settles.

Keep the direct `@firebase/webchannel-wrapper` dependency aligned with the full SDK's transport version.
The DOM regression spec exercises the actual browser SDK through synthetic XHR responses, including empty
and HTML 504s, truncated error JSON, successful filtered counts, permission failures, and subsequent recovery.
Run it when upgrading Firebase; remove the guard once upstream rejects malformed HTTP responses itself.
Backend queue and Cloud Monitoring coverage are unchanged because no provider, worker, queue, schedule,
or server-side lifecycle changes. Existing application error handlers now receive the rejected promise.

Calendar activity, planned-workout and workout-completion subscription failures emit `Calendar data read failed`
through `LoggerService` to the console and Sentry. Sentry groups reports by read source and allowlisted error name/code;
filter with `calendarReadSource`, `calendarView`, `calendarRouteMode`, `calendarErrorName` or `calendarErrorCode`.
The diagnostic fields include whether the reader is bounded, elapsed milliseconds since starting the read and
`navigator.onLine` (a browser connectivity hint, not proof that Firestore is reachable). Error names and Firestore
codes use fixed allowlists; the added fields exclude raw errors/messages/stacks, query dates, owner identifiers,
record identifiers and activity/workout contents. Sentry retains the application's existing session context.
Each failed subscription reports once; successful reads, cancelled reads and a restore-in-progress state are silent.
Error displays and user-triggered retries retain their existing behavior. This is app diagnostics only, with no
change to Training planning semantics or MCP read/write contracts, scopes, projections or bundled workflows.

## Account profile recovery

Firebase Auth identity and account-profile availability are separate states. Authenticated profile reads wait for
server snapshots; permission and transient App Check network/server failures refresh both credentials with bounded
retry/backoff. For App Check `initial-throttle`/`throttled` with HTTP 408/429/5xx, a validated remaining SDK wait of
at most ten seconds may use that same retry budget. The delay is at least the SDK duration plus one second to cover
its rounding, as well as the normal retry backoff. Recovering states retain the safe failure details for correct UI
guidance. Rejected HTTP 403/404 checks, unknown/long SDK waits, other direct exchange 4xx rejections,
reCAPTCHA failures and configuration failures stop automatic profile retries immediately. A forced refresh cannot
clear the SDK's cooldown. The recovery panel explains browser verification separately and offers **Reload page**
for these failures, with regular-window, trusted-network and script-blocking checks. Reloading starts a new check
but does not guarantee acceptance. It never signs out, clears storage or writes account data; transient network
failures and ordinary profile errors retain **Retry**. A requested page reload shows **Reloading…** and prevents
repeated clicks/duplicate haptics. A five-second UI-only fallback re-enables the action if navigation was cancelled;
it never requests a token or reloads automatically, and component destruction cancels it.
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

Sentry's existing `beforeBreadcrumb` hook inspects already emitted console warnings. App Check initialization
subscribes to sanitized initial rejections before starting verification, and registers the public `onTokenChanged`
error observer before downstream Auth/Firestore consumers. The hook accepts only the SDK console prefix and the
warning's exact initial-throttle grammar; unrelated logs and arbitrary arguments are ignored without formatting.
This also captures initial refresh rejections when the SDK retains a still-valid cached token and its public token
observer omits the error. No global Firebase user log handler is installed: that API formats even disabled debug
payloads before filtering, which can add work to unrelated Firestore/Auth operations. Console logging and SDK log
levels stay unchanged. `AppCheckReadinessService` also reports explicit token-request failures and invalidates memoized readiness
after a background failure. The single `App Check verification failed` Sentry message uses fixed phase/code labels,
a bounded HTTP status, a validated SDK retry duration (up to one day), source, online hint and document visibility.
Its custom diagnostic fields never copy raw error messages/stacks, SDK custom data, response bodies, URLs,
identifiers or tokens. Useful existing Sentry identity and navigation context is retained through the targeted
sanitizer described below. An initial rejection and its subsequent cooldown share one report until a usable
fresh token arrives; repeated notifications of the same cached token do not reset deduplication. Token comparison
is memory-only. An already active cooldown is labelled honestly when the original rejection was unavailable. These
diagnostics do not expose a reCAPTCHA score or prove why a particular user was rejected. If Firebase changes its
warning grammar, the strict log parser ignores it; observer/request diagnostics still report the available failure.

App Check failure events also record `appCheckAuthState`: `restoring` until the existing Auth subscription first
resolves, then `signed-in` or `signed-out`. This includes startup before that subscription has initialized; it is
not a claim that an unidentified visitor is signed out or automated. No additional Auth subscription or credential
request is introduced. Each resolved Auth notification advances an in-memory generation. Operation completions
from an earlier generation are ignored, and pending operation recovery state is cleared when Auth changes.

`App Check verification outcome` distinguishes three observations: `token-available` when the existing token
observer reports a different nonempty token after a failure; `operation-blocked` when profile loading or a callable
finally fails with explicit App Check evidence; and `operation-succeeded` when a previously blocked profile loads
authoritatively or the same callable subsequently succeeds in the same Auth generation. Recovery requires an
operation started after the latest tracked blocked failure; older or already in-flight requests cannot clear it.
Operation ordering is local and never enters telemetry or request data. Token availability alone
does not prove application recovery or that the server minted a fresh token. `tokenChanged` is null if there was
no earlier token to compare. Repeated notifications of the same cached token do not report recovery.

Outcome fields use fixed operation/auth/code labels, elapsed time capped at one day, and notification counts capped
at 1000. Notifications can duplicate a single failed verification across observer, console and request sources;
they are not unique users or exact verification-attempt counts. Repeated final failures of the tracked operation
are deduplicated and included in its eventual success count. At most one blocked profile and one blocked callable
are tracked in memory. Each outcome/category is reported once per Auth generation, with at most **five additional
outcome messages per page**, including across account changes. The budget does not reset on Auth changes and does
not suppress the existing deduplicated failure reports. Local recovery tracking continues when telemetry is suppressed.
Callable names are used only for local matching and never copied into the custom diagnostic fields. Generic permission, internal and index errors are
not attributed to App Check. Diagnostic failures cannot replace application results or modify the retry budget.

The `appCheckBeforeSend` callback sanitizes the complete outgoing event for the two fixed App Check diagnostic
messages. It deliberately keeps the existing UID/email, release/environment, trace IDs, browser user agent and page
paths, including path identifiers useful for investigation. It strips URL query strings, fragments and userinfo;
request bodies, cookies and credential headers; arbitrary tags, contexts, extras and raw errors; and event attachments.
Navigation/request breadcrumbs retain paths, methods, statuses, timestamps and levels. Console/click breadcrumbs
retain their category, timestamp and level without arbitrary text, arguments or selectors; other categories are omitted.
The shared Sentry scope is not changed. Other Sentry events keep their existing behavior and are not covered by this
App Check-specific sanitizer. SDK tests inspect the final envelope with an in-memory transport, including inherited
scope data and attachments, while verifying that a subsequent unrelated event still retains its original context.
The scrubber is lazy-loaded only for these diagnostics, keeping it out of the initial public bundle. If that asset
cannot load, the affected diagnostic is dropped rather than sent without scrubbing; unrelated errors remain synchronous.

These diagnostics observe existing callbacks and completions only: they add no Firestore reads/writes, token
requests, probes or timers. They do not identify bots or expose failures inside Google's cross-origin reCAPTCHA
iframe. For a 403 investigation, compare Firebase's existing App Check request metrics and the reCAPTCHA Admin
console score distribution before proposing any change to thresholds, TTLs, enforcement or allowed domains.

Monitoring impact: **unchanged** for Cloud Monitoring queues, dashboards and alert policies. This is browser-only
App Check recovery; no workers, schedules, backlog/lease/dead-letter semantics, provider connections or monitoring
bundle definitions change. Existing import monitoring remains authoritative for server queues; browser verification
uses the scoped Sentry diagnostic above. No production App Check enforcement, risk threshold, token TTL, provider,
Firebase settings or alert configuration changes are part of this fix.

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
Headings center prefixes by default. Provider sync rows opt into
`--compact-row-title-align-items: baseline` so wordmarks and provider names share a text baseline, including logos
with raised brand symbols. Keep this local to provider rows; do not add per-logo offsets or change other row titles.

Compact **column** lists (currently Garmin permission grants) center icon, heading, description, and trailing status,
with 24px icons and tighter row padding. At narrow widths, the status stays beside the heading and the description
wraps underneath; grant labels reserve an equal width so changing status cannot shift the description column.
This density-specific layout does not change comfortable public rows or stacked Health/Training content.

For stacked chart rows, `[fillHeight]="true"` opts into stretching the row body within its allocated height; it is
ignored for column layouts and defaults to false. The Health metric explorer uses this on desktop to fill the space
beside the metric list, with a minimum plot height for multi-row grids. Mobile, Highlights, and public previews
retain their existing chart heights. The existing ECharts host observes the resized plot; no manual resize loop or
extra padding is needed.

### Event chart gaps and zoom

Event Details **Chart options → Line continuity** and **Settings → Charts → Event chart line continuity**
share the account preference `settings.chartSettings.eventLineContinuity` (`mode`, `maxGapSeconds`).
Settings uses **Save Changes**; Event Details saves immediately for the signed-in viewer, including while viewing
someone else's shared activity. Missing or invalid preferences resolve to **Continuous**, without a migration.

- **Continuous** (default) connects available readings within each activity, including across missing data.
  A connecting line does not establish that intermediate measurements exist.
- **Detect gaps** uses the full metric's recorded timing, independently for each activity. Intervals up to two seconds
  connect. Longer intervals connect only when exactly equal to the dominant interval in either neighboring window
  of 16 intervals (excluding the interval being tested), with at least eight valid neighbors and 75% agreement.
  Otherwise the line breaks. This conservative heuristic handles regular slower sampling, but cannot distinguish
  lost readings from an identical genuine sampling pattern. It is an optional display choice, not validated missing-data attribution.
- **Custom gap limit** connects readings at most the configured number of seconds apart. The input accepts whole
  seconds from 1 to 86400, defaulting to 10 when first enabled. The limit measures time **between readings**.

The shared `event-chart-line-continuity.helper` prepares display segment IDs once from the full metric before coordinate
filtering. Worker snapshots carry the preference and return transferable segment buffers; synchronous builds use the
same code. The panel cache key includes the preference. Zoom does not rerun cadence detection. Invalid or non-increasing
sample timestamps break recorded-time connections. Distance coordinates omitted during projection cannot hide a
pre-existing segment break. The segment buffer costs four bytes per chart-grid position and is never persisted.

`buildEventRecordedLineValues` uses the prepared IDs for packed worker buffers; legacy point arrays cache equivalent
IDs against immutable input references and the preference. It uses absolute sample timestamps on Duration, Time and
Distance axes. Display buffers contain only original finite coordinates plus null separators. Grade-colored elevation,
intensity-zone styling, overlays, and comparison activities retain the same connection decisions and original values.
Each activity has its own series; preferences never connect separate activities.

Distance-axis hover-to-map synchronization selects the nearest finite distance/time pair at its original stream
index. Missing readings, invalid values and unpaired timestamps do not become zero or shift later samples; genuine
zeros and repeated distances remain valid, with the first recorded pair winning a tie. No usable pair means no map
cursor update. This read-only lookup preserves the source streams and works with both dense and sparse Distance
streams, including the existing Stryd fallback. Chart availability, x coordinates, lap markers and the map cursor
use Stryd only when the primary Distance stream has no finite readings (including empty/all-null streams).
A recorded zero keeps the primary source eligible. Individual holes in a usable primary stream are never filled
from Stryd; the source streams and their summaries remain unchanged.

The app and Functions both install Sports Lib 23.4.0. Original-file chart hydration retains missing Distance
readings as null instead of carrying the last distance through unrelated sensor timestamps. Real zero and repeated
recorded distances remain valid. Distance-axis charts omit rows without an observed x coordinate; time-axis charts can
still show their other sensor readings. The map cursor uses the aligned finite pairs above. Opening a chart does not
rewrite recorded summaries; historical saved statistics change only through the existing original-file reparse action.
Distance-axis lines apply the selected continuity mode to both the metric and distance recording intervals before
coordinate filtering. Normal sparse coordinates can connect; Detect/Custom preserve breaks in either source stream.
Continuous can span missing data without inventing a distance, tooltip reading or statistic at those missing rows.

The Distance metric itself keeps those sparse values on Time/Duration axes and uses the same continuity setting.
Chart unit selection covers every registered Sports Lib conversion family, including pace, effort/grade-adjusted pace,
swim pace, speed, vertical speed, depth and sustainable distance. It removes unselected base-unit duplicates while
retaining each deliberately selected unit panel. Recorded metrics can convert units even when their sport does not
calculate that metric. Headers, ticks, tooltips and range statistics use the same Sports Lib display and user settings;
Weight, for example, displays pounds consistently while its source values remain kilograms.

Canonical distance subclasses use Sports Lib's value-dependent m/Km tick labels without a fixed metre heading.
Distinct sources such as Stryd Distance, Step Length and Jump Distance retain their own panel identity and canonical
values, with conversion at display time: Sports Lib's shared generic miles/feet identifiers cannot merge them into
recorded Distance or one another. Unique unit variants, including GNSS Distance, retain their selected unit panel.
Duplicate raw stream selection happens before unit conversion, so each unit uses the same selected source. Empty
stream placeholders cannot block conversion from valid recorded samples. Recorded pace, swim pace and grade-adjusted
pace are converted before deriving missing metrics from speed; changing units must not replace recorded pace values
or fill their gaps. Existing converted streams with finite readings, including zero, retain their own gaps. Conversion
preserves nulls and real zero; range statistics use only recorded points, and zoom/overlays do not manufacture
intermediate measurements.

Saved overlay keys and targets resolve to the current unit variant without writing settings on read. Exact saved
choices take precedence, even when their target is unavailable. Alias migration requires a single available variant
and agreement among inherited choices; multiple units or conflicting older preferences cannot silently choose an
overlay. Reading an event never deletes or rewrites these preferences. Explicit edits remove obsolete aliases but
preserve settings for other currently available unit panels. GNSS Distance, recorded Distance, Stryd and sustainable
distance remain distinct sources. Exact self-overlays are rejected, while two deliberately displayed unit variants
can overlay each other on their own axes.

The shared panel renderer retains line endpoints for native viewport clipping instead of filtering away offscreen
endpoints. This keeps a connected segment visible when zoomed between its samples, while a broken segment stays blank
even when neither boundary is in view. Tooltip headers and individual rows outside the visible range are suppressed.
Nearby-row matching uses the current native viewport, including before shared zoom state catches up. The vertical scale
includes recorded endpoints of segments crossing a viewport edge, following each series' connection policy. Context
readings remain outside tooltip and selection-statistic results. A Continuous line crossing missing data adds no tooltip
reading or range statistic there.

Battery retains its sparse-reading display in Continuous and follows explicit Detect/Custom choices. Untimed route
series keep adjacent-row connections: distance/point-index coordinates are not elapsed time, and missing elevations
still break route lines. Power's 3s display retains its complete-window requirement and adjacent-row gaps; its recorded
whiskers do not add line context from offscreen raw readings. These policies also govern viewport scaling.

Both preference surfaces validate custom limits, disable pending edits, and provide semantic haptic feedback. Event
Details rolls back failed saves to the latest saved preference and ignores late completions after account changes or
destruction. The custom-limit input keeps its entered draft until the parent supplies a new value; a rejection before
that update leaves the draft available for retry without changing the active chart preference. Settings refreshes
an untouched preference pair without discarding unrelated edits, preserves edited pairs, and omits untouched continuity
fields from unrelated saves. Existing settings writes and authentication safeguards apply; no new backend endpoint,
index, rules, migration, or reparse is required.

Original streams, raw chart-series buffers, range statistics, Training load and MCP responses are unchanged. This is a
frontend display preference with no MCP/Training contract impact. The chart never manufactures intermediate measurements.

### Dashboard Efficiency single-week display

When the selected Efficiency Trend range contains one finite weekly observation, ECharts displays that observation as
a small circle in the line's theme color. Two or more observations keep the existing line presentation. Changing the
range updates this choice, and a valid zero remains visible. This affects only rendering of the existing weekly values;
calculation, filtering, stored/derived data, Training and MCP contracts are unchanged.

### Event Power display views

Event Details Power panels open in Raw. The Material Raw / 3s control is local to the panel and emits one selection
haptic only on an accepted change. It resets silently for a different activity set, stays selected across axis/theme/zoom
changes, and is omitted from inert previews and streams without a complete three-second window.

`event-power-display.helper.ts` builds a separate packed display buffer from the existing raw/worker series. A trailing
average needs three finite consecutive one-second samples according to their absolute recorded times; zeros count,
missing readings and timestamp interruptions do not. The same computation therefore applies on Duration, Time and Distance
axes, including repeated distance positions. The input series is never mutated. Each comparison activity has its own buffer.

The 3s view keeps recorded peaks and dips as thin, silent ECharts whiskers alongside the average line. Both raw extrema
are retained in each approximately seven-pixel visible interval, at their original x positions and separately within each
uninterrupted recording run. Each whisker extends from the local 3s average to the actual raw value; a recorded-value cap
remains visible when a complete average is unavailable. Zoom, container resize and fullscreen changes rebucket these
extrema. The 3s line omits area fill so the whiskers stay visible; Raw keeps its original fill. Device patterns and zone coloring
remain attached to the average line, including each independent comparison series. Tooltips show canonical Sports Lib-formatted
3s and recorded values separately; the y-axis includes both raw and averaged values in the current view so zooming cannot
clip an average whose window starts before the visible range. Original streams still own minimum/maximum, selection
statistics, overlays, marker positions, power curves, benchmark calculations and recorded metrics. Existing shared tooltip,
scrolling and chart haptic controllers retain interaction ownership.

MCP/Training impact review: this is an in-memory frontend display projection. No stored activity or Training metric,
benchmark calculation, chart/sample read response, catalog, plan/workout contract, consent, provider action or mutation changes.
The three-second buffer is neither persisted nor exposed as another numeric metric or MCP stream.

### Lazy chart code and release bundle budgets

`EChartsLoaderService` loads the core and `echarts-registrations.helper.ts` only in the browser, on chart demand.
The helper uses ECharts' public named imports for the existing six chart types, twelve components and Canvas renderer.
Do not dynamically import the whole `echarts/charts`, `echarts/components` or `echarts/renderers` namespaces:
those imports retain unused installers and their code even when `core.use()` registers a smaller subset. New chart
features must deliberately extend the named registration list and its exact-registration test. Core loading, shared
promise caching, failed-load retry, SSR guards, theme, resize and haptic behavior remain owned by the existing loader.

This is a bundling-only change, not a chart/Training metric, data contract, provider integration or MCP feature change.
No readings, units, chart options, user preferences, scopes or consent change, and no Help changes are needed.
Release verification must run the normal beta and production builds with the existing initial/total-script budgets
unchanged, plus service-worker and public startup checks. An optimized local `--stats-json` build can attribute code
when a release-budget failure prevents output emission; it is diagnostic only, not a substitute for release gates.

Verification: beta and production release builds pass without changing `angular.json` budgets. Production's
generated browser JavaScript totals 13,166,565 bytes against the 13,500,000-byte cap; the emitted graph contains
only the registered chart families, not unused treemap/sunburst/sankey/gauge/graph installers. All 511 targeted
chart/loader/host/public-preview tests, frontend environment/workflow/policy checks, service-worker asset checks
and the public startup/prerender checks pass. A synthetic browser smoke test imports the production chunks and
renders all six chart types on Canvas, including resize and connect/disconnect. No account or provider data is used.

#### Worker metrics imports

The event chart worker and its transitive metric helpers use the public
`@sports-alliance/sports-lib/metrics` entry introduced in Sports Lib 23.3. Root imports stay available for file
import/export consumers. A root import anywhere in the worker graph can make a splitting bundler emit unused FIT/GPX
parser chunks even when the worker never imports those chunks at runtime. Inspect every emitted script when measuring
the `allScript` budget. The app has no local adapter, internal package-file imports or custom resolution aliases.

The new entry shares the root API's exact data classes, `DataStore`, `DynamicDataLoader`, units and stream utilities.
The two shared metric helpers use the same public entry on frontend and Functions, so both consumers must adopt the
compatible package release. No calculations, serialized tokens, data catalog, persistence, Training/MCP contracts,
user preferences, consent or Help behavior change.

`event-chart-worker-bundle.spec.ts` compiles the actual worker with Angular's esbuild version and checks all output
files for parser/adapter code. It executes the bundled worker against the synchronous builder for running/swimming,
metric/imperial preferences and all three x-axis modes, including zero readings, gaps, transferable buffers and
error recovery. The worker service's existing fallback coverage remains in place. Production and beta retain the
`13600kb` total-script error limit and `13000kb` warning limit; the hosting configuration spec guards both values.

Verification with the Sports Lib 23.3.0 release artifact: production on Node 22 emits 13,307,265 script bytes
against the 13,600,000-byte cap, leaving 292,735 bytes of headroom. Beta also passes with the same artifact.
Production service-worker and public
startup/prerender checks pass, as does beta's service-worker check. All 722 targeted app assertions pass, including
the existing App Check recovery tests. Functions compilation and the MCP compatibility check also pass. Package
verification covers ESM/CommonJS identity, TypeScript resolution and every emitted metrics-worker chunk. Both the
app and Functions pinned 23.3.0 for that verification. Their current 23.4.0 pins retain registry URLs and matching
release integrity in both lockfiles.

Dashboard plots, Health metric/Sleep-stage plots, and Training's readiness, power-systems,
swimming-performance, and durability plots opt into `EChartsHostController.deferUntilNearViewport`.
`ChartViewportQueue` observes the nearest scroll container (including the app shell and bottom sheets) with a 600px
preload margin and admits one plot per animation frame after the shared ECharts library is ready, so a cold
import cannot release multiple queued plots into the same render frame. Non-scrolling tab bodies and horizontal-only
wrappers are skipped when choosing that root, so their offscreen charts still wait for the page viewport.
The owner dashboard marks its chart surface for background preloading: all saved plots join the same one-per-frame queue
after the dashboard mounts, and Health tile reads use the existing three-request limit. This prepares lower tiles
before scrolling without turning chart creation or Health reads into one main-thread/network burst. Other workspaces
remain viewport-aware. The shared observer options also gate Health tile evidence, avoiding a second, shorter preload
threshold before ECharts can start.
Scope and scroll-root detection must run after view attachment: Health tiles use `afterNextRender`, and the shared
plot queue defers registration of detached hosts until the current render completes. Checking ancestry in a child
constructor or static view query can otherwise leave dashboard charts waiting for scrolling. Cancellation before
attachment must remove the queued request without registering an observer or loading ECharts.
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

Background dashboard evidence (derived metrics, Sleep/readiness, legacy HRV, activities and routes) updates its
current state immediately and requests one `CoalescedFrameTask` tile rebuild before the next paint. The callback
reads the latest state, so a burst across sources is combined without dropping values. Initial rendering and explicit
layout/range changes still rebuild immediately and cancel a queued background rebuild. Destroying the dashboard
cancels the frame and subscriptions. Owner Health metric tiles retain their existing independent shared adapter;
this scheduling neither adds reads nor changes metric calculations.

Notes-only input changes use `EChartsHostController.updateTimelineNotes`. Its shared binding retains the last base
option and axis hints, projects marker/shading series, then merges only those stable IDs. Removed overlays receive
empty markLine/markArea data; metric series, zoom and legend state are not resent. Before applying an overlay patch,
the host dismisses the active tooltip through ECharts: mobile click-triggered tooltips otherwise retain outdated
private text after an edit, hide/remove or owner change. No chart recreation or resize is required. Full data/theme/range changes
continue through ordinary rendering. Range registrations remain deduplicated, and disposal releases the retained
option and registration. Explicit time bounds avoid traversing samples during overlay projection. Health, Sleep,
Form, Forecast and the four Training trend adapters share this path, without chart-local fetches or haptics.

Timeline note titles face into the available chart space, including each Form grid and Sleep/weekly category bands.
Titles stay inside the bottom of the plot on normal and reversed value axes, including swim pace charts.
Their width is bounded and truncated with an ellipsis; the native marker tooltip retains the full title. After
ECharts finishes layout, the shared host refines placement using `convertToPixel`, which accounts for automatic axis
label margins. A geometry key prevents repeated patches; only marker series are merged, preserving readings, zoom,
legend state and chart height. Real container resizes also refresh these overlays. The shared host removes its native
layout listener on disposal and rejects queued work for a disposed or replaced chart. Help's existing shortened-title
and full-tooltip guidance still applies; there are no changes to notes access, Training calculations or MCP contracts.

`date-time-format.helper.ts` reuses at most 64 Intl date formatters for explicit timezone/locale/option combinations,
with least-recently-used eviction. Health chart labels and workspace dates, Training readiness dates,
and dashboard calendar grouping use it. Formatted readings are never cached. Calls that omit a timezone remain
uncached so a device timezone change does not retain an old local-time formatter. Recorded offsets, locale options,
canonical metric value/unit formatting and range semantics are unchanged.

The shared Material `DayjsDateAdapter` validates typed calendar dates strictly in the active regional format.
Impossible dates and trailing text remain invalid rather than moving the selection to another month. Numeric `L`
formats accept single-digit days/months and surrounding whitespace. This changes only input validation; local-day
request boundaries and Timeline notes' independent fixed-date carrier remain unchanged.

An open chart picker keeps its original Material shell when the viewport crosses a breakpoint. Its mobile sheet
can widen to accommodate the desktop list and preview, while a desktop dialog retains content insets when narrowed.

`title`, optional `titleId`, and `headingLevel` (2, 3, or 4) own heading semantics; `summary`, `icon`, and `iconTone`
provide optional context. Default projected content can contain existing charts, tables, or metric displays.
`compactRowAction` projects a Material control into the action slot. The row is presentational: consumers retain
their existing Sports Lib formatting, data loading, accessible chart descriptions, and single haptic action owner.

Health's explorer, Sleep chart, and loading/empty states are not wrapped in additional card surfaces. Sleep-stage
legend columns wrap to the available card width, including the narrow columns in tablet Highlights.
The shared Health ECharts option renders Stress state as colored horizontal time blocks on named category lanes.
The Health explorer, dashboard tiles, chart-library previews and thumbnails all use that same projection, while
other categorical Health metrics retain their stepped series. Unknown provider states stay neutral and readable.
Health overview **View history** and Highlight **Open** actions focus the metric heading without scrolling it into
view, then reset the actual page scroll owner (`mat-sidenav-content`, or the document for standalone rendering) to
the top after rendering. Switching to a different metric, including browser Back/Forward, also starts at the top.
Returning to overview restores its saved scroll position and originating control focus; changing metrics while in
history does not overwrite that overview position. Date/source changes, refreshes, saved-preference hydration and
unchanged picker selections do not reset scroll. Pending render callbacks are guarded against newer navigation,
account changes and teardown. These are local navigation-only changes: no metric, measurement or MCP contract changes.
They preserve the selected date range and source filters; reopening the remembered metric does not save preferences again.

### Bounded surfaces

Use `.qs-glass-card-panel` for shared content surfaces that are not already represented by an ordinary Material card.
Both that primitive and default Material cards are intentionally flat through `--qs-card-shadow: none`; their border is
the primary separation from the workspace background. Floating menus, dialogs, datepickers, configuration submenus,
and bottom sheets use `--qs-overlay-shadow` so their temporary layer remains visually distinct. Do not reuse the overlay
shadow for in-flow cards or add route-local card shadows.

## Dashboard calendar popup

Selected-day presentation is shared by the full day page, Dashboard day preview, Calendar day preview, and day
bottom sheet through `components/calendar/_calendar-day-presentation.scss`. Reuse its navigation, supporting-text,
section-heading, entry-row, entry-title, and entry-icon mixins instead of copying presentation rules. The full day retains
its timeline layout. Previews and the sheet share 14px/body-medium titles, body-small metadata, 20px sport/note icons,
24px icon slots; month/mobile styles must not shrink their row text independently. Day-sheet workout rows are single
navigation links with one scope/status metadata line and no step summary or duplicate/copy buttons, leaving more room for titles.
Open the workout for step details. Duplication remains in the full day,
selected-day previews, and Plans.
Compact recovery metrics in the sheet and previews share label-small labels/supporting copy and 19px Barlow values;
the full day retains its larger 22px values. The day sheet establishes body-medium typography and zero tracking on its
app-owned container so Material overlay body-large tracking cannot leak into nested metrics or Training-impact text.
The sheet uses content-sized app-owned rows inside Material list items, without decorative vertical rails beside the
sport icons. Long titles, notes, workout metadata, and activity metrics wrap without fixed multi-line heights or
clamping. Material retains navigation, focus and ripple behavior. Keep the
shared overlay surface, fixed header, and bounded content scroll; do not add an inset card or enlarge the rows.
Preview and sheet row titles use on-surface text for readability in both themes; full-day links keep their existing
primary color. Loading/error copy uses the same compact metadata typography, and numeric counts retain
Barlow Condensed without inheriting a metadata font reset.
The sheet reuses the previews' compact Training-impact variant: an outcome headline and CTL/ATL/Form contribution line,
with separate dated lines when activities span two UTC Training days. Sheet impact text wraps at narrow widths so
dated CTL results and unavailable reasons remain readable; the component's whitespace token keeps other previews unchanged.
Partial-coverage warnings remain visible beside
the total; updating/unavailable/error copy and accessible full metric labels stay explicit. The full day retains its
detailed impact summary and model disclaimer. Compact contribution values in the sheet use on-surface text via the
component's compact-value foreground token so small numeric text remains readable on both overlay themes; other
previews retain their existing color.
Where duplication is available, its icons and pending spinners share a centered 24px box inside a public-token-sized
48px Material button.
Ready days without recorded activities omit the sheet's completed totals, sport breakdown, and detail section entirely,
including the zero count/duration and empty-activity message. Loading/error states remain visible, and notes, recovery,
and planning are independent. Linked plans do not create completed activity totals. This calendar presentation-only
change has no MCP wire impact: reads, projections, scopes, consent, mutations, and provider behavior are unchanged;
no plugin rebuild or registered-client rescan is required.

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

The shared Form/TSS chart uses `dashboard-form-y-axis.helper.ts` to derive both value axes from the displayed date
window, not the entire loaded history. The full render series and tooltip indices remain intact. At window edges,
interpolated values preserve the visible portion of crossing weekly/monthly line segments without importing their
offscreen extremes. Form always includes its neutral zero baseline; the load axis retains its existing baseline policy.
This presentation-only range applies to every consumer of `ChartsFormComponent`, without changing stored values,
load calculations, headline stats, timeline-note overlays, or saved W/M/Y choices.

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
For supported nightly HRV series in multi-day views, the time axis ends at the latest reading when it falls on the
selected final day, removing unused hours after the morning measurement. Missing final nights keep the full selected
window. The personal-range band uses the same plotted bounds; reading timestamps, tooltips and query bounds stay intact.

HRV and Sleep have independent saved date ranges and navigation; HRV uses Health's calendar-day windows. Loading, empty and
failed reads remain explicit; incomplete Health loads do not produce a misleading personal range. While paging, the
last complete chart keeps its original dates and an update notice identifies the requested period. A failed refresh
retains that chart with an error notice. Changing owner or units clears the previous display. Preview fallbacks
remain labelled examples, and historical dashboard windows cannot masquerade as the current 14-day preview. HRV and
Sleep remain independently addable/removable; HRV has no automatic tile or derived-metric identity.

`DashboardConfigurationService` persists owner-scoped dashboard patches through Firestore transactions. It compares the
fields being changed against the draft baseline and refuses stale saves. Both sides use the profile hydration
normalizer, so defaults and legacy tile migrations do not look like concurrent edits. Explicit field masks replace each
validated dashboard field as a whole, preserving other dashboard fields and server-managed Training settings. Recursive
map merging would retain old auto-tile dismissal timestamps after an addition and falsely reject the next editor save.
Existing tile resize/reorder/removal and filter/display changes use the same transaction
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

`health-source-selection.helper.ts` owns automatic source choice for every Health metric, Sleep overview and Health
highlights. It ranks drawable readings in the inspected period by useful evidence, main-Sleep/canonical semantics,
latest recorded calendar date and time, then distinct days of coverage. Activity totals and positive measurements
with only zeros rank behind sources with non-zero readings; trailing zeros do not manufacture newer useful evidence.
Zero stress, temperature deviations, altitude, resources, recovery and Sleep scores remain meaningful. Boolean and
categorical states remain eligible. Zeros are never removed or rewritten, raw sample frequency and value magnitude
never win a comparison, and exact ties retain the existing deterministic order. Provider filters bound the candidates;
explicit sources and an eligible HRV account preference take precedence. Overview defaults remain automatic across
refreshes until the user chooses a source; saved dashboard tile source persistence stays unchanged. These decisions
reuse loaded evidence and do not change provider ingestion, metric calculations, stored values or MCP contracts.

Health's All overview uses an explicit ordered selection: Sleep, HRV, resting heart rate, VO₂ max, weight, and steps.
Missing metrics reduce the selection; catalog order never supplies replacement cards. Completed shared chart contexts
also hide default cards with no sources and confirmed `no-data` availability. Their readers remain mounted so refreshes
can reveal new readings; explicit categories retain the cards. If category navigation recreates a confirmed-empty reader,
its shared background-preload marker bypasses viewport waiting while hidden. A fatal read failure also reveals the card
and its retry action, even after an empty result. Failure, partial-load, sample-only and missing-selected-source
states remain visible. Empty results are scoped to owner, overview date and provider filter. The overview has no global
date-period label for owner data: the 30-day cards, 14-day HRV highlight and today's heart rate identify their own periods.
Available Sleep/HRV highlights
own those two presentations on All. Today's eligible heart-rate highlight belongs to Vitals, where it replaces the
general Heart rate card while keeping its full-history action. Without today's readings, the category retains that
general card. Other categories retain their full available catalogs. Both projected highlight slots remain mounted
while hidden so category and history navigation preserve source choices and loaded chart state. Their heading IDs
are distinct. Successfully loaded eligible heart-rate samples augment a stale metric inventory so Vitals and full
history remain accessible. Provider reads, calculations and account settings stay with the existing Health workspace
and chart projections.

Public Home and Health feature previews reuse `HealthCategoryOverviewComponent`, its category controls, and the shared
Health/Sleep chart renderers through `HealthOverviewPreviewComponent`. The explicit `exampleOnly` input bypasses
account subscriptions and refreshes even when the supplied identity matches an owner; switching into that mode clears
retained private evidence. Examples use fixed fictional dates and canonical values from the shared example projection.
Opening sample history preserves the overview's category and returns keyboard focus to its originating action.
These controls never save settings or measurements. Existing detailed Sleep, HRV, and manual-measurement previews remain.
`health-example-days.helper.ts` owns the invented month shared by overview cards and detailed public examples.
Keep observations sparse for weigh-ins and fitness estimates, preserve stage/asleep/in-bed duration totals and morning
wake times, and use the same nightly HRV values in both renderers. Daily movement and energy totals remain coherent.
Older baseline variation is deterministic and independent by metric; never repeat one waveform across metrics or
commit account records, identities, or exports as sample fixtures.

The loading bar sits at the date toolbar's lower edge without reserving an extra flex row. The latest-value/source row follows its content height, retaining Material button touch targets when a selector is present. Embedded Sleep (`hideTitle`) removes its own top padding because the dashboard wrapper already supplies that spacing; standalone Sleep keeps its existing layout.

At phone widths (up to 767px), dashboard boards containing Health charts treat the configured row height as a minimum. Health chart wrappers grow with their reading/source controls, notices and metadata, retaining at least 180px for the metric plot; page scrolling exposes the complete chart and date axis. Shorter cards still fill their row, including Sleep. Desktop grids retain their configured sizing. Dashboard reading pickers use the existing compact presentation, with full accessible measurement names and source details available in the menu/tooltip. This layout does not rewrite saved rows, source choices or ranges, and does not change Health reads or MCP contracts.

Health category chips retain the existing single-row overflow rail. `ChartSourcePickerComponent` keeps source attribution beside the latest value in owner Health/HRV tiles and their previews. Sleep overview places the picker in its date-control row when there are alternatives; its renderer already includes provider attribution. A sole selected source is plain text. Alternatives open a shared `qs-menu-panel` Material menu with wrapped full provider/account and reading details, checked state, keyboard navigation and focus restoration. This nested menu keeps the mobile add-chart sheet open. `chart-source.helper.ts` shortens only the visible label; identities and full provenance remain unchanged. Opening owns one selection haptic and makes no data request; the chart owns feedback for an accepted source change. Both renderers receive the workspace's shared Timeline notes context. New metric tiles are removed from public view models before rendering; private Health loading additionally requires a matching signed-in owner. Existing Sleep/HRV public renderers and deterministic homepage examples remain separate from these owner reads.

Health thumbnails reuse completed browser evidence for the same owner, metric, range and source while their visible subscription hydrates. Their latest value uses the existing canonical display string. The inert ECharts sparkline fits the span of recorded points, preserving values, gaps and colors; single readings and zero-valued bars remain visible. Full charts retain their selected date axis. Source options require drawable points in the selected window (or renderable Sleep sessions). A saved missing source retains its identity and displays `Source unavailable` with an explanation. The menu offers available replacements without silently substituting one; with no replacements it remains plain attribution.

The shared Health projection includes recorded Sleep duration/score, average/minimum sleep heart rate, resting heart rate, maximum sleep oxygen and average sleep respiration even without separate Health reference records. Compact labels retain distinctions such as Sleep minimum, Sleep maximum and Nap average; the menu retains the full reading description. Health's provider filters count these readings too. A failed or pending companion source does not hide available readings, and an empty state waits for the relevant bounded reads. See `docs/unified-health-data.md` for the projection and source-separation contract.


## Empty activity tables

The shared event table keeps its existing surface, filter controls, icon headings, data rows and saved table preferences.
A completed query with no displayed activities renders a compact, surface-free notice below the table's scroll owner;
it does not use the loading shade's error card. Local text/tag no-matches use filter-specific copy. Loading, absent
inputs and failed activity reads do not render the notice. Empty pagination is hidden without destroying the shared
paginator or sort instances, so populated results retain their subscriptions and preferences.

Dashboard and Activities project a Material **Change dates** button into the notice. It opens the existing preset
selector or custom-date calendar without applying a range, changing filters, saving settings or fetching activities.
Preset opening owns one selection haptic; custom calendars reuse their existing opened-event feedback. Disabled,
loading and already-open controls are silent. Both controls receive focus before opening, keeping keyboard navigation
and calendar focus return on the stable date field. The notice wraps its action below the copy at phone widths.

MCP impact review: completed-activity presentation only; readers, canonical metrics, stored data, Training plan/workout
contracts, consent and provider actions are unchanged.
