import { environment } from '../../environments/environment';
import { ASSISTANT_REQUEST_LIMITS, ROUTE_USAGE_LIMITS, USAGE_LIMITS } from '../../../shared/limits';
import {
  POLICIES_AI_AND_PROCESSORS_FRAGMENT,
  POLICIES_CONNECTED_SERVICES_FRAGMENT,
  POLICIES_COROS_DATA_FRAGMENT,
  POLICIES_GARMIN_DATA_FRAGMENT,
  POLICIES_MCP_CLIENTS_FRAGMENT,
  POLICIES_SUUNTO_DATA_FRAGMENT,
  POLICIES_WAHOO_DATA_FRAGMENT,
} from './policies.content';

export type HelpSectionId =
  | 'getting-started'
  | 'activity-calendar'
  | 'training-analysis'
  | 'ai-insights'
  | 'plans-and-billing'
  | 'uploads-and-imports'
  | 'service-connections'
  | 'data-and-privacy'
  | 'troubleshooting';

export interface HelpAction {
  id: 'email-support' | 'report-bug' | 'release-notes' | 'policies';
  label: string;
  icon: string;
  kind: 'route' | 'external';
  target: string;
}

export interface HelpSectionLink {
  label: string;
  icon: string;
  kind: 'route' | 'external';
  target: string;
  fragment?: string;
  queryParams?: Record<string, string>;
}

export interface HelpSection {
  id: HelpSectionId;
  title: string;
  summary: string;
  icon: string;
  content: string;
  links: HelpSectionLink[];
}

const SUPPORT_MAILTO = `mailto:${environment.supportEmail}`;
const PRIVACY_MAILTO = 'mailto:privacy@quantified-self.io';
const GITHUB_ISSUES_URL = 'https://github.com/jimmykane/quantified-self/issues';

const TRAINING_ANALYSIS_HELP_CONTENT = `## What Training is for

- **Training** is a fixed analytical workspace rather than a set of draggable dashboard tiles. It brings together a **28-day status** compared with your usual training, **Readiness today**, **What drove this**, **Load trajectory**, **Training mix**, **Durability**, and **Settings vs recent evidence**, plus **Power systems** where it is available to your account.
- While visible Training snapshots are building or refreshing, the compact line above the **Training** title shows that state before any analytical values. It uses the existing header space, so content does not shift when the state changes. Any available last completed values stay visible during a refresh; a failed update adds **Retry** there. The optional imported recovery snapshot affects this route-level status only while an active **Recovery left** estimate is visible.
- Use **Sports shown** to personalize the Running, Cycling, and Swimming detail cards. Until you save a choice, Training selects sports automatically from activities in the latest 28 days and any saved sport benchmark; if none qualifies, all three stay visible. A saved choice remains fixed until you change it, and **Use automatic selection** restores the automatic behavior.

## Sports and multisport activities

- Running includes the Running and Trail Running activity groups. Cycling includes the Cycling and Mountain Biking groups, including road, indoor, virtual, e-bike, and mountain-bike activities. Swimming uses the Swimming group for both pool and open-water sessions. Unsupported activity types and multisport aggregate records are not assigned to a Training discipline.
- Multisport files are evaluated one activity leg at a time. A triathlon can therefore add one session to Running, one to Cycling, and one to Swimming; the parent event itself is not counted as an extra session. Merged events and activities without an eligible parent event are excluded.
- Hiding a sport removes only that sport's **Best build vs now**, Training Mix, durability tab, and sport-specific performance cards. It does not filter the overall comparison, **What drove this**, or **Power systems** when that section is available to your account. Power systems discovers every exact canonical activity type with usable stored power curves independently; it never combines related types into an all-sports value. Load and intensity charts can still include other eligible activities when their source data provides TSS or zones.

## Best build vs now

- **Best build vs now** is a curated Training comparison for Running, Cycling, and Swimming. Set one saved benchmark per sport from a manual end date or any eligible historical event. A multisport event may anchor separate benchmarks for each discipline. Events tagged exactly **Race** (case-insensitive) are shown first as quick picks, but selecting an event never changes its tags. The picker identifies its latest 100 other historical events by distance, duration, and TSS when available, and can order them by latest, longest, or highest load. An event is only an anchor: its workload is excluded from the benchmark.
- Choose an 8, 10, or 12-week build (12 weeks by default). The saved benchmark must finish before the matching current window, so comparisons never overlap. Merged events are excluded; missing TSS, zones, or durability evidence remains unavailable instead of being counted as zero. Durability rows require the same output or pool context and at least two eligible samples in both windows.

## Load and readiness

- The top **Training state** is a conservative label from the current TSS-derived Form model: Form (CTL minus ATL), 7-day CTL ramp, current CTL, and current ATL. The info control beside the current label shows those exact contributing values and explains the selected state. On desktop it opens a details menu; on a phone it opens the same content in a proper dialog rather than a transient tooltip. **Balanced** means none of the Starting, overload, fatigued, building, fresh, or detraining thresholds applies. Sleep, sessions, and the 28-day time comparison do not change this label. Dashboard **Today** shows the same compact state label and caption before Readiness, with an explicit **TSS only** qualifier. While its Form/TSS snapshot refreshes, Training keeps the latest complete state visible and labels it as updating rather than treating it as a newly calculated result.
- **What drove this** compares the current 28 days with the median of the prior three 28-day blocks. It separates parent-event TSS from child sport-group load, shows top parent-event contributors, keeps Other and unclassified child activities visible, reports load coverage, and compares sport-specific training rhythm. Raw load and composition changes use neutral higher/lower language because a larger load is not inherently good or bad.
- **Readiness today** uses the same current formula as Dashboard Today. It combines derived Form/ramp with a bounded 30-day sleep-only query; the browser does not load event or activity history. The latest non-nap night must be no more than 48 hours old. HRV, average sleep HR, and minimum sleep HR compare with up to 14 prior nights from the same provider and require at least three matching values. Average HR leads the single Overnight HR driver at 70%, minimum HR contributes 30%, and either can stand alone when the other is missing. Lower Overnight HR versus personal baseline supports readiness; missing evidence is never zero. Current normalized Suunto sleep records can provide both HR measures, COROS records can provide average HR, and Garmin Health sleep summaries currently provide neither normalized sleep-HR measure. **Readiness is recovery-aware; Form, Freshness, CTL, ATL, forecasts, and the Training state remain TSS-only.** An active imported post-workout estimate appears as **Recovery left** in the separate Recovery context; it never changes the score or Freshness. Readiness re-evaluates automatically when time alone makes a future record eligible, expires the latest night, or removes baseline evidence. Score, status, confidence, calculation time, driver freshness, and missing signals remain separate. Failed load or sleep reads are identified separately from missing evidence. Sleep already loaded before a listener failure remains visible only while eligible, with available load-only context afterward. Its short training implication is context, not a workout instruction.
- The **14-day trend** is a backend-derived daily series built with the same formula. A readiness-only refresh reuses the prepared Form snapshot and a bounded sleep envelope, without scanning activity history; each daily point applies its own 30-day sleep window. Each point uses only evidence available by that UTC day cutoff, and missing scores stay as gaps. Today's chart point follows the live current result only when the retained series reaches the current UTC day.
- **Recovery context** groups an active **Recovery left** estimate with expandable **Sleep history** inside Readiness today. The countdown includes its estimated local finish time and remains visible while sleep details are collapsed. Use **Show sleep details** and **Hide sleep details** to open or close the recorded-sleep comparison. Sleep history places recorded overnight sleep beside training without changing the Training state or claiming that sleep caused a performance change. It compares the current 28 days with the preceding 84 days. Every ready **Best build vs now** card separately keeps sleep where it directly compares the exact current and saved benchmark ranges, with full metrics and source notes under **Details**.
- Sleep history uses the longest valid main overnight record from each provider per sleep date; naps are excluded. Average sleep appears with at least three recorded nights, while bedtime variation and overnight HRV need at least five qualifying nights. Bedtime variation uses only nights with a trustworthy local timezone offset, including the offset retained on older Suunto sleep timestamps; a night without one can still contribute duration and HRV. Missing nights and missing HRV are never counted as zero. These 28/84-day and build comparisons do not create a readiness score. Readiness today can use a provider sleep score or recorded duration, but does not blend sleep stages, SpO₂, or respiration.
- Deltas require the same sleep provider in both windows and sufficient coverage in each: at least seven recorded nights and at least half of the window. When coverage is limited or providers differ, Training can show the available values but withholds change claims. This protects comparisons when a device was connected late or changed between builds.
- When a recent activity supplies a still-active device recovery estimate, Training shows it as **Recovery left** with the estimated local finish time. It updates each minute, is omitted quietly when missing or elapsed, is not a readiness score, and does not change the Training state.

## Training mix and swimming

- Training Mix compares the latest 28 days with a normalized 84-day baseline for each Training discipline. Missing TSS or zone evidence stays unavailable rather than being interpreted as zero.
- Swimming pace uses 12 UTC-aligned weeks and keeps pool and open-water evidence separate. It uses only stored **Average Swim Pace**, weighted by swimming distance; elapsed duration is never used to estimate pace because rests would distort it. The chart follows your /100 m or /100 yd setting.
- Pool SWOLF is shown only for stored active lengths that share the dominant stroke and pool-length context. SWOLF from different strokes or pool lengths is not comparable and is not blended. See [Garmin's SWOLF guidance](https://support.garmin.com/en-US/?faq=z7QHGpBDDH7wDJsSKjxRi9).
- Training does not infer Critical Swim Speed (CSS) from normal workouts. Reliable CSS requires deliberate maximal-distance trials, commonly 200 m and 400 m; see [Garmin's CSS protocol](https://support.garmin.com/en-US/?faq=h56ydwZxU8A7oi2OSh0y66) and the [critical-speed reliability evidence](https://pmc.ncbi.nlm.nih.gov/articles/PMC10875687/). Missing swim pace, active lengths, or comparable SWOLF remains explicitly unavailable.

## Evidence and missing data

- When a derived comparison is missing or rebuilding, Training says it is preparing rather than showing a zero-session result. A confirmed empty state means no eligible activity leg was found in the latest 28 days.
- **Durability** replaces the old aggregate efficiency trend on Training. Its Running, Cycling, Pool, and Open water tabs compare the current 28 days with the median of the prior three 28-day blocks, expose candidate and eligible activity coverage, preserve output and pool-length/stroke contexts, and show primary exclusion reasons. A context needs eligible evidence in at least two prior blocks before Training calls it usual. Each context also plots a readable 12-week durability trend: aerobic decoupling for Running, Cycling, and Open water, or pace retention for Pool. A Cycling Power Curve proves that power was recorded, but it does not by itself make the ride comparable durability evidence; cycling also needs paired heart rate, sufficient duration and coverage, steady output, and no more than 20% in zones 4–7. Cycling trajectory bars show power-recorded activities while their labels show eligible / power-recorded counts. Weeks without a comparable session explain their primary exclusions instead of being called simply empty, and lines never bridge those gaps. A lower output-to-heart-rate ratio later in one session can suggest a fade only when you intended a similarly steady effort; intentional easing, terrain changes, coasting, or a pace change can produce it too. Use repeated comparable sessions as a trend, and treat missing durability as no suitable comparison rather than zero. Evidence is generated when supported activities are processed; older activities that have not yet been reprocessed stay explicitly missing. Activity-level timelines remain on event detail pages and are not persisted in Training snapshots.
- **Body-weight trend** appears last on Training as secondary, neutral context from recorded persisted Weight values only. It reduces multiple measurements on one UTC day to a median, shows the latest value plus 7- and 28-day medians in your chosen units, and plots the latest 28 days without joining gaps. A 7- or 28-day change appears only when both equal-length windows have at least three recorded days. It is not a health assessment and does not change the Training state, Form, Readiness, or a workout recommendation.
- **Power systems** is shown only where it is available to your account. It estimates current CP, W′, and Pmax for each exact canonical activity type from its stored power curves. For a calculation date, it uses only that type's preceding 42 completed UTC days: the same day and all future workouts are excluded. The selector has no all-sports value, and Cycling is not pooled with Indoor Cycling, mountain biking, Rowing, or any other type.
- Power systems shows today plus sparse workout-date points from the latest 12 weeks. A value appears only when Sports-lib marks that component ready; partial, insufficient, poor-fit, unstable, and invalid evidence remains explicit instead of becoming zero. CP is the modeled sustained-power boundary, W′ is the modeled work capacity above CP, and Pmax is the modeled short-duration power ceiling. CP and W′ have separate stability decisions: stable CP can remain visible when W′ is unstable, while dependent Pmax stays unavailable. When W′ is withheld, **What this means** explains whether one workout supplied all retained sustained bests, whether removing it leaves no CP/W′ refit, the competing W′ estimate range, and why Pmax remains unavailable; that range is evidence of disagreement, not a reported W′ value. Diagnostics distinguish every usable power curve from the smaller set of workouts that actually supplied the retained sustained and short-duration envelope anchors, and show fitting-method disagreement, single-anchor removal, and whole-workout removal separately. A type selector appears only when more than one exact activity type is available. New power curves remove isolated one-sample recording artifacts before persistence; the fitter also rejects and counts their short-curve signature in older stored curves. This is capacity evidence—not TSS, FTP, fitness, fatigue, Readiness, or a workout prescription.
- Parsing a workout no longer generates CP, W′, Pmax, or power-system strain. Existing Training snapshots rebuild from stored power curves without reparsing source files. A future workout-strain phase would need the original continuous power stream because a power curve does not preserve the order of work and recovery; this release does not calculate or aggregate strain.
- Imported capacity markers remain separate from rolling power systems. **FTP setting** is the latest positive FTP imported with an eligible Running or Cycling activity; repeated carried values are deduplicated and shown with when that setting was first and last seen. A value that exactly matches the session-derived estimate of 95% of that activity's 20-minute best is not presented as an imported setting.
- **Imported VO₂ max** is a separate aerobic marker, never a readiness score. Training does not call it a lab result or compare it numerically with power thresholds unless the source provides that methodological provenance.
- Missing or unreliable inputs remain explicit. Training does not infer LT1/LT2, race readiness, a universal athlete score, or workout-execution scoring.
- Training power-profile callouts compare the best 90-day curve with the best one-year curve at 5 seconds, 1 minute, 5 minutes, 20 minutes, and 1 hour. They use bounded reciprocal-duration interpolation, never bridge duration brackets wider than 1.25×, show both activity counts, and call out the strongest retained duration and clearest gap. Missing comparable anchors stay explicit.`;

