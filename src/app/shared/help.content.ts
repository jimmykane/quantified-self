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
  | 'supported-activities'
  | 'activity-calendar'
  | 'health'
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

const HEALTH_WORKSPACE_HELP_CONTENT = `## What Health is for

- **Health (Beta)** is the authenticated workspace for source-attributed Sleep, heart rate, HRV, movement, energy, wellness, body, and fitness measurements imported from supported connected services. Its in-app entry points are temporarily staged to selected accounts; the plan and connection requirements for importing provider history do not change.
- Eligible beta accounts can open it from the main navigation or use **Open Health** beside **Open Training** on Dashboard. Health is a fixed workspace, not a configurable dashboard tile.
- The first cards always show **Sleep**, **Heart rate**, then **HRV** for the latest 30 days. Each connected source gets its own row. Health never creates a cross-provider headline average or saves a preferred source.

## Explore a metric

- Health opens on **Resting heart rate · 30d** when that metric is available. The explorer shows only metrics found anywhere in your imported history, regardless of the currently selected date window; Sleep appears when a normalized Sleep session exists. Health and Sleep availability are checked independently. If either check fails, only that domain stays unfiltered rather than risking hidden valid data. Use **Today**, **14d**, **30d**, **90d**, or **1y** and the older/newer controls. Your range is saved to your account without adding URL query parameters. The selected metric and older/newer position remain local to the open workspace and reset when you return later.
- Detailed sample streams load for Today, 14-day, and 30-day windows. Longer windows use stored summary observations. If a metric exists only as samples, Health asks you to choose a shorter range instead of showing an empty or misleading aggregate. Today shows available intra-day samples and daily summaries; it does not imply that every metric is continuous. Provider support and delivery cadence determine whether a metric is continuous, intermittent, or summary-only.
- Totals use bars, scalar readings use lines or points, and categorical states use stepped series. Every provider, connected account, aggregation, semantic variant, origin, recording method, and unit stays in a separate series. Provider-native or non-comparable readings are labeled and isolated from canonical readings.
- Use the local source filters to focus on one or more providers. Filters are not saved as a preferred source. When one provider has multiple connected accounts, Health shows local labels such as **Garmin account 1** instead of an account identifier.

## Read source quality and status

- Series show device attribution when supplied, coverage, and freshness. Partial coverage, superseded sample revisions, conflicts, and bounded-load limits are stated explicitly. A conflict means comparable source observations disagree; both readings remain visible.
- Expand **Source observations** for the accessible table. It lists source, device, reading, semantics, coverage, freshness, and conflict state without displaying opaque account keys.
- **Sleep** continues to use the normalized Sleep model and existing Sleep trend. Health resolves typed references to those sessions rather than copying Sleep values into another model.
- The compact source footer shows each provider's recency. For an eligible connected Pro source with verified sync state and no previous Sleep or Health history request, **Import history** starts the provider's existing bounded history workflow. Prior and cooldown-bound requests suppress the action; failed requests can be retried, and Garmin also reports its granular queued and running Health progress. If history permissions are missing or the prior-import state cannot be verified, use **Connectivity** instead.
- Loading, empty, permission, reconnect, failure, disconnected, and unsupported states link to **Connectivity** when an account action is available. Disconnecting stops future imports but keeps existing Health history; deleting your Quantified Self account removes user-scoped Health records, samples, sync state, and Sleep sessions as described in Policies.`;

const TRAINING_ANALYSIS_HELP_CONTENT = `## What Training is for

- **Training** is a fixed analytical workspace rather than a set of draggable dashboard tiles. Its **Data through** date identifies the UTC day covered by the derived 28-day analysis, rather than your device clock. It opens on **All training**, where the global **28-day status**, **Readiness today**, **What drove this**, **Load trajectory**, overall **Training mix**, and body-weight context stay together. Switch to one sport for **Best build vs now**, detailed Training Mix, **Power systems**, **Durability**, and other capability-matched evidence without changing any calculation.
- While visible Training snapshots are building or refreshing, the compact line above the **Training** title shows that state before any analytical values. It uses the existing header space, so content does not shift when the state changes. Any available last completed values stay visible during a refresh; a failed update adds **Retry** there. The optional imported recovery snapshot affects this route-level status only while an active **Recovery left** estimate is visible.
- Use **All sports** on desktop to switch between **All training** and Running, Cycling, Swimming, Rowing, Walking & Hiking, Nordic Skiing, Strength, or Paddling. On mobile, **All** and your compact swipeable sport buttons switch the common views in one tap; the compact **All sports** arrow button opens every sport with the current view marked, and **Manage sport shortcuts** moves shortcut editing into that same picker. Your last destination is saved to your account, not the URL. **Shortcuts** pins up to four sports for faster desktop and mobile switching; every sport remains in the complete picker. Until you save shortcuts, Training ranks them automatically from training duration and workouts in the latest 28 days, with saved sport benchmarks as fallback evidence. Existing buttons keep their places while refreshed sport evidence arrives, so the selected shortcut does not jump along the row. A fixed shortcut choice remains until you change it, and **Use automatic selection** restores automatic behavior. Shortcuts change navigation only and never hide a sport from totals or the complete picker.

## Sports and multisport activities

- Running keeps road, trail, treadmill, indoor, and virtual contexts separate where that changes the available summary. Cycling includes road, indoor, virtual, e-bike, hand cycle, velomobile, standard mountain biking, Enduro MTB, and Downhill MTB. Swimming separates pool and open water. Rowing separates indoor and on-water sessions. Walking & Hiking includes Walking, Nordic Walking, Hiking, and Trekking. Nordic Skiing includes cross-country, Nordic, and roller skiing. Strength includes Strength Training, Weight Training, and Kettlebell. Paddling includes Canoeing, Kayaking, Paddling, and Stand Up Paddling. Nearby but unlisted sports such as CrossFit, ski touring, snowshoeing, surfing, and sailing remain Other rather than being guessed into a family.
- Multisport files are evaluated one activity leg at a time. A triathlon can therefore add separate Running, Cycling, and Swimming workouts; other registered legs behave the same way. The parent event itself is not counted as an extra workout. Merged events and activities without an eligible parent event are excluded.
- Standard Mountain Biking uses the normal Cycling endurance analysis. Enduro and Downhill stay within Cycling but use gravity-aware volume summaries: Training shows reliable recorded values such as time, distance, ascent/descent, descent time, jump count, the longest recorded jump, grit, or flow when present. Longest jump is the maximum persisted jump distance across the comparison window, not a sum or average. It does not invent downhill runs or uplift/lift segments, does not interpret zones or TSS as gravity-specific load, and does not show steady-aerobic durability for those contexts.
- Changing destination changes only which presentation is open. **All training** retains the overall comparison, **What drove this**, global load, intensity, sleep, and body-weight context. A sport destination shows only that family's **Best build vs now**, detailed Training Mix, and capability-matched specialist cards. Power systems still discovers every exact canonical activity type independently: registered types appear under their sport, while unmatched types appear under **Other power activities**. It never combines related types into an all-sports value.

## Best build vs now

- **Best build vs now** is available for all eight Training families. Set one saved benchmark per sport from a manual end date or any eligible historical event. A multisport event may anchor separate benchmarks for each represented family. Events tagged exactly **Race** (case-insensitive) are shown first as quick picks, but selecting an event never changes its tags. The picker identifies its latest 100 other historical events by distance, duration, and TSS when available, and can order them by latest, longest, or highest load. An event is only an anchor: its workload is excluded from the benchmark.
- Choose an 8, 10, or 12-week build (12 weeks by default). The saved benchmark must finish before the matching current window, so comparisons never overlap. Merged events are excluded; missing TSS, zones, or durability evidence remains unavailable instead of being counted as zero. Durability rows require the same output or pool context and at least two eligible samples in both windows.

## Load and readiness

- The top **Training state** is a conservative label from the current TSS-derived Form model: Form (CTL minus ATL), 7-day CTL ramp, current CTL, and current ATL. The info control beside the current label shows those exact contributing values and explains the selected state. On desktop it opens a details menu; on a phone it opens the same content in a proper dialog rather than a transient tooltip. **Balanced** means none of the Starting, overload, fatigued, building, fresh, or detraining thresholds applies. Sleep, sessions, and the 28-day time comparison do not change this label. Dashboard **Today** shows the same compact state label and caption before Readiness, with an explicit **TSS only** qualifier. While its Form/TSS snapshot refreshes, Training keeps the latest complete state visible and labels it as updating rather than treating it as a newly calculated result.
- **What drove this** compares the current 28 days with the median of the prior three 28-day blocks. It separates parent-event TSS from child sport-group load, shows top parent-event contributors, keeps Other and unclassified child activities visible, reports load coverage, and compares sport-specific training rhythm. **Largest sport load change** and **Largest rhythm change** identify the selected driver sport inside this all-training explanation; they do not mean that the workspace is filtered to that sport. When every eligible difference is effectively unchanged, the card uses a neutral comparison title instead. Raw load and composition changes use neutral higher/lower language because a larger load is not inherently good or bad.
- **Readiness today** uses the same current formula as Dashboard Today. It combines derived Form/ramp with a bounded 30-day sleep-only query; the browser does not load event or activity history. The latest non-nap night must be no more than 48 hours old. HRV, average sleep HR, and minimum sleep HR compare with up to 14 prior nights from the same provider and require at least three matching values. Average HR leads the single Overnight HR driver at 70%, minimum HR contributes 30%, and either can stand alone when the other is missing. Lower Overnight HR versus personal baseline supports readiness; missing evidence is never zero. Current normalized Suunto sleep records can provide both HR measures, COROS records can provide average HR, and Garmin Health sleep summaries currently provide neither normalized sleep-HR measure. **Readiness is recovery-aware; Form, Freshness, CTL, ATL, forecasts, and the Training state remain TSS-only.** An active imported post-workout estimate appears as **Recovery left** in the separate Recovery context; it never changes the score or Freshness. Readiness re-evaluates automatically when time alone makes a future record eligible, expires the latest night, or removes baseline evidence. Score, status, confidence, calculation time, driver freshness, and missing signals remain separate. Failed load or sleep reads are identified separately from missing evidence. Sleep already loaded before a listener failure remains visible only while eligible, with available load-only context afterward. Its short training implication is context, not a workout instruction.
- The **14-day trend** is a backend-derived daily series built with the same formula. A readiness-only refresh reuses the prepared Form snapshot and a bounded sleep envelope, without scanning activity history; each daily point applies its own 30-day sleep window. Each point uses only evidence available by that UTC day cutoff, and missing scores stay as gaps. Today's chart point follows the live current result only when the retained series reaches the current UTC day.
- Readiness and eligible sleep scores use accessible 0–100 bars with markers at the Readiness category boundaries. Confidence remains separate from the score, and the four small evidence segments show how many Load, Sleep, HRV, and Overnight HR signals are available. Personal-baseline bars for HRV and Overnight HR are centered on the user's usual value; lower Overnight HR can be supportive, while missing evidence leaves the bar empty rather than showing zero.
- **Recovery context** groups an active **Recovery left** estimate with expandable **Sleep history** inside Readiness today. The countdown includes its estimated local finish time and remains visible while sleep details are collapsed. Use **Show sleep details** and **Hide sleep details** to open or close the recorded-sleep comparison. Sleep history places recorded overnight sleep beside training without changing the Training state or claiming that sleep caused a performance change. It compares the current 28 days with the preceding 84 days. Every ready **Best build vs now** card separately keeps sleep where it directly compares the exact current and saved benchmark ranges, with full metrics and source notes under **Details**.
- Sleep history uses the longest valid main overnight record from each provider per sleep date; naps are excluded. Average sleep appears with at least three recorded nights, while bedtime variation and overnight HRV need at least five qualifying nights. Bedtime variation uses only nights with a trustworthy local timezone offset, including the offset retained on older Suunto sleep timestamps; a night without one can still contribute duration and HRV. Missing nights and missing HRV are never counted as zero. These 28/84-day and build comparisons do not create a readiness score. Readiness today can use a provider sleep score or recorded duration, but does not blend sleep stages, SpO₂, or respiration.
- Deltas require the same sleep provider in both windows and sufficient coverage in each: at least seven recorded nights and at least half of the window. When coverage is limited or providers differ, Training can show the available values but withholds change claims. This protects comparisons when a device was connected late or changed between builds.
- When a recent activity supplies a still-active device recovery estimate, Training shows it as **Recovery left** with the estimated local finish time. It updates each minute, is omitted quietly when missing or elapsed, is not a readiness score, and does not change the Training state.

## Training mix and sport context

- On **All training**, Training Mix gives every recorded registered family a compact current-versus-usual workout, duration, and available TSS summary, followed by the global intensity chart. Workout and duration use the normalized 84-day baseline; TSS uses the median of the three preceding 28-day blocks when that family's recorded load is eligible. A sport destination expands only that family's latest 28 days versus its normalized 84-day baseline. Context summaries keep materially different environments separate and show only recorded metrics appropriate to that profile: for example ascent/descent for vertical sports, gravity MTB jump count and longest jump, swimming/rowing/paddling stroke rate, distance-weighted 500 m rowing pace plus stroke distance, and elapsed time without distance for Strength. Best build comparisons use the same context metrics. Missing TSS, zones, or profile metrics stay unavailable rather than being interpreted as zero.
- Swimming pace uses 12 UTC-aligned weeks and keeps pool and open-water evidence separate. Its compact x-axis uses **W35**-style markers; **W** means a Monday–Sunday UTC week, while the tooltip gives the full date range. It uses only stored **Average Swim Pace**, weighted by swimming distance; elapsed duration is never used to estimate pace because rests would distort it. The chart follows your /100 m or /100 yd setting.
- Pool SWOLF is shown only for stored active lengths that share the dominant stroke and pool-length context. SWOLF from different strokes or pool lengths is not comparable and is not blended. See [Garmin's SWOLF guidance](https://support.garmin.com/en-US/?faq=z7QHGpBDDH7wDJsSKjxRi9).
- Training does not infer Critical Swim Speed (CSS) from normal workouts. Reliable CSS requires deliberate maximal-distance trials, commonly 200 m and 400 m; see [Garmin's CSS protocol](https://support.garmin.com/en-US/?faq=h56ydwZxU8A7oi2OSh0y66) and the [critical-speed reliability evidence](https://pmc.ncbi.nlm.nih.gov/articles/PMC10875687/). Missing swim pace, active lengths, or comparable SWOLF remains explicitly unavailable.

## Evidence and missing data

- When a derived comparison is missing or rebuilding, Training says it is preparing rather than showing a zero-session result. A confirmed empty state means no eligible activity leg was found in the latest 28 days.
- **Durability** replaces the old aggregate efficiency trend on Training. Its Running, standard Cycling/MTB, Pool, and Open water tabs compare the current 28 days with the median of the prior three 28-day blocks, expose candidate and eligible activity coverage, preserve output and pool-length/stroke contexts, and show primary exclusion reasons. Recent supporting workouts use each workout's local start date and time, rather than an imported source label. The trajectory retains a 12-week UTC summary, but, when a later candidate workout exists, collapses an uninterrupted leading run with no candidates into a short note; later no-workout weeks remain visible as gaps. On phones, its x-axis uses compact **W35**-style markers, where **W** means a Monday–Sunday UTC week; wider screens show the week-start date, and a tooltip always gives the full range. Training shows a tab only for a scope with recorded candidate or summary evidence somewhere in its retained current, usual, baseline, or weekly windows, so a no-data Pool scope never appears beside recorded Open water evidence; this rule applies to every supported discipline. If a selected sport has no durability evidence at all, Training says so without showing tabs. Recorded candidates with no eligible result stay visible to explain missing evidence and exclusions. Enduro and Downhill are explicitly unsupported because the steady aerobic protocol is not a valid gravity-run model; Rowing does not have a durability adapter in this release. A context needs eligible evidence in at least two prior blocks before Training calls it usual. Each supported context also plots a readable 12-week durability trend: aerobic decoupling for Running, standard Cycling/MTB, and Open water, or pace retention for Pool. The fixed Cycling power context remains visible even when none of those weeks has an eligible point, so its candidates, confirmed power, eligible counts, missing processed evidence, and primary exclusions remain inspectable. A Cycling Power Curve proves that power was recorded, but it does not by itself make the ride comparable durability evidence; cycling also needs paired heart rate, sufficient duration and coverage, steady output, and no more than 20% in zones 4–7. Cycling trajectory bars show power-recorded activities while their labels show eligible / power-recorded counts. Missing processed evidence is reported as power unknown rather than confirmed no power. Unsupported Enduro and Downhill evidence is not counted as confirmed power because the steady-aerobic check rejects those contexts before inspecting their power stream. Weeks without a comparable session explain their primary exclusions instead of being called simply empty, and lines never bridge those gaps. A lower output-to-heart-rate ratio later in one session can suggest a fade only when you intended a similarly steady effort; intentional easing, terrain changes, coasting, or a pace change can produce it too. Use repeated comparable sessions as a trend, and treat missing durability as no suitable comparison rather than zero. Evidence is generated when supported activities are processed; older activities that have not yet been reprocessed stay explicitly missing. Activity-level timelines remain on event detail pages and are not persisted in Training snapshots.
- **Body-weight trend** appears last on Training as secondary, neutral context from recorded persisted Weight values only. It reduces multiple measurements on one UTC day to a median, shows the latest value plus 7- and 28-day medians in your chosen units, and plots the latest 28 days without joining gaps. A 7- or 28-day change appears only when both equal-length windows have at least three recorded days. It is not a health assessment and does not change the Training state, Form, Readiness, or a workout recommendation.
- **Power systems** is available to every signed-in Training user from the matching sport destination, or from **Other power activities** when an exact canonical type is outside the Training sport registry. It estimates current CP, W′, and Pmax for each exact canonical activity type from its stored power curves. For a calculation date, it uses only that type's preceding 42 completed UTC days: the same day and all future workouts are excluded. There is no pooled all-sports value, and Cycling is not combined with Indoor Cycling, mountain biking, Rowing, or any other type.
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
- In day details, an activity group containing exactly one activity opens that activity directly, as does its individual activity row. Browser **Back** restores the same day's details sheet. Deleting an activity from its details page returns to the previous in-app page; the day sheet reopens when other activity remains on that day.
- Calendar dates intentionally have no hover or touch tooltip. This keeps native vertical scrolling responsive on phones; day details remain available by selecting a date.

## Understand period totals and activity bars

- The summary above the full calendar shows recorded **Distance**, **Duration**, and **Ascent** for the selected week, month, or year. Month totals exclude adjacent dates shown only to complete the calendar grid.
- Below the calendar, **Activities** compares activity groups by recorded duration. Each bar uses the same color as its circles and is scaled against the longest-duration group in the selected period. The info control beside the heading explains this comparison.
- Available duration, distance, ascent, and descent totals appear with icons beneath each bar. A metric is omitted when no positive recorded value exists, and **--** beside an activity group means duration was not recorded.
- Lift-served downhill activities such as alpine skiing, snowboarding, and downhill cycling do not add ascent but do contribute descent. Diving, Scuba Diving, Free Diving, Snorkeling, and Mermaiding do not contribute either elevation metric; their vertical movement is recorded as depth. Ascent and descent summary exclusions configured in **Settings** also apply.
- The activity table beneath the duration bars lists normal activities in the selected Week, Month, or Year. It follows Calendar navigation exactly; use its search, tag filter, sorting, pagination, and row checkboxes, or use an activity's action menu to share, reprocess, download, or delete it without leaving your current Calendar period. Month tables exclude adjacent dates shown only to complete the grid.

## Preferences and data scope

- Weekday order follows **Settings -> Dashboard -> Start of the Week**. The configured first day is identified in the header, and Saturday and Sunday remain identifiable as weekend days.
- Distance, ascent, and descent use the units selected in **Settings -> Units**.
- The Calendar grid and its activity table use their own visible-period activity query, independent from the dashboard event table, custom-chart ranges, and map-tile filters. The table always uses the exact selected Week, Month, or Year, while the dashboard tile independently loads its current-month window.
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
- **Health** compares supported Sleep and Health measurements source by source. Open the [Health guide](/help#health) for metric ranges, source separation, and sync-state guidance.
- **Calendar** shows activities in Week, Month, and Year views. Open the [Activity Calendar guide](/help#activity-calendar) for display and summary details, or read the public [Activity Calendar overview](/features/activity-calendar).
- **Supported activity types** lists the activity types Quantified Self recognizes and explains why the details shown depend on data in each activity. Open the [Supported activity types guide](/help#supported-activities) or public [Supported activity types page](/features/supported-activities).
- **Training** is your fixed workspace for baseline comparisons, current readiness signals, load trajectory, training mix, capacity evidence, durability, sleep, and power interpretation. Open the [Training analysis guide](/help#training-analysis) for the detailed product guide, read the public [Training Analysis overview](/features/training-analysis) for the search-facing summary, or use its **Feedback** action to email support with Training-specific feedback.
- **My Tracks** maps positional activities and supports date range, custom date, and activity type filters. Its activity filter lists only trackable types in the selected date range, while keeping an active no-match choice visible until you clear it. Detected trips list an inferred **Home** area first when available; use the sort button to choose newest-first or oldest-first, and the choice is saved.
- **Services** is where you connect Garmin, Suunto, COROS, and Wahoo. Connection screens use a limited account summary once it is available; existing connections continue to work while those summaries are populated during rollout.
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
- New dashboards start with the Activity Calendar tile. The optional Dashboard **Today** header greets the dashboard owner according to browser-local morning, afternoon, or evening time, using the first part of their display name when available and generic copy otherwise; the greeting stays hidden on shared dashboards. Today then begins with the same TSS-only **Training state** shown in Training and shows current **Readiness** with its score, confidence, available-signal count, Load, Sleep, HRV, and Overnight HR alongside **Open Training**. Accounts in the staged Health beta also see **Open Health**. Select its calendar icon to open a mini calendar for the current month, use its previous and next controls to browse months, then select an activity day for details. Use **Show Today summary** in Dashboard manager to show or hide it independently from chart and map tiles.
- Today uses the same compact Readiness, sleep-score, evidence-coverage, and personal-baseline indicators as Training. Exact values and labels remain visible, so the indicators add scanability without turning Form, ramp, recovery time, or other unbounded metrics into arbitrary percentages.
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
- On supported mobile devices, selected controls and completed actions such as uploads, syncs, exports, and saves provide lightweight haptic feedback.
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
- **Intensity Distribution** uses power zones when available, otherwise heart-rate zones, grouped to Easy/Moderate/Hard by week. Each stacked bar’s height is the recorded zone time for that week; its colored segments show the Easy/Moderate/Hard split, so a short workout does not look equivalent to a high-volume week.
- Intensity Distribution shows both zone time and percentage for the **Current week**; when no current-week bucket exists they are labeled **Latest week**. Workouts without usable zones are excluded from that zone-time denominator.
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
- The [File Comparison Tool](/tools/compare) requires sign-in before file selection, then creates one saved benchmark event from multiple FIT, GPX, TCX, JSON, or SML files and opens event details with the benchmark report flow.
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
- Swim lengths appear in activity tabs and show lap index, split progress, duration, distance, length type, stroke, strokes, swim pace, stroke rate, heart rate, SWOLF, and energy when available.
- Active split progress is shown inside each expanded set, so a 25 m pool with a 100 m set displays 25 m, 50 m, 75 m, and 100 m splits before the rest row.
- Swim distance, pace, and energy values follow your preferred units from **Settings**.

### Event stamina metrics

- Event details can show **Stamina** and **Potential Stamina** when Garmin FIT or compatible Suunto imports include them.
- Stamina metrics appear in Detailed Statistics, in event summary metric tabs, and as selectable chart metrics from **Settings -> Charts**.
- Garmin session-level stamina values such as **Minimum Stamina**, **Beginning Potential Stamina**, and **Ending Potential Stamina** are shown when present.

### FIT calorie metrics

- FIT activities that record it show **Metabolic Calories** in the **Physiological** Event Details summary tab. It is a source-recorded metric and remains separate from total **Energy**.

### Event dive profiles

- Diving, Scuba Diving, Free Diving, Snorkeling, and Mermaiding activities show a pinned **Dive Profile** below Performance Charts and above the normal Event Details charts when the original source contains continuous depth samples.
- Garmin FIT activities explicitly recorded as single-gas, multi-gas, or gauge diving are classified as **Scuba Diving**; apnea diving and apnea hunting are classified as **Free Diving**. Other dive modes remain **Diving** when there is no exact activity type.
- An Event Details summary containing only Diving-group activities omits terrain-derived elevation metrics: **Altitude Minimum**, **Altitude Maximum**, **Average Altitude**, ascent/descent timing, grade and grade-adjusted values, VAM, and vertical speed. When a mixed Event is regenerated, its ascent, descent, altitude, and grade summaries use only non-Diving activities. Dive vertical movement is represented by depth instead.
- The profile uses the standard Event Details chart controls and height. The surface is fixed at the top of the depth axis, elapsed time runs left to right, and missing samples remain visible gaps.
- Temperature, heart rate, next-stop depth/time, time to surface, no-decompression limit, CNS/N2 load, air time remaining, pressure/volume SAC, RMV, PO₂, and dive ascent rate are available one at a time from the standard chart overlay picker when the source records them. Overlays start turned off, and multi-activity events keep each selected dive separate.
- The **Diving** summary tab shows the source-provided average/maximum depth, surface interval, bottom time, dive number and phase times/rates, CNS/N2 loads, oxygen toxicity, SAC, and RMV values that are present. **Maximum Depth** also appears in Overall and Environment. Missing values stay unavailable: the app does not infer summaries from samples or reconstruct samples from a summary.
- When an imported FIT activity includes dive gases, tank summaries, or tank pressure updates, the **Diving** summary tab also shows a **Gas & Tanks** section. New imports and reprocessed activities keep those details with the activity; older activities can still show them while the original file is available. Each selected dive stays separate, and the section shows the recorded percentages, pressure, volume, timestamps, and original labels. The app does not make up a gas mixture name or nitrogen value, match a gas to a tank, calculate consumption, or add missing records.
- **Depth** is also available as an advanced chart metric in **Settings -> Charts**. The first Swim pace preference selects one dive display family: per 100 meters uses meters and meters per second, while per 100 yards uses feet and feet per second. Depth and dive-rate displays retain the FIT source's three decimal places; SAC/RMV and PO₂ retain two.

### Event chart defaults and controls

- In Event details, if any selected activity does not include distance data, the chart automatically falls back to a **Duration** x-axis.
- In that case, the **Distance** x-axis option stays visible but is disabled until a compatible activity selection is active.
- **Default chart metrics** in **Settings -> Charts** are your global allow-list for automatic chart visibility. Sport recommendations choose the first up to three relevant recorded metrics from those defaults; missing metrics are skipped without adding unrelated charts. Swimming, rowing, canoeing, kayaking, paddling, and stand-up paddling use **Stroke Rate** rather than Cadence when that stream is recorded.
- The chart option **Include all recorded metrics** makes other chartable streams, such as Temperature, available in **Visible charts**. It adds choices but does not show them automatically. Merged events and benchmark comparisons always make all recorded chartable metrics available so every source can be inspected.
- **Visible charts** groups sport recommendations before other available metrics. Its context note explains that recommendations combine the selected sport, recorded metrics, and your Default chart metrics. Showing or hiding a chart creates a custom override for that event and selected-sport combination.
- **Show all charts** is an explicit custom choice that displays every currently available chart. Use **Reset to <sport> defaults** to discard the current custom override and return to the latest sport recommendation without changing Default chart metrics, Include all recorded metrics, overlays, or other chart options.
- A specialized chart can own a metric without duplicating it automatically in the ordinary chart stack. For example, a pinned **Dive Profile** owns Depth and every available dive overlay by default while those ordinary charts remain manually selectable when available.
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
      { label: 'Health guide', icon: 'school', kind: 'route', target: '/help', fragment: 'health' },
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
    id: 'supported-activities',
    icon: 'category',
    title: 'Supported activity types',
    summary: 'Browse the activity types Quantified Self recognizes and learn why the details shown depend on the data in each activity.',
    content: `## Activity types we recognize