const ACTIVITY_CALENDAR_HELP_CONTENT = `## Open and navigate the calendar

- New dashboards start with a 1 x 1 **Activity Calendar** tile showing the current month. Select its open action to move to the full [Calendar](/calendar).
- The Dashboard and Training headers each include a **Calendar** action for opening the full [Calendar](/calendar).
- Existing editable dashboards that do not contain the Activity Calendar receive it once automatically. Use **Undo** on the notice, remove the tile, or use Dashboard manager **Remove all** to keep it from returning; adding it again manually restores it to the dashboard.
- The full Calendar has **Week**, **Month**, and **Year** views. The previous and next controls move by the selected view's period, and **Today** returns to the current period without taking a separate row on smaller screens.
- The selected view and date are kept in the URL, so refreshing or sharing the authenticated route preserves the same calendar position.

## Read activity days

- A circle's color identifies an activity group and its size reflects recorded duration. Larger circles mean more recorded time, using a bounded scale so unusually long activities do not dominate the grid.
- Week and Month views separate activity-group circles when space allows. Narrow layouts, the dashboard tile, and Year view place multiple circles concentrically around the same center so a day stays readable in a compact cell.
- Select a day with activity to open its details sheet. It shows the day's total duration, the same duration bars and available distance/ascent/descent totals by activity group, and individual activities with their available distance and elevation metrics.
- Calendar dates intentionally have no hover or touch tooltip. This keeps native vertical scrolling responsive on phones; day details remain available by selecting a date.

## Understand period totals and activity bars

- The summary above the full calendar shows recorded **Distance**, **Duration**, and **Ascent** for the selected week, month, or year. Month totals exclude adjacent dates shown only to complete the calendar grid.
- Below the calendar, **Activities** compares activity groups by recorded duration. Each bar uses the same color as its circles and is scaled against the longest-duration group in the selected period. The info control beside the heading explains this comparison.
- Available duration, distance, ascent, and descent totals appear with icons beneath each bar. A metric is omitted when no positive recorded value exists, and **--** beside an activity group means duration was not recorded.
- Lift-served downhill activities such as alpine skiing, snowboarding, and downhill cycling do not add ascent but do contribute descent. Ascent and descent summary exclusions configured in **Settings** also apply.

## Preferences and data scope

- Weekday order follows **Settings -> Dashboard -> Start of the Week**. The configured first day is identified in the header, and Saturday and Sunday remain identifiable as weekend days.
- Distance, ascent, and descent use the units selected in **Settings -> Units**.
- The full Calendar owns a visible-period activity query that is independent from the dashboard event table, custom-chart ranges, and map-tile filters. The dashboard tile independently loads its current-month window.
- Normal activity events are included. Merge and benchmark records are excluded so comparison artifacts do not create calendar days or inflate totals.`;