- Quantified Self uses activity types and groups to label, search, filter, and organize activities. If a type is listed, we can recognize it; not every device, connected service, or uploaded file includes the same details.
- Open the [Supported activity types page](/features/supported-activities) to search the complete list.

## What you see when you open an activity

- Routes, terrain, sensors, laps, swim lengths, jumps, charts, and sport-specific details appear only when the imported activity includes that data. We do not add missing information.
- When you open an activity, you can see **Laps** when it includes lap data, **Swim Lengths** when the data includes individual pool lengths, and **Jumps** when the activity includes jump events. Charts and overlays need data recorded over time in the activity.
- Compatible FIT running data can provide ground contact time and ground contact time percentage. Compatible Suunto JSON can also provide running flight time, contact-time-to-flight-time ratio, and left/right ground-contact balance. Event Details groups recorded average, minimum, and maximum running-dynamics summaries under **Performance** when available; a metric absent from both source summaries and recorded samples remains hidden.
- Groups help you browse, but the activity type and its data determine the charts. Activities in the same group can show different charts. For example, Boating is listed in Motorized but can use sailing-oriented charts when the activity includes the data those charts need. Wheel Chair is listed in Adaptive Mobility but can use cycling-oriented charts when the activity includes the data those charts need.
- Hand Cycle and Velomobile are grouped with Cycling. They appear in Cycling Training analysis only when the activity contains enough relevant data.

## Diving

- Dive Profile needs continuous depth data. Other dive details, such as depth, decompression, timing, tissue load, SAC/RMV, gas, and tank information, appear only when they are included in the activity. We do not estimate or fill in missing dive data.
- In a dive-only activity, depth is the relevant vertical measure, so terrain altitude, ascent, descent, and grade are hidden. For an event that combines diving with another activity, terrain summaries come only from the non-diving activity.
`,
    links: [
      { label: 'Supported activity types', icon: 'category', kind: 'route', target: '/features/supported-activities' },
      { label: 'Explore Integrations', icon: 'sync', kind: 'route', target: '/integrations' },
      { label: 'Uploads & Imports', icon: 'upload_file', kind: 'route', target: '/help', fragment: 'uploads-and-imports' },
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
    id: 'health',
    icon: 'cardiology',
    title: 'Health',
    summary: 'Compare Sleep and the complete Health metric catalog across providers without blending sources.',
    content: HEALTH_WORKSPACE_HELP_CONTENT,
    links: [
      { label: 'Connectivity', icon: 'hub', kind: 'route', target: '/services' },
      { label: 'Privacy Policy', icon: 'lock_outline', kind: 'route', target: '/privacy' },
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
- If you refresh while an answer is in progress, the page keeps the pending question visible and reconnects to the server-owned turn. While the outcome is uncertain, that browser tab temporarily keeps the account-bound, bounded question and request metadata in session storage. If the refresh cancelled the send before registration, it safely resends the same request ID; completed requests cannot be duplicated. A different signed-in account cannot restore the record, and it is cleared after completion, confirmed failure, reset, or expiry.
- Every current answer must use at least one read-only Quantified Self result. Expand **Data used** below an answer to inspect compact facts and app links produced from actual tool results.
- Use **New chat** to clear the stored messages, return precise activity locations to the default **off** state, and start a new conversation generation. An older in-flight answer cannot restore a cleared conversation.

## What the Assistant can read

- **Today and recovery:** daily report, current readiness, sleep duration and stages, aggregate/overnight HRV, sleeping heart rate, SpO2, respiration, and bounded sleep trends.
- **Training:** ready Training metric catalog, current values, Form, ramp, load, volume, intensity, current-versus-usual context, and missing or rebuilding states.
- **Measurements:** first-class measurement discovery and bounded history, including body weight when recorded.
- **Activities:** activity types, recent or bounded activity lists, activity metrics, rankings, laps, MTB jumps, swim lengths, and bounded on-demand workout chart series. Activity start/end, chart breadcrumbs, and MTB jump coordinates are redacted by default. In **Examples & data access**, you can start a new chat with **Precise activity locations** enabled for exact activity positions, chart breadcrumbs, and nearby activity searches. For an MTB jump record, the Assistant ranks the matching Mountain Biking activities by the relevant maximum-jump metric and treats that persisted maximum as authoritative instead of comparing jump counts or only recent activities. It reads individual jump records only when you ask for those details.
- **Saved routes:** coordinate-free route names, activity types, bounded summary metrics and counts, and import or update times, filterable by sport, name, or recency. Route names can contain user- or provider-assigned place information.
- **Activity metrics:** one or several bounded aggregate metric queries through the canonical MCP metric catalog.

## Charts and maps

- When a visual materially helps, the Assistant can add one interactive chart and one map to an answer. Assistant maps have their own saved style, separate from activity maps. After choosing **Show map** or **Expand**, use the layers button to switch between Default, Satellite, and Outdoors in place; the choice is reused by other Assistant maps. Opening or refreshing a conversation never loads map tiles automatically.
- Gemini chooses only from safe chart-series or map sources advertised by the current validated tool result. Quantified Self constructs all plotted values, coordinates, labels, and renderer settings deterministically; Gemini cannot author arbitrary chart configuration or move map points.
- Charts reuse existing measurement, sleep, Training, aggregate metric, ranking, jump, and workout-chart results. Missing readings remain gaps instead of becoming zero.
- Maps use only activity coordinates already allowed by the current **Precise activity locations** chat. Saved-route bounds, geometry, and waypoints are still unavailable.
- Opening a map sends the displayed geographic area to Mapbox to load map tiles, regardless of the selected Assistant map style. This applies even after a direct-coordinate search that did not use Mapbox geocoding. If a map cannot load, the text answer and **Data used** remain available.

## Privacy boundaries

- The built-in Assistant is coordinate-free by default. When you explicitly enable **Precise activity locations** for a fresh chat, activity tools selected during that chat may send Gemini exact activity start/end and MTB jump coordinates plus nearby activity results. Place-name nearby searches send only the location text to Mapbox; direct-coordinate searches do not use Mapbox. Changing this setting starts a new chat so coordinate-bearing history cannot cross back into a coordinate-free conversation.
- Saved-route bounds, route geometry, route waypoints, full-resolution or unrequested sensor streams, original files, write tools, and dashboard settings remain unavailable even when precise activity locations are enabled.
- Gemini receives your message, the browser's IANA timezone for local-day context, bounded recent conversation context, and the validated read-only tool results selected for the current question. Direct in-app URLs are withheld, and an answer that repeats an opaque reference or cursor is rejected. Raw FIT, TCX, GPX, JSON, and SML files are not sent.
- Evidence rendering removes opaque references, cursors, provider, device, source, owner, token, and identifier fields again before display.
- The Assistant is fitness information, not medical advice. Verify important health and Training decisions.

## Retention and control

- Quantified Self stores one active conversation per user, with at most the latest six completed turns. If bounded charts, maps, and grounded details make that transcript too large, the oldest whole turn is removed first so the newest completed answer can still be saved. Text, compact evidence, and any bounded chart or map payload use the same retention period.
- The active conversation becomes unavailable about **seven days** after its latest completed turn or reset. A response already in progress can protect an imminent expiry for at most four extra minutes. Firestore TTL then deletes the expired record asynchronously; account deletion removes it directly.
- Conversation documents are server-owned. Browser code cannot read or write them directly; it must use authenticated App Check callables.
- **New chat** immediately replaces the stored conversation, removes its prior message content, and returns precise activity locations to **off**.

## Built-in Assistant or external MCP?

- Use the **Assistant** for a zero-setup, app-funded conversation. It is coordinate-free by default and offers explicit per-chat precise **activity** location access.
- Use [Connections -> MCP](/services?serviceName=mcp) when you prefer ChatGPT or another compatible client, need separately approved saved-route location or geometry access, or want usage billed by that external client.
- External MCP calls do not consume the in-app Assistant allowance. External clients have their own privacy and retention practices.

## Troubleshooting quick checks

- **App verification failed**: refresh and retry.
- **Conversation changed**: another tab or New chat replaced the active conversation; reload and retry.
- **Another response is in progress**: wait for the current turn to finish. A stale turn lock expires automatically.
- **Quota reached**: wait for reset, upgrade, or use your own compatible AI client through MCP.
- **No data found**: ask which measurement, sleep vital, Training metric, activity type, or activity metric is available before assuming it is unsupported.
- For exact activity start/end or MTB jump locations and nearby activity searches, enable **Precise activity locations** in **Examples & data access**. For saved-route location, route geometry, or waypoint questions, use an external MCP client and explicitly approve the related permission.`,
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