export const HELP_ACTIONS: HelpAction[] = [
  {
    id: 'email-support',
    label: 'Email Support',
    icon: 'email',
    kind: 'external',
    target: SUPPORT_MAILTO,
  },
  {
    id: 'report-bug',
    label: 'Report a Bug',
    icon: 'bug_report',
    kind: 'external',
    target: GITHUB_ISSUES_URL,
  },
  {
    id: 'release-notes',
    label: 'Release Notes',
    icon: 'campaign',
    kind: 'route',
    target: '/releases',
  },
  {
    id: 'policies',
    label: 'Policies',
    icon: 'policy',
    kind: 'route',
    target: '/policies',
  },
];

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'getting-started',
    icon: 'rocket_launch',
    title: 'Getting Started',
    summary: 'Sign in, pick a plan, and learn where key features and workflows live.',
    content: `## Start in three steps

1. Sign in with an email magic link, Google, or GitHub.
2. Complete onboarding and accept the required policies.
3. Start with manual uploads, or upgrade to Pro if you want service connections and history imports.

## Where things live

- **Dashboard** is your main activity overview.
- **Calendar** shows activities in Week, Month, and Year views. Open the [Activity Calendar guide](/help#activity-calendar) for display and summary details, or read the public [Activity Calendar overview](/features/activity-calendar).
- **Training** is your fixed workspace for baseline comparisons, current readiness signals, load trajectory, training mix, capacity evidence, durability, sleep, and power interpretation. Open the [Training analysis guide](/help#training-analysis) for the detailed product guide, read the public [Training Analysis overview](/features/training-analysis) for the search-facing summary, or use its **Feedback** action to email support with Training-specific feedback.
- **My Tracks** maps positional activities and supports date range, custom date, and activity type filters.
- **Services** is where you connect Garmin, Suunto, COROS, and Wahoo.
- **Settings** is where you manage profile details, consent options, charts, maps, and units.
- **Subscription** is where you review your current plan.
- **Release Notes** shows product updates and fixes.

## Good first workflow

- Upload a few files manually if you want to test the app before connecting services.
- Move to **Pro** when you need automatic integrations or history import tools.

## Core dashboard features

### Dashboard manager

- Use the **Dashboard manager** button above dashboard tiles to add or edit dashboard tiles.
- Dashboard manager supports two workflows: **Manual** and **Presets**.
- You can choose between **Curated**, **KPI**, **Custom**, and **Map** categories.
- **Presets** provide quick-start tile templates and can be applied in both **Add** and **Edit** modes.
- **Curated Recovery** remains a fixed insight and does not react to event table or custom tile date ranges.
- **Activity Calendar** is the default 1 x 1 dashboard tile. It shows the current month and opens the full [Calendar](/calendar). Existing editable dashboards that do not contain it receive it once automatically; **Undo** or removing it keeps it dismissed. The [Activity Calendar guide](/help#activity-calendar) explains its views, circles, summaries, and data scope.
- **Curated Form/TSS** computes from full history and does not react to event table or custom tile date ranges. Its **W / M / Y** view setting is saved on that dashboard tile.
- New curated charts: **Freshness Forecast**, **Intensity Distribution**, **Efficiency Trend**, **Cycling Power Curve**, and **Running Power Curve**.
- New dashboards start with the Activity Calendar tile. The optional Dashboard **Today** header begins with the same TSS-only **Training state** shown in Training, then shows current **Readiness** with its score, confidence, available-signal count, Load, Sleep, HRV, Overnight HR, and **Open Training** and **Calendar** actions. Use **Show Today summary** in Dashboard manager to show or hide it independently from chart and map tiles.
- **Training** remains the fixed analytical workspace. Dashboard tiles can reuse selected derived evidence without changing Training calculations or layout.
- Existing curated and KPI tiles are preserved until you edit or remove them in Dashboard manager.
- The **Today** header can show **Uploaded activities**, which counts current uploaded activity events.
- On mobile, Today rows stay compact while the chart/map grid stays unchanged below.
- The main dashboard groups chart and map tiles by intent, such as **Activity Overview**, **Routes & Maps**, and **Custom Charts**.
- Custom charts are placed in those dashboard sections automatically when their metric intent is obvious; otherwise they appear under **Custom Charts**.
- New dashboard tiles use chart-aware default sizes: Activity Calendar, simple custom totals, KPIs, and the clustered heatmap start at 1 x 1, while Form/TSS, Power Curve, and the Routes map start wider.
- Empty editable dashboards show lightweight section guidance until chart or map sections exist.
- KPI choices in Dashboard manager are grouped as **Load**, **Readiness**, and **Execution** for both manual and preset flows.
- **Aerobic Capacity** shows the latest imported running or cycling VO2 max and compares only observations from the same source. It does not substitute FTP or rolling CP/W′/Pmax capacity for VO2 max.
- **Aerobic Durability** shows the current persisted long-session context with the strongest sample evidence: aerobic decoupling for Running, Cycling, and Open water, or pace retention for Pool. Missing and ineligible activity evidence stays unavailable.
- Dashboard **Today** begins with the same compact **Training state** label and caption as Training. It uses current Form, ramp, CTL, and ATL only, so recorded sleep and imported recovery never change it; those are shown separately in Today Readiness.
- Today **Readiness** combines available current Form/ramp with the latest aggregated non-nap night from the last 48 hours. Its four drivers are Load (40%), Sleep (25%), HRV versus the same-provider baseline (20%), and one Overnight HR driver (15%). Overnight HR blends average sleep HR (70%) and minimum sleep HR (30%), bounds each ratio to 80–120% of baseline, and falls back to whichever measure is available. Lower average or minimum sleep HR supports the score only relative to that user's own same-provider baseline; it is not a universal medical judgment. Provider coverage follows the normalized sleep record: current Suunto records can provide average and minimum sleep HR, COROS records can provide average sleep HR, and Garmin Health sleep summaries currently do not populate these normalized sleep-HR measures. Missing drivers are excluded and the available weights are renormalized. **Freshness, Form, CTL, ATL, their forecasts, and Load Status remain TSS-only; only Readiness adds recorded sleep-recovery context.** An active imported estimate is displayed separately as **Recovery left**, with the same remaining duration and estimated local finish time as Training; it is never weighted into the score and disappears when elapsed. Current sleep evidence is independent of the Sleep chart's selected range or historical page, and score and evidence confidence stay separate.
- Curated and KPI tiles include an **info** icon beside the title with formulas, interpretation guidance, and KPI detail rows such as metric state, freshness date, source, and the signals behind the current label.
- On supported mobile devices, dashboard buttons and chart interactions provide lightweight haptic feedback.
- Haptics automatically fall back to no-op when vibration support is unavailable or reduced-motion is enabled.
- Event search filters only the dashboard event table.
- Event tags can be added from an event row or event details. The table supports an exact tag filter, and up to 250 selected events can receive atomic add/remove tag changes in bulk. Each event supports up to 10 tags of 32 characters; tags are visible on public event and comparison links.
- **Custom** charts use their own tile date-range and activity filters, with matching controls in Dashboard manager.
- If your account has no activities yet, the dashboard shows **No activities yet** with actions to **Upload activity** or **Connect service**. Uploads support FIT, GPX, TCX, JSON, and SML files; service connections support Garmin, Suunto, COROS, and Wahoo.
- Dashboard **Action prompts** are contextual setup cards shown above your dashboard when an account action needs attention after activity data exists.
- New users can choose a kilometers or miles preset from the dashboard **Default units** action prompt; choose **Advanced settings** there, or open **Settings -> Units**, to fine-tune individual unit preferences later.
- Pro users with activity data but without a connected activity service may see a one-time **Connect a service** action prompt; dismissing it hides the prompt permanently, and services can still be connected later from **Services**.
- Pro users with Suunto plus Garmin and/or COROS connected may see a **Send new activities to Suunto** action prompt when automatic activity sync is off. Turning it on affects new Garmin or COROS activities only; use **Sync past activities** in **Services** for activities already in Quantified Self. Dismissing the prompt hides it permanently.
- If Suunto disconnects server-side or stops accepting the stored token, the dashboard can show a **Reconnect Suunto** action prompt. Reconnecting restarts sleep sync, history imports, and upload tools. Automatic Garmin to Suunto and COROS to Suunto activity sync stays off until you turn it on again in **Services**; dismissing the card only hides the reminder.
- Distance values in dashboards, event charts, activity chips, and CSV exports follow your kilometers or miles preference from **Settings -> Units**; jump distances display in feet when miles are selected.
- **Map** tiles can use activity events or saved route previews as their source. Activity map tiles use their own tile date-range and activity filters, independent from the event table search; **Routes** map tiles show recent saved routes from lightweight route previews and do not use event filters.
- **Cycling Power Curve** and **Running Power Curve** are curated derived snapshots: each uses its own prepared date range, defaults to **1y**, and compares your best power per duration with either the latest activity or a saved recent-best comparison window. Power Curve tiles do not use activity subfilters or historical window navigation.
- Curated, KPI, form, recovery, sleep, and other derived tiles stay independent from event table filters and custom/map tile filters.
- Beyond the default Activity Calendar and its one-time addition to existing dashboards that lack it, the Dashboard does not automatically add sleep, KPI, curated training, or power-curve tiles. It can add a **Routes** map once saved routes have generated previews.
- Derived curated and KPI chart types are unique: only one tile per special derived chart type can exist at a time.
- Map tiles are unique per source: one activity map and one saved-routes map can exist at a time.
- Map style and cluster-marker settings are edited inside Dashboard manager.
- Default manager sizes are chart-aware: Activity Calendar, simple custom totals, KPIs, and the clustered heatmap start at 1 x 1, while Form/TSS, Power Curve, and the Routes map start wider.
- Dashboard manager bulk actions include **Reset to default**, which replaces the current dashboard tiles with a useful recommended set based on evidence in each tile's default window (90 days for activity-backed tiles, 14 days for Sleep, and the prepared 1-year Power Curve snapshots), plus route, capacity, and durability evidence; **Add everything**, which inserts every available preset including overlapping metrics; and **Remove all**, which hides the Today summary, clears every dashboard chart/map tile, and keeps automatic suggestions dismissed. Reset to default and Add everything restore the Today summary.

### Reorder dashboard tiles

- On desktop, drag dashboard tiles from the tile action area to reorder them.
- On mobile and touch devices, open any tile menu with the three-dot button.
- Use **Move earlier** or **Move later** when drag-and-drop is unavailable.
- Tile order is saved automatically to your account.

### Recovery tile summary

- The curated **Recovery** pie tile is optional and can be added from Dashboard manager presets or **Add everything**.
- The tile shows live recovery split between **Left now** and **Elapsed**.
- The summary shows **Recovery left**, plus **Active total** and **Latest workout** recovery context.
- Active totals only include currently active recovery windows, not all historical recovery values.
- Extremely large recovery values above 14 days are treated as outliers and ignored.
- Remaining recovery updates every minute while the tile is visible.
- While derived metrics are refreshing, the tile shows a recovery-specific **updating** message instead of generic no-data text.
- You can still move or remove this tile from the tile menu.

### Form tile (CTL / ATL / TSB)

- The tile derives daily load from **Training Stress Score**.
- Legacy **Power Training Stress Score** is used automatically when current TSS is missing.
- It shows current-day headline stats: **Current CTL**, **Current ATL**, and **Current TSB**.
- **Current TSB** is same-day readiness using same-day CTL - ATL.
- Form and RecoveryNow tiles use precomputed derived snapshots from your full history (UTC day buckets).
- Form/TSS trend lines keep full history and are explored with compact **W / M / Y** timeline buttons.
- The chart does not use slider or reload/reset toolbar controls.
- Form trend lines continue to **today** with zero-load decay after your latest workout.
- Headline **Current CTL / Current ATL / Current TSB** values reflect the current-day decayed state; **Latest workout TSS** stays anchored to your latest real workout.
- CTL, ATL, Form Now, and Ramp Rate use that same current UTC-day Form series, so their dates and values stay aligned across Dashboard and Training.
- CTL updates as **previous CTL + (today TSS - previous CTL) / 42**; ATL uses the same calculation with **/ 7**; TSB is **CTL - ATL**.
- Form/TSS uses adaptive render granularity by view: **W = daily points**, **M = weekly points**, **Y = monthly points**.
- While derived metrics are refreshing, the tile shows a training-metrics **updating** message instead of generic no-data text.
- When snapshots are missing or stale, they rebuild asynchronously; refresh usually follows within a few minutes.
- Opening the dashboard also runs a freshness check against your latest events and requeues a rebuild automatically if snapshots are behind.
- If rebuilding requests fail repeatedly, the dashboard shows a retry notification and continues with last known snapshot values.
- If a stale/building state is stuck for too long, the dashboard switches to a retryable failed state so you can trigger a rebuild immediately.
- While rebuilding, the dashboard uses the existing top summary-header slot for the derived-metrics status before **Today** and the tiles. This keeps the page in place while any available last completed values remain visible; a failed update adds **Retry** in that same header. The optional imported recovery snapshot affects this route-level status only when an active recovery estimate is visible in **Today** or when a Recovery tile is configured.
- The status title updates dynamically from current Form bands:
  - **High fatigue** at very negative Form values,
  - **Building fitness** while carrying meaningful load,
  - **Maintaining fitness** around neutral Form,
  - **Fresh** when Form is clearly positive.

### Derived KPI and curated charts

- **ACWR** uses acute 7-day load versus chronic 28-day load/4 and shows an 8-week sparkline.
- **Ramp Rate** uses CTL(today) - CTL(today-7d) with an 8-week sparkline.
- **Monotony / Strain** uses 7-day load mean/stddev for monotony, and load * monotony for strain.
- **Load Status** summarizes current training state from current TSB, CTL ramp, current CTL, and current ATL.
- KPI detail menus show the current metric state, the latest derived day or week used, and the input signals behind summary labels such as **Load Status** and **Training Balance**.
- KPI no-data guidance is metric-specific: efficiency asks for power plus heart-rate samples, intensity balance asks for power or heart-rate zones, and load/readiness KPIs ask for TSS-backed training load.
- **Form Now** uses current TSB from the same current-day Form series as CTL, ATL, and Ramp Rate.
- **Fitness (CTL)** uses current 42-day chronic training load from the derived Form model.
- **Fatigue (ATL)** uses current 7-day acute training load from the derived Form model.
- **Fitness Trend** shows recent CTL direction from the derived Form model.
- **Fatigue Trend** shows recent ATL direction from the derived Form model.
- **Recovery Debt** estimates zero-load days until current TSB returns to neutral.
- **Form +7d** projects current TSB at day +7 assuming zero load.
- **Training Balance** summarizes the latest weekly Easy/Moderate/Hard intensity mix.
- **Easy %** and **Hard %** use the latest weekly intensity distribution bucket.
- **Efficiency Δ (4w)** shows current efficiency versus the prior 4-week baseline as absolute + percent delta.
- **Freshness Forecast** projects 7 future days with zero load from the latest derived day. It is a TSS-only scenario, not a forecast of sleep or recovery.
- **Intensity Distribution** uses power zones when available, otherwise heart-rate zones, grouped to Easy/Moderate/Hard by week.
- Intensity Distribution headline percentages are labeled as **Current week**; when no current-week bucket exists they are labeled **Latest week**.
- **Efficiency Trend** uses weekly duration-weighted average of avgPower/avgHeartRate.
- **Cycling Power Curve** and **Running Power Curve** use a prepared PowerCurve snapshot to draw the best power envelope and a selectable comparison: latest activity, best last 30d, or best last 90d. Cycling and running power data stay in separate tiles.
- Intensity Distribution and Efficiency Trend include compact **8w / 12w / 6m / 1y / All** range selectors that only change the visible derived weekly history and are saved per dashboard tile.
- Training-derived tiles do not fall back to currently loaded dashboard events.

### Merge events

- In the dashboard event table, select at least two events and use the merge action.
- Merge requests support up to **10 events** at once.
- Selected events must still have original source file metadata available.
- **Benchmark merge** creates a merged event for benchmark workflows.
- **Multi activity merge** creates a standard merged event for regular multi-activity analysis.
- Retrying the same selected events with the same merge type reuses the same merged result instead of creating a duplicate.

### Benchmark workflows

- Merged rows show an analytics icon in the activity-type column.
- If a benchmark exists, that icon opens the saved report.
- If no benchmark exists yet, it opens the benchmark selection flow.
- Benchmark comparison uses exactly two activities, supports role swap, and can auto-align time.
- Benchmark reports can be rerun, shared, and saved as an image.
- The [File Comparison Tool](/tools/compare) requires sign-in before file selection, then creates one saved benchmark event from multiple FIT, GPX, or TCX files and opens event details with the benchmark report flow.
- Saved file comparisons are listed from [Tools -> Compare](/tools/compare/saved) in a sortable, filterable, paginated table with device, activity type, and review tag filters, selected-row bulk delete, distance, ascent, descent, visible benchmark pairs, GNSS/heart-rate/altitude benchmark error metrics colored by low/moderate/high error, clickable draft metric cells that open the benchmark flow, quick description notes, and custom reviewer tags for labeling firmware, sensor, route, or publication workflow groups.
- Benchmark reports show an **At a Glance** reviewer summary with the key pair, overall agreement, GNSS, heart-rate, altitude, quality, and saved tags. The report share menu can copy that summary for review notes.
- Reviewers can assign account-level device color preferences from saved file comparisons; colors are keyed by the base device name rather than firmware/software version and carry through activity toggles, event tables, benchmark dialogs, charts, and maps.
- The public [Features hub](/features) links to [Workout Data Comparison](/features/workout-data-comparison), [Workout File Comparison](/features/workout-file-comparison), [Workout File Analyzer](/features/fit-gpx-tcx-file-analyzer), [FIT and GPX Route Files](/features/fit-gpx-route-files), and [Sports Watch Benchmark](/features/sports-watch-benchmark) pages that explain how Garmin, Suunto, COROS, uploaded FIT/TCX/GPX/JSON/SML activity files, and saved FIT/GPX route files fit with benchmark reports, source files, maps, charts, overlays, and reviewer workflows for device tests, YouTube videos, and blog posts. Manual uploads, core analysis, and benchmark comparisons are available on the free plan for up to ${USAGE_LIMITS.free} activities and ${ROUTE_USAGE_LIMITS.free} saved routes; automatic provider sync and higher limits require a paid plan.

### Event jump tables

- Event details now include a **Jumps** table when selected activities contain jump events.
- The jump table appears in activity tabs and only shows columns with available data.
- Jump metrics use your preferred units from **Settings** when unit conversion is supported.

### Event lap tables

- Event details include a **Laps** table when selected activities contain lap data.
- To change it, open **Laps -> Columns**, choose Running, Cycling, Swimming, or Other activities, then tick the metrics you want to see. Use the typed metric search to quickly narrow long lists.
- Quantified Self remembers a separate column list for each of those sport families. A triathlon can therefore keep different running, cycling, and swimming lap layouts.
- Running and trail-running laps use pace, cycling laps use speed, and swimming laps use swim pace. These values, along with other convertible metrics, follow your unit preferences in **Settings -> Units**.
- Each lap table includes an **Avg** row directly below its headers, with averageable lap metrics in their matching columns and using those same units. Accumulated totals, such as duration, distance, elevation, energy, and work, are not averaged.
- Satellite diagnostics and EHPE/EVPE position-error metrics are intentionally left out of the column picker. Related Average, Minimum, and Maximum values are grouped under their shared metric name.
- The menu includes the Event Summary metric families, but a column appears only when a current lap has a valid value. Missing values stay unavailable rather than becoming zero.

### Event swim length tables

- Event details include a **Swim Lengths** table when selected swim activities contain per-length pool data.
- Swim lengths are grouped into collapsed sets through the next idle/rest length; expand a set to inspect each individual length row.
- Swim lengths appear in activity tabs and show lap index, split progress, duration, distance, length type, stroke, strokes, swim pace, cadence, heart rate, SWOLF, and energy when available.
- Active split progress is shown inside each expanded set, so a 25 m pool with a 100 m set displays 25 m, 50 m, 75 m, and 100 m splits before the rest row.
- Swim distance, pace, and energy values follow your preferred units from **Settings**.

### Event stamina metrics

- Event details can show **Stamina** and **Potential Stamina** when Garmin FIT or compatible Suunto imports include them.
- Stamina metrics appear in Detailed Statistics, in event summary metric tabs, and as selectable chart metrics from **Settings -> Charts**.
- Garmin session-level stamina values such as **Minimum Stamina**, **Beginning Potential Stamina**, and **Ending Potential Stamina** are shown when present.

### Event chart x-axis fallback

- In Event details, if selected indoor activities do not include distance data, the chart automatically falls back to a **Duration** x-axis.
- In that case, the **Distance** x-axis option stays visible but is disabled until a compatible activity selection is active.
- **Default chart metrics** in **Settings -> Charts** control which available charts are shown initially.
- The chart option **Include all recorded metrics** makes other chartable streams, such as Temperature, available in **Visible charts**. It does not change which charts are currently visible.
- Use **Visible charts** to show or hide individual charts, or **Show all charts** to display every available chart.
- When an event-chart zoom or selection is active, each chart panel shows a **Reset zoom or selection** button; using any one clears the shared chart state for the event.
- Each event chart panel can use the **Overlay** button to compare one other available metric on a shared y-axis when metrics are compatible, otherwise on a right-side y-axis; overlay choices are saved globally by primary metric, so **Heart Rate** can always request **Altitude** when both streams exist.
- Right-clicking an event chart copies a themed image of the full chart panel, including the chart title, legend, and range statistics.
- On phones, the **Durability** performance chart keeps its activity eligibility details collapsed by default; use the disclosure button beside the chart title to inspect them.
- **Durability** compares the usable first and second halves of a long, reasonably steady effort after warm-up and cool-down are excluded. For cycling, **matched power and heart-rate data** means both signals were recorded at the same moments; coverage tells you how much of the comparison was usable. An eligible result describes whether power relative to heart rate was lower, higher, or unchanged in the second half, then reports second-half output relative to the first and the average heart-rate change. Lower later power relative to heart rate can suggest more cardiovascular strain, but one ride is context rather than a fitness verdict.
- Swim activities with per-length pool data show a **Show Swim Lengths** chart option that overlays swim length end boundaries on the chart; active and idle/rest lengths are both included.
- When an overlay is active, the primary metric keeps its normal line and fill, while the overlay renders as a plain solid no-fill line using the overlay metric's series color. On merged and benchmark events, overlay legend and tooltip rows include both metric and activity labels.
- When Grade Smooth or Grade streams are available, **Altitude** charts can color the altitude line by grade; the chart option **Color Altitude by Grade** is on by default and can be turned off from Chart options.
- When provider heart-rate or power zone boundaries are available on non-merged events, the **Heart Rate** and **Power** charts color their lines and visible fill by zone.`,
    links: [
      { label: 'Login', icon: 'login', kind: 'route', target: '/login' },
      { label: 'Dashboard', icon: 'space_dashboard', kind: 'route', target: '/dashboard' },
      { label: 'Calendar', icon: 'calendar_month', kind: 'route', target: '/calendar' },
      { label: 'Activity Calendar guide', icon: 'school', kind: 'route', target: '/help', fragment: 'activity-calendar' },
      { label: 'Activity Calendar Overview', icon: 'travel_explore', kind: 'route', target: '/features/activity-calendar' },
      { label: 'Training', icon: 'monitoring', kind: 'route', target: '/training' },
      { label: 'Training analysis guide', icon: 'school', kind: 'route', target: '/help', fragment: 'training-analysis' },
      { label: 'Training Analysis Overview', icon: 'monitoring', kind: 'route', target: '/features/training-analysis' },
      { label: 'Membership', icon: 'card_membership', kind: 'route', target: '/pricing' },
      { label: 'Release Notes', icon: 'campaign', kind: 'route', target: '/releases' },
    ],
  },
  {
    id: 'activity-calendar',
    icon: 'calendar_month',
    title: 'Activity Calendar',
    summary: 'Use Week, Month, and Year views, duration-scaled activity circles, period totals, and activity-group comparisons.',
    content: ACTIVITY_CALENDAR_HELP_CONTENT,
    links: [
      { label: 'Open Calendar', icon: 'calendar_month', kind: 'route', target: '/calendar' },
      { label: 'Activity Calendar Overview', icon: 'travel_explore', kind: 'route', target: '/features/activity-calendar' },
      { label: 'Calendar Settings', icon: 'tune', kind: 'route', target: '/settings' },
    ],
  },
  {
    id: 'training-analysis',
    icon: 'monitoring',
    title: 'Training Analysis',
    summary: 'Understand current training status, readiness, historical benchmarks, sport detail, durability, and performance evidence.',
    content: TRAINING_ANALYSIS_HELP_CONTENT,
    links: [
      { label: 'Open Training', icon: 'monitoring', kind: 'route', target: '/training' },
      { label: 'Training Analysis Overview', icon: 'travel_explore', kind: 'route', target: '/features/training-analysis' },
      { label: 'Email Training Feedback', icon: 'email', kind: 'external', target: `${SUPPORT_MAILTO}?subject=Training%20feedback` },
    ],
  },
  {
    id: 'ai-insights',
    icon: 'auto_awesome',
    title: 'Assistant',
    summary: 'How grounded chat, evidence, quotas, short retention, and external MCP differ.',
    content: `## Access and quota

- The Assistant is available for **Free**, **Basic**, and **Pro** accounts.
- It is the zero-setup choice inside Quantified Self. You do not need to install an MCP client.
- The public [Quantified Self Assistant](/features/ai-insights) page explains the feature before sign-in.
- Request limits:
  - Free: up to **${ASSISTANT_REQUEST_LIMITS.free}** requests per calendar month
  - Basic: up to **${ASSISTANT_REQUEST_LIMITS.basic}** requests per billing period
  - Pro: up to **${ASSISTANT_REQUEST_LIMITS.pro}** requests per billing period
- The composer shows your live remaining allowance.
- A request consumes one allowance once grounded-answer processing begins. Loading or resetting the saved conversation does not.

## How chat works

- Ask a question and press **Send**. Press **Shift + Enter** for a new line.
- Starter prompts fill the composer; they do not send automatically.
- Ask follow-up questions in the same active conversation. The latest six completed turns provide bounded context.
- Every current answer must use at least one read-only Quantified Self result. Expand **grounded results** below an answer to inspect compact facts and app links produced from actual tool results.
- Use **New chat** to clear the stored messages and start a new conversation generation. An older in-flight answer cannot restore a cleared conversation.

## What the Assistant can read

- **Today and recovery:** daily report, current readiness, sleep duration and stages, aggregate/overnight HRV, sleeping heart rate, SpO2, respiration, and bounded sleep trends.
- **Training:** ready Training metric catalog, current values, Form, ramp, load, volume, intensity, current-versus-usual context, and missing or rebuilding states.
- **Measurements:** first-class measurement discovery and bounded history, including body weight when recorded.
- **Activities:** activity types, recent or bounded activity lists, activity metrics, rankings, laps, MTB jumps with coordinates redacted, and swim lengths.
- **Saved routes:** coordinate-free route names, activity types, bounded summary metrics and counts, and import or update times, filterable by sport, name, or recency. Route names can contain user- or provider-assigned place information.
- **Activity metrics:** one or several bounded aggregate metric queries through the canonical MCP metric catalog.

## Privacy boundaries

- The built-in Assistant can read coordinate-free saved-route summaries, but it has no access to coordinate fields, saved bounds, route geometry, waypoints, nearby-location search, raw chart streams, original files, write tools, or dashboard settings.
- Gemini receives your message, the browser's IANA timezone for local-day context, bounded recent conversation context, and the validated read-only tool results selected for the current question. Direct in-app URLs are withheld, and an answer that repeats an opaque reference or cursor is rejected. Raw FIT, TCX, GPX, JSON, and SML files are not sent.
- Evidence rendering removes opaque references, cursors, provider, device, source, owner, token, and identifier fields again before display.
- The Assistant is fitness information, not medical advice. Verify important health and Training decisions.

## Retention and control

- Quantified Self stores one active conversation per user, with at most the latest six completed turns.
- The active conversation becomes unavailable about **seven days** after its latest completed turn or reset. A response already in progress can protect an imminent expiry for at most four extra minutes. Firestore TTL then deletes the expired record asynchronously; account deletion removes it directly.
- Conversation documents are server-owned. Browser code cannot read or write them directly; it must use authenticated App Check callables.
- **New chat** immediately replaces the stored conversation and removes its prior message content.

## Built-in Assistant or external MCP?

- Use the **Assistant** for a zero-setup, app-funded conversation with the conservative coordinate-free tool set above.
- Use [Connections -> MCP](/services?serviceName=mcp) when you prefer ChatGPT or another compatible client, want separately approved location or route-geometry access, or want usage billed by that external client.
- External MCP calls do not consume the in-app Assistant allowance. External clients have their own privacy and retention practices.

## Troubleshooting quick checks

- **App verification failed**: refresh and retry.
- **Conversation changed**: another tab or New chat replaced the active conversation; reload and retry.
- **Another response is in progress**: wait for the current turn to finish. A stale turn lock expires automatically.
- **Quota reached**: wait for reset, upgrade, or use your own compatible AI client through MCP.
- **No data found**: ask which measurement, sleep vital, Training metric, activity type, or activity metric is available before assuming it is unsupported.
- For exact-location, nearby-search, route-geometry, or waypoint questions, use an external MCP client and explicitly approve the related permission.`,
    links: [
      { label: 'Assistant', icon: 'auto_awesome', kind: 'route', target: '/ai-insights' },
      { label: 'Assistant Overview', icon: 'travel_explore', kind: 'route', target: '/features/ai-insights' },
      {
        label: 'MCP Connections',
        icon: 'devices',
        kind: 'route',
        target: '/services',
        queryParams: { serviceName: 'mcp' },
      },
      { label: 'AI & Processors', icon: 'shield', kind: 'route', target: '/policies', fragment: POLICIES_AI_AND_PROCESSORS_FRAGMENT },
      { label: 'Membership', icon: 'card_membership', kind: 'route', target: '/pricing' },
      { label: 'Email Support', icon: 'email', kind: 'external', target: SUPPORT_MAILTO },
      { label: 'Release Notes', icon: 'campaign', kind: 'route', target: '/releases' },
    ],
  },
  {
    id: 'plans-and-billing',
    icon: 'card_membership',
    title: 'Plans & Billing',
    summary: 'Understand activity limits, Pro features, and what happens when a plan changes.',
    content: `## Current plan structure

### Starter (Free)

- Up to **${USAGE_LIMITS.free} activities**
- Up to **${ROUTE_USAGE_LIMITS.free} saved routes**
- Manual activity uploads (\`.fit\`, \`.gpx\`, \`.tcx\`, \`.json\`, \`.sml\`)
- Manual route uploads (\`.fit\`, \`.gpx\`)
- Core dashboard and event analysis tools
- Free read-only MCP connections

### Basic

- Everything in Starter
- Up to **${USAGE_LIMITS.basic.toLocaleString('en-US')} activities**
- Up to **${ROUTE_USAGE_LIMITS.basic} saved routes**
- **My Tracks (Beta)** access
- Paid-only profile customization such as custom chart watermark text

### Pro

- Everything in Basic
- **Unlimited activities**
- **Unlimited saved routes**
- Garmin, Suunto, COROS, and Wahoo integration workflows
- History import workflows (provider limits still apply)
- Suunto FIT activity upload and GPX/FIT route upload tools
- COROS FIT activity upload tool

## Feature access by area

- **Dashboard / event analysis:** Starter, Basic, Pro
- **My Tracks (Beta):** Basic, Pro
- **Connections page and read-only MCP:** Starter, Basic, Pro
- **Service connections and sync actions:** Pro (or active Pro grace period)
- **History imports:** Pro (or active Pro grace period)

## Billing basics

- Paid plans renew automatically until you cancel.
- You can manage billing from the subscription area.
- Cancellation takes effect at the end of the current billing period.
- When a paid plan has a trial configured, the public pricing page shows the exact trial length as an offer for eligible new members.
- Trial eligibility is confirmed after sign-in. Accounts with prior paid subscription history may not be eligible.
- Yearly paid plans appear automatically when active yearly Stripe prices are available.
- Yearly plans can show a **Save X% vs monthly** label based on the matching monthly price.
- If you start monthly, you can switch to yearly later from the billing portal.

## Downgrades and grace period

If you downgrade from a paid plan, the app keeps your access through the current billing period and then applies a **30-day grace period**.

After the grace period:

- Provider imports and automatic delivery stop, and an automated subscription check disconnects expired Pro connections.
- Any provider connection that is still shown can always be disconnected manually without upgrading.
- Existing activities and routes are retained. New uploads follow your current plan limits.

## When to contact support

Contact support if:

- your plan looks wrong,
- billing status does not refresh,
- or a previous subscription is not linked to the account you are currently using.`,
    links: [
      { label: 'Subscription', icon: 'credit_card', kind: 'route', target: '/subscriptions' },
      { label: 'My Tracks', icon: 'layers', kind: 'route', target: '/mytracks' },
      { label: 'Services', icon: 'sync', kind: 'route', target: '/services' },
      { label: 'Policies', icon: 'policy', kind: 'route', target: '/policies' },
      { label: 'Email Support', icon: 'email', kind: 'external', target: SUPPORT_MAILTO },
    ],
  },
  {
    id: 'uploads-and-imports',
    icon: 'upload_file',
    title: 'Uploads & Imports',
    summary: 'Manual uploads, file-validation guidance, exports, and reprocessing.',
    content: `## Manual uploads

The app accepts these file types for manual activity upload:

- \`.fit\`
- \`.gpx\`
- \`.tcx\`
- \`.json\`
- \`.sml\`

The public [Workout File Analyzer](/features/fit-gpx-tcx-file-analyzer) page explains how FIT, GPX, TCX, JSON, and SML activity uploads can be analyzed with maps, charts, statistics, exports, source-file context, and reprocessing. The public [Workout File Comparison](/features/workout-file-comparison) page explains how those files can be compared with provider activities and benchmark reports. The public [FIT and GPX Route Files](/features/fit-gpx-route-files) page explains saved FIT course and GPX route/track uploads, original-file retention, downloads, and route limits.

Saved routes open from **Routes** with the details action. Route details parse the original FIT or GPX file in memory to show the route summary, all segments, map, elevation and grade charts, waypoints and turn instructions, and original-file download. GPX files with route points, untimed tracks, or timed track geometry can be saved as routes from **Routes**. The original uploaded route file remains the canonical source; parsed points and streams are not saved back to Firestore. New or reprocessed saved routes store a lightweight encoded route preview for route-table thumbnails, the Routes page map, and dashboard route maps. The Routes page map follows the current table filters using saved-route documents only; it does not load activity events or parse original route files. Older saved routes need to be reprocessed before they appear with previews.

## Activity limits

- Manual uploads count toward your activity limit on limited plans.
- **Starter** and **Basic** have activity caps.
- **Pro** does not have an activity cap.

## Route limits

- Saved FIT and GPX route uploads count toward a separate route limit on limited plans.
- **Starter** includes up to **${ROUTE_USAGE_LIMITS.free} saved routes**.
- **Basic** includes up to **${ROUTE_USAGE_LIMITS.basic} saved routes**.
- **Pro** does not have a saved-route cap.

## Common upload issues

- Your session may have expired. Sign in again and retry.
- You may have reached your current plan's activity or route limit.
- The file may be invalid, unsupported, or unreadable by the importer.

## Export and backup options

- You can export dashboard activity tables to CSV.
- From selected dashboard rows, CSV export, GPX export, and original-file download actions support your current multi-selection.
- If an activity has positional data, you can download **GPX** from its action menu or export selected dashboard rows to GPX; multi-selected GPX exports download as a ZIP.
- If original source files are stored for an activity, you can download the original file or files.

## Reprocessing a single activity

From an activity action menu you can also:

- **Regenerate activity statistics**
- **Reimport activity from file** when original source files are available`,
    links: [
      { label: 'Workout File Comparison', icon: 'upload_file', kind: 'route', target: '/features/workout-file-comparison' },
      { label: 'Compare Files Tool', icon: 'compare_arrows', kind: 'route', target: '/tools/compare' },
      { label: 'Workout File Analyzer', icon: 'analytics', kind: 'route', target: '/features/fit-gpx-tcx-file-analyzer' },
      { label: 'FIT and GPX Route Files', icon: 'route', kind: 'route', target: '/features/fit-gpx-route-files' },
      { label: 'Sports Watch Benchmarks', icon: 'rate_review', kind: 'route', target: '/features/sports-watch-benchmark' },
      { label: 'Subscription', icon: 'credit_card', kind: 'route', target: '/subscriptions' },
      { label: 'Dashboard', icon: 'space_dashboard', kind: 'route', target: '/dashboard' },
      { label: 'Email Support', icon: 'email', kind: 'external', target: SUPPORT_MAILTO },
    ],
  },
  {
    id: 'service-connections',
    icon: 'sync',
    title: 'Connected Services',
    summary: 'Garmin, Suunto, COROS, and Wahoo connection rules, limits, and expected import behavior.',
    content: `## Pro requirement

Garmin, Suunto, COROS, and Wahoo connections are part of **Pro**.

The **Connections** page is available to every signed-in account. Starter and Basic accounts open on the free **MCP** tab by default and can select every provider tab to review its capabilities. Provider tabs are marked **PRO**, while MCP is marked **FREE**. Connecting a provider, importing history, uploading to a provider, and automatic sync still require Pro.

Services opens each provider on a compact connection overview. Choose an action on an activity, sleep history, route, upload, or automatic sync card. For non-Pro accounts, the action opens the Pro subscription page. For Pro accounts, it opens the provider tool in a dialog; close the dialog to return to the unchanged overview. A connected provider can always be disconnected after Pro access ends. Once any grace period expires, an automated subscription check disconnects remaining expired Pro provider connections.

At the top of Connections, **Your data flow** explains that connected providers import new activities into Quantified Self. Non-Pro accounts see a Pro upgrade explanation instead of an unusable connection prompt. Once two or more services are connected with Pro access, it shows a provider-to-provider matrix of compatible automatic activity and saved-route delivery paths through Quantified Self. On phones, the same routes are grouped by source and destination instead of using a wide table. Enabled routes show **On**, available routes remain opt-in, and a configured route that cannot run because a provider is disconnected or needs reconnection is marked **Needs connection**. With no services connected, it prompts a Pro account to connect its first provider.

## Integration pages overview

The public [Integrations hub](/integrations) links to focused [Garmin Integration](/integrations/garmin), [Suunto Integration](/integrations/suunto), [COROS Integration](/integrations/coros), and [Wahoo Integration](/integrations/wahoo) pages. They explain provider activity imports, activity sync to Suunto and Wahoo, direct GPX/FIT route delivery to Garmin, Suunto, and Wahoo, sending saved routes to Garmin Connect, syncing past activities, sending Suunto routes to Garmin or Wahoo, history imports, uploads, and how those workflows connect to the private training dashboard.

Provider-specific privacy details live on [Policies -> Connected Services](/policies#connected-services-data), with separate sections for [Garmin Data](/policies#garmin-data), [Suunto Data](/policies#suunto-data), [COROS Data](/policies#coros-data), [Wahoo Data](/policies#wahoo-data), and [AI & Third-Party Processing](/policies#ai-and-third-party-processing).

The public [Training Data Sync Guides](/guides) hub links to the [import activities to Suunto guide](/guides/import-activities-to-suunto), [import activities to Wahoo guide](/guides/import-activities-to-wahoo), [Garmin to Suunto sync guide](/guides/sync-garmin-to-suunto), [COROS to Suunto sync guide](/guides/sync-coros-to-suunto), [Wahoo to Suunto sync guide](/guides/sync-wahoo-to-suunto), [Suunto routes to Garmin courses guide](/guides/sync-suunto-routes-to-garmin-courses), and [centralized workout data guide](/guides/centralize-garmin-suunto-coros-workout-data) for step-by-step setup.

The public [Tools hub](/tools) links to the [File Comparison Tool](/tools/compare), which creates saved benchmark events directly from FIT, GPX, and TCX files.

The public [Features hub](/features) links to [Workout Data Comparison](/features/workout-data-comparison), [Workout File Comparison](/features/workout-file-comparison), [Workout File Analyzer](/features/fit-gpx-tcx-file-analyzer), [FIT and GPX Route Files](/features/fit-gpx-route-files), and [Sports Watch Benchmark](/features/sports-watch-benchmark) pages that explain how centralized Garmin, Suunto, COROS, uploaded FIT/TCX/GPX/JSON/SML activity files, and saved route-only FIT/GPX files support benchmark reports, metric overlays, maps, charts, source-file workflows, and reviewer workflows for device tests, YouTube videos, and blog posts. Manual uploads, core analysis, and benchmark comparisons are available on the free plan for up to ${USAGE_LIMITS.free} activities and ${ROUTE_USAGE_LIMITS.free} saved routes; automatic provider sync and higher limits require a paid plan.

## Sleep data

Sleep sync is server-owned health data. When available, Garmin, Suunto, and COROS sleep sessions are imported as separate source records and shown by the dashboard **Sleep** tile. The sleep chart has its own 14d, 30d, 90d, and 1y range control with older/newer paging, independent from dashboard event filters. It stacks sleep stages and overlays available vitals: recorded sleep HRV, average sleep heart rate, and minimum sleep heart rate with range-average reference lines, plus max SpO2 when the provider includes those values. Garmin, Suunto, and COROS Pro users can select **Sleep history** in Connections, then choose **Import Sleep History** from History Import; Garmin users may also see a one-time dashboard prompt. Suunto can import sleep from Jan 1, 2016 to today with a 7-day cooldown. Garmin can request sleep from Jan 1, 2016 to today, receives records asynchronously from Garmin, and uses a 30-day cooldown. COROS can import the available last three months in 30-day windows with a 7-day cooldown; the COROS API does not expose sleep stages.

## Suunto

Suunto tools currently include:

- connecting your account,
- syncing recent sleep samples,
- importing sleep history from Jan 1, 2016,
- importing history,
- automatically importing saved Suunto routes,
- importing existing Suunto routes,
- uploading FIT activities to Suunto,
- uploading GPX or FIT routes to Suunto.

Suunto FIT activity uploads in Services show each file's upload status, duplicate detection, failure message, and retry control. If Suunto has already issued an upload job when a temporary error occurs, retrying the same row checks that job first instead of immediately uploading the FIT again. A replacement is started only when Suunto explicitly reports that the earlier job is still empty. Large upload batches are processed one file at a time with short pauses between provider upload calls.

While your Suunto account is connected, Quantified Self also imports new and updated Suunto routes into **Routes** automatically. Services includes an **Import existing routes** action for first-time imports or after reconnecting. The **Routes** page can also show a one-time prompt to import existing Suunto routes.

Suunto users can turn on **Automatically send new and updated routes** in Suunto Services for Garmin or Wahoo. Garmin can also be enabled from a one-time **Routes** page prompt when both connections are ready. This sends newly imported or updated Suunto routes already saved in Quantified Self to the selected destination. For Garmin, it sends routes already saved in Quantified Self to Garmin as courses; Garmin must be connected with **Course Import** permission. Wahoo receives a FIT course and requires Wahoo route access. **Send routes** uses Suunto routes already saved in Quantified Self. For Garmin, it does not fetch routes from Suunto or Garmin; Wahoo delivery likewise operates only on the saved route. Wahoo route delivery uses a stable saved-route key, so an updated Suunto route replaces its earlier Wahoo route instead of creating a duplicate. If Wahoo was connected before route delivery was available, reconnect it once to grant route access.

Saved FIT and GPX routes can be sent to Suunto from **Routes** using a row action or the selected-row bulk toolbar. Quantified Self reparses each saved route from its original source file, generates a fresh GPX export, and uses the saved Quantified Self route name as the route name sent to Suunto. Suunto imports sent route files as new routes, so sending an edited route that was already sent to Suunto creates an updated copy in Suunto App. Routes imported from Suunto are not sent back to the same connected Suunto account, but they can still be sent to a different connected Suunto account when one exists. Bulk sends upload routes one at a time so partial failures can be reported without stopping successful routes.

**Uploads** in Suunto Services also accepts a selected GPX or FIT route without adding it to **Routes**. Suunto receives GPX, so Quantified Self converts a selected FIT route to GPX in memory before delivery. The direct upload does not create or retain a Quantified Self route.

See [Policies -> Suunto Data](/policies#suunto-data) for the provider-specific privacy summary for Suunto imports, sleep sync, route imports, and sending routes to Garmin.

## Garmin

Garmin history import has two important limits:

- one import request every **30 days**,
- and up to **5 years** of data per request.

Garmin can deliver imported activities gradually over hours or days.

Garmin sleep history import is separate from activity history import. It requests sleep through Garmin Health API and records appear later as Garmin sends sleep notifications.

If Garmin permissions are missing, reconnect the app and grant the required export, history, and health permissions in Garmin Connect.

Saved FIT and GPX routes can also be sent to Garmin Connect from **Routes**. Garmin must be connected with **Course Import** permission. If that permission is missing, Routes can show a Garmin permission prompt; open Garmin Connect, go to **Connected Apps**, allow Course Import for Quantified Self, and reconnect Garmin from Routes or **Services**. Quantified Self reads the original saved route file, uses the saved route name, and updates the same Garmin course when you send that route again to the same Garmin account.

**Uploads** in Garmin Services accepts selected GPX and FIT route files as well. Quantified Self parses either source format and creates a Garmin Connect course; this direct upload does not add the route to Quantified Self or retain Garmin delivery metadata, so uploading the same file again creates another Garmin course. Course Import permission is required.
See [Policies -> Garmin Data](/policies#garmin-data) for the provider-specific privacy summary for Garmin imports, sleep history, and Garmin to Suunto sync.

Garmin to Suunto activity sync requires:

- you must connect both Garmin and Suunto,
- turn on automatic activity sync in Garmin Services,
- and allow Activity Export in Garmin.

Disconnecting Garmin, COROS, or Suunto turns off related automatic activity sync. After reconnecting, turn it on again if you want automatic sync to resume.

If a provider revokes access, Quantified Self marks that connection as **Reconnect required** in Services and may also show a dashboard reconnect prompt. Reconnecting restores access; dismissing the prompt does not reconnect automatically.

Automatic sync runs only for newly imported Garmin activities and uses the stored original activity file from your event.

**Sync past activities** is available in Garmin Services: choose a date range to send Garmin activities already imported into Quantified Self to Suunto. It uses the original files already saved with those activities.

You can sync past activities while automatic activity sync is off. This does not turn on automatic sync for future imports.

When Garmin and Suunto are connected, the dashboard may offer a one-time action prompt to turn on automatic Garmin to Suunto activity sync. Dismissing the prompt hides it permanently; **Sync past activities** remains available in Services.

## COROS

COROS history import is limited to the last **3 months** because of API restrictions.

COROS tools currently include:

- connecting your account,
- automatically importing daily sleep summaries from a rolling recent window (sleep timing plus available average sleep HR, resting HR, and overnight HRV; the COROS API does not expose sleep stages),
- importing available COROS sleep history from the last three months in 30-day windows once every seven days,
- importing history,
- uploading FIT activities to COROS.

COROS FIT activity uploads in Services use the same per-file status, short provider upload pacing, and failed-file retry controls as Suunto uploads.

COROS to Suunto activity sync requires:

- you must connect both COROS and Suunto,
- turn on automatic activity sync in COROS Services,
- and keep both service connections active.

Automatic sync runs only for newly imported COROS activities and uses the stored original activity file from your event.

**Sync past activities** is available in COROS Services: choose a date range to send COROS activities already imported into Quantified Self to Suunto.

You can sync past activities while automatic activity sync is off. This does not turn on automatic sync for future imports.

When COROS and Suunto are connected, the dashboard may offer a one-time action prompt to turn on automatic COROS to Suunto activity sync. Dismissing the prompt hides it permanently; **Sync past activities** remains available in Services.

See [Policies -> COROS Data](/policies#coros-data) for the provider-specific privacy summary for COROS imports, sleep summaries, uploads, and COROS to Suunto sync.

## Wahoo

Wahoo is a **Pro** activity integration. Connect Wahoo from Services to:

- receive new completed Wahoo workouts automatically,
- import Wahoo workout history for a selected date range,
- retain the original FIT activity with the imported event for downloads, exports, and reprocessing,
- analyze Wahoo activities alongside your other activity sources,
- send a FIT activity file directly to Wahoo without creating a Quantified Self activity,
- send a GPX or FIT course or route file directly to Wahoo without creating a Quantified Self route,
- automatically send new Garmin, COROS, or Suunto activities to Wahoo,
- or choose a date range to send past Garmin, COROS, or Suunto activities already in Quantified Self to Wahoo,
- automatically send new and updated Suunto routes already saved in Quantified Self to Wahoo, or send those saved routes now,
- automatically send new Wahoo activities to Suunto, or choose a date range to send past retained Wahoo activities to Suunto.

Quantified Self imports only Wahoo records with an available FIT file. Workouts without a FIT file are skipped, as are workouts Wahoo identifies as originating from a third-party fitness application. History is returned newest first and is queued for background processing; large ranges may take time to appear.

Direct FIT activity delivery only sends the selected file to Wahoo. It does not create or retain an activity in Quantified Self. Wahoo may process an activity upload asynchronously; Services keeps the upload status available to refresh. If Wahoo has already issued an upload ID, retrying after a connection or status error checks that same upload instead of sending the FIT again. A fresh upload starts only after Wahoo explicitly reports that processing failed. If you connected Wahoo before activity sending was available, reconnect it once to grant workout write access.

Direct course/route delivery accepts GPX and FIT files. Quantified Self converts a selected GPX route to a FIT course in memory before sending it to Wahoo; the GPX must contain exactly one route with valid coordinates. It sends the route to Wahoo without creating or retaining a route in Quantified Self. If you connected Wahoo before route sending was available, reconnect it once to grant route access. When a route send reports missing Wahoo route access, select **Reconnect Wahoo** in the displayed dialog, then send the route again after you return. Routes imported by Wahoo's Cloud API sync to the Wahoo App and directly to an ELEMNT bike computer, not the ELEMNT App.

Wahoo to Suunto activity sync requires:

- you must connect both Wahoo and Suunto,
- turn on automatic activity sync in Wahoo Services,
- keep both service connections active,
- and use Wahoo activities with a retained original FIT file.

Automatic sync runs only for newly imported eligible Wahoo activities. **Sync past activities** in Wahoo Services sends retained Wahoo FIT activities from the date range you choose to Suunto. You can sync past activities while automatic activity sync is off; this does not turn on automatic sync for future Wahoo imports.

Disconnecting Wahoo revokes future access and stops new imports and deliveries. It does **not** delete activities already imported into Quantified Self. Delete individual activities yourself, or delete the account to remove all associated data. Wahoo-to-Suunto is the only Wahoo-origin provider-to-provider activity route in this release. Suunto-to-Wahoo saved-route delivery is a separate, opt-in route workflow in Suunto Services; direct Wahoo GPX/FIT course/route delivery is a separate, user-selected Wahoo-only upload. Sleep sync, plans, and other Wahoo forwarding are not supported.

See [Policies -> Wahoo Data](/policies#wahoo-data) for the provider-specific privacy and retention summary.

## Queue behavior

Suunto, COROS, and Wahoo history imports are queued jobs. Large ranges can take hours or days to finish, depending on volume and queue load.`,
    links: [
      { label: 'Integrations', icon: 'hub', kind: 'route', target: '/integrations' },
      { label: 'Features', icon: 'dashboard_customize', kind: 'route', target: '/features' },
      { label: 'Training Guides', icon: 'menu_book', kind: 'route', target: '/guides' },
      { label: 'Workout Data Comparison', icon: 'compare_arrows', kind: 'route', target: '/features/workout-data-comparison' },
      { label: 'Compare Files Tool', icon: 'compare_arrows', kind: 'route', target: '/tools/compare' },
      { label: 'Workout File Analyzer', icon: 'analytics', kind: 'route', target: '/features/fit-gpx-tcx-file-analyzer' },
      { label: 'FIT and GPX Route Files', icon: 'route', kind: 'route', target: '/features/fit-gpx-route-files' },
      { label: 'Import Activities to Suunto', icon: 'upload_file', kind: 'route', target: '/guides/import-activities-to-suunto' },
      { label: 'Import Activities to Wahoo', icon: 'upload_file', kind: 'route', target: '/guides/import-activities-to-wahoo' },
      { label: 'Garmin to Suunto Guide', icon: 'sync_alt', kind: 'route', target: '/guides/sync-garmin-to-suunto' },
      { label: 'COROS to Suunto Guide', icon: 'published_with_changes', kind: 'route', target: '/guides/sync-coros-to-suunto' },
      { label: 'Wahoo to Suunto Guide', icon: 'directions_bike', kind: 'route', target: '/guides/sync-wahoo-to-suunto' },
      { label: 'Suunto Routes to Garmin Guide', icon: 'route', kind: 'route', target: '/guides/sync-suunto-routes-to-garmin-courses' },
      { label: 'Centralize Workout Data', icon: 'hub', kind: 'route', target: '/guides/centralize-garmin-suunto-coros-workout-data' },
      { label: 'Garmin Integration', icon: 'sync_alt', kind: 'route', target: '/integrations/garmin' },
      { label: 'Suunto Integration', icon: 'published_with_changes', kind: 'route', target: '/integrations/suunto' },
      { label: 'COROS Integration', icon: 'sync', kind: 'route', target: '/integrations/coros' },
      { label: 'Wahoo Integration', icon: 'directions_bike', kind: 'route', target: '/integrations/wahoo' },
      { label: 'Connected Service Privacy', icon: 'policy', kind: 'route', target: '/policies', fragment: POLICIES_CONNECTED_SERVICES_FRAGMENT },
      { label: 'Garmin Data Privacy', icon: 'policy', kind: 'route', target: '/policies', fragment: POLICIES_GARMIN_DATA_FRAGMENT },
      { label: 'Suunto Data Privacy', icon: 'policy', kind: 'route', target: '/policies', fragment: POLICIES_SUUNTO_DATA_FRAGMENT },
      { label: 'COROS Data Privacy', icon: 'policy', kind: 'route', target: '/policies', fragment: POLICIES_COROS_DATA_FRAGMENT },
      { label: 'Wahoo Data Privacy', icon: 'policy', kind: 'route', target: '/policies', fragment: POLICIES_WAHOO_DATA_FRAGMENT },
      { label: 'AI & Processors', icon: 'shield', kind: 'route', target: '/policies', fragment: POLICIES_AI_AND_PROCESSORS_FRAGMENT },
      { label: 'Services', icon: 'sync', kind: 'route', target: '/services' },
      { label: 'Subscription', icon: 'credit_card', kind: 'route', target: '/subscriptions' },
      { label: 'Email Support', icon: 'email', kind: 'external', target: SUPPORT_MAILTO },
    ],
  },
  {
    id: 'data-and-privacy',
    icon: 'shield',
    title: 'Data & Privacy',
    summary: 'Manage analytics consent, account deletion, and privacy-related requests.',
    content: `## Privacy controls

- Profile and activity visibility is managed by the platform and is not configurable in the app UI.
- Event and saved comparison sharing is manual. Use **Share link** on an event or saved comparison to create a public URL.
- Public links expose the shared event, its activities, any saved benchmark report, and every object stored under that event's source-file folder (\`users/{uid}/events/{eventId}/...\`) while sharing is enabled.
- Public links do not expire automatically and are marked noindex, but anyone with the URL can open them.
- Use **Stop sharing** from the event details menu or saved comparison row to make the event, activities, and event source-file folder private again.
- Anonymous viewers are read-only. They can open an existing saved benchmark report from a comparison link, but they cannot generate or save new reports.
- The built-in Assistant sends Gemini your message, bounded recent conversation context, and only the validated read-only Quantified Self results selected for that question.
- The Assistant can send Gemini coordinate-free saved-route summaries selected for a question, including route names that may contain place information. It cannot access or send raw activity or route files, coordinate fields, saved bounds, route geometry, waypoints, write tools, or dashboard settings. Its server-owned conversation keeps at most six completed turns, becomes unavailable about seven days after the latest completed turn or reset (with at most four extra minutes for a response already in progress), and is then deleted asynchronously by Firestore TTL.
- The Policies page includes provider-specific sections for [Garmin Data](/policies#garmin-data), [Suunto Data](/policies#suunto-data), [COROS Data](/policies#coros-data), [Wahoo Data](/policies#wahoo-data), and [AI & Third-Party Processing](/policies#ai-and-third-party-processing).
- The dedicated [Privacy Policy](/privacy) and [Terms of Service](/terms) pages are public and readable without signing in.

## Settings you can change yourself

In Settings you can:

- turn anonymous usage statistics on or off,
- turn marketing emails on or off,
- and customize charts, maps, and units.

Review and revoke authorized MCP clients under [**Connections -> MCP**](/services?serviceName=mcp).

## MCP client access

- An MCP client can read data only after you sign in and approve its requested permissions. **Activity and Training metrics**, **Body measurements**, **Individual activity details**, **Activity locations**, **Sleep summaries**, **Saved-route summaries**, and **Saved-route locations and geometry** are separate, optional read-only permissions. Activity locations require activity details; saved-route locations require saved-route summaries. Removing a parent permission also removes its location permission.
- Metric access covers persisted numeric activity metrics and ready Training-derived snapshots. Clients can compare up to four activity metrics over one bounded range and can first check the human-readable Training metric catalog to distinguish ready, rebuilding, stale, missing, and incompatible snapshots. When individual activity detail access is also granted, a client can inspect which metrics, laps, jumps, swim lengths, and chart streams are available for one referenced activity, request up to 25 explicitly selected canonical numeric Sports Lib metrics, or rank activities by one metric over a bounded range. These paths do not add a separate stored metric catalog. Precise latitude/longitude and first-class body-measurement metrics are excluded, and Training event/activity IDs, names, labels, source fingerprints, and imported device/provider source keys are removed.
- Body-measurement access covers first-class body-measurement history. Body-weight history is available for bounded ranges up to 366 days as identity-free day, week, or month values using median, average, minimum, maximum, or latest aggregation. It contains recorded measurements only and is not a medical or health assessment. It excludes exact source measurement timestamps, event/activity identity, names, provider/device metadata, and source provenance.
- Any authorized MCP client can discover canonical Sports Lib activity types for filters; that static catalog contains no account data. Individual activity detail access covers non-location summaries, laps, swim lengths, MTB jump measurements, signed-in app links, selected persisted numeric metrics, and bounded chart-ready heart-rate, power, cadence, altitude, grade, distance, speed, and activity-appropriate pace streams. Clients can filter newest-first activity scans by one or more types and request **today** or **yesterday** in an explicit IANA timezone. Bounded pages report scan completion so a client can distinguish a complete no-match result from older history that remains to be checked. Chart streams are parsed temporarily from an existing FIT, GPX, TCX, Suunto JSON/SML, or gzip original file, downsampled over the complete activity, and discarded without a reparse, backfill, cache, or additional activity storage. Historical chart access therefore depends on the original file still being available and within the documented limits.
- Activity location access separately covers exact activity start/end coordinates, nearby activity searches, MTB jump coordinates, and bounded breadcrumb traces returned with a chart. Without it, summaries and jump measurements remain available with coordinates omitted. Exact activity locations can reveal your home, workplace, frequent trailhead, or other sensitive places.
- Sleep access covers normalized session summaries, day/week/month aggregates, bounded discovery of recorded safe aggregate vital types, and a one-call sleep trend that combines coverage with duration, score, stages, HRV, heart-rate, blood-oxygen, and respiration values for the requested period. These sleep tools share the same normalized projection and aggregation path, and a missing vital remains unavailable rather than becoming zero. Raw samples remain excluded, and the result cannot diagnose illness. When you also grant **Activity and Training metrics**, a client can request the same live UTC-day Readiness used by Dashboard Today: current Form/ramp plus the latest eligible sleep score, safe aggregate HRV and overnight-heart-rate values, same-provider baseline medians, ratios, evidence counts, and explicit missing or insufficient-baseline states. The IANA timezone supplies local-day context while Readiness remains UTC-day based. The preferred daily report returns the latest completed non-nap sleep with recorded average/overnight HRV and average/minimum sleep heart rate, a same-provider duration comparison, live Readiness, and current-versus-usual equivalent 28-day Training totals and Running/Cycling/Swimming mix. It keeps the Readiness explanation brief. The older compact briefing remains physiology-free for compatibility. These projections exclude provider identity, provider user/session IDs, provider payloads, raw sleep-stage intervals, score components, raw HRV samples, SpO2 and respiration samples, locations, activities, body measurements, workout plans, and medical advice.
- Saved-route summary access covers route names, activity types, bounded metrics and route/waypoint/point counts, import/update times, and signed-in app links. Clients can filter bounded newest-first scans by canonical Sports Lib activity type or a case-insensitive part of the route name, and scan completion distinguishes a complete no-match from older history. It omits exact bounds and reports that location was redacted.
- Saved-route location access separately covers exact bounds, simplified preview geometry and segment endpoints, nearby route searches, and waypoint coordinates, altitude, and distance. Existing clients retain non-location route summaries but must reconnect and approve the new location permission to regain coordinate-bearing route tools.
- Original files, full-resolution recordings, absolute per-sample timestamps, raw unrequested streams, internal IDs, source keys, provider/device provenance, parser extensions, and Storage paths are never returned. Activity and saved-route location grants are independent: granting one never exposes the other.
- Nearby MCP searches accept either direct latitude/longitude or a place name such as a city. Direct coordinates are processed inside Quantified Self. For place names, Quantified Self sends only the location text to Mapbox for forward geocoding; it does not send activity, route, account, or prompt data to Mapbox for this lookup.
- Only clients that finish authorization appear in [**Connections -> MCP**](/services?serviceName=mcp). Authorizing the same verified MCP client again keeps its current grant usable until the new code exchange succeeds; successful reauthorization replaces the previous permissions and credentials instead of creating another logical connection. Failed or abandoned authorization attempts do not replace an existing grant, are not active connections, and their codes expire automatically. Some clients can notify Quantified Self through standard server-to-server token revocation, but they may not do so when removed or uninstalled. **Disconnect** in Connections remains the authoritative control: it invalidates the current grant and any older duplicate records for that verified client without affecting your other MCP clients. The external client may retain data it already received under its own policy.
- See the [Read-only MCP Server feature page](/features/mcp-server) for a public overview of the available data categories and access boundaries.
- See [Policies -> MCP Client Access](/policies#mcp-clients) for the complete disclosure.

## Use with ChatGPT

1. In ChatGPT on the web, turn on Developer mode and create a custom app.
2. Use the Quantified Self MCP endpoint: **https://quantified-self.io/mcp**.
3. Let ChatGPT scan the available tools, then sign in to Quantified Self and approve the read-only permissions you want to grant.
4. Start a new chat, select the Quantified Self app, and ask about activity metrics, body-weight history or trends, your latest run, today’s or yesterday’s workouts, activity charts, sleep summaries or HRV trends, today’s Readiness drivers, or a daily report with sleep HRV and sleep heart rate for your IANA timezone when you granted both metrics and sleep access, saved routes, or—if you granted the matching location permission—activities that started or ended near a place and routes that pass near a place.
5. If ChatGPT asks for an app icon, download the recommended [256 x 256 PNG (9.4 KB)](/assets/favicons/quantified-self-chatgpt-icon-256x256.png). It meets ChatGPT's preferred minimum dimensions and stays under its current 10 KB upload limit. MCP clients that render server metadata can discover an icon automatically.

### Android authorization handoff

Desktop setup is the most reliable option. After approval in an Android browser, Android may open the client return address in the installed ChatGPT app. If ChatGPT opens but does not continue the custom-app setup, the authorization code is not exchanged and no active MCP connection appears.

Retry from ChatGPT on the web using a desktop. As an Android workaround, temporarily turn off **Open supported links** for ChatGPT under the app's **Open by default** or **Set as default** settings, retry the entire browser authorization flow, and restore the setting afterward. Quantified Self must return to the exact address supplied by ChatGPT and cannot force Android or the ChatGPT app to handle that address differently.

You can copy the endpoint and manage connected clients in [**Connections -> MCP**](/services?serviceName=mcp). ChatGPT is an external client, so authorize only the data you are comfortable sharing and review its own data-retention policy.

## Account deletion

You can delete your account from **Settings -> Account -> Danger Zone**.

If your account has an email address, self-deletion sends a confirmation email after the request completes.

Deleting your account permanently removes:

- activities and fitness data,
- settings and profile data,
- connected services,
- uploaded files,
- and any active subscription.

This action cannot be undone.

## Exports and legal requests

- Use CSV export and per-activity downloads for day-to-day backups.
- For privacy or GDPR-related requests, contact **privacy@quantified-self.io**.
- Legal details live on the Policies page.`,
    links: [
      { label: 'Settings', icon: 'settings', kind: 'route', target: '/settings' },
      {
        label: 'MCP Connections',
        icon: 'devices',
        kind: 'route',
        target: '/services',
        queryParams: { serviceName: 'mcp' },
      },
      { label: 'Privacy Policy', icon: 'lock_outline', kind: 'route', target: '/privacy' },
      { label: 'Terms of Service', icon: 'gavel', kind: 'route', target: '/terms' },
      { label: 'Policies', icon: 'policy', kind: 'route', target: '/policies' },
      { label: 'Garmin Data Privacy', icon: 'policy', kind: 'route', target: '/policies', fragment: POLICIES_GARMIN_DATA_FRAGMENT },
      { label: 'Suunto Data Privacy', icon: 'policy', kind: 'route', target: '/policies', fragment: POLICIES_SUUNTO_DATA_FRAGMENT },
      { label: 'COROS Data Privacy', icon: 'policy', kind: 'route', target: '/policies', fragment: POLICIES_COROS_DATA_FRAGMENT },
      { label: 'MCP Server', icon: 'devices', kind: 'route', target: '/features/mcp-server' },
      { label: 'MCP Client Access', icon: 'devices', kind: 'route', target: '/policies', fragment: POLICIES_MCP_CLIENTS_FRAGMENT },
      { label: 'AI & Processors', icon: 'shield', kind: 'route', target: '/policies', fragment: POLICIES_AI_AND_PROCESSORS_FRAGMENT },
      { label: 'Privacy Email', icon: 'shield', kind: 'external', target: PRIVACY_MAILTO },
    ],
  },
  {
    id: 'troubleshooting',
    icon: 'build_circle',
    title: 'Troubleshooting',
    summary: 'Fast checks for sign-in issues, slow imports, permissions, and browser problems.',
    content: `## Sign-in issues

- Check spam or junk if the magic link email does not arrive.
- Make sure you are opening the link for the same email address you entered.
- If one sign-in method does not match your existing account, try the provider you originally used.

## Imports taking longer than expected

- Garmin history imports can arrive gradually.
- Suunto and COROS imports run in the background and can take hours or days.
- Check cooldowns and connection status before retrying.
- If Services shows **Reconnect required**, reconnect that provider before retrying imports or sleep sync.

## Merge and benchmark checks

- Merge requires at least two selected events.
- Merge requests are limited to 10 events at a time.
- If merge fails because source files are missing, select events that still have their original uploaded files.
- If merge fails due to identical source files, remove duplicate events/files from the selection and retry.
- If merge fails at plan limits, free space or upgrade your plan before retrying.
- If the app says a merge may still be finishing, wait a moment and refresh the event list. The selected rows remain selected, and retrying the same selection and merge type safely reuses any existing result.
- Benchmark comparison requires exactly two activities for the selected pair.

## Browser compatibility

Some upload and compression behavior depends on modern browser features. If the app reports that your browser does not support a required feature, update your browser and try again.

## What to include when contacting support

Send these if possible:

- the account email you use in Quantified Self,
- which service or page failed,
- when the issue happened,
- a screenshot,
- and an event link or event ID if the problem is tied to one activity.`,
    links: [
      { label: 'Email Support', icon: 'email', kind: 'external', target: SUPPORT_MAILTO },
      { label: 'Report a Bug', icon: 'bug_report', kind: 'external', target: GITHUB_ISSUES_URL },
      { label: 'Release Notes', icon: 'campaign', kind: 'route', target: '/releases' },
    ],
  },
];