## Complimentary extensions

Support may occasionally add complimentary calendar months to an existing Basic or Pro membership as a thank-you or service credit. The time is added after the later of the current paid period or an existing trial. It postpones the next renewal date, or the final access date if cancellation is already scheduled, without changing the plan, creating a charge or proration, or turning automatic renewal back on.

During gifted time, the subscription page shows **Complimentary extension** instead of an ordinary trial label. The optional notification email states the plan, gifted time, and new access date; internal admin notes are never included.

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

The public [Integrations hub](/integrations) links to focused [Garmin Integration](/integrations/garmin), [Suunto Integration](/integrations/suunto), [COROS Integration](/integrations/coros), and [Wahoo Integration](/integrations/wahoo) pages. They explain provider activity imports, supported activity-sync directions to Suunto, Wahoo, and COROS, direct GPX/FIT and saved-route delivery to Garmin, Suunto, Wahoo, and COROS, saved-route row and bulk sends, syncing past activities, opt-in Suunto route delivery, history imports, uploads, and how those workflows connect to the private training dashboard.

Provider-specific privacy details live on [Policies -> Connected Services](/policies#connected-services-data), with separate sections for [Garmin Data](/policies#garmin-data), [Suunto Data](/policies#suunto-data), [COROS Data](/policies#coros-data), [Wahoo Data](/policies#wahoo-data), and [AI & Third-Party Processing](/policies#ai-and-third-party-processing).

The public [Training Data Sync Guides](/guides) hub links to the [import activities to Suunto guide](/guides/import-activities-to-suunto), [import activities to Wahoo guide](/guides/import-activities-to-wahoo), [Garmin to Suunto sync guide](/guides/sync-garmin-to-suunto), [COROS to Suunto sync guide](/guides/sync-coros-to-suunto), [Wahoo to Suunto sync guide](/guides/sync-wahoo-to-suunto), [Suunto routes to Garmin courses guide](/guides/sync-suunto-routes-to-garmin-courses), and [centralized workout data guide](/guides/centralize-garmin-suunto-coros-workout-data) for step-by-step setup.

The public [Tools hub](/tools) links to the [File Comparison Tool](/tools/compare), which creates saved benchmark events directly from FIT, GPX, TCX, JSON, and SML files.

The public [Features hub](/features) links to [Workout Data Comparison](/features/workout-data-comparison), [Workout File Comparison](/features/workout-file-comparison), [Workout File Analyzer](/features/fit-gpx-tcx-file-analyzer), [FIT and GPX Route Files](/features/fit-gpx-route-files), and [Sports Watch Benchmark](/features/sports-watch-benchmark) pages that explain how centralized Garmin, Suunto, COROS, uploaded FIT/TCX/GPX/JSON/SML activity files, and saved route-only FIT/GPX files support benchmark reports, metric overlays, maps, charts, source-file workflows, and reviewer workflows for device tests, YouTube videos, and blog posts. Manual uploads, core analysis, and benchmark comparisons are available on the free plan for up to ${USAGE_LIMITS.free} activities and ${ROUTE_USAGE_LIMITS.free} saved routes; automatic provider sync and higher limits require a paid plan.

## Sleep data

Sleep sync is server-owned health data. When available, Garmin, Suunto, and COROS sleep sessions are imported as separate source records and shown by the dashboard **Sleep** tile. The sleep chart has its own 14d, 30d, 90d, and 1y range control with older/newer paging, independent from dashboard event filters. It stacks sleep stages and overlays available vitals: recorded sleep HRV, average sleep heart rate, and minimum sleep heart rate with range-average reference lines, plus max SpO2 when the provider includes those values. Garmin and Suunto Pro users can select the provider history action in Connections; Garmin users may also see a one-time dashboard prompt. Suunto can import sleep from Jan 1, 2016 to today with a 7-day cooldown. Connected Suunto users see **Sleep & Health history** while Suunto Health is enabled; the same control queues separate bounded Health records for available heart rate, HRV, SpO2, altitude, steps, energy, Body Energy Balance, and StressState. These values stay separate from workout FIT metrics and Sleep sessions, and missing values remain missing. Garmin can request sleep from Jan 1, 2016 to today, receives records asynchronously from Garmin, and uses a 30-day cooldown. Connected Garmin Pro users see **Sleep & Health history** while Garmin Health is enabled; the same request queues Daily, Stress, HRV, User Metrics, Body Composition, Pulse Ox, All-day Respiration, Blood Pressure, Skin Temperature, and Health Snapshot history in paced 90-day windows. Health records remain separate in the unified Health model, and missing values remain missing. COROS Pro users can select **Sleep & Health history**, then choose **Import Sleep & Health History** to import the available last three months in 30-day windows with a 7-day cooldown. The same daily COROS sync stores source-attributed steps, the provider calorie value, resting and sleep heart rate, overnight HRV, and available detailed HRV samples in the unified Health model. Aggregate sleep values stay on the Sleep session and are referenced rather than copied; missing values stay missing. The COROS API does not expose sleep stages.

## Suunto

Suunto tools currently include:

- connecting your account,
- syncing recent sleep samples,
- importing sleep history from Jan 1, 2016, with combined Sleep & Health history while Suunto Health is enabled,
- importing separate source-attributed 24/7 Activity, daily-statistics, and Recovery Health records,
- importing history,
- automatically importing saved Suunto routes,
- importing existing Suunto routes,
- uploading FIT activities to Suunto,
- uploading GPX or FIT routes to Suunto.

Suunto FIT activity uploads in Services show each file's upload status, duplicate detection, failure message, and retry control. If Suunto has already issued an upload job when a temporary error occurs, retrying the same row checks that job instead of uploading the FIT again. Suunto can report a job as new while an accepted FIT is still processing, so retry never replaces an issued job automatically. To deliberately start a fresh upload, clear the upload list and choose the FIT file again. Large upload batches are processed one file at a time with short pauses between provider upload calls.

While your Suunto account is connected, Quantified Self also imports new and updated Suunto routes into **Routes** automatically. Services includes an **Import existing routes** action for first-time imports or after reconnecting. The **Routes** page can also show a one-time prompt to import existing Suunto routes.

Suunto users can turn on **Automatically send new and updated routes** in Suunto Services for Garmin, Wahoo, or COROS. Every destination is opt-in and off by default. Garmin can also be enabled from a one-time **Routes** page prompt when both connections are ready. This sends newly imported or updated Suunto routes already saved in Quantified Self to the selected destination. Garmin receives a course and requires **Course Import** permission. Wahoo receives a FIT course and requires Wahoo route access. COROS receives GPX route geometry; cycling activity types are sent as bike routes and all other or unspecified types as running routes. **Send routes** uses Suunto routes already saved in Quantified Self and can backfill them without enabling future delivery. It does not fetch routes from Suunto or any destination during delivery. Wahoo uses a stable saved-route key, so an updated Suunto route replaces its earlier Wahoo route instead of creating a duplicate. COROS uses a deterministic ID for the exact saved-route revision, so repeating that revision is deduplicated. If Wahoo was connected before route delivery was available, reconnect it once to grant route access.

Saved FIT and GPX routes can be sent to Suunto from **Routes** using a row action or the selected-row bulk toolbar. Quantified Self reparses each saved route from its original source file, generates a fresh GPX export, and uses the saved Quantified Self route name as the route name sent to Suunto. Suunto imports sent route files as new routes, so sending an edited route that was already sent to Suunto creates an updated copy in Suunto App. Routes imported from Suunto are not sent back to the same connected Suunto account, but they can still be sent to a different connected Suunto account when one exists. Bulk sends upload routes one at a time so partial failures can be reported without stopping successful routes.

**Uploads** in Suunto Services also accepts a selected GPX or FIT route without adding it to **Routes**. Suunto receives GPX, so Quantified Self converts a selected FIT route to GPX in memory before delivery. The direct upload does not create or retain a Quantified Self route.

Suunto 24/7 Health notifications are signature-checked and used to refetch bounded local-day ranges. Quantified Self stores normalized, source-attributed Health records rather than raw webhook samples. Repeated polls, notifications, and history ranges update the same source identities instead of creating duplicates. Disconnecting stops future imports but retains imported Sleep and Health history; deleting the account removes both plus associated queue work.

See [Policies -> Suunto Data](/policies#suunto-data) for the provider-specific privacy summary for Suunto imports, Sleep and 24/7 Health sync, route imports, and sending routes or activities to connected destinations.

## Garmin

Garmin history import has two important limits:

- one import request every **30 days**,
- and only the latest rolling **5 years** of activity data. It does not support an arbitrary older five-year period.

The history picker disables dates before the current five-year cutoff, and the server rejects an older range before contacting Garmin.

Garmin can deliver imported activities gradually over hours or days.

Garmin Sleep and Health history import is separate from activity history import. It requests sleep through Garmin Health API and records appear later as Garmin sends sleep notifications.

Garmin can also send source-attributed Daily, Stress Details, HRV, User Metrics, Body Composition, Pulse Ox, All-day Respiration, Blood Pressure, Skin Temperature, and Health Snapshot summaries for connected accounts with Health Export permission. Missing measurements remain unavailable, Garmin Body Battery remains provider-specific, and these Health records do not replace Sleep sessions or workout metrics. Connected Pro accounts see **Sleep & Health history** while Garmin Health is enabled; one request queues Sleep plus all ten Health families from Jan 1, 2016 in paced windows. If Garmin Health is temporarily disabled, the control falls back to **Import Sleep History**. Garmin Summary Resender is reserved for bounded operational recovery after live delivery is verified.

If Garmin permissions are missing, reconnect the app and grant the required export, history, and health permissions in Garmin Connect.

Saved FIT and GPX routes can also be sent to Garmin Connect from **Routes**. Garmin must be connected with **Course Import** permission. If that permission is missing, Routes can show a Garmin permission prompt; open Garmin Connect, go to **Connected Apps**, allow Course Import for Quantified Self, and reconnect Garmin from Routes or **Services**. Quantified Self reads the original saved route file, uses the saved route name, and updates the same Garmin course when you send that route again to the same Garmin account.

**Uploads** in Garmin Services accepts selected GPX and FIT route files as well. Quantified Self parses either source format and creates a Garmin Connect course; this direct upload does not add the route to Quantified Self or retain Garmin delivery metadata, so uploading the same file again creates another Garmin course. Course Import permission is required.
See [Policies -> Garmin Data](/policies#garmin-data) for the provider-specific privacy summary for Garmin imports, Sleep and Health data, and Garmin to Suunto sync.

Garmin to Suunto activity sync requires:

- you must connect both Garmin and Suunto,
- turn on automatic activity sync in Garmin Services,
- and allow Activity Export in Garmin.

Garmin Services also offers Wahoo and COROS as opt-in activity destinations. Automatic delivery applies only to new imported FIT activities. **Sync past activities** can send a selected stored date range to any supported destination without turning on future delivery.

Disconnecting Garmin, COROS, Suunto, or Wahoo turns off related automatic activity or route delivery. After reconnecting, turn each route on again if you want automatic sync to resume.

If a provider revokes access, Quantified Self marks that connection as **Reconnect required** in Services and may also show a dashboard reconnect prompt. Reconnecting restores access; dismissing the prompt does not reconnect automatically.

Automatic sync runs only for newly imported Garmin activities and uses the stored original activity file from your event.

**Sync past activities** is available in Garmin Services: choose a supported destination and date range to send Garmin activities already imported into Quantified Self. It uses the original files already saved with those activities.

You can sync past activities while automatic activity sync is off. This does not turn on automatic sync for future imports.

When Garmin and Suunto are connected, the dashboard may offer a one-time action prompt to turn on automatic Garmin to Suunto activity sync. Dismissing the prompt hides it permanently; **Sync past activities** remains available in Services.

## COROS

COROS history import is limited to the last **3 months** because of API restrictions.

COROS tools currently include:

- connecting your account,
- automatically importing daily Health and sleep data from a rolling recent window (sleep timing, steps, the provider calorie value, resting and sleep HR, overnight HRV, and available detailed HRV samples; the COROS API does not expose sleep stages),
- importing available COROS Sleep and Health history from the last three months in 30-day windows once every seven days,
- importing history,
- uploading FIT activities to COROS,
- uploading selected GPX or FIT routes to COROS without saving them in Quantified Self,
- sending saved routes to COROS individually or in selected-row bulk batches,
- automatically sending new Garmin, Suunto, or Wahoo activities to COROS, or backfilling a stored date range,
- automatically sending new COROS activities to Suunto or Wahoo, or backfilling a stored date range,
- and opting in to new/updated or existing saved Suunto route delivery to COROS.

COROS activity upload, activity delivery, and route delivery are available to all eligible connected Pro users.

COROS uses one active connected account for every import and delivery. New OAuth connections pin that account. A legacy connection is pinned deterministically the first time it is used; if the pinned token disappears, delivery fails closed and asks you to reconnect instead of silently choosing another account.

When you open the COROS connection overview, Quantified Self asks COROS whether that account is still bound. If COROS says it is unbound, the card changes to **Reconnect required** and related automatic activity and saved-route settings turn off. A temporary check failure shows **Retry** and does not mark the account disconnected.

For imported activities, Quantified Self can recover a missing or expired COROS FIT download link from the workout identity. Imported event attribution preserves the COROS mode, submode, device, source timezones, training-plan workout ID, and multisport component when COROS supplies them; the expiring provider link is not kept on new events.

COROS FIT activity uploads in Services are asynchronous and use per-file status, short provider upload pacing, and failed-file retry controls. Once COROS issues an upload ID, refresh or retry checks that same upload first instead of posting the FIT again. A duplicate is shown as a completed result.

### Activity types COROS accepts

COROS documents third-party activity import for these modes:

- **Running:** Run, Indoor Run, Trail Run, Track Run, and Hike.
- **Cycling:** Bike and Indoor Bike.
- **Swimming:** Pool Swim and Open Water Swim.
- **Other outdoor:** Multisport, Bouldering, Mountain Climb, GPS Cardio, Badminton, Basketball, Pickleball, Soccer, and Tennis.
- **Other indoor:** Strength, Indoor Climb, Gym Cardio, and Table Tennis.

Quantified Self sends the retained original FIT file, while COROS makes the final compatibility and activity-type decision. A source mode outside the documented list may be rejected during asynchronous processing even after COROS issues an upload ID, or COROS may accept it under a generic type. For example, Stand Up Paddling may appear as **Other**. Sailing and Snorkeling are not in COROS's documented import list and may be rejected. COROS currently reports these processing failures only as a generic failed status without a specific reason. See [COROS's supported import requirements](https://support.coros.com/hc/en-us/articles/360040256971-How-to-Import-Activities-to-Your-COROS-Account).

Direct COROS route upload accepts one GPX or FIT file, parses it server-side, and sends generated GPX route geometry without creating or retaining a Quantified Self route. Saved routes can be sent from a row action, route detail, or selected-row bulk action. Saved-route and automatic Suunto-route delivery share the same server adapter and delivery metadata. COROS supports bike and running route types: cycling-family routes use bike, while every other or missing activity type uses running.

COROS to Suunto activity sync requires:

- you must connect both COROS and Suunto,
- turn on automatic activity sync in COROS Services,
- and keep both service connections active.

Automatic sync runs only for newly imported COROS activities and uses the stored original activity file from your event. COROS Services also offers Wahoo as a destination.

**Sync past activities** is available in COROS Services: choose a date range to send COROS activities already imported into Quantified Self to Suunto or Wahoo.

You can sync past activities while automatic activity sync is off. This does not turn on automatic sync for future imports.

When COROS and Suunto are connected, the dashboard may offer a one-time action prompt to turn on automatic COROS to Suunto activity sync. Dismissing the prompt hides it permanently; **Sync past activities** remains available in Services.

Garmin, Suunto, and Wahoo Services each offer COROS as an activity destination. Connect both services and turn on only the route you want. Automatic delivery is off by default; a date-range backfill does not enable it. The original stored FIT is sent, so events without a supported retained original file are skipped.

Before an activity is sent to any provider, Quantified Self stores short-lived, server-only exact-file and semantic FIT fingerprints. If COROS, Suunto, or Wahoo later returns that activity through its import feed, the matching provider echo is acknowledged without creating another event or starting another fan-out. These receipts expire after about 120 days and contain hashes and routing metadata, not the source file.

See [Policies -> COROS Data](/policies#coros-data) for the provider-specific privacy summary for COROS imports, sleep summaries, activity and route uploads, provider-to-provider sync, and short-lived echo protection.

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
- automatically send new Wahoo activities to Suunto, or choose a date range to send past retained Wahoo activities to Suunto,
- automatically send new Wahoo activities to COROS, or choose a date range to send past retained Wahoo activities to COROS.

Quantified Self imports only Wahoo records with an available FIT file. Workouts without a FIT file are skipped, as are workouts Wahoo identifies as originating from a third-party fitness application. History is returned newest first and is queued for background processing; large ranges may take time to appear.

Direct FIT activity delivery only sends the selected file to Wahoo. It does not create or retain an activity in Quantified Self. Wahoo may process an activity upload asynchronously; Services keeps the upload status available to refresh. If Wahoo has already issued an upload ID, retrying after a connection or status error checks that same upload instead of sending the FIT again. A fresh upload starts only after Wahoo explicitly reports that processing failed. If you connected Wahoo before activity sending was available, reconnect it once to grant workout write access.

If Wahoo rejects repeated token refreshes, its connection card changes to **Reconnect required**. Select **Reconnect** there and authorize the same Wahoo account so parked work cannot be delivered to a different account. To change Wahoo accounts, disconnect the retained account first and then connect the other one. Quantified Self keeps unaccepted automatic activity and saved-route deliveries parked while reconnecting, then resumes them safely after the new connection succeeds; it does not turn your saved route settings off.

After Wahoo processes an activity automatically synced from Garmin, COROS, or Suunto, Quantified Self corrects the Wahoo workout type when the persisted Sports Lib activity type has an explicit Wahoo mapping. Activities containing multiple canonical types are marked as multisport. If no explicit mapping exists, Quantified Self keeps Wahoo's inferred type instead of guessing or defaulting to cycling or Other. Direct FIT activity uploads keep Wahoo's inferred type.

Direct course/route delivery accepts GPX and FIT files. Quantified Self converts a selected GPX route to a FIT course in memory before sending it to Wahoo; the GPX must contain exactly one route with valid coordinates. It sends the route to Wahoo without creating or retaining a route in Quantified Self. If you connected Wahoo before route sending was available, reconnect it once to grant route access. When a route send reports missing Wahoo route access, select **Reconnect Wahoo** in the displayed dialog, then send the route again after you return. Routes imported by Wahoo's Cloud API sync to the Wahoo App and directly to an ELEMNT bike computer, not the ELEMNT App.

Wahoo to Suunto or COROS activity sync requires:

- you must connect Wahoo and the selected destination,
- turn on automatic activity sync in Wahoo Services,
- keep both service connections active,
- and use Wahoo activities with a retained original FIT file.

Automatic sync runs only for newly imported eligible Wahoo activities. **Sync past activities** in Wahoo Services sends retained Wahoo FIT activities from the date range you choose to Suunto or COROS. You can sync past activities while automatic activity sync is off; this does not turn on automatic sync for future Wahoo imports.

Disconnecting Wahoo revokes future access and stops new imports and deliveries. It does **not** delete activities already imported into Quantified Self. Delete individual activities yourself, or delete the account to remove all associated data. Wahoo-origin FIT activities can be delivered to Suunto or COROS after explicit opt-in. Suunto-to-Wahoo saved-route delivery is a separate, opt-in route workflow in Suunto Services; direct Wahoo GPX/FIT course/route delivery is a separate, user-selected Wahoo-only upload. Sleep sync and plans are not forwarded.

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
- The built-in Assistant sends Gemini your message, bounded recent conversation context, and only the validated read-only Quantified Self results selected for that question. It is coordinate-free by default. If you explicitly start a chat with **Precise activity locations** enabled, selected activity-tool results may also send Gemini exact activity start/end and MTB jump coordinates and nearby activity results during that chat. Place-name searches send only the supplied location text to Mapbox. Changing the setting starts a new chat, and **New chat** returns it to off.
- The Assistant can send Gemini coordinate-free saved-route summaries selected for a question, including route names that may contain place information. It cannot access or send raw activity or route files, saved-route bounds, route geometry, waypoints, write tools, or dashboard settings. Its server-owned conversation keeps at most six completed turns, becomes unavailable about seven days after the latest completed turn or reset (with at most four extra minutes for a response already in progress), and is then deleted asynchronously by Firestore TTL.
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
- Metric access covers persisted numeric activity metrics and ready Training-derived snapshots. Clients can compare up to four activity metrics over one bounded range and can first check the human-readable Training metric catalog to distinguish ready, rebuilding, stale, missing, and incompatible snapshots. When individual activity detail access is also granted, a client can inspect which metrics, laps, jumps, swim lengths, and chart streams are available for one referenced activity, request up to 25 explicitly selected canonical numeric Sports Lib metrics, or rank activities by one metric over an explicit bounded range or a processing-bounded all-history scan. Oversized rankings fail instead of returning partial records. MTB jump superlatives reuse that ranking and treat the persisted maximum as authoritative; individual jump records remain an optional detail read, and jump count is not treated as jump quality. These paths do not add a separate stored metric catalog. Precise latitude/longitude and first-class body-measurement metrics are excluded, and Training event/activity IDs, names, labels, source fingerprints, and imported device/provider source keys are removed.
- Body-measurement access covers first-class body-measurement history. Body-weight history is available for bounded ranges up to 366 days as identity-free day, week, or month values using median, average, minimum, maximum, or latest aggregation. It contains recorded measurements only and is not a medical or health assessment. It excludes exact source measurement timestamps, event/activity identity, names, provider/device metadata, and source provenance.
- Any authorized MCP client can discover canonical Sports Lib activity types for filters; that static catalog contains no account data. Individual activity detail access covers non-location summaries, laps, swim lengths, MTB jump measurements, signed-in app links, selected persisted numeric metrics such as Stroke Rate, and bounded chart-ready heart-rate, power, cadence, altitude, grade, distance, speed, and activity-appropriate pace streams. Cadence is not offered as a chart stream for activities whose canonical metric is Stroke Rate. Clients can filter newest-first activity scans by one or more types and request **today** or **yesterday** in an explicit IANA timezone. Bounded pages report scan completion so a client can distinguish a complete no-match result from older history that remains to be checked. Chart streams are parsed temporarily from an existing FIT, GPX, TCX, Suunto JSON/SML, or gzip original file, downsampled over the complete activity, and discarded without a reparse, backfill, cache, or additional activity storage. Historical chart access therefore depends on the original file still being available and within the documented limits.
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
- If Suunto temporarily returns an incomplete activity file, Quantified Self validates it and retries automatically instead of saving an empty activity.
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
