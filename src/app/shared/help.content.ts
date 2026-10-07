import { environment } from '../../environments/environment';
import { ASSISTANT_REQUEST_LIMITS, ROUTE_USAGE_LIMITS, USAGE_LIMITS } from '../../../shared/limits';
import { getNumberFormatter } from '../helpers/number-format.helper';
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
  | 'post-workout-reflections'
  | 'getting-started'
  | 'supported-activities'
  | 'activity-calendar'
  | 'training-plans'
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
  kind: 'route' | 'external' | 'email';
  target: string;
}

export interface HelpSectionLink {
  label: string;
  icon: string;
  kind: 'route' | 'external' | 'email';
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

const TIMELINE_NOTES_HELP_CONTENT = `## Timeline notes

Use **Timeline notes** in the Dashboard, Health, or Calendar header to add private context such as sickness, injury, vacation, travel, or stress. Notes also appear on supported Training charts. Notes are available to every signed-in account; no subscription or connected device is needed. **Add measurement** stays separate.

Choose a single day, an inclusive date range, or an ongoing period. You can plan future days and ranges; ongoing notes must already have started. **End today** closes an ongoing note using its original time zone. Dates stay fixed when you travel.

Each category has its own icon. Choose a **Color** in the editor to recognize a note in lists, on charts, and in Calendar, then select **Save**. **Default** uses the same neutral gray in lists, charts, and Calendar. Chart markers show the note's title, shortened to fit when needed; hover or tap the marker to read the full title in its tooltip. Date ranges have start and end arrows with a subtle band between them. An open circle means the period continues beyond the view or is ongoing; ongoing shading stops at today. Single days, and ranges within one weekly chart bucket, use one marker. Grouped notes show a count. Overlapping notes with different colors share a neutral marker; its tooltip shows each note individually. Use the calendar buttons to pick dates, or type them in your local date format.

The manager lists all notes, including future plans, newest start date first. You can edit, delete with confirmation, or browse older pages. **Show on charts and calendar** is the global switch remembered across Dashboard, Health, Sleep, Training, and Calendar. Each note also has **Show this note on charts and calendar**, enabled by default; change it in the editor and select **Save**. A note appears only when both switches are on. Turning the global switch back on preserves your individual choices. Hidden notes remain editable in the manager with a **Hidden** label; hiding does not delete them. Hover or tap a note's title, start/end marker, or grouped marker to show its tooltip. Chart markers do not open notes for editing; use **Timeline notes** in the header to edit them. Hover or tap inside the shaded band to inspect your measurements as usual. The manager is also the keyboard-accessible way to browse them. Weekly charts show which notes overlap a week while retaining their actual dates.

In Health, notes appear on the Highlights trend charts as well as the detailed metric and Sleep charts. They follow each chart's date window, even when the explorer is showing older history.

Notes never change your measurements, readiness, or forecasts. Ongoing shading stops today. Source and sport filters do not hide notes. If a view reaches its note limit or cannot load notes, it says so while keeping your metric charts available. Notes stay private and are not sent to connected providers or public shares. Full titles and details, including notes hidden from charts, can be read only when you separately enable **Timeline notes** for an MCP client or in the Assistant. An external MCP client also needs **Change Timeline notes** before it can create, edit, or permanently delete a note; those tools use the MCP client's approval controls. In the built-in Assistant, turn on **Timeline notes** and **Timeline note changes**, ask for one exact change, then review and apply or dismiss the proposal in Quantified Self. Gemini cannot apply it. Deletion is permanent. This may include sensitive health or personal text. Chart visibility is not an access permission. Disconnecting a provider keeps notes; deleting your account removes them.
`;

const HEALTH_WORKSPACE_HELP_CONTENT = `## What Health is for

See the [Health feature overview](/features/health) for sleep, HRV, and measurement previews using sample data. The HRV preview includes fictional travel, sickness, and stress notes; select a marker or **View sample notes** to read them. These examples never load or change your account notes.

- **Health (Beta)** is the authenticated workspace for source-attributed Sleep, heart rate, HRV, movement, energy, wellness, body, and fitness measurements imported from supported connected services. It is available to all signed-in users; the plan and connection requirements for importing provider history do not change.
- Open **Health** from the main navigation. Health is a fixed workspace, not a configurable dashboard tile.
- Highlights show available **Sleep** and **Heart rate** context with every connected source kept separate. **HRV** appears as a source-specific 14-day trend only when a nightly recovery series has at least three observations; a lone sleep-derived HRV value already shown inside Sleep is not repeated as an empty card. Activity-interval and Health Snapshot HRV remain available in the explorer but are not interpreted as nightly recovery. Health prefers a provider's dedicated overnight HRV over a generic Sleep-session average for the same account. Each displayed provider/account series builds its own rolling 60-day personal range from distinct recorded nights. Until 14 nights exist, the headline status stays neutral and shows baseline progress. After that, a rolling seven-day average with at least three recent nights is labeled and colored as within, outside, or far outside the current personal range; unusually high and unusually low values are treated symmetrically. Both the 14-day Highlight and the selected nightly-HRV explorer chart grade each observation against the personal range that existed on that date. Their segments, points, range band, and tooltip status use the same historical green/yellow/red/neutral meaning instead of inheriting the latest status. The shaded band moves with each date's personal range; hover or tap a reading to see **Range on this date**. The band continues across missing-reading days while at least 14 recorded nights remain in the preceding 60 days. Missing readings stay as gaps; dates without enough baseline history stay unshaded. Health loads a bounded earlier summary context to calculate a complete 60-day baseline for the oldest plotted date; that context does not expand the date range shown. This is a personal trend, not a medical interpretation. Health never creates a cross-provider headline average.

- **Choose a Highlight source.** When a Sleep, Heart rate, or HRV highlight has more than one source, its compact tabs keep each source’s latest reading visible and show one chart or Sleep summary at a time. Your selected source is remembered separately for each highlight in your account settings. This is only a display choice: it never blends readings, changes calculations, or filters the metric explorer. If that source is temporarily unavailable or excluded by the Sources filter, an available source is shown without overwriting your saved choice. A single source needs no tabs.

- **Today’s heart rate** shows recorded heart rate throughout your current local day: Garmin’s 15-second samples or Suunto’s interval averages. The latest reading includes its recorded time; it is not a live sensor feed. A source appears only if it has eligible readings today, and the whole highlight is hidden when none do. Sleep heart rate, resting heart rate, HRV-associated readings, snapshots, and daily or seven-day summaries are not substituted. Changing the explorer’s date range does not change this highlight.

## Explore a metric

- **Sleep readings also appear in their own metric charts.** Sleep duration and Sleep score use your recorded sessions, including Suunto, Garmin and COROS when available. When Suunto supplies adjacent records for one physical night, Health, Dashboard, Calendar and Training show the same combined night while retaining both provider records for audit. HRV is weighted by the recorded sample counts; if the fragments cannot be reconciled safely, no canonical HRV is shown instead of choosing the last record. The same sessions can also supply average/minimum sleep heart rate, resting heart rate, maximum blood oxygen and average respiration. These readings appear in both Health and dashboard previews without importing them again. Only values actually supplied by the provider are shown. Sleep and nap readings stay separate from all-day readings; minimum heart rate is not a resting-heart-rate measurement, and maximum blood oxygen is not an average.
- The Health explorer omits **Distance**, **Active duration**, and **Altitude** to keep the metric list focused. Their imported data is retained. Steps, floors climbed, and moderate/vigorous intensity minutes remain available when recorded. Garmin distance and active duration are daily movement totals; Suunto altitude comes from its 24/7 readings, not workout ascent totals.

- Health opens on **Resting heart rate · 30d** when that metric is available. The explorer shows metrics found anywhere in your imported history or saved measurements, regardless of the currently selected date window; Weight and VO₂ max also remain available because those values may exist only in your workouts. You do not need to find a metric in the explorer to add your first measurement: use **Add measurement** in the Health header. Sleep appears when a normalized Sleep session exists. HRV also appears when the loaded selected or recent Sleep sessions contain average or overnight HRV, even if no standalone Health HRV record exists. Health and Sleep availability are checked independently. If either check fails, only that domain stays unfiltered rather than risking hidden valid data. Use **1d**, **14d**, **30d**, or **90d** for detailed sample readings. **1y** remains available for readings with daily summaries; it is disabled, and an older saved view is returned to **90d**, when the selected source is sample-only. Heart rate can still use **1y** when QS can calculate its existing daily summaries from recorded intervals. Use the older/newer controls to move the selected window. The one-day range identifies **Today**, **Yesterday**, or the inspected date as you browse; a compact Today action returns the date window to the current day. Your selected metric and range are saved to your account without adding URL query parameters. The older/newer position and provider filters remain local to the open workspace and reset when you return later.
- Detailed sample charts are available for 1d, 14-day, 30-day, and 90-day windows. The 1-year window uses summary observations, including the calculated Heart rate summaries described below. If a source has only detailed readings with no supported daily summary, Health names the omitted source, returns an older saved 1-year selection to 90 days, and prevents selecting 1 year for that source. The one-day view does not imply that every metric is continuous: coverage depends on what the provider recorded and delivered.
- **Read Heart rate charts by their time period.** Garmin's **7-day average** is its reported rolling value, not a daily average or the average of your selected range. Provider daily minimum/maximum values cover the recorded monitoring period, which may be incomplete. **Heart rate throughout the day** shows Garmin's 15-second representative samples or Suunto's interval averages; those are individual intervals, not daily averages. Through **90d**, QS shows the supported detailed intervals already in your account. For **1y**, QS calculates daily summaries from those intervals. Each daily mean is the unweighted arithmetic average of the available readings; missing intervals are not filled or assumed representative of the rest of the day. Suunto's calculated lowest/highest interval averages are **not the day's true heart-rate extremes**. If recorded interval minimums/maximums exist, they remain separately labeled. Garmin's provider-reported extrema remain intact and its calculated daily mean stays separate from the 7-day average. All calculations are source/account-specific, retain partial or unknown coverage, and are marked **Calculated by QS**. They are calculated when you open the view, not written back to provider data. Existing load limits still apply: an interrupted boundary day is omitted and an incomplete-result notice asks you to narrow the range. No reconnect or new history import is needed for already-stored readings.
- Totals use bars, scalar readings use lines or points, and categorical states use stepped series. Chart dates and tooltip times use the timezone offset recorded with each provider reading, so a local day is not relabeled as the preceding UTC day. Stress state uses horizontal state blocks instead of a connecting line, making each recorded period easier to scan without implying a smooth transition. It keeps every category explicit and uses the app palette consistently across blocks, axis labels, and tooltip markers: relaxing or resting is green, active blue, passive gray, and stressful red. The state name and vertical position remain visible, so color is never the only signal. Every provider, connected account, aggregation, semantic variant, origin, recording method, and unit stays in a separate series. Provider-native or non-comparable readings are labeled and isolated from canonical readings.
- Use the local source filters to focus on one or more providers. These filters are separate from your saved Highlight choices and are not saved. When one provider has multiple connected accounts, Health shows local labels such as **Garmin account 1** instead of an account identifier.
- Open **Sources** beside the Health title to filter Highlights and every metric, then tap **Apply**. **Cancel** leaves the view unchanged. The button shows when a source filter is active. Your selection stays in place when changing metrics or dates; a source with no readings does not silently switch to another provider. Choose **Show all sources** in an empty filtered view to clear the filter. A lone source is shown without a redundant checkbox.
- **Open a Highlight.** Use **Open Sleep**, **Open Today’s heart rate**, or **Open HRV** to jump to that metric in the explorer. This also works when the metric is already selected, and keeps your current date range and source filters.
- **Choose a metric.** On mobile, tap the metric title and its arrow to open **Choose metric**. Available metrics are grouped by category, with your current choice marked. Tap a metric to switch immediately; closing the picker changes nothing. Desktop keeps the metric list beside the chart. Your metric selection is remembered in your account settings.
- Date controls stay beside the chart. On phones, tap the compact range dropdown between the older/newer arrows; desktop keeps its inline range toggle. The inspected dates and **Today** jump stay visible below the metric heading. Range changes do not change Highlights or your source selection.
- **Add to dashboard** beside the selected metric opens its chart preview. Your current provider filter seeds the reading selector. The new tile uses the same range length and starts with the latest period, even if you were browsing older dates. Choose **Add to dashboard** to save it, or return without adding. If that metric is already present anywhere on your dashboard, **View on dashboard** takes you to the existing tile without changing its settings. This shortcut does not clear the Health library’s **New** badge.
- **Add a measurement.** Use **Add measurement** at the top of Health, then choose Weight, VO₂ max, Blood pressure, Body fat, Muscle mass, Body water, Bone mass, or Blood oxygen (SpO₂)—even if that metric has no history yet. Weight is a measured weigh-in; body fat and body water are percentages. Muscle mass and bone mass are masses from your body-composition result, not muscle percentages or bone-density scores. Blood oxygen is a saturation reading recorded with its measurement time. For blood pressure, enter systolic and diastolic from the same measurement, with optional pulse taken at the same time. VO₂ max also records whether it is General, Running, or Cycling and whether it came from a lab test, field test, or another estimate. Weight input and display use your **Settings → Units & formatting → Customize units → Weight** choice (kg or lb), independently of distance; saved measurements remain in canonical kg. After saving, Health opens that metric and date using your current range. Manual readings use the same metrics as provider readings, with **Manual** as their separate source. You can edit or delete your own manual rows from **Source observations**; stale edits are rejected instead of overwriting a newer change. Editing or deleting a blood-pressure row affects both readings and any pulse saved with them. The form does not diagnose or interpret your readings.
- **Measurement input limits.** Readings must be positive numbers within the limit shown below each field; zero and negative readings cannot be saved. Percentage readings cannot exceed 100%. Decimals are supported. Leave optional pulse empty if it was not measured. These limits catch invalid input, not whether a reading is healthy.
- **Weight from workouts is fallback profile context, not a weigh-in.** Health reads one value from each parent event so a multisport file does not repeat the same profile Weight for every child activity. It appears only when the active provider-filtered view has no real provider or manual Health Weight measurement, and it is never plotted as a weigh-in.
- **Workout VO₂ max is separate evidence.** Health reads each activity so Running, Cycling, and other disciplines keep their meaning, collapses consecutive unchanged estimates within the same source and discipline, and never merges them with provider Health or manual VO₂ max. When one provider supplies both kinds, labels such as **Garmin Health summary** and **Garmin workout VO₂** describe the evidence instead of implying that another Garmin account is connected.

## Read source quality and status

- Series show device attribution when supplied, coverage, and freshness. Partial coverage, superseded sample revisions, conflicts, and bounded-load limits are stated explicitly. A conflict means comparable source observations disagree; both readings remain visible.
- Expand **Source observations** for the accessible table. It lists source, device, reading, semantics, coverage, freshness, and conflict state without displaying opaque account keys.
- Workout-backed Weight and VO₂ max are read on demand from your already imported events/activities through an authenticated bounded query. They are not copied into Health storage, and the Health response omits workout IDs, names, locations, account IDs, and raw creator details. Manual Weight and VO₂ max are stored in your owner-scoped Health history with Quantified Self as their source and are removed by account deletion with the rest of that history.
- **Sleep** continues to use the normalized Sleep model and existing Sleep trend. Health resolves typed references to those sessions rather than copying Sleep values into another model. For legacy or otherwise unreferenced sessions, Health can read average and overnight HRV directly at display time. Sleep-derived HRV remains a separately labelled series, is never averaged with standalone HRV, and is suppressed when an equivalent typed Sleep reference is already present.
- The **Sources** sheet shows each provider's recency, latest update, and connection status, and links to **Connectivity** for connection and import management. A small indicator beside Sources flags delayed updates or a source needing attention; open the sheet for the explanation.
- A small spinner beside the inspected dates shows when your view is being saved or more source readings are loading. Available charts stay visible; hover over the spinner for the status. A failed save keeps your view active and offers **Retry**.
- Loading, empty, permission, reconnect, failure, disconnected, and unsupported states link to **Connectivity** when an account action is available. Disconnecting stops future imports but keeps existing Health history; deleting your Quantified Self account removes user-scoped Health records, samples, sync state, and Sleep sessions as described in Policies.`;

const TRAINING_ANALYSIS_HELP_CONTENT = `## What Training is for

- Preview readiness history, sport mix, Best Build comparisons, power systems, and durability on the [Training analysis overview](/features/training-analysis). These interactive examples use synthetic data; your signed-in Training workspace uses your recorded evidence.
- **Training** is a fixed analytical workspace rather than a set of draggable dashboard tiles. Its **Data through** date identifies the UTC day covered by the derived 28-day analysis, rather than your device clock. It opens on **All training**, where the global **28-day status**, **Readiness today**, **What drove this**, **Load trajectory**, overall **Training mix**, and body-weight context stay together. Switch to one sport for **Best build vs now**, detailed Training Mix, **Power systems**, **Durability**, and other capability-matched evidence without changing any calculation.
- While Training insights are updating, a compact **sync icon** beside the **Training** title spins. Tap it to expand the update details; available last completed values stay visible during a refresh. The icon stays still when reduced motion is enabled. A failed update shows a warning icon and **Retry**. The details close and the icon disappears once the update finishes. The optional imported recovery snapshot affects this status only while an active **Recovery left** estimate is visible.
- Use the app navigation for **Calendar** and **Dashboard**. Manage **Timeline notes** from Dashboard, Health, or Calendar; supported Training charts still show those notes. Training feedback is available through **Email Training Feedback** in this guide.
- Use **All sports** on desktop to switch between **All training** and the established Running, Cycling, Swimming, Rowing, Walking & Hiking, Nordic Skiing, Strength, or Paddling groups. **Fitness & Gym** appears when recorded general training, conditioning, equipment, mobility, or fitness-class activities exist; **Other training** appears when a recorded sport does not belong to a modeled family. These two volume-only groups are discovered from workouts, not from TSS, zones, power, or durability evidence. On mobile, **All** and your compact swipeable sport buttons switch the common views in one tap; the compact **All sports** arrow button opens every currently available sport with the current view marked, and **Manage sport shortcuts** moves shortcut editing into that same picker. Your last destination is saved to your account, not the URL. **Shortcuts** pins up to four available sports for faster desktop and mobile switching. Until you save shortcuts, Training ranks them automatically from training duration and workouts in the latest 28 days, with saved sport benchmarks as fallback evidence. Existing buttons keep their places while refreshed sport evidence arrives, so the selected shortcut does not jump along the row. A fixed shortcut choice remains until you change it, and **Use automatic selection** restores automatic behavior. Shortcuts change navigation only and never hide a sport from totals or the complete picker.

## Sports and multisport activities

- Running keeps road, trail, treadmill, indoor, and virtual contexts separate where that changes the available summary. Cycling includes road, indoor, virtual, e-bike, hand cycle, velomobile, standard mountain biking, Enduro MTB, and Downhill MTB. Swimming separates pool and open water. Rowing separates indoor and on-water sessions. Walking & Hiking includes Walking, Nordic Walking, Hiking, and Trekking. Nordic Skiing includes cross-country, Nordic, and roller skiing. Strength includes Strength Training, Weight Training, and Kettlebell. Paddling includes Canoeing, Kayaking, Paddling, and Stand Up Paddling. Fitness & Gym includes generic Training and Indoor Training, cardio/HIIT/circuit/CrossFit sessions, common gym equipment, Yoga, Pilates, flexibility, stretching, and gymnastics. Known sports outside those modeled families—such as ski touring, snowshoeing, surfing, or sailing—remain visible under volume-only **Other training** instead of being guessed into a nearby physiological model.
- Multisport files are evaluated one activity leg at a time. A triathlon can therefore add separate Running, Cycling, and Swimming workouts; other registered legs behave the same way. The parent event itself is not counted as an extra workout. Merged events and activities without an eligible parent event are excluded.
- Standard Mountain Biking uses the normal Cycling endurance analysis. Enduro and Downhill stay within Cycling but use gravity-aware volume summaries: Training shows reliable recorded values such as time, distance, ascent/descent, descent time, jump count, the longest recorded jump, grit, or flow when present. Longest jump is the maximum persisted jump distance across the comparison window, not a sum or average. It does not invent downhill runs or uplift/lift segments, does not interpret zones or TSS as gravity-specific load, and does not show steady-aerobic durability for those contexts.
- Changing destination changes only which presentation is open. **All training** retains the overall comparison, **What drove this**, global load, intensity, sleep, and body-weight context. A sport destination shows only that family's **Best build vs now**, detailed Training Mix, and capability-matched specialist cards. Power systems still discovers every exact canonical activity type independently: registered types appear under their sport, while unmatched types appear under **Other power activities**. It never combines related types into an all-sports value.

## Best build vs now

- **Best build vs now** is available for the eight modeled benchmark families: Running, Cycling, Swimming, Rowing, Walking & Hiking, Nordic Skiing, Strength, and Paddling. Fitness & Gym and Other training are volume-only navigation and mix groups; they do not accept a benchmark or expose specialist evidence. Set one saved benchmark per supported sport from a manual end date or any eligible historical event. A multisport event may anchor separate benchmarks for each represented family. Events tagged exactly **Race** (case-insensitive) are shown first as quick picks, but selecting an event never changes its tags. The picker identifies its latest 100 other historical events by distance, duration, and TSS when available, and can order them by latest, longest, or highest load. An event is only an anchor: its workload is excluded from the benchmark.
- Choose an 8, 10, or 12-week build (12 weeks by default). The saved benchmark must finish before the matching current window, so comparisons never overlap. Merged events are excluded; missing TSS, zones, or durability evidence remains unavailable instead of being counted as zero. Durability rows require the same output or pool context and at least two eligible samples in both windows.

## Load and readiness

- **Load metric history** adds small 8-week columns below CTL, ATL, Ramp, ACWR, Strain and Form now on Training Overview. They show available weekly observations with a zero baseline; missing weeks stay gaps rather than zero. Tap a column on mobile or hover on desktop for its date and value. Monotony stays numeric because its snapshot has no Monotony history. The +7-days mini-chart is a dashed no-additional-load scenario, not recorded history or a prediction.
- The top **Training state** is a conservative label from the current TSS-derived Form model: Form (CTL minus ATL), 7-day CTL ramp, current CTL, and current ATL. The info control beside the current label shows those exact contributing values and explains the selected state. On desktop it opens a details menu; on a phone it opens the same content in a proper dialog rather than a transient tooltip. **Balanced** means none of the Starting, overload, fatigued, building, fresh, or detraining thresholds applies. Sleep, sessions, and the 28-day time comparison do not change this label. Dashboard **Today** shows the same compact state label and caption before Readiness, with an explicit **TSS only** qualifier. While its Form/TSS snapshot refreshes, Training keeps the latest complete state visible and labels it as updating rather than treating it as a newly calculated result.
- **Training impact** appears for completed activities on your private activity details and selected Calendar days. On activity details, a compact strip sits directly below the main summary. **This workout’s contribution** shows the workout's load values; **Day result** says whether fitness load increased, decreased, or stayed steady after accounting for the gradual fade of previous training load. The day result includes all training counted for that day, not only this workout. Open **How it’s calculated** for the formulas, model limitation, and fixed daily cutoff, which may differ from local midnight. Each activity contributes its TSS divided by 42 to **Fitness load (CTL)** and its TSS divided by 7 to **Fatigue load (ATL)**; **Freshness (Form)** is the CTL contribution minus the ATL contribution. This is a TSS-based load model, not measured physiological adaptation. Missing TSS stays unavailable, and a refreshing Form snapshot shows an updating state instead of a calculated guess. Merge and benchmark records remain excluded from Training and their event detail pages do not show Training impact. Public activity shares and planned workouts do not show Training impact.
- **Training impact recap** appears first under **Load trajectory** on Training Overview. It defaults to the last 7 completed UTC Training days and can show 28 days; both periods end yesterday in UTC so today's partial load is excluded. **Training contributed** is total TSS divided by 42, **Normal decay** is the part of CTL change caused by the daily model, and together they equal the **Actual change**. The card also shows total TSS, the exact number of completed parent activities with valid current or legacy TSS, and how many UTC days rose, held, or declined after decay. Valid zero TSS counts as an activity, while missing TSS and merged benchmark events do not. Seven days use daily bars; 28 days use four consecutive 7-day blocks. A refreshing snapshot keeps the last complete recap with an updating label, and older data is rebuilt instead of guessing activity counts. The recap is private to Training Overview and does not appear on sport destinations, Dashboard, Calendar, event details, public shares, or planned workouts.
- **What drove this** compares the current 28 days with the median of the prior three 28-day blocks. It separates parent-event TSS from child sport-group load, shows top parent-event contributors, keeps Other and unclassified child activities visible, reports load coverage, and compares sport-specific training rhythm. **Largest sport load change** and **Largest rhythm change** identify the selected driver sport inside this all-training explanation; they do not mean that the workspace is filtered to that sport. When every eligible difference is effectively unchanged, the card uses a neutral comparison title instead. Raw load and composition changes use neutral higher/lower language because a larger load is not inherently good or bad.
- **Readiness today** uses the same current formula as Dashboard Today. On first opening Training, it waits for both load and sleep to finish loading before showing a score. If a completed read has no eligible sleep, it shows the available load-only result; an unavailable source is identified separately. It combines derived Form/ramp with recorded sleep and overnight HRV. **HRV · 7-day average** compares the last seven days with your rolling **60-day personal range**, using the same calculation as the Health and Dashboard HRV charts for the same source. Current HRV requires one authoritative observation from the latest completed main-sleep night, no more than 48 hours old. When Suunto supplies adjacent records for one night, the app combines records separated by at most 30 minutes and weights their HRV by the recorded sample counts; it does not simply use the last record. If the latest night has no HRV or its fragments cannot be reconciled safely, the card shows **No current HRV** and does not reuse a previous value. With at least four recent same-source nights, the status also says whether the recent series is rising, stable, or falling. That direction is descriptive and does not change the range classification or Readiness score. It needs at least 14 recorded baseline days and three recent days; otherwise it shows what is missing. Changing a chart to one year does not change these windows. Values outside either end of your range reduce the HRV contribution; unusually high HRV does not earn an automatic bonus. Sleep score and Overnight HR use a main night no more than 48 hours old. Average and minimum sleep HR retain their separate comparison with up to 14 prior nights from the same provider within 30 days, requiring three matching values. Average HR leads the single Overnight HR driver at 70%, minimum HR contributes 30%, and either can stand alone when the other is missing. Lower Overnight HR versus personal baseline supports readiness; missing evidence is never zero. Current normalized Suunto sleep records can provide both HR measures, COROS records can provide average HR, and Garmin Health sleep summaries currently provide neither normalized sleep-HR measure. **Readiness is recovery-aware; Form, Freshness, CTL, ATL, forecasts, and the Training state remain TSS-only.** An active imported post-workout estimate appears as **Recovery left** in the separate Recovery context; it never changes the score or Freshness. Readiness re-evaluates automatically when time alone makes a future record eligible, expires the latest night, or removes baseline evidence. Score, status, confidence, calculation time, driver freshness, and missing signals remain separate. Failed or stale load, recovery, or sleep sources contribute no current value. A sleep refresh failure clears previously loaded readiness sleep evidence immediately, while independently current load-only context can remain available. Its short training implication is context, not a workout instruction.
- The **14-day trend** is a backend-derived daily series built with the same formula. A readiness-only refresh reuses the prepared Form snapshot and a bounded sleep envelope, without scanning activity history; each daily point applies its own 60-day HRV range and seven-day average (with the separate 30-day window for Overnight HR). Each point uses only evidence available by that UTC day cutoff, and missing scores stay as gaps. Today's chart point follows the live current result only when the retained series reaches the current UTC day.
- Readiness and eligible sleep scores use accessible 0–100 bars with markers at the Readiness category boundaries. Confidence remains separate from the score, and the four small evidence segments show how many Load, Sleep, HRV, and Overnight HR signals are available. HRV shows its seven-day value and 60-day range as text. The Overnight HR bar is centered on the user's usual value; lower Overnight HR can be supportive, while missing evidence leaves the bar empty rather than showing zero.
- **Recovery context** groups an active **Recovery left** estimate with expandable **Sleep history** inside Readiness today. The countdown includes its estimated local recovery day and time and remains visible while sleep details are collapsed. Use **Show sleep details** and **Hide sleep details** to open or close the recorded-sleep comparison. Sleep history places recorded overnight sleep beside training without changing the Training state or claiming that sleep caused a performance change. It compares the current 28 days with the preceding 84 days. Every ready **Best build vs now** card separately keeps sleep where it directly compares the exact current and saved benchmark ranges, with full metrics and source notes under **Details**.
- Sleep history first reconciles adjacent Suunto records from the same account and wake date, then uses the longest valid main overnight record from each provider per sleep date; naps are excluded. Average sleep appears with at least three recorded nights, while bedtime variation and overnight HRV need at least five qualifying nights. Bedtime variation uses only nights with a trustworthy local timezone offset, including the offset retained on older Suunto sleep timestamps; a night without one can still contribute duration and HRV. Missing nights and missing HRV are never counted as zero. These 28/84-day and build comparisons do not create a readiness score. Readiness today can use a provider sleep score or recorded duration, but does not blend sleep stages, SpO₂, or respiration.
- Deltas require the same sleep provider in both windows and sufficient coverage in each: at least seven recorded nights and at least half of the window. When coverage is limited or providers differ, Training can show the available values but withholds change claims. This protects comparisons when a device was connected late or changed between builds.
- When a recent activity supplies a still-active device recovery estimate, Training shows it as **Recovery left** with the estimated local recovery day and time. It updates each minute, is omitted quietly when missing or elapsed, is not a readiness score, and does not change the Training state.

## Training mix and sport context

- On **All training**, Training Mix gives every recorded registered family a compact current-versus-usual workout, duration, and available TSS summary, followed by the global intensity chart. Workout and duration use the normalized 84-day baseline; TSS uses the median of the three preceding 28-day blocks when that family's recorded load is eligible. A sport destination expands only that family's latest 28 days versus its normalized 84-day baseline. Context summaries keep materially different environments separate and show only recorded metrics appropriate to that profile: for example ascent/descent for vertical sports, gravity MTB jump count and longest jump, swimming/rowing/paddling stroke rate, distance-weighted 500 m rowing pace plus stroke distance, and elapsed time without distance for Strength. Best build comparisons use the same context metrics. Missing TSS, zones, or profile metrics stay unavailable rather than being interpreted as zero.
- Training Mix and Best build use the same approximate intensity groups as Intensity Distribution: **heart rate: Easy Z1–Z2, Moderate Z3, Hard Z4–Z5**; **power: Easy Z1–Z2, Moderate Z3–Z4, Hard Z5–Z7**. Each activity uses usable power zones first, otherwise heart rate. Missing zones do not contribute intensity time.
- Swimming pace uses 12 UTC-aligned weeks and keeps pool and open-water evidence separate. Its compact x-axis uses **W35**-style markers; **W** means a Monday–Sunday UTC week, while the tooltip gives the full date range. It uses only stored **Average Swim Pace**, weighted by swimming distance; elapsed duration is never used to estimate pace because rests would distort it. The chart follows your /100 m or /100 yd setting.
- Pool SWOLF is shown only for stored active lengths that share the dominant stroke and pool-length context. SWOLF from different strokes or pool lengths is not comparable and is not blended. See [Garmin's SWOLF guidance](https://support.garmin.com/en-US/?faq=z7QHGpBDDH7wDJsSKjxRi9).
- Training does not infer Critical Swim Speed (CSS) from normal workouts. Reliable CSS requires deliberate maximal-distance trials, commonly 200 m and 400 m; see [Garmin's CSS protocol](https://support.garmin.com/en-US/?faq=h56ydwZxU8A7oi2OSh0y66) and the [critical-speed reliability evidence](https://pmc.ncbi.nlm.nih.gov/articles/PMC10875687/). Missing swim pace, active lengths, or comparable SWOLF remains explicitly unavailable.

## Evidence and missing data

- When a derived comparison is missing or rebuilding, Training says it is preparing rather than showing a zero-session result. A confirmed empty state means no eligible activity leg was found in the latest 28 days.
- **Durability** replaces the old aggregate efficiency trend on Training. Its Running, standard Cycling/MTB, Pool, and Open water tabs compare the current 28 days with the median of the prior three 28-day blocks, expose candidate and eligible activity coverage, preserve output and pool-length/stroke contexts, and show primary exclusion reasons. Recent supporting workouts use each workout's local start date and time, rather than an imported source label. The trajectory retains a 12-week UTC summary, but, when a later candidate workout exists, collapses an uninterrupted leading run with no candidates into a short note; later no-workout weeks remain visible as gaps. On phones, its x-axis uses compact **W35**-style markers, where **W** means a Monday–Sunday UTC week; wider screens show the week-start date, and a tooltip always gives the full range. Training shows a tab only for a scope with recorded candidate or summary evidence somewhere in its retained current, usual, baseline, or weekly windows, so a no-data Pool scope never appears beside recorded Open water evidence; this rule applies to every supported discipline. If a selected sport has no durability evidence at all, Training says so without showing tabs. Recorded candidates with no eligible result stay visible to explain missing evidence and exclusions. Enduro and Downhill are explicitly unsupported because the steady aerobic protocol is not a valid gravity-run model; Rowing does not have a durability adapter in this release. A context needs eligible evidence in at least two prior blocks before Training calls it usual. Each supported context also plots a readable 12-week durability trend: aerobic decoupling for Running, standard Cycling/MTB, and Open water, or pace retention for Pool. The fixed Cycling power context remains visible even when none of those weeks has an eligible point, so its candidates, confirmed power, eligible counts, missing processed evidence, and primary exclusions remain inspectable. A Cycling Power Curve proves that power was recorded, but it does not by itself make the ride comparable durability evidence; cycling also needs paired heart rate, sufficient duration and coverage, steady output, and no more than 20% in zones 4–7. Cycling trajectory bars show power-recorded activities while their labels show eligible / power-recorded counts. Missing processed evidence is reported as power unknown rather than confirmed no power. Unsupported Enduro and Downhill evidence is not counted as confirmed power because the steady-aerobic check rejects those contexts before inspecting their power stream. Weeks without a comparable session explain their primary exclusions instead of being called simply empty, and lines never bridge those gaps. A lower output-to-heart-rate ratio later in one session can suggest a fade only when you intended a similarly steady effort; intentional easing, terrain changes, coasting, or a pace change can produce it too. Use repeated comparable sessions as a trend, and treat missing durability as no suitable comparison rather than zero. Evidence is generated when supported activities are processed; older activities that have not yet been reprocessed stay explicitly missing. Activity-level timelines remain on event detail pages and are not persisted in Training snapshots.
- **Body-weight trend** appears last on Training as secondary, neutral context. Provider and manual Health Weight measurements stay source-separated. If any Health Weight exists, Training ignores workout profile Weight; otherwise it labels those workout values as fallback context rather than weigh-ins. Each source reduces multiple measurements on one UTC day to a median, shows the latest value plus 7- and 28-day medians in your chosen units, and plots the latest 28 days without joining gaps. A 7- or 28-day change appears only when both equal-length windows have at least three recorded days. It is not a health assessment and does not change the Training state, Form, Readiness, or a workout recommendation.
- **Power systems** is available to every signed-in Training user from the matching sport destination, or from **Other power activities** when an exact canonical type is outside the Training sport registry. It estimates current CP, W′, and Pmax for each exact canonical activity type from its stored power curves. For a calculation date, it uses only that type's preceding 42 completed UTC days: the same day and all future workouts are excluded. There is no pooled all-sports value, and Cycling is not combined with Indoor Cycling, mountain biking, Rowing, or any other type.
- Power systems shows today plus sparse workout-date points from the latest 12 weeks. A value appears only when Sports-lib marks that component ready; partial, insufficient, poor-fit, unstable, and invalid evidence remains explicit instead of becoming zero. CP is the modeled sustained-power boundary, W′ is the modeled work capacity above CP, and Pmax is the modeled short-duration power ceiling. CP and W′ have separate stability decisions: stable CP can remain visible when W′ is unstable, while dependent Pmax stays unavailable. When W′ is withheld, **What this means** explains whether one workout supplied all retained sustained bests, whether removing it leaves no CP/W′ refit, the competing W′ estimate range, and why Pmax remains unavailable; that range is evidence of disagreement, not a reported W′ value. Diagnostics distinguish every usable power curve from the smaller set of workouts that actually supplied the retained sustained and short-duration envelope anchors, and show fitting-method disagreement, single-anchor removal, and whole-workout removal separately. A type selector appears only when more than one exact activity type is available. New power curves remove isolated one-sample recording artifacts before persistence; the fitter also rejects and counts their short-curve signature in older stored curves. This is capacity evidence—not TSS, FTP, fitness, fatigue, Readiness, or a workout prescription.
- Parsing a workout no longer generates CP, W′, Pmax, or power-system strain. Existing Training snapshots rebuild from stored power curves without reparsing source files. A future workout-strain phase would need the original continuous power stream because a power curve does not preserve the order of work and recovery; this release does not calculate or aggregate strain.
- Imported capacity markers remain separate from rolling power systems. **FTP setting** is the latest positive FTP imported with an eligible Running or Cycling activity; repeated carried values are deduplicated and shown with when that setting was first and last seen. A value that exactly matches the session-derived estimate of 95% of that activity's 20-minute best is not presented as an imported setting.
- **Imported VO₂ max** is a separate aerobic marker, never a readiness score. A manual Running or Cycling lab/field VO₂ max can appear beside it as a labelled reference. Training compares the two only when the nearest imported estimate is within 14 days, never merges them, and never compares either one with FTP or power-system thresholds.
- Missing or unreliable inputs remain explicit. Training does not infer LT1/LT2, race readiness, a universal athlete score, or workout-execution scoring.
- Training power-profile callouts compare the best 90-day curve with the best one-year curve at 5 seconds, 1 minute, 5 minutes, 20 minutes, and 1 hour. They use bounded reciprocal-duration interpolation, never bridge duration brackets wider than 1.25×, show both activity counts, and call out the strongest retained duration and clearest gap. Missing comparable anchors stay explicit.`;

const TRAINING_PLANNING_HELP_SNIPPETS = {
  gettingStarted: "- **Plans** lets you create standalone workouts or organize them into dated plans without connecting a service. Open the [Training plans guide](/help#training-plans).",
  calendarDetails: "- Planned workouts appear in their own section with links to edit them and actions to add a workout for that date.",
  calendarOverlays: "- The calendar shows standalone workouts plus workouts from the active plan. Inactive-plan workouts remain in [Plans](/training/plans), and skipped workouts stay visible with a separate marker.",
  calendarColors: "- Planned-workout icons and the leading edge of their detail rows use the plan's color. Choose it in **Plans -> Plan actions -> Plan color**; **Default** follows the app theme. Standalone workouts stay neutral. The dashboard tile and Year view use slim color marks on the right edge, dashed for skipped workouts. The Today calendar popup places these marks below the day. Mixed days keep a mark for both the active plan and standalone workouts; open the day for all workouts and counts. Completed activity circles keep their sport colors.",
  calendarTotals: "- Planned workouts never change recorded period totals, activity counts, activity-group bars, or the activity table.",
} as const;

const TRAINING_PLANS_HELP_CONTENT = `## Create plans and workouts

See the public [Training Plans overview](/features/training-plans) for a walkthrough, interactive sample calendar, and read-only workout profiles. Choose a sample workout to inspect its steps and targets. The samples use synthetic workouts and never load account data or save changes.

- Open [Plans](/training/plans) to create a dated workout. Its sidebar entry sits beneath **Training**. You do not need to create a plan first: choose **Standalone** to keep the workout independent, or use the active plan when you want it grouped into a date range.
- Select a plan or **Standalone**, then use **Add workout** in that view. Each saved workout editor has its own link, and browser Back and Forward return between the editor and the previous plan, Standalone, or Calendar screen. **Save workout** keeps you in the workout's chosen destination, while **Cancel** returns without saving. Dates within the plan stay selected, and Save and Cancel stay available while scrolling on mobile.
- **Plan schedule** shows only the selected plan, even when paused or archived. Its start and end are marked; the full month stays visible at either boundary, while dates outside the plan are muted and unavailable. Navigate its months, select a day, then use **Add workout** to prefill that day and plan. Empty days are simply unscheduled—not automatically rest days. On desktop you can edit a workout directly from its calendar label; on mobile, select its day to see the compact workout rows below the grid. **Calendar**, available from the app navigation or Dashboard, remains your separate overview of completed activities, standalone workouts, and the active plan.
- The plan calendar follows **Settings -> Units & formatting -> Start of the Week**. Its first weekday is marked and named below the grid. Saturday and Sunday are subtly tinted wherever they fall in the week; these are calendar cues, not rest-day recommendations. Selected dates and dates outside the plan retain their separate states.
- Choose **Plan color** when creating a plan, or use **Plan actions -> Plan color** later. The color accents that plan's schedule and its workout markers in the main Calendar, dashboard Activity Calendar tile, and Today mini-calendar. **Default** follows the app theme, including for older plans. Standalone workouts stay neutral; completed activities keep their sport colors. Changing color preserves your selected date, and restoring plan history also restores its saved color.
- Use **Plan actions → Phases** to name parts of a plan, such as Base, Build, Recovery or Taper, or use your own names. Each phase has inclusive start/end dates, an optional description and a color that can inherit the plan color. Add, edit or remove up to 32 phases. Gaps and single-day phases are allowed; phases cannot overlap. Confirm any extension of the plan dates, and keep every current workout inside the range. A failed save keeps your draft; a concurrent change requires reloading.
- Phase names appear in the selected plan schedule and on the active plan's days in Calendar, including days without workouts. Paused and archived phases remain visible when you select their plan in Plans. **Shift dates** moves phases with the plan and workouts; plan history can restore edits or removed phases. Deleting the plan permanently removes its phases and history. Phases are labels you author: they do not create workouts, prescribe intensity, change readiness or mark completion, and are not sent to connected services.
- Workouts appear as compact rows with their sport, date, and ordered steps. When an exact stored activity link exists, the plan schedule, workout row, main Calendar, dashboard calendar, and Today calendar mark the workout **Completed · activity linked**. That marker does not add a second activity or change completed totals, and it does not claim that every prescribed step was followed. Moving or rescheduling the workout keeps its existing link; a newly imported marker from an older sent date or plan does not create a link until that provider copy catches up. Use **Edit** beside a workout's title for its content, date, or plan association, and its actions menu for **Duplicate to…**, skip/unskip, history, and deletion. You can also duplicate a planned workout from the full day page or selected-day previews in Calendar and Dashboard. **Plan actions** beside the plan selector contains activation, pause, rename, date shifting, history, archive, and deletion.
- Plans and standalone workouts work without a service connection. Workout delivery to Garmin, Suunto, and Wahoo is available to connected Pro members through explicit plan opt-in or standalone Send actions. COROS plan sync and standalone Send are coming soon. Connecting a service does not send anything automatically.
- **Suunto sends individual SuuntoPlus Guides**, not a native Suunto plan. With sync enabled, QS sends today and the next six days in your saved delivery time zone. Later workouts show **Scheduled for later** and are sent automatically when their date approaches. Moving a sent upcoming workout beyond that window requests removal of its prior Guide until the new date approaches; QS cannot use cloud presence to verify its app or watch visibility, and past Guides stay unchanged.
- Suunto watch text uses simple punctuation and a short subtitle generated from your workout title. Your original QS title and instructions stay unchanged. These cosmetic adjustments happen automatically; shortened instructions or other meaningful differences still need your review before sending.
- **Sent to Suunto** means Suunto accepted the Guide for your account. It does not prove that the Guide is visible in the Suunto app, selected or pinned, or available on your watch. QS does not offer a Suunto visibility check: hiding or removing a Guide in Suunto can leave its cloud record visible to partners, while a missing record is not authoritative deletion evidence. QS therefore never recreates a Guide automatically from these records. Suunto may clean up hidden Guides after a later account reconnect, but reconnecting is not required or recommended as a normal QS workflow.
- **COROS workout delivery is coming soon.** Plan sync, plan-workout resume, and standalone Send are not available yet. COROS plan delivery will use individual workouts in the COROS training calendar rather than a QS-owned COROS plan. [COROS documents a two-week watch window and one training plan synced to a watch at a time](https://support.coros.com/hc/en-us/articles/360048955151-Creating-and-Using-Training-Plans). COROS does not provide a planned-workout read/list operation, so remote checking and automatic missing-copy restoration are unavailable.
- COROS compatibility checks can describe running, trail running, cycling, target-free pool swimming and complete strength prescriptions without sending them. Treadmill, Indoor Running and Virtual Running use the broad Run mapping; Mountain Biking, Indoor Cycling, Virtual Cycling, E-Biking, Hand Cycle, Velomobile, Enduro MTB and Downhill Cycling use Bike. These subtype substitutions need mapping review and keep your authored QS sport. Walking, Hiking, Rowing, Indoor Rowing and Open-water swimming have no supported COROS workout-delivery mapping. COROS's own app may offer other workout modes, but that does not make them available through its partner API. Local compatibility is not delivery or watch-receipt evidence.
- Completed Suunto FIT files may carry identifiers for QS Guides used during a session. When one marker unambiguously belongs to the same connected account and scheduled workout, QS shows **Completed · activity linked** and keeps the sent Guide. This means the Guide was referenced by a recorded session; it does not prove that every prescribed interval or target was completed. Conflicting or ambiguous markers stay unlinked. The Guide ID and account evidence remain private, and deleting the activity or your QS account removes the local link and evidence.
- Completed Wahoo activities can link to a QS-delivered workout through the exact API association or an exact Plan reference in the recorded FIT file under the same connected account. The FIT reference must identify one workout QS sent and one matching recorded session; QS never guesses from titles or dates. QS then shows **Completed · activity linked** and keeps the sent workout. This identifies the delivered workout referenced by the recording; it does not prove that every prescribed interval or target was completed. Missing, conflicting or ambiguous identifiers stay unlinked, and a second recording does not replace the first link. The service identifiers and account evidence remain private, and deleting the activity removes the local link and evidence.
- A completed Garmin FIT activity can link to a planned workout when its workout-file reference identifies one workout QS sent to the same Garmin account, with one current scheduled date and one recorded activity on that date. QS then shows **Completed · activity linked** and keeps the sent workout. Missing or conflicting evidence stays unlinked; a second recording of an already-linked workout does not replace the first. This does not prove the workout reached a device or that every step was followed.
- Choose the exact workout profile: Running, Trail Running, Treadmill, Cycling, Mountain Biking, Indoor Cycling, E-Biking, Hand Cycle, **Pool swimming**, or **Open-water swimming**. Running/cycling distance follows your km or mile preference and pace uses min/km or min/mi; changing units preserves saved distances. Swim steps use metres and pace uses your /100 m or /100 yd setting. For pool swims, optionally select a physical pool length in metres or yards, separate from step distance; blank means unspecified, and open water has no pool length. Suunto Guides recommend the matching swim exercise but do not receive pool length, so check the watch setting. Authorized MCP clients can also author Indoor/Virtual Running, Virtual Cycling, Velomobile, Enduro MTB and Downhill Cycling with v1 tools. Separate MCP read/preview tools support an authored pool length; step distance never implies pool size. Garmin receives broad Running/Cycling families for subtypes, with a review warning. The editor supports date-only scheduling, time, distance or lap-button-ended steps, fixed repeats and up to two different HR, power, speed/pace or cadence targets per step. Garmin can send compatible target-free pool swims with selected length; unspecified pools may fail on older devices. **Found in connected app** is not a watch receipt. COROS can encode target-free pool swims, but its new Send and plan-sync actions are **Coming soon**; it cannot encode open water. Garmin can deliver open-water workouts as **Generic**, not a native swim profile, after mapping review. Generic works only on some devices and does not guarantee native sport tracking or display; QS keeps your authored sport. Wahoo supports timed, untargeted pool/open-water swimming and outdoor/indoor rowing. Native profiles and timed intervals have been account/device-tested; distance endings and intensity targets remain unsupported. Selected pool length is not sent to Wahoo: its Cloud API has no documented physical pool-length field, so QS does not support sending that setting. QS never estimates distance steps into a duration.
- In the interval editor, choose **End by -> Lap button press** for warmup, work, recovery, cooldown, rest, or other steps, including steps inside fixed repeats. The step continues until you press the lap button, with no time or distance limit; it is a third ending choice, not a timer plus a button condition. Targets and instructions still apply. Garmin and Suunto support these manual transitions; COROS has the mapping but delivery remains **Coming soon**. Wahoo cannot receive lap-ended steps, and QS will not replace them with a guessed duration. Ending a step advances the workout; it does not stop the recording or mark the QS workout completed. An exact linked completed activity is still required for **Completed · activity linked**.
- **Targets:** choose **Add target** for heart rate, power, speed/pace or cadence. New cadence targets are offered for running and cycling; saved cadence on other sports stays editable. Each step can have two different kinds; use the arrows to change their order or Remove to return to an untargeted step. Choose **Absolute** or **Percent of reference**, then a range or single value. A single value stores equal bounds. Relative heart rate uses maximum or threshold heart rate, power uses FTP or critical power, speed/pace uses threshold speed, and cadence uses preferred cadence. Enter the reference explicitly; **80 means 80%**, and values above 100% are allowed. QS shows the resolved absolute range and keeps the saved reference snapshot when you reopen a workout, even if settings change. Editing the reference changes that prescription. Relative pace percentages describe speed, so a higher percentage means a faster pace; a zero-speed bound has no finite pace. Cadence keeps its canonical cadence meaning and does not imply swimming or rowing stroke-rate conversion. These controls also work inside repeats and in the Workout library. Provider/device support can differ, especially for a second target; review any mapping losses before sending.
- Reorder interval steps or whole repeat blocks with their **drag handle**, or open **Actions** and choose **Move up** or **Move down** with touch or keyboard. Steps inside a repeat move only within that repeat. **Duplicate step** or **Duplicate repeat block** inserts an independent copy immediately after the original, keeping its instructions, duration, distance, targets and repeat count. Edit the copy without changing the original. These actions work in Plans, Standalone and the Workout library; changes are saved only when you save the editor. Workouts allow 100 nodes in total, counting repeat blocks and their steps; copying requires room for the whole copy. Strength exercises use their separate editor.
- **Workout profile** shows your interval steps while editing, and **Show profile** opens a saved scheduled or library workout without editing it. Equal widths mean step order, not time or distance. Choose a **Target view** to see one metric at a time; both targets remain in the step details. Pace shows faster values at the top, with time marks in your selected pace units. Pool and open-water swimming show **Swim pace** in min/100m or min/100yd; outdoor and indoor rowing show **Rowing pace** in min/500m. The full prescribed range remains visible, including slow limits. Speed uses its normal numeric scale. Warm-up and cool-down targets stay constant unless your recipe specifies otherwise. Untargeted steps have labelled purpose markers and no invented intensity. Relative targets use their saved reference, not your current settings. A pace target starting at 0% has no finite range to plot; its instructions remain in the step details. Select a step or use arrow keys/Home/End for its ending, targets and notes; the matching editor step is highlighted. Large repeats show one pass at a time with a pass selector and the complete occurrence count. Every pass remains inspectable, and editing a repeat preserves the selected pass while it still exists. Invalid step details hide the preview until corrected. Strength uses its exercise editor.
- For **End by -> Time**, enter **Hours**, **Minutes**, and **Seconds** separately, including inside repeats and in the Workout library. For 1 minute 15 seconds enter 0 / 1 / 15; for 1 minute 30 seconds enter 0 / 1 / 30. Minutes and seconds must be below 60, and the total must be positive. Existing decimal-minute durations reopen with the correct time parts. Pace targets accept **m:ss**, for example **4:30**, in your selected running/swimming pace unit or rowing 500 m split; decimal minutes such as 4.5 still work. The Faster pace must not exceed the Slower pace. For cycling speed, choose **Add target**, select **Speed / Pace**, and choose **Presentation -> Speed** and enter the minimum and maximum in your selected speed unit, such as km/h or mph. The profile then shows Speed with round ticks in your selected speed unit. Target choices put Speed/Pace first for running, swimming and rowing, with **Swim pace** and **Rowing pace** presentation labels; cycling puts Power then Speed/Pace first. For running or cycling, choose the **Cadence** target kind and enter the minimum and maximum in rpm. Saved cadence stays editable for other sports. Cadence targets stay cadence when you change sport; they are separate from swimming or rowing stroke rate. Switching between Pace and Speed converts the range; switching to or from Cadence clears the numeric bounds so you can enter the new target. QS keeps exact saved durations and speed targets when you reopen and save without editing them; provider-specific delivery limits still apply.
- On a timed or distance step, **Allow early Lap** means the step ends at its prescribed limit **or** when you press Lap. It starts unchecked; older workouts keep their existing ending. **Lap button** is different: it has no numeric limit and waits until you press Lap. Suunto delivery supports the early-Lap option, including repeats. QS currently refuses Garmin, COROS and Wahoo delivery when it is enabled because their mappings cannot express this per-step choice faithfully. An unchecked option does not guarantee that a device prevents its own skip action. Finishing a step does not mark the workout completed in QS.
- The editor also supports exact **Walking**, **Hiking**, **Rowing**, and **Indoor Rowing** profiles with the same time, distance or lap-button-ended steps, fixed repeats, and absolute or relative targets. Rowing distance is entered in metres and rowing pace as a 500 m split; QS stores speed in m/s. Suunto sends Guides recommended for the matching exercise profiles (including Walking activity 0). Wahoo supports outdoor Walking/Hiking with timed steps and no intensity targets; distance steps and intensity targets remain unsupported for Wahoo. Garmin delivers these four profiles as **Generic**, after mapping review, not their native sport profiles. Generic works only on some devices; native sport tracking and display are not guaranteed, and QS keeps your authored sport. Generic preserves time/distance/manual steps, fixed repeats and one primary target; repetition/kJ endings and secondary targets are unsupported. COROS delivery for these four profiles remains unsupported. Wahoo supports timed, untargeted pool/open-water swimming and outdoor/indoor rowing. Native profiles and timed intervals have been account/device-tested; distance endings and intensity targets remain unsupported. Selected pool length is not sent to Wahoo: its Cloud API has no documented physical pool-length field, so QS does not support sending that setting. A sent workout is cloud acceptance, not a guarantee of app/watch receipt or completion.
- **Strength Training** has its own exercise editor: name exercises in order, then add sets of repetitions or timed holds, optional external load in your selected kg or lb weight unit, and optional rest after each set. QS stores the load in kilograms, and an unchanged displayed value keeps its exact saved weight. You can create, edit, copy, move, restore, and schedule these workouts like other planned workouts. Older app versions see only a compatibility summary and cannot edit the full prescription. Suunto delivers a Gym Guide with exercise/set instructions; rep-based sets require manual transitions and load is guidance, not native rep/load tracking. This standard limitation is explained when you Send or enable plan sync, with no separate approval for each workout or edit. Suunto load instructions follow your kg or lb choice in **Settings → Units & formatting**. QS checks for unit changes about every 30 minutes and updates eligible synced Guides; then sync your Suunto app and watch to receive the updated instructions. The watch's unit setting cannot convert weight already written into instruction text. Additional mapping losses, such as shortened exercise instructions, still need review; changing units keeps an existing approval only when those losses are unchanged. Garmin strength mapping preserves individual reps or timed sets, load and rest for supported exercise names. Native delivery has been verified through cloud create/edit/reschedule/withdrawal and owner-confirmed Garmin Connect/watch checks; this does not guarantee every device or exercise. Wahoo supports timed strength sets and rests as Gym workouts. Repetition sets are unsupported; QS never estimates their duration. Exercise names and loads are instructions, not native rep/load tracking. Wahoo load guidance uses kilograms while your QS editor still follows your kg/lb preference. The normal Send/sync review discloses this limitation; rounded load instructions need mapping approval. The COROS backend maps the complete strength prescription with named sets, reps or timed holds, optional rest and fixed external load in kilograms. New COROS Send and plan sync remain **Coming soon** pending account-side proof. Local compatibility does not mean COROS received the workout or that it reached your watch. Sent Guide status does not prove app/watch receipt or workout completion.
- **Garmin strength exercise names:** Barbell back squat, Barbell front squat, Goblet squat, Squat, Barbell bench press, Dumbbell bench press, Barbell deadlift, Romanian deadlift, Barbell biceps curl, Dumbbell biceps curl, Plank, Side plank, Push up, Pull up, Lunge, Seated cable row, Barbell row, Dumbbell row, Barbell shoulder press, and Dumbbell shoulder press. Case, spaces, hyphens and underscores are accepted. Other names remain manually plannable but cannot be sent to Garmin; QS never guesses equipment or substitutes another exercise. Garmin receives loads in kilograms and currently displays its load field in kilograms; your QS editor still follows your kg/lb preference. Confirm the workout in Garmin Connect and on your device before relying on it.

## Suunto Guide screens and interval alerts

- **Guide targets and readings are different.** QS currently sends heart-rate, power, speed/pace and cadence targets. A swimming stroke-rate reading is not an authored stroke-rate target; SWOLF targets are not supported yet. **ZoneSense targets are not supported in SuuntoPlus Guides**, even if your watch offers ZoneSense in a sport mode. A watch resource or measured screen field alone does not establish a supported Guide target. Relative targets use the reference snapshot saved with your workout, not a percentage of an unknown watch setting.
- Newly delivered or updated Guides show measured readings as well as your time/distance countdown and authored targets. During Work and active Recovery, running uses **block-average pace and current HR**. Cycling uses **block-average power, current HR, cadence and speed**. Pool swimming uses **block-average pace, swimming stroke rate and SWOLF**, with current HR where space permits. Open-water swimming keeps **block-average pace, swimming stroke rate and current HR**, without SWOLF; stroke rate is separate from running/cycling cadence. Walking, hiking and rowing keep pace and HR. Strength keeps exercise/set instructions, with HR where space permits. Both targets' documented measured values take priority in their authored order, with current HR for an HR target. Power/cadence sensors are used for running and cycling; swimming stroke rate does not turn a cadence target into a stroke target, and rowing strokes are not inferred. Screens have at most five fields: countdown, targets and instructions are reserved first, so not every reading fits every step. An untargeted pool swim-work step with a time/distance ending and instructions keeps those instructions, pace, stroke rate and SWOLF instead of optional HR. Untargeted steps stay untargeted. Long manual instructions stay text-only rather than being shortened to add readings.
- After the updated Functions release, **manual pool-swim work** can show **Swum** (distance covered in the current step) and **Elapsed** (current-step time), alongside swim readings where space permits. **Dist rem** and **Time rem** mean distance or time remaining for numeric endings. For **pool and open-water swimming**, stationary **Rest** shows current HR, its countdown and your targets/notes, not newly reset swim averages or the preceding swim's statistics. Where space permits, Rest also shows **Total**, the native cumulative distance for the whole recording, not the distance or pace of the last interval. Missing readings remain unavailable, not zero. Active **Recovery** keeps swim readings. Open-water Work/recovery fields are unchanged. Targets, notes and the five-field limit still take priority; long manual instructions remain text-only. Suunto controls the physical screen layout, so fields may move when the number or type of fields changes. QS does not offer a configurable field editor or guarantee fixed positions. These screen changes do not fix delayed pool-length detection or make unavailable watch readings appear.
- After the Rest-screen Functions update, stationary **Rest** for running, walking/hiking, supported cycling profiles and pool/open-water swimming puts its native countdown first; timed Rest calls it **Rest rem**. Your exact duration, targets and notes are kept. Remaining slots show current target readings and HR, not freshly reset averages or previous-effort statistics. Work and active Recovery keep their existing readings. Simple repeated Work/Rest pairs show actual pass labels such as **Rest 3/10**; where space permits, **Next: Work 4/10** previews the next phase, not an inferred distance for a manual interval. Each repeat set has its own count. Complex sets do not get misleading single-interval numbering; very large Guides keep their existing step structure without counters or Next hints, and can retain the previous layout when the new labels cannot fit safely. Your targets and instructions are never removed to make them fit. Long instructions remain text-only. For swimming, **Total** is still optional cumulative recording distance. This is not a previous-interval summary, configurable field editor, fixed-position layout or extra alarm sequence. Rowing and strength screens are unchanged. Sync your Suunto app and watch after an eligible future Guide updates.
- **Avg pace**, **Avg pwr**, **Avg strk** and pool-only **AvgSWOLF** (**Avg SWOLF** on older Guides) use Suunto's current manual-lap average, not instant readings or the whole-workout average. Guides containing any of these fields create recorded laps at automatic step boundaries, including repeat passes and the final boundary. Lap-button-ended steps already create a lap when you press the button, so the following step does not create a duplicate. The first step starts with recording and creates no opening lap. With **Allow early Lap** off, pressing Lap during a timed/distance step resets the displayed average early without ending that step. With it enabled, Lap ends that step early and the next step uses the button-created lap. These laps can appear in your recorded activity, but do not prove target adherence or mark a planned workout completed. Guides without a lap-average field, including HR-only strength Guides, keep their existing lap behavior. Pool screen updates retain the existing lap-boundary behavior even when a rest screen no longer shows averages.
- **SWOLF is a measured reading, not a target.** It depends on your watch's pool-length setting, stroke and available swim data. Compare it only within the same pool length and stroke; lower values across different contexts do not establish better swimming. QS does not send the selected pool length to Suunto, calculate a substitute SWOLF or promise that a supported field will have a value. Check your watch's pool length before swimming. The new SWOLF screen requires the updated Functions release.
- Suunto renders native watch units. Rowing pace on the watch is not guaranteed to match the 500 m split shown in QS. Readings depend on your watch, sport mode and available sensors; missing readings are unavailable, not zero. HR stays current. Running power may use Suunto's native smoothing; cycling's **Avg pwr** is the lap average. Selecting a screen field does not establish that your watch or sensors support it.
- Each step requests a notification when it starts, including rest/recovery and every repeat. Entering the next step alerts at the previous interval's end. A final **Guide complete** screen requests the last alert without adding workout time or stopping activity recording. Repetition-based strength sets still advance manually. Sound and vibration follow **your watch settings**; QS cannot force either. There are no promised pre-end countdown beeps or out-of-target alerts. The notification popup can remain visible for approximately 20 seconds, so try short intervals on your watch before relying on that layout.
- Notifications keep the phase name and prioritize your notes or exercise/set instructions. Without notes, timed steps say **For 01m 30s**, **Recover for 30s**, or **Rest for 02m 00s**, using the prescribed duration. Distance steps say **Follow distance countdown**. Updated pool/open-water Guides say **Swim now. Press Lap to finish this interval.** for manual swim steps. Manual steps in other supported sports say **Press Lap to finish this interval.**, including warm-up, Work, active Recovery and cool-down; manual Rest says **Rest now. Press Lap to finish this rest.** in every sport. The step starts immediately: Lap finishes the current step, not starts it. Otherwise empty non-swim manual steps keep a persistent **Lap to finish** reminder. Older Guides may still say **Press lap when ready** until an eligible sync updates them. With **Allow early Lap** enabled, generated time/distance alerts also mention Lap; authored notes retain priority. Notification text does not follow your watch's unit settings automatically; the numeric countdown and live readings use native watch units. Fractional or day-length durations use **Follow time countdown** rather than rounding or omitting seconds.
- After the updated Functions release, new sends use these screens. Normal sync updates eligible, already-consented future Guides in place, keeping their identity; past and completed copies stay unchanged. Screens and generated alerts alone require no extra approval, while meaningful mapping losses still need review. **Sent to Suunto** remains delivery evidence, not proof of watch receipt, sensor readings, alerts or workout completion.

## Remote workout checks

- When available, **Check Garmin** checks upcoming synced workouts in Garmin Connect without changing your sync settings. Results update in the same compact details view. Repeated checks within 15 minutes are combined.
- **Last sent** is when delivery was accepted; **Last checked** is the latest supported remote check. Neither confirms a download to your watch or bike computer. Suunto visibility checking is unavailable because its retained cloud records do not prove that a Guide is visible in the app or on a watch.
- Where supported, active sync checks daily and restores workouts confirmed missing from the connected app. Service limits can delay checking or restoration. **Stop sync** prevents restoration. Workouts already sent for past dates or completed workouts are kept.
- **Sent · automatic checking unavailable** means delivery was accepted but that service cannot currently be checked. For Garmin, **Found in connected app** or **Cloud copy confirmed** means the exact Workout and dated Schedule were confirmed in Garmin cloud under your connected account, not on your watch. **Could not check workout** or **Cloud check inconclusive** means a later check could not confirm both records; **Last sent** still describes the earlier accepted delivery, not current cloud presence. A missing Workout response alone is not reliable deletion proof and QS does not recreate it automatically. QS can restore a confirmed missing calendar entry while keeping the original Workout.
- **Not found in Garmin · review required** means a complete check did not find the earlier Workout. Check Garmin Connect first. When both the earlier workout and calendar entry were not found, open that workout’s Garmin sync details and choose **Create replacement Garmin copy** to review and explicitly request one new copy. A not-found response is not definitive deletion proof: a duplicate is possible if the old copy reappears. QS rechecks before sending and keeps its original IDs in private history. If it finds the old copy again, it reuses that copy and applies the workout and date you reviewed. Your QS workout, other providers and completed activities are unchanged. A remaining calendar entry, changed account, past/completed workout or unfinished send can block replacement.
- **Retry workout sync** only recovers an earlier operation; it does not authorize a new replacement. If Garmin may have accepted a new workout but the response was lost, QS stops for attention instead of blindly sending again. The same explicit replacement review is supported by the additive MCP preview after its release/catalog refresh: request a replacement for one exact Garmin workout, review its date and possible-duplicate warning, then confirm through your client. The built-in Assistant prepares that review only with Training provider-delivery changes enabled; you confirm in QS. Older clients can use the workout’s in-app sync details. Ordinary MCP Send and Retry never authorize replacement. Approval queues recovery, not provider or watch receipt.

## Understand workout totals

Plans and the Workout library show a prescription summary above the steps. While editing in Plans, Standalone or the Workout library, **Workout totals** updates as you change steps, repeats, endings and targets, before you save. Invalid or incomplete workout details show a prompt instead of stale totals. The compact summary wraps on narrow screens and stays visible when the profile is collapsed. Strength totals include timed holds and rest; repetition duration stays unknown. Timed endings contribute exact time; distance endings contribute exact prescribed distance. Fixed repeats count every pass. A distance step with an explicit speed or pace target can contribute an **estimated duration range**. A relative speed target uses only the threshold-speed reference saved with that workout.

When a numeric step allows **early Lap**, the summary labels its totals as **prescribed limits** and counts the steps that allow it, including repeat passes. Pressing Lap can shorten the actual workout. These totals describe the prescription, not a promise of your elapsed time or recorded distance.

**Subtotal** means part of the workout is known. Manual/Lap, repetition, and energy endings do not supply a duration. For example, a 10-minute warmup plus four 1 km efforts at 4–5 min/km and four manual recoveries has **26–30 minutes covered, plus four steps with unknown duration** and a **4 km distance subtotal**. The recoveries make the complete duration unknown. Missing information never counts as zero. HR, power, and cadence targets do not establish speed. Summaries follow your unit preferences and do not change your saved workout, completed activity totals, or Wahoo's exact timed-duration requirement.

## Organize plans and standalone workouts

- An account can keep multiple plans but only one can be active. Activating a plan pauses the previous active plan. Archived plans remain available without contributing workouts to Calendar overlays.
- Move a workout between plans or between a plan and **Standalone** without changing its workout identity. **Duplicate to…** opens a date picker, initially set to the source day; choose another day or keep the same one. Cancel changes nothing. The new workout stays in the same plan or remains standalone, starts planned even if the original was skipped or completed, and has no copied completion link. Moving, duplicating, or attaching outside a plan's current dates asks before extending that range.
- Use **Workout library** to keep common workouts without dates. Create one with the familiar step or strength editor, or choose **Save to library** beside a workout already on your calendar. While editing a workout, **Save copy to library** copies the version currently in the editor; it does not save those edits to the calendar workout. Choose **Save workout** separately if you want both updated. Edit, archive, restore, or delete saved recipes without changing workouts already on your calendar. **Add to dates** lets you choose a plan or Standalone, a date range, and weekdays (for example every Tuesday across six months); it previews the number of dates and existing workouts. Each placement is a separate planned workout with its own history. At most 100 dates can be added at once; outside a plan's dates, QS asks before extending the plan. A saved recipe has no service sync setting: active-plan copies follow that plan's current settings, while standalone copies need their own Send action.
- Search saved workouts by title and filter by exact sport. The library starts with **Active** recipes; choose **Archived** or **All** to find older ones, and restore an archived recipe before adding it. **Show prescription** reveals all interval instructions or strength exercises, sets, loads, and rests in your units. Some saved instructions exceed the manual editor's capabilities; QS labels these recipes and still lets you place the exact saved prescription.
- On a selected Calendar day, choose **Add from library** in the Add workout menu. That day's date stays selected, including when it falls outside the active plan. Review the saved version, destination, dates, and existing workouts before adding; choose **Standalone** explicitly when you want a workout outside a plan. Cancel the review to return to the library without adding anything, or use Back to return to the selected Calendar day. If a reply is lost, keep the review open and choose **Retry exact placement** to recover the original result safely; dates and destination stay locked until it is resolved.
- An active plan's existing sync settings may send its new duplicate automatically. A standalone duplicate does not inherit the original's Send setting; send it separately if you want a copy in a connected service. Duplicating never creates a second completed activity or changes completed totals.
- Shifting a plan moves its start and end dates together with only that plan's current workouts. Skipping keeps a workout visible and marked; it does not turn it into a completed activity.
- A very large plan shift may take longer while QS prepares its history in the background. Your existing plan and workout dates remain visible until the shift commits together; if the request is interrupted, QS automatically retries it. A very large history restore may briefly make planned workouts unavailable in Plans and the calendars while QS applies the saved prescriptions in the background. Completed activities remain visible. The planned workouts return together when the restore finishes; if it is interrupted, QS automatically retries it. Avoid starting another plan edit until either operation finishes, and reload an older app tab if its planned workouts do not return.
- Ordinary deletion is recoverable for **90 days from the time you delete the workout**, regardless of its scheduled date. After that deadline it disappears from Deleted workouts and cannot be restored, even if background cleanup has not finished. This also applies to workouts deleted before the 90-day policy begins. Permanent deletion has a separate confirmation and prevents restoration immediately. A standalone workout's revision history is removed with it; a plan-bound workout can remain in its plan's immutable audit until that plan is deleted, and the confirmation identifies this retention. Deleting a plan asks whether its current workouts should become standalone or be deleted; archiving is the non-destructive alternative.
- Expand **Deleted workouts (90 days)** in Plans or Standalone to load recoverable workouts only when you need them. The newest deletions appear first, 25 at a time; use **Show more deleted workouts** for older entries. You can still open history, restore, or permanently delete a workout from its row. If a page fails to load, use **Retry**. Changing plans or signing out clears the loaded page.
- History preview shows what a restore would change before you confirm it. A restore creates a new revision, does not silently reclaim a workout moved to another plan or to standalone, and never recreates a permanently deleted workout.

- Sync details wait for current saved settings. **Loading sync settings** is not **Sync off**. If settings are unavailable, check your connection, then close and reopen sync details; do not enable sync again just to refresh the display. **Check Garmin** reads the latest saved revisions without changing consent. If the workout, schedule or settings change during a consent or replacement review, confirmation is disabled; cancel and review the latest version. If a save was already attempted but its result is uncertain, retry that same confirmation to check the original request. Opening details, refreshing settings and failed reviews never enable sync or change completed-activity totals.

## Use Training Plans through MCP

- Training Plans uses independent MCP permissions. Activity metrics, completed-activity details, provider connections, and Timeline notes do not grant access to your plans or planned workouts.
- With **Training plans and planned workouts** access, a compatible MCP client can list plans, read authored phase names, dates and optional descriptions, read complete workout instructions, query upcoming workouts in date order, inspect exact stored completion links, assess local provider compatibility, and read existing sanitized sync summaries. The MCP update must be released, discovered by your client, and explicitly authorized before these tools appear.
- The same read permission can request a separate **workout prescription analysis** for a scheduled or saved recipe: exact subtotals, explicit speed-based duration ranges, unknown contributions, and repeat counts. Partial subtotals are not complete workout totals. This additive read appears after the backend release and client tool-catalog refresh; existing instruction reads keep their current shape.
- The same read permission can list saved workouts and read one complete saved recipe. Saved recipes have no date or sync consent; reading one does not place it on your calendar or send it to a service.
- With **Training plan and workout changes** also enabled, a client can preview a saved-workout change or place one on up to 100 dates. It must read the current recipe and revisions first. Nothing changes until you approve the separate Apply action. Removing a saved recipe does not remove workouts already added to your calendar. The built-in Assistant likewise waits for your in-app confirmation. Saving or placing a recipe never turns on service sync by itself: planned copies only follow a plan's existing setting, and Standalone copies need their own Send action. These new tools appear only after the backend release and your MCP client's tool catalog refresh.
- A pool length only appears in the separate full-workout read if you selected one. A focused preview can propose a 25 m or 25 yd pool; apply still needs Training write permission and client approval. Older v1 tools omit pool length and cannot erase a saved selection.
- Early Lap appears in the latest full scheduled-workout and saved-recipe MCP reads. Its focused previews preserve existing settings and explicitly review enabling or removing it; older edit tools cannot silently erase it. Turning it on requires your explicit request. The built-in Assistant can prepare the change, then waits for your in-app confirmation. Refresh your MCP tool catalog after the backend update to discover these additive tools.
- For Strength Training, the normal v1 workout read is only a compatibility summary. Use the separate strength-details read to inspect named exercises, sets, kilograms of external load, and rest. A separate strength preview accepts the complete prescription and derives the summary on the server; the same approval-gated apply still controls changes.
- **Training plan and workout changes** and **Training provider delivery changes** are separate permissions. A client prepares one bounded proposal, then uses a distinct write call governed by the MCP host's approval controls. Keep automatic approval off when you want to inspect every change. The built-in Assistant uses separate in-app choices and can prepare a proposal, but it cannot apply one without your confirmation in Quantified Self.
- If an approved MCP change reply times out or reports an internal error, it may already have applied. Ask your client to check the original proposal's status before retrying. The recovery read must be released and discovered by your client; if unavailable, inspect your current plans/workouts and sync status. Wait while a change is applying. Do not create replacement workouts, split an already-approved batch, or replay a declined/cancelled approval elsewhere. Any same-proposal retry must still use the client's approval controls. Accepted sync preferences do not prove provider or watch receipt. Larger batches can outlast a client's response deadline even within the 25-change limit.
- A very large approved plan shift may finish in the background if the MCP apply call is interrupted. Retry the same approved proposal to retrieve its result; do not prepare a second shift. QS keeps the old dates visible until the change commits together, although MCP plan reads are temporarily unavailable while it is staging. If you revoke the connection or its Training permission before commit, QS cancels the unpublished shift and its approval. Earlier changes in the same proposal may already have applied, so inspect the current plan before preparing a new proposal. Restoring permission requires a new preview and approval.
- Provider delivery proposed through MCP still requires Pro, an eligible connected provider, rollout readiness, the independent delivery permission, and your review of any mapping adjustment. Previewing a change never contacts a provider, and one provider failure does not roll back an authored plan or workout.
- If a new workout needs a provider adjustment—for example, Garmin simplifying a sport or Suunto shortening a step instruction—the first proposal tells you what would change. Confirming that proposal approves both the workout and that specific adjustment; you should not get a second approval for the same version. Your full instructions remain in Quantified Self. If the workout or connection changes before sending, QS blocks the outdated approval. **Send** still means delivery was requested, not that it reached the provider or your watch.

## Send workouts to connected providers

- Workout delivery to Garmin, Suunto, and Wahoo is available to connected Pro members. COROS plan sync and standalone Send are coming soon. Every available destination remains off until the user explicitly enables plan sync or sends a standalone workout. Provider-specific compatibility, permissions, scheduling windows, and connection checks still apply.
- Wahoo supports time-based running/cycling, outdoor Walking/Hiking without intensity targets, and timed-strength Gym workouts for today and the next six days in the saved time zone. Later dates wait automatically. Distance-based steps are not sent because Wahoo needs a total duration. Strength repetition sets are unsupported; exercise/load instructions are not native tracking. Older Wahoo connections may need **Reconnect Wahoo** to grant Plan and Workout access; activity imports remain usable before that reconnect. Running/cycling subprofiles use their native indoor/outdoor type where available. Indoor Running uses Treadmill, Velomobile uses Cycling, and Enduro MTB/Downhill Cycling use Mountain Biking, with a review warning; the saved QS sport is unchanged. Wahoo supports timed, untargeted pool/open-water swimming and outdoor/indoor rowing. Native profiles and timed intervals have been account/device-tested; distance endings and intensity targets remain unsupported. Selected pool length is not sent to Wahoo: its Cloud API has no documented physical pool-length field, so QS does not support sending that setting. Bike computers use the first target in an interval; review any warnings before approving. Sent is cloud delivery, not a device receipt. Checks confirm the app-owned Plan, Workout and association; automatic missing-copy restoration is unavailable.
- Before starting a workout in the Wahoo app, check its selected workout profile. For a timed Gym workout, select **Strength Training**, not Yoga or Indoor Fitness Equipment. If the profile is missing, add the native Strength profile in Wahoo. Cloud delivery does not select or create your local equipment/profile settings, and does not provide native rep or load tracking.
- If a standalone workout uses a sport or step Wahoo cannot deliver, the first sync review explains why and **Send workout** stays disabled. You can keep the workout in QS, edit it to a supported timed recipe, or send it to another compatible service. An earlier Wahoo copy, if any, may remain unchanged. Mapping adjustments that Wahoo can make are shown separately for your approval.
- Garmin workout sync needs **Training** permission and a current authorized connection. If permission or connection details are missing, reconnect Garmin in Connectivity and allow training workouts. Older connections may need this even when activity imports work. Garmin workout content and its calendar entry are separate: sync can need recovery after only one was accepted. If acceptance cannot be established, **Sync could not be confirmed** stays blocked to avoid duplicates; Retry may still require support rather than sending another copy. This does not change activity imports or mark a planned workout completed.
- When available, choose **Sync plan with Garmin** beside a plan's actions, then **Enable plan sync**. Availability and compatibility are checked automatically before that confirmation; there is no separate Preview step. New workouts and later edits sync automatically while the plan is active. For a standalone workout, choose **Send to Garmin**, then **Send workout** once; later edits update the same Garmin workout. Connecting a service alone never opts in. Workout sync requires Pro; plans and standalone workouts created in QS remain available on the free tier.
- **Plan sync** manages automatic sync for that plan. The plan shows a quiet summary row with each service's logo and a compact sent/total count for Suunto, or the provider-specific synced/total wording for other services, for workouts currently due for delivery. If nothing is due now, the row says **No workouts due for sync** instead of showing dashes. Choose the small **View** action to see earlier workouts and each service's full status. Later workouts are named **Scheduled for later** instead of making the current count look unhealthy. With more than one service, the dialog shows whether sync is enabled for each service and one **Manage** action. Manage opens only that service's settings and individual workout statuses; **All services** returns to the service overview. These navigation actions do not enable sync or send anything. The **Workout sync status** list contains individual workouts, not plans or edits. Rows show the scheduled workout date and current delivery status. Select anywhere on a row to open **Workout sync**, which names the parent plan (or Standalone), applies actions only to that workout, and offers **Back to plan sync** in the same service detail. **Edit workout** is a separate action at the top right beside the workout name, outside sync controls and attempt details; browsing delivery details never opens the editor or changes consent.
- Plans and saved workouts show delivery by service. The plan-level count prioritizes today and future workouts, so **3/3**, **All 3 upcoming workouts synced · 2 earlier workouts**, or Suunto's **All 3 upcoming workouts sent · 2 earlier workouts** can remain clear even when older workouts have different historical outcomes. Completed and skipped current/future workouts are named separately, while past workouts become the quieter earlier count; every workout stays available in the individual list. Waiting, paused and blocked upcoming workouts remain explicit. Older-account copies do not count as current delivery, and **Upcoming status incomplete** means a full current/future total is unavailable. The editor reports the saved workout, not unsaved changes. These summaries describe individual workout delivery, even when a service has no native plan support; they do not confirm app visibility or watch receipt.
- **2 retries scheduled** means two workouts are waiting for another sync attempt, not that one workout has failed twice. Open a workout's **Show attempt details** to see its failed-attempt count and **Next automatic check** time. You do not need to keep the dialog open.
- The confirmation shows the delivery time zone, defaulting to your browser's IANA time zone. Use **Change** if you need a different zone. Plan workouts inherit their plan's zone; edit it in **Plan sync settings**. Existing settings open with **Save changes** disabled. A different valid time zone is checked automatically before Save becomes available; changing it back disables Save again. Travel never silently changes workout dates.
- Each review has one action row: **Cancel** and **Enable plan sync**, **Send workout**, or **Save changes**, depending on what you are doing. Cancel discards edits and returns to sync details; cancelling the initial Send/Enable screen closes it. The overview has only **Close**. Once saving starts, Close leaves the request running; it does not undo it.
- The automatic check is read-only and can be cancelled. Saving settings starts background work, not instant delivery. **Synced** and **Up to date** mean QS recorded the provider-specific delivery as complete, not delivery to a device. Suunto instead says **Sent to Suunto** and exposes no visibility check because neither API acceptance nor cloud presence proves app/watch visibility. A sent workout can exist while its calendar entry or latest changes are still unconfirmed; this does not mean the workout is corrupt. **Next automatic check** shows when recovery can run. **Show attempt details** reveals compact timestamps and retry counts; **How sync works** opens lifecycle guidance. You can close the dialog while sync continues.
- Pausing or archiving a plan, or activating another plan, requests withdrawal of eligible future provider copies but retains preferences for reactivation. **Stop plan sync** ends sync for the plan and requests removal of its eligible future provider copies. For just one plan workout, open the service's more-actions menu and choose **Exclude from plan sync**. The workout stays in your QS plan; withdrawal is requested only for its upcoming provider copy, if one exists. Other workouts keep syncing. **Resume workout sync** includes it again. Standalone workouts use **Stop workout sync**. For Suunto, Stop requests withdrawal of an eligible cloud Guide, but it does not guarantee that a Guide already visible in the Suunto app or on your watch disappears. Remove or hide it in Suunto if you no longer want to see it there; QS cannot verify that app/watch change. **Past workout · previously sent** explains an unrelated past delivery. When an exact activity is linked, its service shows **Completed · activity linked** and other confirmed copies show **Sent · workout completed**.
- Deleting a workout or plan offers an unchecked **Also try to remove past provider copies** option. With a connected account and retained QS-owned identity, Garmin, Wahoo and Suunto may remove an uncompleted past copy. This is best-effort cloud cleanup: a provider app or device may still retain it. COROS cannot remove past workouts under its partner contract, even when you select the option; its eligible future copies still withdraw. Copies already known to be completed stay protected, and this never deletes recorded activities. Without the option, past copies remain. The same choice is available for permanent workout deletion and either plan-deletion workout disposition. After the focused MCP deletion tool is released and discovered, an MCP client or the Assistant can ask whether to also remove older, uncompleted service copies. Both Training change permissions are required, and your choice appears in the deletion preview before approval. Older clients keep past copies; they must explain that limitation rather than promise full cleanup.
- Pro expiry pauses creates and updates but keeps preferences and copies. Removal remains possible while the connection is valid. When Pro returns, delivery resumes with the latest eligible workouts after the same account is connected; it never reactivates paused plans.
- Stopping workout sync keeps your connected account and your plans and workouts in Quantified Self. If you separately disconnect the service or delete your Quantified Self account, workouts already sent may remain in the connected app. To request removal of upcoming synced workouts through Quantified Self, stop sync while the account is still connected. Disconnecting turns off workout sync for that connection; reconnecting does not turn it back on. An authentication failure keeps your sync settings for reconnecting the same account; connecting a different account requires you to enable sync again.
- After Wahoo confirms withdrawal of an upcoming copy, **Send** or **Resume workout sync** can send it again without reusing its deleted provider Plan. If Wahoo reports a deleted Plan but safe withdrawal cannot be confirmed, QS shows **Needs attention** instead of repeatedly recreating the copy. Stopping and sending again never deletes completed recordings or resets their activity links.
- Copies do not inherit standalone Send consent. Moving into a plan adopts its settings; moving to Standalone requires a new Send. Restoring schedule history restores content, not old sync consent.
- A workout that cannot map stays blocked. **Not sent · Needs review** means a new workout is waiting for approval; **Update needs review** means an earlier copy may exist but the changes are blocked. Choose **Review** to see meaningful differences before approving them. Opening Review never sends or approves anything by itself. A relevant edit needs renewed approval. Existing sent copies stay unchanged while an update is blocked. Retry inspects uncertain operations before repeating them and never blindly creates duplicates.
- **Sync** beside the **Plans** title opens **Workout sync history** when sync records exist. It shows individual workout statuses across all plans and standalone workouts, not a history of edits. Loaded rows are ordered by scheduled date; **Show more workout statuses** loads further records. Dates without a retained workout are not guessed. Open a row for warnings and recovery, even after deleting its workout or plan; this does not restore it or start new sync. Workout details label the latest attempt/confirmation separately from the scheduled date; **Show attempt details** keeps both timestamps available. Loaded details stay up to date automatically. Authored edits remain in the separate, compact, scrollable **Revision history** with restore actions.

## Add from Calendar

- Every visible date in the full Calendar, dashboard Activity Calendar tile, and Today mini-calendar can be selected, including an empty date.
- **Add workout** uses the active plan when one exists and otherwise creates a standalone workout. **Add standalone** is always available as the explicit independent option.
- Calendar overlays show standalone workouts and workouts from the active plan. Inactive-plan workouts remain in [Plans](/training/plans), while skipped workouts stay visible with a separate mark.
- Planned workouts and completed activities are separate. Plans never increase completed activity counts, duration, distance, elevation, activity-group bars, the activity table, or Training analysis.`;

const ACTIVITY_CALENDAR_HELP_CONTENT = `## Open and navigate the calendar

- New dashboards place a full-width **Calendar** section just below Today. Select a date to see its activities, Timeline notes, and planned workouts beside the month or below it on a phone. Groups without entries stay out of the way. On desktop, the day panel scrolls within the calendar's height when needed; on a phone, it scrolls with the page. The Calendar route uses the same day panel, and both show every entry. Earlier dates also show their available health readings; today's health stays in Today above. **Full day** opens a dedicated page with a time-ordered timeline and previous/next day controls. That page offers **Dashboard** to return when opened from the dashboard tile or Today's mini-calendar.
- The **Today** card opens a compact month calendar in a bottom sheet. Use its arrows to change months and select a day for details, then choose **Full day** for the complete day view. Browser Back reopens that day's sheet. Open the full [Calendar](/calendar) from the app navigation or the dashboard Calendar section.
- Selected-day previews and the day sheet use sport icons for planned workouts and completed activities. On days without recorded activities, the sheet hides completed-activity totals and sections; recovery, notes, and plans remain available. Activity loading and errors are still labeled.
- The day sheet keeps workout rows navigation-only, without copy buttons. Rows show one plan/status metadata line; tap a workout to read its steps. Duplication remains available in **Plans**, the full day page, and selected-day previews in Calendar and Dashboard.
- The sheet uses the same compact **Training impact** summary as Calendar and Dashboard previews: the day outcome and CTL/ATL/Form contributions. Separate UTC-day outcomes and missing-data warnings stay explicit. Impact text wraps on narrow screens so outcome values and unavailable reasons remain readable. Choose **Full day** for the detailed breakdown and model explanation.
- Existing Calendar tiles move into their own section without changing their saved settings. They expand to the full section width once; previously saved sizes are kept. Calendar does not offer Columns or Rows controls. **Open calendar** in the section header opens the complete Calendar with the tile's selected date. Use **Hide Calendar** or **Show Calendar** in **Dashboard options** to control its section independently of Today. You can also remove the tile and restore it through **Add to dashboard → Calendar**; removing it keeps it out of suggestions until you add it manually.
- The full Calendar has **Week**, **Month**, **30 days**, and **Year** views. **Month** is the default. Month shows complete weeks, including quieter dates from adjoining months; select them without changing the displayed month. This also applies to Dashboard and the Today mini-calendar. The previous and next controls move by the selected view's period, and **Today** returns to the current period without taking a separate row on smaller screens.
- Choose **30 days** for today and the previous 29 dates. Complete boundary weeks give surrounding dates context; their activities stay out of period totals, analysis, and the activity table. Arrows move the period and selected date by exactly 30 dates, and **Today** returns to the latest period. Switching views keeps the selected day: Month opens its month, while 30 days opens the latest period containing it or a period ending on that date.
- Use the **Month / 30 days** buttons above the dashboard Calendar to switch views. The selected button shows the current view, and your choice is saved. A fresh visit starts in the current period; returning from a day, activity, or workout restores the period you were browsing. The Today mini-calendar stays in Month.
- Selecting a day keeps the calendar visible and updates the day panel. Month and 30 days show every entry in the selected day, with an independent panel scroll on desktop; **Full day** opens the time-ordered day timeline. On a phone, selecting a date in Year view opens that month so the day's details are close to the calendar; browser Back returns to Year. The selected view, displayed period, and selected date are kept in the URL, so refreshing or sharing the authenticated route restores the same day. **Calendar** returns to the originating view and period with that day selected.

## Compare planned and recorded training

In the full Calendar’s **Week** view, your activity count and recorded totals appear first. **Month** keeps a compact strip of recorded **Distance**, **Duration**, and **Ascent** below the calendar, following your sport and summary exclusions. Month totals exclude adjacent dates shown only to complete the grid; those dates remain selectable. Select a date to see its planned workouts and activities.

If the month has workouts, an extra row below the activity totals shows how many are scheduled, how many have an activity and how many remain. The small line below shows planned time, time left and skipped workouts. Months without workouts keep the activity totals alone. Tap, hover over or focus the small line for the full totals and any limits on them.

**Planned workouts** appears only when there are workouts from your active plan or Standalone in that week. Its heading shows how many are scheduled and how many remain. Tap it to see the details; it starts closed when you open another period. Empty planning sections and zero counts stay hidden.

**With an activity** counts workouts with a matching recording. **Remaining** means a workout has no matching activity and has not been skipped; you may have done it without an activity match. **Planned** totals include workouts with an activity and leave out skipped workouts. A matching recording does not tell QS whether you followed every step. The recording stays in the period when it happened, even if the workout was scheduled for another date. If you edited a workout after recording its activity, QS points that out.

Workout time can be an estimate or a total of only the steps with a set time. Month shows planned time and time left when the full total can be calculated; other time totals stay out of the compact row. The full details identify steps without a set time. Steps you can end early with Lap may take less time. Distance includes only the distance set in the workout. Training load comes from recorded activities. If a Week or Month read is incomplete, QS tells you that some activities or workouts may be missing. If a read fails, use **Try again**. Remaining counts stay unavailable until activity matches can be checked.

## Read activity days

- A circle's color identifies an activity group and its size reflects recorded duration. Larger circles mean more recorded time, using a bounded scale so unusually long activities do not dominate the grid.
- Month view, the dashboard tile, and the Today mini-calendar show overlapping activity-group circles, with a count when several activities share a group. The mini-calendar keeps the same markers in smaller cells. Week view separates duration-sized circles; Year view uses compact concentric circles.
- A small pulsing dot in the corner marks today's date in Month view, the dashboard Calendar, and the Today mini-calendar. It stays on today when you select a different date. On narrow calendars the word **Today** is hidden to keep the cell clear; the date's accessible label still announces it. Reduced-motion settings keep the dot still.
- Planned workouts have a colored rail on the left of their date. Wider month cells also show the first workout's title and a count of any others; on phones and in tightly packed dashboard months, select the date to read every title. Skipped workouts have a dashed rail. These are plans, not completed activity circles.
- Select any date, including an empty one, to see that day next to the calendar on desktop or below it on mobile. The Calendar route's day panel shows that day's completed-activity distance, duration, and ascent; empty days show zero, and unavailable activity data shows dashes while loading or after an error. The Month and 30 days panels show every entry with a link to the full day; Week and Year retain their detailed activity breakdown. Period totals and activity-group bars remain available below the month. The Today mini-calendar still opens day details in a sheet.
- Private selected-day views also show **Training impact** for completed activities with TSS. Activity rows show their modeled **Fitness load (CTL)**, **Fatigue load (ATL)**, and **Freshness (Form)** contributions; the day summary totals the visible activities and separately reports whether CTL rose, held, or declined after normal decay. Training days use UTC, so one local calendar date can show two dated UTC outcomes while keeping one contribution total. Missing TSS stays unavailable, merged benchmark events are excluded, and planned workouts never contribute. This TSS-based model describes sustained training load, not measured physiological adaptation.
${TRAINING_PLANNING_HELP_SNIPPETS.calendarDetails}
${TRAINING_PLANNING_HELP_SNIPPETS.calendarOverlays}
${TRAINING_PLANNING_HELP_SNIPPETS.calendarColors}
- In Month view, the dashboard tile, and the Today mini-calendar, a slim colored tick on the right marks days with **Timeline notes**, even when there is no activity. Select the day to see the notes and their individual colors, then select a note to open or edit it. Week and Year keep their note icons and color markers. Activity circles keep their own colors. Date ranges include their end day; ongoing notes stop at today in their original time zone and refresh when you return to the tab. Notes never affect activity totals or circle sizes. Use **Timeline notes** in the header to manage them and **Show on charts and calendar** to show or hide them across workspaces.
- Select an activity row to open its details. Browser **Back** returns to the selected calendar day. The Today mini-calendar retains its day-details sheet and its activity-group links.
- Calendar dates intentionally have no hover or touch tooltip. This keeps native vertical scrolling responsive on phones; day details remain available by selecting a date.

- The selected day shows date-matched sleep and HRV with their sources. The full day page adds sleep duration, the recorded sleep window, and average overnight heart rate when the selected night provides them, followed by the same sleep-stage breakdown used in Health. Its timeline places notes and planned workouts without invented times, then overnight sleep and completed activities by their recorded times. Select sleep to jump to its stages, or an activity or note for details. Activities by sport remain below. A short **What stands out** summary appears only when there is a relevant note or an earlier planned workout without a linked activity. On a phone, the date controls stay visible as you scroll; use **Calendar** above the date to return to the selected month. Sleep and HRV can appear while readiness is still loading. Readiness appears for past days only when a daily score was stored. Opening a recent day refreshes missing or outdated readiness history; an available recorded score stays visible during refresh. The stored history covers fourteen days, so older dates may have no score. Recovery left is shown only for today. Missing readings, loading, and read errors are labeled separately.

## Understand period totals and activity bars

- The summary above 30 days and Year shows recorded **Distance**, **Duration**, and **Ascent** for the selected period. Month totals exclude adjacent dates shown only to complete the calendar grid. Week and Month use the separate recorded and prescription summaries described above. Dashboard calendars retain their existing summaries.
${TRAINING_PLANNING_HELP_SNIPPETS.calendarTotals}
- Below the calendar, **Activities** compares activity groups by recorded duration. Each bar uses the same color as its circles and is scaled against the longest-duration group in the selected period. The info control beside the heading explains this comparison.
- If a Week or Month read is incomplete, observed activities and workouts stay visible, while day totals and activity-group totals remain unknown. Open **Full day** to load the selected date independently. **Completion unknown** means the Calendar could not establish whether that workout has a valid link; it does not mean the workout was missed.
- Duration appears beside each bar. Available distance, ascent, and descent totals appear with icons beneath it. A metric is omitted when no positive recorded value exists, and **--** beside an activity group means duration was not recorded.
- Lift-served downhill activities such as alpine skiing, snowboarding, and downhill cycling do not add ascent but do contribute descent. Diving, Scuba Diving, Free Diving, Snorkeling, and Mermaiding do not contribute either elevation metric; their vertical movement is recorded as depth. Ascent and descent summary exclusions configured in **Settings** also apply.
- The activity table beneath the duration bars lists normal activities in the selected Week, Month, or Year. It follows Calendar navigation exactly; use its search, tag filter, sorting, pagination, and row checkboxes, or use an activity's action menu to share, reprocess, download, or delete it without leaving your current Calendar period. The tag filter lists your saved activity tags across all dates, while matching table rows stay within the selected period. Month tables exclude adjacent dates shown only to complete the grid.

## Preferences and data scope

- Weekday order follows **Settings -> Units & formatting -> Start of the Week**. The configured first day is identified in the header, and Saturday and Sunday remain identifiable as weekend days.
- Distance, ascent, and descent use the units selected in **Settings -> Units & formatting**.
- The Calendar grid and its activity table use their own visible-period activity query, independent from the dashboard event table, custom-chart ranges, and map-tile filters. The table always uses the exact selected Week, Month, or Year, while the dashboard tile independently loads its current-month window.
- Normal activity events are included. Merge and benchmark records are excluded so comparison artifacts do not create calendar days or inflate totals.`;

export const HELP_ACTIONS: HelpAction[] = [
  {
    id: 'email-support',
    label: 'Email Support',
    icon: 'email',
    kind: 'email',
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
${TRAINING_PLANNING_HELP_SNIPPETS.gettingStarted}
- **Supported activity types** lists the activity types Quantified Self recognizes and explains why the details shown depend on data in each activity. Open the [Supported activity types guide](/help#supported-activities) or public [Supported activity types page](/features/supported-activities).
- **Training** is your fixed workspace for baseline comparisons, current readiness signals, load trajectory, training mix, capacity evidence, durability, sleep, and power interpretation. Open the [Training analysis guide](/help#training-analysis) for the detailed product guide and its **Email Training Feedback** action, or read the public [Training Analysis overview](/features/training-analysis) for the search-facing summary.
- **My Tracks** maps positional activities and supports date range, custom date, and activity type filters. Its activity filter lists only trackable types in the selected date range, while keeping an active no-match choice visible until you clear it. Detected trips list an inferred **Home** area first when available; use the sort button to choose newest-first or oldest-first, and the choice is saved.
- **Services** is where you connect Garmin, Suunto, COROS, and Wahoo. Connection screens use a limited account summary once it is available; existing connections continue to work while those summaries are populated during rollout.
- **Settings** is where you manage profile details, consent options, charts, maps, and units.
- **Subscription** is where you review your current plan.
- **Release Notes** shows product updates and fixes.

## Good first workflow

- Upload a few files manually if you want to test the app before connecting services.
- Move to **Pro** when you need automatic integrations or history import tools.

## Core dashboard features

### HRV chart

Add **HRV** from **Training State**, beside **Sleep**. It uses the same HRV chart and recorded data as **Health**, with sources kept separate. Eligible nightly series include the shaded **personal range**, colored readings, and 7-day average calculated using the same 60-day baseline as Health. The date selector controls the visible HRV period independently of Sleep. The 60-day baseline is calculation history, not the displayed date range. Earlier history is loaded for the baseline when you change the visible date window. Missing readings remain gaps and naps are excluded; insufficient history shows **Building personal range**.

Use **Timeline notes** in the dashboard header to manage your notes. HRV, Sleep, Form, and Freshness Forecast show the same note markers and periods as Health and Training, using each chart’s own dates. Notes appear only on your own dashboard; shared profiles and chart-library previews do not include them.

HRV and Sleep each have their own date range and older/newer navigation. While a new HRV period loads, the previous chart stays visible with its original dates and an updating notice. If loading fails, the notice explains that the previous chart is still shown. The chart picker includes a small HRV preview and a large preview with details. A labelled example appears when your HRV data is not available yet.

### Add and edit dashboard tiles

- **Show or hide Calendar.** Open **Dashboard options** beside Today and choose **Hide Calendar** or **Show Calendar**. This changes only the Calendar section; Today and your other tiles stay as you left them, and your recorded data is kept. **Undo** reverses the change. Calendar has no **Columns** or **Rows** controls.
- **Add tiles anywhere.** Use **Add to dashboard +** at the top (the **+** button on phones), then choose a dashboard section, including **Calendar** if you removed it. Empty sections stay hidden until you add their first tile and disappear when you remove their last one. A completely empty dashboard offers **Add tiles** or **Use starter dashboard**.
- **Health charts on your dashboard.** Choose **Add to dashboard +**, then **Health**, to browse the same metrics as the Health hub, plus **Sleep overview**. Sleep overview combines stages and overnight readings; Sleep duration and Sleep score offer separate trends from those same recorded sessions, including Suunto, Garmin, and COROS when available. Nap readings stay separate from main sleep, and a missing score stays unavailable. Search across Health categories, preview your readings, and add one tile per metric. No Health tiles are added automatically.
- Recorded sleep heart rate, resting heart rate, blood oxygen and respiration also appear in the corresponding Health charts. The source label distinguishes sleep averages, minimums and maximums from other readings; only values your provider supplied are available.
- Each Health tile shows a compact source label beside its latest value. When there are alternatives, tap that label to choose a **Source and reading** and see its full details; a single source is shown as plain text. Sleep overview places this control beside its date controls. Source choices include only readings that can be shown in the selected period. Provider accounts and different kinds of readings stay separate. A previously selected reading with no data stays selected and explains what is missing. Each tile has its own **1d**, **14d**, **30d**, **90d**, or **1y** range and older/newer controls. Changing one tile does not change another tile or your Health hub preferences. Detailed readings without long-range summaries offer **Show 90 days**, and the tile and dashboard configurator disable **1y** for that selected reading.
- Existing Sleep and HRV tiles keep their location and saved range. Their menu offers **Move to Health** or **Move to Training State**, with **Undo** after a move. Newly added Sleep and HRV tiles start in Health. New Health metric tiles are private to your dashboard; existing Sleep and HRV sharing is unchanged.
- Populated chart and map sections keep the compact **Add KPI**, **Add chart**, or **Add map** action beside their title. **Activity Overview** contains activity charts; Calendar has **Open calendar** instead of an add action. A section add action disappears when all its presets are already on your dashboard; the top Add action stays available. Activity Overview keeps its action for custom charts; when all its presets are added, it opens custom chart properties directly.
- Search within the section, use **Load**, **Readiness**, or **Execution** to filter KPIs, and scroll the compact list. Each row identifies its type, data availability, and a small preview. Health mini charts show the recorded trend and latest value when readings are available; zero is a recorded value too. Examples remain labeled. The large preview identifies **Your data** or **Example data** explicitly. If a filter excludes the previewed item, select a matching row before adding.
- The add action opens a wide dialog on desktop or a bottom sheet on mobile. Select a row to see its large preview, explanation, data scope, and destination section. Desktop previews the first available item and keeps the list beside it. Mobile opens the list first; **Back to Calendar**, **Back to KPIs**, **Back to charts**, or **Back to maps** returns to that section’s list.
- Previews load your available data when you open a section, including charts, KPIs, maps and calendars you have not added yet. Small previews use the same series colors and data as their large preview. Every Health metric includes a labelled example while readings load or when the selected period has no data. Examples only illustrate the chart; saved tiles use your recorded data, and examples never qualify a suggestion. Activity charts respect their selected date range; Sleep and HRV start with 14 days. A KPI without enough history can show its current value without a trend.
- **Suggested for you** shows up to two charts that are ready with your data, followed by the other available choices. Search and KPI filters apply to both groups. Removing a chart dismisses its suggestion; you can still find and add it in the list.
- A **New** badge on the top Add action or a section’s add action means a newly released chart type is available, even if you do not have data for it yet. Opening a section’s list acknowledges only its additions across your devices; other sections keep their badges, and its new entries stay marked for that browsing session. Opening an existing tile’s settings does not clear badges. Existing library entries are not announced again, and shared dashboards do not show these badges.
- **Ready with your data** means the preview has recorded values. **Needs more history** means a comparison needs more readings; **No data in this period** means the preview period has no matching records. Loading, updating, and unavailable sources have separate messages. Power curves need recorded power curves, maps need usable locations, and HRV readings can appear before a personal range is available.
- **Your data** previews stay in sync with available personal data. During an update or failed refresh, the last available values stay visible with a notice. **Example data** previews use synthetic examples when no personal values are available, including during the first load. If a source cannot load, reopen the library to try again. Browsing never adds anything or starts a metric rebuild.
- **Chart settings** appears for configurable metric charts and **Map settings** for maps. Properties appear beside the live preview on desktop and above it on mobile. Health charts use their source and range controls directly in the preview. **Back to chart** or **Back to map** preserves unsaved properties. Curated charts, KPIs, and the activity calendar have fixed configuration, so their previews do not show a settings button. Use their date-range or source controls on the dashboard where available. Nothing is saved until **Add to dashboard** or **Save changes**; a successful save closes the picker and reveals the saved item. Leaving changed settings asks whether to discard them.
- After adding a tile, **Undo** removes that addition until another dashboard change makes it unsafe to undo. Your event-table search and date filters stay unchanged. If you have started editing another tile, Undo asks before discarding those changes. If the dashboard changed elsewhere, reopen the editor with the current layout before saving again.
- Each tile’s three-dot menu uses the same layout and identifies its type: for example, **KPI details** and **Remove KPI**, or **Edit map** and **Remove map**. Fixed tiles open their preview and explanation; charts and maps with editable properties open their settings. Where resizing is available, choose **Columns** or **Rows**, then a size; the current choice is marked. You can navigate these menus with the arrow keys. A spinner appears while a layout change is saving. Closing an editor returns keyboard focus to that tile’s menu button. Removal only takes it off your dashboard; it does not delete the underlying data. Removing the last tile hides that section; the top Add action can restore it. Shared dashboards remain read-only.
- Chart previews and info buttons explain what each chart shows, which records contribute, and how to read the trend. Easy and Hard percentages measure time in recorded zones, not a share of Training Stress Score. Calculation periods, such as the 42-day fitness average, are separate from the date range displayed.
- Charts farther down the page draw as you approach them to keep scrolling responsive. Their titles and controls remain available, and scrolling back keeps charts already shown.
- **Curated Recovery** remains a fixed insight and does not react to event table or custom tile date ranges.
- **Calendar** has its own full-width dashboard section below Today. It shows the current month and the selected day's activities, notes, and plans in a bounded day panel on desktop. Earlier dates also show available health readings, while today's health stays in Today. **Full day** opens a time-ordered timeline. Existing Calendar tiles keep their settings; restore a removed one through **Add to dashboard → Calendar**. The [Activity Calendar guide](/help#activity-calendar) explains its views, circles, summaries, and data scope.
- **Curated Form/TSS** computes from full history and does not react to event table or custom tile date ranges. Its **W / M / Y** view setting is saved on that dashboard tile.
- New curated charts: **Freshness Forecast**, **Intensity Distribution**, **Efficiency Trend**, **Cycling Power Curve**, and **Running Power Curve**.
- New dashboards start with **Today**, then the full-width **Calendar** section and **Weekly Training Time** in **Activity Overview**. Weekly Training Time shows weekly columns grouped by sport over **90 days**. Before data arrives, empty states guide you to upload activities or connect a service. The optional Dashboard **Today** header greets the dashboard owner according to browser-local morning, afternoon, or evening time, using the first part of their display name when available and generic copy otherwise; the greeting stays hidden on shared dashboards. Today then begins with the same TSS-only **Training state** shown in Training and shows current **Readiness** with its score, confidence, available-signal count, Load, Sleep, HRV, and Overnight HR. Open **Training** or **Health** from the main navigation. Select its calendar icon to open a mini calendar for the current month, use its previous and next controls to browse months, then select an activity day for details. Use **Show Today summary** in **Dashboard options** to show or hide it independently from chart and map tiles.
- Today uses the same compact Readiness, sleep-score, evidence-coverage, and personal-baseline indicators as Training. Exact values and labels remain visible, so the indicators add scanability without turning Form, ramp, recovery time, or other unbounded metrics into arbitrary percentages.
- Today shows **Loading readiness…** until the initial load and sleep checks finish. If no eligible sleep is found, the score uses the available current load signal. A failed sleep check is labelled separately from missing sleep and clears previously loaded readiness sleep evidence immediately. Stale, building, missing, or failed load and recovery snapshots display no current value. Newly imported data can still update the score afterward.
- **Training** remains the fixed analytical workspace. Dashboard tiles can reuse selected derived evidence without changing Training calculations or layout.
- Existing curated and KPI tiles are preserved until you edit or remove them using their tile menu.
- The **Today** header can show **Uploaded activities**, which counts current uploaded activity events.
- On mobile, Today rows stay compact while the chart/map grid stays unchanged below.
- The main dashboard places **Calendar** after Today, then KPIs and charts grouped by intent: **Training State**, **Health**, **Performance & Power**, **Activity Overview**, and **Routes & Maps**.
- All custom charts belong in **Activity Overview**, regardless of their metric. Open that section’s chart picker and choose **Create custom chart** to select the chart type, metric, aggregation, grouping, and date range directly.
- New dashboard tiles use chart-aware default sizes: Calendar starts full width; simple custom totals, KPIs, and the clustered heatmap start at 1 x 1, while Form/TSS, Power Curve, and the Routes map start wider.
- Empty sections stay hidden; use the dashboard's top Add action to bring one back.
- KPI choices are grouped as **Load**, **Readiness**, and **Execution** in the chart library and inline editor.
- **Aerobic Capacity** shows the latest imported running or cycling VO2 max and compares only observations from the same source. It does not substitute FTP or rolling CP/W′/Pmax capacity for VO2 max.
- **Aerobic Durability** shows the current persisted long-session context with the strongest sample evidence: aerobic decoupling for Running, Cycling, and Open water, or pace retention for Pool. Missing and ineligible activity evidence stays unavailable.
- Dashboard **Today** begins with the same compact **Training state** label and caption as Training. It uses current Form, ramp, CTL, and ATL only, so recorded sleep and imported recovery never change it; those are shown separately in Today Readiness.
- Today **Readiness** combines current Form/ramp with eligible sleep and overnight HRV. Its four drivers are Load (40%), Sleep (25%), the seven-day HRV average versus the same-source 60-day personal range (20%), and one Overnight HR driver (15%). HRV uses the same rolling calculation as Health and the Dashboard HRV chart, regardless of their visible date ranges. At least 14 baseline days and three days in the current week are needed. Current HRV also requires one authoritative observation from a completed latest main-sleep night no more than 48 hours old. Adjacent Suunto records separated by at most 30 minutes are combined as one night and their HRV is weighted by sample count. If that cannot be done safely, or the latest night has no HRV, the card shows **No current HRV**; no earlier or last-fragment reading is substituted. With at least four recent same-source nights, the range status also says whether the recent series is rising, stable, or falling; this does not change the score. Sleep and Overnight HR require a night from the last 48 hours. Overnight HR blends average sleep HR (70%) and minimum sleep HR (30%), bounds each ratio to 80–120% of baseline, and falls back to whichever measure is available. Lower average or minimum sleep HR supports the score only relative to that user's own same-provider baseline; it is not a universal medical judgment. Provider coverage follows the normalized sleep record: current Suunto records can provide average and minimum sleep HR, COROS records can provide average sleep HR, and Garmin Health sleep summaries currently do not populate these normalized sleep-HR measures. Missing drivers are excluded and the available weights are renormalized. **Freshness, Form, CTL, ATL, their forecasts, and Load Status remain TSS-only; only Readiness adds recorded sleep-recovery context.** An active imported estimate is displayed separately as **Recovery left**, with the same day-based remaining duration and estimated local recovery day and time as Training; its bar shows the remaining share of the active imported recovery estimates. It is never weighted into the score and disappears when elapsed. Current sleep evidence is independent of the Sleep chart's selected range or historical page, and score and evidence confidence stay separate.
- Curated and KPI tiles include an **info** icon beside the title with formulas, interpretation guidance, and KPI detail rows such as metric state, freshness date, source, and the signals behind the current label.
- On supported mobile devices, selected controls and completed actions such as uploads, syncs, exports, and saves provide lightweight haptic feedback.
- Haptics automatically fall back to no-op when vibration support is unavailable or reduced-motion is enabled.
- Event search filters only the dashboard event table.
- Activity tags can be added from an activity row or activity details. In details, **Add tags** sits beside the device name; select the existing tags there to edit them. The tag action remains available when no device is recorded. The dashboard table's exact tag filter and tag editors list your saved tags regardless of the selected date range. A tag remains available for reuse after you remove it from every event. Selecting a tag filters events in the current date range; widen the range to see older matches. You can apply atomic add/remove tag changes in bulk to up to 250 selected events. Each event supports up to 10 tags of 32 characters; tags are visible on public event and comparison links.
- **Custom** charts use their own tile date-range and activity filters, with matching controls in the inline editor.
- If your account has no activities yet, the dashboard shows **No activities yet** with actions to **Upload activity** or **Connect service**. Uploads support FIT, GPX, TCX, JSON, and SML files; service connections support Garmin, Suunto, COROS, and Wahoo.
- Dashboard **Action prompts** are contextual setup cards shown above your dashboard when an account action needs attention after activity data exists.
- New users can choose a kilometers or miles preset from the dashboard **Default units** action prompt; choose **Advanced settings** there, or open **Settings → Units & formatting**, to fine-tune individual unit preferences later. **Weight** starts in kg for both presets and can be changed to lb independently; changing a distance preset does not reset that choice.
- The unit prompt appears on your own dashboard while unit setup is incomplete, including before your first activity. The suggested preset follows your browser's region. **Apply** saves the preset, preserves your weight and week-start choices, and completes setup. Failed saves leave it available to retry. Saving changed units in Settings also completes setup; changing unrelated settings does not. Existing accounts without an incomplete-setup flag are not prompted again on every login.
- Pro users with activity data but without a connected activity service may see a one-time **Connect a service** action prompt; dismissing it hides the prompt permanently, and services can still be connected later from **Services**.
- Pro users with Suunto plus Garmin and/or COROS connected may see a **Send new activities to Suunto** action prompt when automatic activity sync is off. Turning it on affects new Garmin or COROS activities only; use **Send past activities** in **Services** for activities already in Quantified Self. Dismissing the prompt hides it permanently.
- If Suunto disconnects server-side or stops accepting the stored token, the dashboard can show a **Reconnect Suunto** action prompt. Reconnecting restarts sleep sync, history imports, and upload tools. Automatic Garmin to Suunto and COROS to Suunto activity sync stays off until you turn it on again in **Services**; dismissing the card only hides the reminder.
- Distance values in dashboards, event charts, activity chips, and CSV exports follow your kilometers or miles preference from **Settings -> Units & formatting**; jump distances display in feet when miles are selected.
- **Map** tiles can use activity events or saved route previews as their source. Activity map tiles use their own tile date-range and activity filters, independent from the event table search; **Routes** map tiles show recent saved routes from lightweight route previews and do not use event filters.
- **Cycling Power Curve** and **Running Power Curve** are curated derived snapshots: each uses its own prepared date range, defaults to **1y**, and compares your best power per duration with either the latest activity or a saved recent-best comparison window. Power Curve tiles do not use activity subfilters or historical window navigation.
- Curated, KPI, form, recovery, sleep, and other derived tiles stay independent from event table filters and custom/map tile filters.
- Charts and maps are never added automatically to an existing dashboard. Saved layouts, date ranges, and intentionally empty dashboards stay as you left them. Account setup and service prompts remain separate from chart suggestions.
- Derived curated and KPI chart types are unique: only one tile per special derived chart type can exist at a time.
- Map tiles are unique per source: one activity map and one saved-routes map can exist at a time.
- Map style and cluster-marker settings are edited in the inline chart editor.
- Default tile sizes are chart-aware: Calendar starts full width; simple custom totals, KPIs, and the clustered heatmap start at 1 x 1, while Form/TSS, Power Curve, and the Routes map start wider.
- **Dashboard options** includes **Reset to starter dashboard**, which asks for confirmation before it replaces the current dashboard tiles with Weekly Training Time and Activity Calendar and restores Today; **Add all presets**, which inserts every available preset including overlapping metrics; and **Remove all**, which hides the Today summary, clears every dashboard chart/map tile, and keeps chart suggestions dismissed. Resetting preserves your new-chart acknowledgements. Add all presets also restores the Today summary.

### Reorder dashboard tiles

- On desktop, drag dashboard tiles from the tile action area to reorder them.
- On mobile and touch devices, open any tile menu with the three-dot button.
- Use **Move earlier** or **Move later** when drag-and-drop is unavailable.
- Tile order is saved automatically to your account.

### Recovery tile summary

- The curated **Recovery** pie tile is optional and can be added from the **Training State** chart library or **Add all presets**.
- The tile shows live recovery split between **Recovery left** and **Elapsed**, using the same recovery color as Today.
- The center summary shows the same day-based remaining duration as Today and the local day and time when recovery is expected.
- Hover or tap a ring segment to see its duration, the active total, and the full expected recovery date and time.
- Active totals only include currently active recovery windows, not all historical recovery values.
- Extremely large recovery values above 14 days are treated as outliers and ignored.
- Remaining recovery updates every minute while the tile is visible.
- While derived metrics are refreshing, the tile shows a recovery-specific **updating** message instead of generic no-data text.
- You can still move or remove this tile from the tile menu.

### Form tile (CTL / ATL / TSB)

- The tile derives daily load from **modeled Training Stress Score**. Recorded activity statistics and metric queries remain unchanged.
- Owners can open **Training load** in an activity's actions to choose Automatic, HR or a calorie/MET estimate, enter a 0–9999 TSS override, exclude a leg or the entire workout, or reset to its saved policy. Scores display one decimal; zero is valid. Clear the override field to use the selected method again. Exclusion keeps activity history and volume.
- Multisport overrides apply to individual legs. Included legs are summed; a parent-only score is never divided among legs. Partial totals identify missing load separately from excluded legs. Unmatched legs after a reimport require explicit reassociation or reset. If an open editor reports that the activity changed, close it and reopen the activity before editing its legs.
- Walking & Hiking Automatic uses file-imported TSS, then calibrated HR, then a calorie/MET estimate. It never uses running pace or power. HR requires resting, threshold and maximum HR calibration in the file; a walk's observed peak is not maximum HR. MET requires file calories, body mass and duration. If a preferred calculation is unavailable, the editor explains the eligible fallback. Imported TSS takes precedence.
- **Settings → Training load** saves dated sport defaults. They apply to workouts starting from the time you save them, including delayed uploads; existing workouts keep their saved policy. The activity editor can also copy method and inclusion to future workouts, without copying a numeric override.
- Imports and reimports preserve your saved load preferences and overrides. Training updates after the activity and its load calculation are saved; if an import fails, retry it before relying on refreshed Training values. Whole-workout exclusion also works while an import is pending.
- Training impact waits while workout details and saved load calculations do not match, including changed or missing multisport legs. A selected day's total and outcome wait until all selected workouts finish updating. Reopen the activity after a reimport; if the import failed, retry it. Whole-workout exclusion remains available.
- Older activities retain recorded values until **Reimport activity from file** creates HR/MET evaluations. Overrides and exclusion work immediately. Missing load is shown as unavailable, separately from zero and exclusion.
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
- **Preparing your dashboard…** means your charts and stats are being prepared. **Updating your dashboard…** means newer data is being added; you can keep browsing the values already shown. The **Today** title, date, and calendar stay in place, and the short loading message returns to your greeting when the update finishes. If an update fails, use **Retry** beside the dashboard options. Recovery affects this status only when an active recovery estimate appears in Today or a Recovery tile is on your dashboard.
- The status title updates dynamically from current Form bands:
  - **High fatigue** at very negative Form values,
  - **Building fitness** while carrying meaningful load,
  - **Maintaining fitness** around neutral Form,
  - **Fresh** when Form is clearly positive.

### Derived KPI and curated charts

- **ACWR** uses acute 7-day load versus chronic 28-day load/4 and shows 8-week history columns.
- **Ramp Rate** uses CTL(today) - CTL(today-7d) with 8-week history columns.
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
- Weekly scalar KPI mini-charts use compact **history columns** without changing the tile layout. Each column is that week's available metric observation, not summed weekly load. Missing observations remain gaps, signed values extend below zero, and the latest observation is accented. **Form +7d** columns describe past zero-load scenarios; the full **Freshness Forecast** chart still shows the future scenario as lines. Recovery Debt, Aerobic Capacity and Aerobic Durability retain their existing evidence lines.
- **Freshness Forecast** projects 7 future days with zero load from the latest derived day. It is a TSS-only scenario, not a forecast of sleep or recovery.
- **Intensity Distribution** uses the recorded QS zone durations, with **Auto** selecting power per activity when its recorded zone time is positive, otherwise heart rate. Its approximate groups are **heart rate: Easy Z1–Z2, Moderate Z3, Hard Z4–Z5** and **power: Easy Z1–Z2, Moderate Z3–Z4, Hard Z5–Z7**. Each multisport segment uses its own selected source. Each stacked bar’s height is the recorded zone time for that week; its colored segments show the Easy/Moderate/Hard split, so a short workout does not look equivalent to a high-volume week.
- Intensity Distribution shows both zone time and percentage for the **Current week**; when no current-week bucket exists they are labeled **Latest week**. Activities without usable zones are excluded from that zone-time denominator. The chart tooltip shows power and heart-rate activity counts and zone time, plus the count excluded for missing zones; mixed weeks use both sources. Weeks without usable zone time have no bar.
- **Efficiency Trend** uses weekly duration-weighted average of avgPower/avgHeartRate.
- **Cycling Power Curve** and **Running Power Curve** use a prepared PowerCurve snapshot to draw the best power envelope and a selectable comparison: latest activity, best last 30d, or best last 90d. Cycling and running power data stay in separate tiles.
- New Intensity Distribution and Efficiency Trend tiles start at **12 weeks**; existing saved ranges stay unchanged. Both include compact **8w / 12w / 6m / 1y / All** range selectors that only change the visible derived weekly history and are saved per dashboard tile.
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
- Open **Device colors** or select a device's colored dot to choose named swatches or a custom color. **Standard** is selected by default and also offers dark gray and tan. **Use Okabe–Ito preset** assigns up to eight listed devices the published palette by color-blind researchers [Masataka Okabe and Kei Ito](https://jfly.uni-koeln.de/color/index.html#pallet), starting with vermillion (red-orange), blue, black, and reddish purple. Changes stay in the dialog until **Apply**; **Cancel** discards them and **Reset to Automatic** removes the selected device's saved preference.
- **Distinct line patterns** is in **Settings -> Charts**, below **Line Width**, and in **Chart options** on merged and benchmark event details. It is off by default, keeping the previous solid lines, normal widths, and dot legends. Use **Save Changes** to apply this account preference from Settings; changes in event details save immediately and use the same preference. Your device color selections stay unchanged. When enabled, merged and benchmark time-series charts use solid, dashed, dotted, and dash-dot patterns, repeated after four activities. Legends show matching patterns, which stay stable when activities are hidden or a device lacks a metric. Primary and overlay lines keep their normal stroke widths when patterns are enabled, and legends match them. Overlay metric names appear in the legend and tooltip. Chart and timeline-marker colors adjust for background contrast in light and dark themes, so black becomes neutral gray in dark mode. Comparison charts prioritize device colors over intensity-zone and altitude-grade coloring. Colors alone cannot suit every form of color blindness; use the optional patterns, device labels, and custom colors to find a comfortable combination.
- The public [Features hub](/features) links to [Workout Data Comparison](/features/workout-data-comparison), which brings provider activities and uploaded FIT/TCX/GPX/JSON/SML activity files into one workflow with maps, charts, sports-device benchmarks, and reviewer workflows for device tests, YouTube videos, and blog posts. The [Workout File Analyzer](/features/fit-gpx-tcx-file-analyzer) and [FIT and GPX Route Files](/features/fit-gpx-route-files) pages cover single-file analysis and saved-route workflows separately. Manual uploads, core analysis, and benchmark comparisons are available on the free plan for up to ${USAGE_LIMITS.free} activities and ${ROUTE_USAGE_LIMITS.free} saved routes; automatic provider sync and higher limits require a paid plan.

### Event jump tables

- Event details now include a **Jumps** table when selected activities contain jump events.
- The jump table appears in activity tabs and only shows columns with available data.
- Jump metrics use your preferred units from **Settings** when unit conversion is supported.

### Event lap tables

- Event details include a **Laps** table when selected activities contain lap data.
- A sole lap that repeats the whole activity is hidden. If the lap and activity totals cannot be compared reliably, the lap stays visible. Final segments after earlier laps remain visible, including Garmin **Session end** laps and Suunto final partial laps. Chart and map end markers are handled separately.
- To change it, open **Laps -> Columns**, choose Running, Cycling, Swimming, or Other activities, then tick the metrics you want to see. Use the typed metric search to quickly narrow long lists.
- Quantified Self remembers a separate column list for each of those sport families. A triathlon can therefore keep different running, cycling, and swimming lap layouts.
- Running and trail-running laps use pace, cycling laps use speed, and swimming laps use swim pace. These values, along with other convertible metrics, follow your unit preferences in **Settings -> Units & formatting**.
- Swimming laps include **Stroke** by default when recorded per-length stroke data is available. Use **Laps -> Columns -> Swimming -> Stroke** to show or hide it. Existing saved column choices stay as you selected them. Stroke labels come from active lengths assigned to that lap; **Mixed** means those lengths contain different recorded strokes. Missing stroke data and rest-only laps stay blank.
- Swim interval rows can expand through their **Lengths** button into the individual recorded FIT pool lengths, with split times, stroke counts, stroke, and pace. For example, a recorded 150 yd rep in a 25 yd pool expands into six lengths, and 250 yd into ten. This requires recorded length messages; longer reps are not divided into invented splits.
- Swimming defaults also include **Total strokes** and calculated **SWOLF (25 yd)** or **SWOLF (25 m)**, alongside stroke rate (spm). The SWOLF reference follows your first Swim pace preference. Existing saved column layouts stay unchanged; add either metric through **Laps -> Columns -> Swimming**.
- Stroke, total strokes and normalized SWOLF columns are available only for swimming.
- Calculated SWOLF uses active swim seconds plus total strokes, scaled to the displayed reference distance. Recorded SWOLF remains available in length details. Incomplete length details can use valid native interval metrics when no rest lengths are recorded. A partial collection of lengths never replaces the full interval's metrics when its recorded active-length count differs. Mixed swim/rest intervals require complete active length details for calculated performance values. Compare efficiency within a similar stroke and physical pool length; normalizing the reference does not remove differences in turns.
- Rest intervals have a **Rest** label and shaded rows. Recorded inactive laps and idle/rest lengths identify rest; when these are unavailable, a lap with recorded zero distance and zero stroke rate is treated as rest. Active drills stay active even with zero strokes.
- Each lap table includes a persistent **Avg** row directly below its headers, with averageable lap metrics in their matching columns and using those same units. Accumulated totals, such as duration, distance, elevation, energy, and work, are not averaged.
- Swimming **Avg** values exclude rest. Swim pace and calculated SWOLF are weighted by active distance, and cadence/stroke rate by active swim time. For laps containing both swim and rest lengths, recorded active lengths supply the performance values; the lap's duration and distance totals remain available.
- Use the checkboxes beside lap rows to compare a temporary selection. A sticky **Selected avg · N** footer appears while rows are selected and averages the selected values in the visible columns. It includes how many selected laps contributed to each value, uses distance-weighted pace and duration-weighted speed where appropriate, applies the same active-only swim performance averages, and disappears when the selection is cleared.
- A saved lap column stays selected even when the current laps do not contain that metric. The column chooser marks it as unavailable and hidden from the table, or shows when it is available in only some of the current lap tables.
- Satellite diagnostics and EHPE/EVPE position-error metrics are intentionally left out of the column picker. Related Average, Minimum, and Maximum values are grouped under their shared metric name.
- The menu includes the Event Summary metric families, but a column appears only when a current lap has a valid value. Missing values stay unavailable rather than becoming zero.

### Event swim length tables

- Event details include a **Swim Lengths** table when selected swim activities contain per-length pool data.
- Swim lengths are grouped into collapsed sets through the next idle/rest length; expand a set to inspect each individual length row. You can also expand recorded lengths directly from the corresponding swim lap row.
- Each swim set header shows its recorded **Stroke** automatically, such as Freestyle or Breaststroke, with **Mixed** for different active strokes in the same set. Expand the set to see the stroke for each length.
- Set headers separate **Swim** time (excluding idle/rest lengths) from **Rest** time. **Total** keeps the combined time when both are available. For example, 51 seconds swimming plus 10 seconds resting shows Swim 51s, Rest 10s, and Total 01m 01s. Set swim pace, stroke totals, average stroke rate, and efficiency exclude rest too.
- Each length keeps its recorded duration and all available details. Timing uses recorded timer time, falling back to elapsed time when timer time is missing. Missing timing stays blank; unrecorded rest is not inferred from gaps between lengths.
- Missing active-length distance can use its recorded pool length for distance, splits, pace and calculated SWOLF. Rest lengths never gain distance from pool size. Set pace and calculated SWOLF require complete active time and distance.
- Swim lengths appear in activity tabs and show lap index, split progress, duration, distance, length type, stroke, strokes, swim pace, stroke rate, heart rate, SWOLF, and energy when available.
- Active split progress is shown inside each expanded set, so a 25 m pool with a 100 m set displays 25 m, 50 m, 75 m, and 100 m splits before the rest row.
- In **Settings -> Units & formatting -> Customize units -> Swim pace**, put your preferred pace unit first: **per 100 meters** shows recorded swim distances in meters, and **per 100 yards** shows them in yards. This applies to swim lengths, split progress, set totals, swimming summaries, lap tables, detailed statistics, and swim/lap chart tooltips. The general kilometers/miles preference does not override it.
- Swim comparison differences use the same meter/yard preference as their distance values. Totals combining swimming with other sports use your general distance units.
- A 25-yard pool with a 100-yard set shows 25 yd, 50 yd, 75 yd, and 100 yd splits before the rest row. Set headers show the total distance, swim time, rest time, and combined total; expand them for individual lengths. Open sets stay open when unit preferences change. Stored distances remain in meters, so changing the preference does not change your activity data.
- Swim pace and energy values follow your preferred units from **Settings**.

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
- In **Zoom** chart mode, pinch with two fingers on a touch screen to zoom an Event details chart's horizontal axis, then swipe left or right with one finger to move through the zoomed range. The same time or distance range appears across the other event charts and the zoom bar; vertical page scrolling remains available. In **Select** mode, one-finger drags select a range and pinching does not change the chart range.
- Each event chart panel can use the **Overlay** button to compare one other available metric on a shared y-axis when metrics are compatible, otherwise on a right-side y-axis; overlay choices are saved globally by primary metric, so **Heart Rate** can always request **Altitude** when both streams exist.
- Right-clicking an event chart copies a themed image of the full chart panel, including the chart title, legend, and range statistics.
- On phones, the **Durability** performance chart keeps its activity eligibility details collapsed by default; use the disclosure button beside the chart title to inspect them.
- **Durability unavailable** appears only when multiple performance chart tabs are shown and the selected activities lack supported output data. It is hidden beside a single chart or when no performance charts are available.
- **Durability** compares the usable first and second halves of a long, reasonably steady effort after warm-up and cool-down are excluded. For cycling, **matched power and heart-rate data** means both signals were recorded at the same moments; coverage tells you how much of the comparison was usable. An eligible result describes whether power relative to heart rate was lower, higher, or unchanged in the second half, then reports second-half output relative to the first and the average heart-rate change. Lower later power relative to heart rate can suggest more cardiovascular strain, but one ride is context rather than a fitness verdict.
- Swim activities with per-length pool data show a **Show Swim Lengths** chart option that overlays swim length end boundaries on the chart; active and idle/rest lengths are both included.
- When an overlay is active, the primary metric keeps its normal line and fill, while the overlay normally renders as a plain solid no-fill line using the overlay metric's series color. Enabling **Distinct line patterns** applies the device pattern to both metrics on merged and benchmark events. On merged and benchmark events, overlay legend and tooltip rows include both metric and activity labels.
- When Grade Smooth or Grade streams are available, **Altitude** charts can color the altitude line by grade; the chart option **Color Altitude by Grade** is on by default and can be turned off from Chart options.
- When provider heart-rate or power zone boundaries are available on non-merged events, the **Heart Rate** and **Power** charts color their lines and visible fill by zone.`,
    links: [
      { label: 'Login', icon: 'login', kind: 'route', target: '/login' },
      { label: 'Dashboard', icon: 'space_dashboard', kind: 'route', target: '/dashboard' },
      { label: 'Calendar', icon: 'calendar_month', kind: 'route', target: '/calendar' },
      { label: 'Plans', icon: 'event_note', kind: 'route', target: '/training/plans' },
      { label: 'Training plans guide', icon: 'school', kind: 'route', target: '/help', fragment: 'training-plans' },
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
    id: 'training-plans',
    icon: 'event_note',
    title: 'Training plans',
    summary: 'Create plans and standalone workouts, use approval-gated MCP planning, and manage opt-in provider delivery.',
    content: TRAINING_PLANS_HELP_CONTENT,
    links: [
      { label: 'Open Plans', icon: 'event_note', kind: 'route', target: '/training/plans' },
      { label: 'Workout library', icon: 'library_books', kind: 'route', target: '/training/plans/library' },
      { label: 'Training Plans overview', icon: 'travel_explore', kind: 'route', target: '/features/training-plans' },
      { label: 'MCP Connections', icon: 'devices', kind: 'route', target: '/services', queryParams: { serviceName: 'mcp' } },
      { label: 'Connected services', icon: 'hub', kind: 'route', target: '/services' },
      { label: 'Open Calendar', icon: 'calendar_month', kind: 'route', target: '/calendar' },
      { label: 'Training analysis guide', icon: 'monitoring', kind: 'route', target: '/help', fragment: 'training-analysis' },
    ],
  },
  {
    id: 'health',
    icon: 'cardiology',
    title: 'Health',
    summary: 'Compare Sleep and the complete Health metric catalog across providers without blending sources.',
    content: `${HEALTH_WORKSPACE_HELP_CONTENT}\n\n${TIMELINE_NOTES_HELP_CONTENT}`,
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
    content: `${TRAINING_ANALYSIS_HELP_CONTENT}\n\n${TIMELINE_NOTES_HELP_CONTENT}`,
    links: [
      { label: 'Open Training', icon: 'monitoring', kind: 'route', target: '/training' },
      { label: 'Training Analysis Overview', icon: 'travel_explore', kind: 'route', target: '/features/training-analysis' },
      { label: 'Email Training Feedback', icon: 'email', kind: 'email', target: `${SUPPORT_MAILTO}?subject=Training%20feedback` },
    ],
  },
  {
    id: 'post-workout-reflections',
    icon: 'rate_review',
    title: 'Post-workout reflections',
    summary: 'Keep optional private text context for a recording or one activity.',
    content: `## Add or skip a reflection

Open your saved recording and select **Edit details** in the summary actions. The same form contains **Name**, **Description**, **Feeling**, **RPE** and an optional **Private reflection**. For a workout with one activity, the private note applies to the entire workout. When the workout has multiple activities, choose **Whole recording** or one activity explicitly for the note. Benchmarks and other people’s recordings do not offer reflection editing. Changing the selection discards only unsaved reflection text; your other edits remain staged.

There is one **RPE** input for the **whole recording**, including when your private note refers to one activity. It edits the existing workout RPE. There is no separate reflection rating. An absent RPE shows **Not recorded**; imported fractional values are preserved unless you change them.

Use any of the three optional prompts and write up to **2000 characters**. Select **Save changes** once to save your edited event details and private note together. **Cancel** writes nothing. A conflict or failed save preserves your whole draft; event details and the note cannot be partially saved. Unchanged reflection text is not rewritten, and a reflection read failure still permits details-only edits. Voice entry is not included.

An exact saved planned-workout link can add a comparison prompt; it does not prove completion or that today’s prescription matches the recorded session. Reflections never complete a planned workout, change a recipe, adapt your plan, alter load/readiness calculations, or diagnose an injury.

## Privacy, editing and deletion

Reflections are private even when the recording is public. They are separate from Timeline notes, Health entries, event descriptions and provider data. They are not included in activity exports or sent to connected fitness services. Edit the same selection to replace its text. A concurrent edit requires reloading; a failed save keeps your draft for retry.

**Delete reflection** stages a permanent-delete review in the same form. **Keep reflection** cancels that deletion; **Cancel** discards the whole draft. **Save changes** confirms the deletion and any other staged event edits together. The private note cannot be restored. A content-free revision marker prevents stale edits restoring deleted text; deleting the recording or account removes that marker too. Reflections remain until you delete them, their recording or your account. Reparsing does not copy reflection context to newly identified activities.

## Optional AI access

An external MCP client needs **Private workout reflections** plus **Individual activity details** to read a selected reflection. **Change workout reflections** additionally permits focused save or permanent delete through the client’s approval controls. Requested permissions start checked; uncheck them before approving to withhold access. Existing connections must authorize again to add these grants. Keep automatic approval off when you require review before each write; disable reflection writes in unattended modes. Availability follows the separate server release and tool-catalog refresh.

In the built-in Assistant, **Private workout reflections** in **Examples & data access** starts on for fresh and New chats. You can turn it off; existing off choices and older chats without the setting stay off. Gemini can read selected private text and prepare one change; only you can review and **Apply change**, **Delete reflection** or **Dismiss** in QS. Changing access starts a fresh chat. Text is reported context, never instructions, proof of causation or consent to adapt Training. Revoking AI access stops future reads and writes but cannot erase text a client already received or quoted.`,
    links: [
      { label: 'Assistant', icon: 'auto_awesome', kind: 'route', target: '/ai-insights' },
      { label: 'MCP access policy', icon: 'shield', kind: 'route', target: '/policies', fragment: POLICIES_MCP_CLIENTS_FRAGMENT },
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
- If a Training snapshot is still preparing, the Assistant keeps your question ready to retry and returns that attempt to your allowance.

## How chat works

- Ask a question and press **Send**. Press **Shift + Enter** for a new line.
- Starter prompts fill the composer; they do not send automatically.
- **Today's workout** in **Examples & data access** asks for one standalone session using recorded readiness, recovery, recent training load, and your 28-day weekday training pattern. It also asks the Assistant to state your usual recorded per-session duration and load for the suggested sport with the period and session count, compare the proposed session with those values, explain any reduction, and ask for missing information before choosing a duration when that baseline is unavailable. With **Training plans** access it can check existing workouts; with the independent **Timeline notes** access it can consider relevant recent or ongoing notes. Missing records do not prove you skipped training. Turn on **Plan and workout changes** to prepare a session, then review it and choose **Apply changes** before it is added. Choosing the example does not turn on permissions or send a workout to a service.
- Ask follow-up questions in the same active conversation. The latest six completed turns provide bounded context, including message dates and confirmed Training changes. Freshly checked records take precedence over earlier answers. This is not memory across separate chats.
- If you refresh while an answer is in progress, the page keeps the pending question visible and reconnects to the server-owned turn. While the outcome is uncertain, that browser tab temporarily keeps the account-bound, bounded question and request metadata in session storage. If the refresh cancelled the send before registration, it safely resends the same request ID; completed requests cannot be duplicated. A different signed-in account cannot restore the record, and it is cleared after completion, confirmed failure, reset, or expiry.
- Every current answer must use at least one verified Quantified Self tool result. Expand **Data used** below an answer to inspect compact facts and app links produced from actual tool results.
- Use **New chat** to clear the stored messages, return data access to its defaults (Manual Health measurements and Private workout reflections on; other optional access off), and start a new conversation generation. An older in-flight answer cannot restore a cleared conversation.

## What the Assistant can read and propose

- **Training planning (optional):** turn on **Training plans** in **Examples & data access** to read current plans, authored phase names/dates/descriptions, standalone workouts, full instructions, exact stored completion links, step notes and existing service sync status. **Plan and workout changes** and **Planned-workout sync changes** are separate default-off choices and require Training plans access. Gemini can prepare one bounded proposal but cannot apply it. For phase edits, review the full current/proposed phase list and plan dates. For interval workouts, review the before/proposed totals, changed step definitions, notes, targets, repeats, dates and destination. Open **Show profile** to inspect the proposed workout; changed definitions are highlighted. Unknown duration and estimated ranges stay labelled. Provider mapping shows local limitations, not connection availability or proof that a service or watch received the workout. Large change lists can be expanded and scrolled. Choose **Apply changes** or **Dismiss**; expired or concurrent changes require a fresh proposal. Changing access starts a fresh chat; **New chat** resets Training permissions off and invalidates older proposals. Workout sync remains Pro and connection/rollout gated; a sync failure never removes an authored workout. Confirmed sync means the workout exists in the connected app, not that it reached a watch.

- **Deleting a plan or planned workout:** with both Training change choices on, the Assistant asks whether to also remove older, uncompleted service copies unless you already chose. Review that choice, then use **Delete plan** or **Delete workout**, or **Dismiss** to change nothing. Workout deletion is recoverable; a plan and its history are permanently removed, and you choose whether its workouts stay standalone or are deleted. Eligible upcoming copies are handled automatically. Older-copy cleanup is optional, needs valid service access/provider support, and does not require Pro. The deletion result confirms the change in QS, not removal from a connected app or watch. Completed activities stay untouched.

- **Timeline notes (optional):** enable **Timeline notes** in **Examples & data access** to let Gemini read full private titles and details when relevant, including notes hidden from charts. In a workout-suggestion question, recent or ongoing notes about sickness, injury, travel, or vacation can provide context alongside sleep, readiness, and training history. It is off by default. Changing optional access starts a fresh chat and preserves the other choices; **New chat** turns notes access off. Without it the Assistant cannot check notes and should say so. Notes are user-reported context, not verified diagnoses or instructions, and never change calculations, automatically send a workout, or authorize plan changes.

- **Private workout reflections (optional):** the independent choice in **Examples & data access** starts on for fresh and New chats and can be turned off. It allows reading selected private notes, or preparing one save or permanent delete. Review the activity/date, whole-recording or activity target, and current/new content before **Apply change** or **Delete reflection**. **Dismiss** changes nothing. New chat restores the on default; existing off choices and older chats without the setting stay off. See [Post-workout reflections](#post-workout-reflections) for storage and deletion details.

- **Manual Health measurements:** on for fresh/New chats; existing chats without this choice stay off. Use the independent choice in **Examples & data access** to withhold exact manual-entry lookup and changes. Ask to log, find, edit or permanently delete any Health manual type. Gemini prepares one review with explicit values, units and observation time; only you can **Apply change**, **Delete measurement** or **Dismiss**. Blood pressure is a whole pair with optional pulse; deletion cannot be restored. VO2 max needs context and method. Imported readings cannot be edited. Other optional permissions stay unchanged.

- **Activity tags and Timeline note changes (optional):** enable **Activity tag changes** to let the Assistant read the selected activity's complete current tags and prepare a replacement. Enable **Timeline note changes** after enabling Timeline notes to prepare one create, edit, or permanent delete. Gemini sees prepare-only tools, not direct writes. Quantified Self shows the target and exact proposed content; choose **Apply change**, **Delete note**, or **Dismiss**. Concurrent edits, expired proposals, access changes, and stale chats fail instead of overwriting data. Tags remain shared by activities in the same event.

- **Today and recovery:** daily report, current readiness, sleep duration and stages, aggregate/overnight HRV, sleeping heart rate, SpO2, respiration, and bounded sleep trends.
- **Workout suggestion for today or tomorrow:** the Assistant checks today's recorded activity, the requested day's usual weekday pattern, and ready Training load snapshots. With the separate choices enabled, it also checks dated Timeline notes and the requested day's planned workouts with their exact stored completion links. Follow-ups such as “What about tomorrow?” keep the requested date clear. Tomorrow's suggestion uses today's available readiness, not a prediction of tomorrow's sleep, and should be reassessed tomorrow. “Today is done” means no extra session today; “without my plan” asks for an alternative without changing your actual schedule. The answer lists the checked facts and any missing or incomplete data. An ended note is historical context, an upcoming note is not a current condition, and a planned workout is not proof it was completed. A suggestion does not create or send a workout; a requested change still needs your review in Quantified Self. Apply and Dismiss are recorded as a compact **Training review result** under **Data used** in the saved chat. An accepted sync request is not proof of delivery to the service or watch.
- **Training:** Training metric catalog, preparation of selected snapshots, current values, Form, ramp, load, volume, intensity, current-versus-usual context, and missing or rebuilding states. The example questions include the impact of your latest completed workout and yesterday's training. For one completed activity or one selected local date, the Assistant can explain identity-free **Training impact** from the existing Form model. It first resolves the exact completed activity or complete bounded day, then shows one TSS/CTL/ATL/Form contribution total and the actual dated UTC Training-day outcome after decay. A local date can have two UTC outcomes. It never includes planned workouts, activity titles, exact start times, devices, or provider provenance. This describes modeled sustained load, not measured physiological adaptation. If preparation takes longer than a short wait, try the same question again after a few seconds.
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
- Saved-route bounds, route geometry, route waypoints, full-resolution or unrequested sensor streams, original files, direct write tools, and dashboard settings remain unavailable even when precise activity locations are enabled. The Assistant can prepare manual Health measurement, Training, activity-tag and Timeline-note proposals; only the user can review and apply them in Quantified Self.
- Gemini receives your message, the browser's IANA timezone for local-day context, bounded recent conversation context, and the validated read-only tool results selected for the current question. Direct in-app URLs are withheld, and an answer that repeats an opaque reference or cursor is rejected. Raw FIT, TCX, GPX, JSON, and SML files are not sent.
- Evidence rendering removes opaque references, cursors, provider, device, source, owner, token, and identifier fields again before display.
- The Assistant is fitness information, not medical advice. Verify important health and Training decisions.

## Retention and control

- Quantified Self stores one active conversation per user, with at most the latest six completed turns. If bounded charts, maps, and grounded details make that transcript too large, the oldest whole turn is removed first so the newest completed answer can still be saved. Text, compact evidence, and any bounded chart or map payload use the same retention period.
- The active conversation becomes unavailable about **seven days** after its latest completed turn or reset. A response already in progress can protect an imminent expiry for at most four extra minutes. Firestore TTL then deletes the expired record asynchronously; account deletion removes it directly.
- Conversation documents are server-owned. Browser code cannot read or write them directly; it must use authenticated App Check callables.
- **New chat** immediately replaces the stored conversation, removes its prior message content and pending proposals, and returns precise activity locations, Timeline notes, tag/note changes and all Training choices to **off**, with Manual Health measurements **on**.

## Built-in Assistant or external MCP?

- Use the **Assistant** for a zero-setup, app-funded conversation. It is coordinate-free by default and offers explicit per-chat precise **activity** location access.
- Use [Connections -> MCP](/services?serviceName=mcp) when you prefer ChatGPT or another compatible client, need separately approved saved-route location or geometry access, or want usage billed by that external client.
- External MCP calls do not consume the in-app Assistant allowance. External clients have their own privacy and retention practices.

## Troubleshooting quick checks

- **App verification failed**: refresh and retry.
- **Conversation changed**: another tab or New chat replaced the active conversation; reload and retry.
- **Another response is in progress**: wait for the current turn to finish. A stale turn lock expires automatically.
- **Quota reached**: wait for reset, upgrade, or use your own compatible AI client through MCP.
- **Training metrics preparing**: wait a few seconds and send the retained question again. The pending attempt does not use your Assistant allowance.
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
      { label: 'Email Support', icon: 'email', kind: 'email', target: SUPPORT_MAILTO },
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
- Free permission-scoped MCP connections, including approval-gated Training plan and workout changes

### Basic

- Everything in Starter
- Up to **${getNumberFormatter('en-US').format(USAGE_LIMITS.basic)} activities**
- Up to **${ROUTE_USAGE_LIMITS.basic} saved routes**
- **My Tracks (Beta)** access
- Paid-only chart customization such as custom watermark text

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
- **Connections page and MCP data access:** Starter, Basic, Pro
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
      { label: 'Email Support', icon: 'email', kind: 'email', target: SUPPORT_MAILTO },
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

The public [Workout File Analyzer](/features/fit-gpx-tcx-file-analyzer) page explains how FIT, GPX, TCX, JSON, and SML activity uploads can be analyzed with maps, charts, statistics, exports, source-file context, and reprocessing. The public [Workout Data Comparison](/features/workout-data-comparison) page explains how those files can be compared with provider activities, sports devices, and benchmark reports. The public [FIT and GPX Route Files](/features/fit-gpx-route-files) page explains saved FIT course and GPX route/track uploads, original-file retention, downloads, and route limits.

Saved routes open from **Routes** with the details action. Route details parse the original FIT or GPX file in memory to show the route summary, all segments, map, elevation and grade charts, waypoints and turn instructions, and original-file download. GPX files with route points, untimed tracks, or timed track geometry can be saved as routes from **Routes**. The original uploaded route file remains the canonical source; parsed points and streams are not saved back to Firestore. New or reprocessed saved routes store a lightweight encoded route preview for route-table thumbnails, the Routes page map, and dashboard route maps. The Routes page map follows the current table filters using saved-route documents only; it does not load activity events or parse original route files. Older saved routes need to be reprocessed before they appear with previews.

From **Route actions → Send to** on Route Details, Pro members can send the current saved route to eligible connected **Suunto**, **COROS**, **Garmin**, and **Wahoo** accounts. Only eligible destinations appear. Connect or reconnect a provider from **Connections** if it is missing; Garmin needs Course Import permission, and Wahoo may open a **Reconnect Wahoo** dialog to let you allow route access; after reconnecting, send the route again. The route must belong to you and retain its original file. A **Sending route** indicator stays visible while the request runs, and repeat sends are blocked until it finishes. The result appears below the summary and in a notification, and successful delivery updates the destination badge. Sending an updated Suunto copy asks for confirmation because it creates another route in Suunto.

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

- A route/course is not a recorded workout. When activity upload detects one, **Upload as route** appears after active upload batches finish and opens **Routes**; select the original file there. The rejected file is not automatically uploaded or converted.
- Your session may have expired. Sign in again and retry.
- You may have reached your current plan's activity or route limit.
- The file may be invalid, unsupported, or unreadable by the importer.

## Export and backup options

- You can export dashboard activity tables to CSV.
- CSV activity dates use the local calendar date in **YYYY-MM-DD** format so spreadsheets do not reinterpret the day and month order.
- From selected dashboard rows, CSV export, GPX export, and original-file download actions support your current multi-selection.
- If an activity has positional data, you can download **GPX** from its action menu or export selected dashboard rows to GPX; multi-selected GPX exports download as a ZIP.
- If original source files are stored for an activity, you can download the original file or files.

## Reprocessing a single activity

From an activity action menu you can also:

- **Regenerate activity statistics**
- **Reimport activity from file** when original source files are available`,
    links: [
      { label: 'Workout Data Comparison', icon: 'compare_arrows', kind: 'route', target: '/features/workout-data-comparison' },
      { label: 'Compare Files Tool', icon: 'compare_arrows', kind: 'route', target: '/tools/compare' },
      { label: 'Workout File Analyzer', icon: 'analytics', kind: 'route', target: '/features/fit-gpx-tcx-file-analyzer' },
      { label: 'FIT and GPX Route Files', icon: 'route', kind: 'route', target: '/features/fit-gpx-route-files' },
      { label: 'Subscription', icon: 'credit_card', kind: 'route', target: '/subscriptions' },
      { label: 'Dashboard', icon: 'space_dashboard', kind: 'route', target: '/dashboard' },
      { label: 'Email Support', icon: 'email', kind: 'email', target: SUPPORT_MAILTO },
    ],
  },
  {
    id: 'service-connections',
    icon: 'sync',
    title: 'Connected Services',
    summary: 'Garmin, Suunto, COROS, and Wahoo connection rules, limits, and expected import behavior.',
    content: `## Pro requirement

Garmin, Suunto, COROS, and Wahoo connections are part of **Pro**.

After you return from a provider, Quantified Self shows a successful connection only after the server confirms that the authorization was saved. If you deny access, the provider returns an incomplete response, the authorization expires, or saving fails, Connections shows an error and you can start the connection again. A recovery attempt that removes an old connection says so instead of showing it as connected; partial cleanup remains visible as pending rather than claiming removal.

The **Connections** page is available to every signed-in account. Starter and Basic accounts open on the free **MCP** tab by default and can select every provider tab to review its capabilities. Provider tabs are marked **PRO**, while MCP is marked **FREE**. Connecting a provider, importing history, uploading to a provider, and automatic sync still require Pro.

Services opens each provider on a compact connection overview. Choose an action on an activity, sleep history, route, upload, or automatic sync card. For non-Pro accounts, the action opens the Pro subscription page. For Pro accounts, it opens the provider tool in a dialog; close the dialog to return to the unchanged overview. A connected provider can always be disconnected after Pro access ends. Once any grace period expires, an automated subscription check disconnects remaining expired Pro provider connections.

### Garmin permissions

In **Connections → Garmin**, **Permissions** shows each account's last-reported access for supported permissions, including **Training** and **Course Import**. **Granted** and **Not granted** describe Garmin's saved response. **Not reported** means QS does not yet have permission details for that connection—not that you denied access. A granted permission does not mean every related feature is available in QS.

If a Garmin history or route-upload tool says **Permission details unavailable**, close that tool and select **Manage in Garmin** on the connection overview to check access. Contact support if permission details remain unavailable.

Select **Manage in Garmin**, find **Quantified Self** under Garmin Connect's **Connected Apps**, and manage the permissions Garmin offers there. Changes appear after Garmin reports them. You do not need to disconnect in QS first. Viewing these details and opening Garmin's settings are available without Pro. **Reconnect** is reserved for connection recovery, not refreshing permissions on a healthy connection. These rows are not local permission toggles or a live Garmin check, and opening the page does not change access or opt workouts into sync.

### Disconnecting a provider

When a disconnect begins, automatic activity and saved-route delivery involving that provider turn off. If the connection shows **Disconnect pending**, sync is paused while the server retries; you do not need to keep the page open. Operational cleanup can finish in the background after disconnect completes. Your previously imported activities, saved routes, Health history, and Sleep sessions stay in your account. After reconnecting, turn any automatic delivery directions you want back on yourself.

At the top of Connections, **Your data flow** explains that connected providers import new activities into Quantified Self. Non-Pro accounts see a Pro upgrade explanation instead of an unusable connection prompt. Once two or more services are connected with Pro access, it shows a provider-to-provider matrix of compatible automatic activity and saved-route delivery paths through Quantified Self. On phones, the same routes are grouped by source and destination instead of using a wide table. Enabled routes show **On**, available routes remain opt-in, and a configured route that cannot run because a provider is disconnected or needs reconnection is marked **Needs connection**. With no services connected, it prompts a Pro account to connect its first provider.

## Integration pages overview

The public [Integrations hub](/integrations) links to focused [Garmin Integration](/integrations/garmin), [Suunto Integration](/integrations/suunto), [COROS Integration](/integrations/coros), and [Wahoo Integration](/integrations/wahoo) pages. They explain provider activity imports, supported activity-sync directions to Suunto, Wahoo, and COROS, direct GPX/FIT and saved-route delivery to Garmin, Suunto, Wahoo, and COROS, saved-route row and bulk sends, syncing past activities, opt-in Suunto route delivery, history imports, uploads, and how those workflows connect to the private training dashboard.

Provider-specific privacy details live on [Policies -> Connected Services](/policies#connected-services-data), with separate sections for [Garmin Data](/policies#garmin-data), [Suunto Data](/policies#suunto-data), [COROS Data](/policies#coros-data), [Wahoo Data](/policies#wahoo-data), and [AI & Third-Party Processing](/policies#ai-and-third-party-processing).

The public [Training Data Sync Guides](/guides) hub links to the [import activities to Suunto guide](/guides/import-activities-to-suunto), [import activities to Wahoo guide](/guides/import-activities-to-wahoo), [Garmin to Suunto sync guide](/guides/sync-garmin-to-suunto), [COROS to Suunto sync guide](/guides/sync-coros-to-suunto), [Wahoo to Suunto sync guide](/guides/sync-wahoo-to-suunto), [Suunto routes to Garmin courses guide](/guides/sync-suunto-routes-to-garmin-courses), and [centralized workout data guide](/guides/centralize-garmin-suunto-coros-workout-data) for step-by-step setup.

The public [Tools hub](/tools) links to the [File Comparison Tool](/tools/compare), which creates saved benchmark events directly from FIT, GPX, TCX, JSON, and SML files.

The public [Features hub](/features) links to [Workout Data Comparison](/features/workout-data-comparison), [Workout File Analyzer](/features/fit-gpx-tcx-file-analyzer), and [FIT and GPX Route Files](/features/fit-gpx-route-files). The comparison page combines centralized Garmin, Suunto, COROS, and Wahoo activities with uploaded FIT/TCX/GPX/JSON/SML activity files, synchronized overlays, sports-device benchmarks, and reviewer workflows for device tests, YouTube videos, and blog posts. Manual uploads, core analysis, and benchmark comparisons are available on the free plan for up to ${USAGE_LIMITS.free} activities and ${ROUTE_USAGE_LIMITS.free} saved routes; automatic provider sync and higher limits require a paid plan.

Activity-history date pickers for Garmin and Suunto default to the latest **2 calendar years** through today. COROS defaults to its full **3-month** provider limit, and Wahoo defaults to the latest **2 years**. You can select a longer or shorter range before importing, subject to each provider's available-history limit.

## Sleep data

Sleep sync is server-owned health data. When available, Garmin, Suunto, and COROS sleep sessions are imported as separate source records and shown by the dashboard **Sleep** tile. The sleep chart has its own 14d, 30d, 90d, and 1y range control with older/newer paging, independent from dashboard event filters. It stacks sleep stages and overlays available vitals: recorded sleep HRV, average sleep heart rate, and minimum sleep heart rate with range-average reference lines, plus max SpO2 when the provider includes those values. Garmin and Suunto Pro users can select the provider history action in Connections; Garmin users may also see a one-time dashboard prompt. Suunto can request sleep from Jan 1, 2000 to today with a 7-day cooldown. This is the requested range, not a guarantee that Suunto has data for every year. Connected Suunto users see **Sleep & 24/7 Health history** while Suunto Health is enabled; the same control queues separate bounded Health records for available heart rate, HRV, SpO2, altitude, steps, energy, Body Energy Balance, and StressState. These values stay separate from workout FIT metrics and Sleep sessions, and missing values remain missing. Garmin can request sleep for up to the latest rolling five years, receives records asynchronously from Garmin, and uses a 30-day cooldown. Garmin may allow a shorter range; we respect its earliest available date for each request. Connected Garmin Pro users see **Sleep & available Health history** while Garmin Health is enabled; the same request queues Daily, Stress, HRV, User Metrics, Body Composition, Pulse Ox, All-day Respiration, Blood Pressure, Skin Temperature, and Health Snapshot history in paced 90-day windows. Health records remain separate in the unified Health model, and missing values remain missing. COROS Pro users see **Sleep & daily Health history** and can import the available last three months in 30-day windows with a 7-day cooldown. The same daily COROS request stores source-attributed steps, the provider calorie value, resting and sleep heart rate, overnight HRV, and available detailed HRV samples in the unified Health model. Aggregate sleep values stay on the Sleep session and are referenced rather than copied; missing values stay missing. The COROS API does not expose sleep stages.

## Suunto

Suunto tools currently include:

- connecting your account,
- syncing recent sleep samples,
- requesting available sleep history from Jan 1, 2000, with combined Sleep & 24/7 Health history while Suunto Health is enabled,
- importing separate source-attributed 24/7 Activity, daily-statistics, and Recovery Health records,
- importing history,
- automatically importing saved Suunto routes,
- importing existing Suunto routes,
- uploading FIT activities to Suunto,
- uploading GPX or FIT routes to Suunto.

Suunto FIT activity uploads in Services show each file's upload status, duplicate detection, failure message, and retry control. A pending upload stays **Processing**, with delayed automatic status checks against the same upload job rather than another file upload. After eight automatic checks, checks pause and **Check status again** lets you request another status check without declaring the upload failed. Closing the uploader stops its automatic checks; upload rows are not retained across reloads. If Suunto has already issued an upload job when a temporary error occurs, retrying the same row checks that job instead of uploading the FIT again. A pending or ambiguous job is never replaced automatically. An explicit processing failure that requires a restart stops status checks; **Retry upload** then starts a fresh attempt. Otherwise, to deliberately start a fresh upload, clear the upload list and choose the FIT file again. Large upload batches are processed one file at a time with short pauses between provider upload calls.

Closing the Suunto uploader or clearing its list removes its local progress notifications. This does not cancel an upload that Suunto may still be processing.

While your Suunto account is connected, Quantified Self also imports new and updated Suunto routes into **Routes** automatically. Services includes an **Import existing routes** action for first-time imports or after reconnecting. The **Routes** page can also show a one-time prompt to import existing Suunto routes.

Suunto users can turn on **Automatically send new and updated routes** in Suunto Services for Garmin, Wahoo, or COROS. Every destination is opt-in and off by default. Garmin can also be enabled from a one-time **Routes** page prompt when both connections are ready. This sends newly imported or updated Suunto routes already saved in Quantified Self to the selected destination. Garmin receives a course and requires **Course Import** permission. Wahoo receives a FIT course and requires Wahoo route access. COROS receives GPX route geometry; cycling activity types are sent as bike routes and all other or unspecified types as running routes. **Send routes** uses Suunto routes already saved in Quantified Self and can backfill them without enabling future delivery. It does not fetch routes from Suunto or any destination during delivery. Wahoo uses a stable saved-route key, so an updated Suunto route replaces its earlier Wahoo route instead of creating a duplicate. COROS uses a deterministic ID for the exact saved-route revision, so repeating that revision is deduplicated. If Wahoo was connected before route delivery was available, reconnect it once to grant route access.

Saved FIT and GPX routes can be sent to Suunto from **Routes** using a row action or the selected-row bulk toolbar. Quantified Self reparses each saved route from its original source file, generates a fresh GPX export, and uses the saved Quantified Self route name as the route name sent to Suunto. Suunto imports sent route files as new routes, so sending an edited route that was already sent to Suunto creates an updated copy in Suunto App. Routes imported from Suunto are not sent back to the same connected Suunto account, but they can still be sent to a different connected Suunto account when one exists. Bulk sends upload routes one at a time so partial failures can be reported without stopping successful routes.

**Uploads** in Suunto Services also accepts a selected GPX or FIT route without adding it to **Routes**. Suunto receives GPX, so Quantified Self converts a selected FIT route to GPX in memory before delivery. The direct upload does not create or retain a Quantified Self route.

Suunto 24/7 Health notifications are signature-checked and used to refetch bounded local-day ranges. Nearby notifications for the same day are grouped into a refresh that starts after a window of up to five minutes, so new readings or corrections may take a few minutes to appear. Quantified Self stores normalized, source-attributed Health records rather than raw webhook samples. Repeated polls, notifications, and history ranges update the same source identities instead of creating duplicates. Disconnecting stops future imports but retains imported Sleep and Health history; deleting the account removes both plus associated queue work.

See [Policies -> Suunto Data](/policies#suunto-data) for the provider-specific privacy summary for Suunto imports, Sleep and 24/7 Health sync, route imports, and sending routes or activities to connected destinations.

## Garmin

Garmin history import has two important limits:

- one import request every **30 days**,
- and only the latest rolling **5 years** of activity data. It does not support an arbitrary older five-year period.

The history picker disables dates before the current five-year cutoff, and the server rejects an older range before contacting Garmin.
The picker starts with the latest two calendar years selected. You can expand it to any allowed range before importing, including the full available five-year window.

Garmin can deliver imported activities gradually over hours or days.

While Garmin activity history is being requested, Services shows **Import already running** and prevents another request. Closing the dialog does not cancel the request; reopening it shows the current running state. If another tab started the request before the status arrived, the duplicate request shows a wait message. Once the request is accepted, the usual **30-day cooldown** applies while activities continue arriving from Garmin.

Garmin Sleep and Health history import is separate from activity history import. It requests sleep through Garmin Health API and records appear later as Garmin sends sleep notifications.

Garmin can also send source-attributed Daily, Stress Details, HRV, User Metrics, Body Composition, Pulse Ox, All-day Respiration, Blood Pressure, Skin Temperature, and Health Snapshot summaries for connected accounts with Health Export permission. Missing measurements remain unavailable, Garmin Body Battery remains provider-specific, and these Health records do not replace Sleep sessions or workout metrics. Connected Pro accounts see **Sleep & available Health history** while Garmin Health is enabled; one request queues Sleep plus all ten Health families for up to the latest rolling five years in paced windows, respecting stricter provider limits. If Garmin Health is temporarily disabled, the control falls back to **Import Sleep history**. Garmin Summary Resender is reserved for bounded operational recovery after live delivery is verified.

If Garmin permissions are missing, reconnect the app and grant the required export, history, and health permissions in Garmin Connect.

Saved FIT and GPX routes can also be sent to Garmin Connect from **Routes**. Garmin must be connected with **Course Import** permission. If that permission is missing, Routes can show a Garmin permission prompt; open Garmin Connect, go to **Connected Apps**, allow Course Import for Quantified Self, and reconnect Garmin from Routes or **Services**. Quantified Self reads the original saved route file, uses the saved route name, and updates the same Garmin course when you send that route again to the same Garmin account.

**Uploads** in Garmin Services accepts selected GPX and FIT route files as well. Quantified Self parses either source format and creates a Garmin Connect course; this direct upload does not add the route to Quantified Self or retain Garmin delivery metadata, so uploading the same file again creates another Garmin course. Course Import permission is required.
See [Policies -> Garmin Data](/policies#garmin-data) for the provider-specific privacy summary for Garmin imports, Sleep and Health data, and Garmin to Suunto sync.

Garmin to Suunto activity sync requires:

- you must connect both Garmin and Suunto,
- turn on automatic activity sync in Garmin Services,
- and allow Activity Export in Garmin.

Garmin Services also offers Wahoo and COROS as opt-in activity destinations. Automatic delivery applies only to new imported FIT activities. **Send past activities** in the destination's Services card lets you preview and send saved Garmin imports, other supported provider imports, and manual FIT uploads from a selected date range without turning on future delivery.

Disconnecting Garmin, COROS, Suunto, or Wahoo turns off related automatic activity or route delivery. After reconnecting, turn each route on again if you want automatic sync to resume.

If a provider revokes access, Quantified Self marks that connection as **Reconnect required** in Services and may also show a dashboard reconnect prompt. Reconnecting restores access; dismissing the prompt does not reconnect automatically.

Automatic sync runs only for newly imported Garmin activities and uses the stored original activity file from your event.

For a one-time send, open **Send past activities** under the destination service in Services. Select **Garmin imports** and any other sources you want, including **Manual uploads**, then choose dates and preview. The server checks each saved original before scheduling delivery. Only retained FIT files are eligible; manual FIT.gz uploads are expanded for sending. GPX, TCX, merged or derived events, missing files, and activities already sent or already in a one-time send for that destination are skipped. An automatic send that has not begun its destination upload can be converted to a one-time send.

You can send past activities while automatic activity sync is off. A source connection is not required for a saved import, but the destination must be connected. This does not turn on automatic sync for future imports. Preview does not send anything; **Send** schedules background delivery, which may still fail or be rejected by the destination. Retrying the same selection safely skips one-time sends already queued or completed.

When Garmin and Suunto are connected, the dashboard may offer a one-time action prompt to turn on automatic Garmin to Suunto activity sync. Dismissing the prompt hides it permanently; **Send past activities** remains available in Services.

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
- automatically sending new Garmin, Suunto, or Wahoo activities to COROS, or sending saved FIT imports and manual uploads from a selected date range,
- automatically sending new COROS activities to Suunto or Wahoo, or sending saved COROS FIT imports from a selected date range,
- and opting in to new/updated or existing saved Suunto route delivery to COROS.

COROS activity upload, activity delivery, and route delivery are available to all eligible connected Pro users.

COROS uses one active connected account for every import and delivery. New OAuth connections pin that account. An older connection without a saved active account is pinned deterministically the first time it is used; if the pinned token disappears, delivery fails closed and asks you to reconnect instead of silently choosing another account.

When you open the COROS connection overview, Quantified Self asks COROS whether that account is still bound. If COROS says it is unbound, the card changes to **Reconnect required** and related automatic activity and saved-route settings turn off. A temporary check failure shows **Retry** and does not mark the account disconnected.

Connection checks pause while you connect or disconnect. Results from an earlier connection do not replace the current connection status.

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

**Send past activities** is available under the Suunto or Wahoo destination card in Services. Select **COROS imports** and a date range to send COROS activities already saved in Quantified Self; you can also select supported other imports or manual uploads.

You can send past activities while automatic activity sync is off. This does not turn on automatic sync for future imports.

When COROS and Suunto are connected, the dashboard may offer a one-time action prompt to turn on automatic COROS to Suunto activity sync. Dismissing the prompt hides it permanently; **Send past activities** remains available in Services.

The COROS Services card offers **Send past activities** for saved Garmin, Suunto, and Wahoo imports, plus manual FIT or FIT.gz uploads. Select sources and dates, preview eligible files, then schedule the send. Automatic delivery remains off unless you enable it separately. The retained original FIT is sent, so unsupported or unavailable originals are skipped.

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
- or choose sources and dates to send saved Garmin, COROS, Suunto, or manual-upload activities to Wahoo,
- automatically send new and updated Suunto routes already saved in Quantified Self to Wahoo, or send those saved routes now,
- automatically send new Wahoo activities to Suunto, or choose a date range to send past retained Wahoo activities to Suunto,
- automatically send new Wahoo activities to COROS, or choose a date range to send past retained Wahoo activities to COROS.

Quantified Self imports only Wahoo records with an available FIT file. Workouts without a FIT file are skipped, as are workouts Wahoo identifies as originating from a third-party fitness application. History is returned newest first and is queued for background processing; large ranges may take time to appear.

While Wahoo history is being scanned, Services shows **Import already running** and prevents another request. Closing the dialog does not cancel the import; reopening it shows the current running state. If another tab started the import before the status arrived, the duplicate request shows the same wait message. Once the scan finishes, the usual history-import cooldown applies, and queued activities continue processing in the background.

Direct FIT activity delivery only sends the selected file to Wahoo. It does not create or retain an activity in Quantified Self. During the initial send, Quantified Self parses the FIT on the server and uses the same explicit Wahoo workout-type mapping as automatic delivery. Wahoo may process an activity upload asynchronously; Services keeps the upload status and the optional mapped type available to refresh. If Wahoo has already issued an upload ID, retrying after a connection or status error checks that same upload instead of sending the FIT again. A fresh upload starts only after Wahoo explicitly reports that processing failed. If you connected Wahoo before activity sending was available, reconnect it once to grant workout write access.

If Wahoo rejects repeated token refreshes, its connection card changes to **Reconnect required**. Select **Reconnect** there and authorize the same Wahoo account so parked work cannot be delivered to a different account. To change Wahoo accounts, disconnect the retained account first and then connect the other one. Quantified Self keeps unaccepted automatic activity and saved-route deliveries parked while reconnecting, then resumes them safely after the new connection succeeds; it does not turn your saved route settings off.

After Wahoo processes an activity automatically synced from Garmin, COROS, or Suunto, or a direct FIT activity, Quantified Self corrects the Wahoo workout type when its canonical Sports Lib activity type has an explicit Wahoo mapping. Activities containing multiple canonical types are marked as multisport. The correction changes only the type and preserves the existing Wahoo workout title. If no explicit mapping exists, Quantified Self keeps Wahoo's inferred type instead of guessing or defaulting to cycling or Other. For a direct asynchronous upload, the browser temporarily echoes the server-derived mapped ID with the Wahoo upload ID; the backend accepts only IDs from the explicit mapping, and the connected Wahoo credential can affect only that user's own workout.

Direct course/route delivery accepts GPX and FIT files. Quantified Self converts a selected GPX route to a FIT course in memory before sending it to Wahoo; the GPX must contain exactly one route with valid coordinates. It sends the route to Wahoo without creating or retaining a route in Quantified Self. If you connected Wahoo before route sending was available, reconnect it once to grant route access. When a route send reports missing Wahoo route access, select **Reconnect Wahoo** in the displayed dialog, then send the route again after you return. Routes imported by Wahoo's Cloud API sync to the Wahoo App and directly to an ELEMNT bike computer, not the ELEMNT App.

Wahoo to Suunto or COROS activity sync requires:

- you must connect Wahoo and the selected destination,
- turn on automatic activity sync in Wahoo Services,
- keep both service connections active,
- and use Wahoo activities with a retained original FIT file.

Automatic sync runs only for newly imported eligible Wahoo activities. **Send past activities** under the Suunto or COROS destination card can send retained Wahoo FIT imports from your chosen date range. Select **Wahoo imports** and optionally other supported imports or manual uploads. You can send past activities while automatic activity sync is off; this does not turn on automatic sync for future Wahoo imports.

Disconnecting Wahoo revokes future access and stops new imports and deliveries. It does **not** delete activities already imported into Quantified Self. Delete individual activities yourself, or delete the account to remove all associated data. Wahoo-origin FIT activities can be delivered to Suunto or COROS after explicit opt-in. Suunto-to-Wahoo saved-route delivery is a separate, opt-in route workflow in Suunto Services; direct Wahoo GPX/FIT course/route delivery is a separate, user-selected Wahoo-only upload. Wahoo-owned plans are not imported, and plans or sleep are not forwarded between providers.

See [Policies -> Wahoo Data](/policies#wahoo-data) for the provider-specific privacy and retention summary.

## Queue behavior

Wahoo **Training** delivery is available to connected Pro members and is separate from activity uploads and route sending. If Wahoo needs plan access, use **Reconnect Wahoo** in Training sync and authorize the same account. Existing activity and route permissions remain requested. Reconnect alone does not enable plan sync: return to review the setup or retry the workout. Time-based running/cycling, outdoor Walking/Hiking without intensity targets, and timed-strength Gym workouts in the seven-day window can be delivered; strength repetition sets cannot; cloud acceptance does not confirm ELEMNT/watch receipt. Running/cycling subprofiles use their native indoor/outdoor type where available. Indoor Running uses Treadmill, Velomobile uses Cycling, and Enduro MTB/Downhill Cycling use Mountain Biking, with a review warning; the saved QS sport is unchanged. Wahoo supports timed, untargeted pool/open-water swimming and outdoor/indoor rowing. Native profiles and timed intervals have been account/device-tested; distance endings and intensity targets remain unsupported. Selected pool length is not sent to Wahoo: its Cloud API has no documented physical pool-length field, so QS does not support sending that setting. Check the selected Wahoo workout profile before starting; timed Gym workouts use **Strength Training**, not Yoga or Indoor Fitness Equipment. When Wahoo later returns the recorded activity with the exact QS-delivered Workout, Plan and token identifiers, Training can show **Completed · activity linked** without matching by title or date.

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
      { label: 'Email Support', icon: 'email', kind: 'email', target: SUPPORT_MAILTO },
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
- On event details, the activity actions button shows a spinner while sharing is being updated. Wait for it to finish before copying the public link or changing sharing again; your map and charts stay visible.
- Public links expose the shared event, its activities, any saved benchmark report, and every object stored under that event's source-file folder (\`users/{uid}/events/{eventId}/...\`) while sharing is enabled.
- Public links do not expire automatically and are marked noindex, but anyone with the URL can open them.
- Use **Stop sharing** from the event details menu or saved comparison row to make the event, activities, and event source-file folder private again.
- Anonymous viewers are read-only. They can open an existing saved benchmark report from a comparison link, but they cannot generate or save new reports.
- The built-in Assistant sends Gemini your message, bounded recent conversation context, and only validated Quantified Self tool results selected for that question. It is coordinate-free by default. If you explicitly start a chat with **Precise activity locations** enabled, selected activity-tool results may also send Gemini exact activity start/end and MTB jump coordinates and nearby activity results during that chat. Separately enabled Training, activity-tag, and Timeline-note changes expose only prepare tools to Gemini; application remains an app-owned user confirmation. Place-name searches send only the supplied location text to Mapbox. Changing a setting starts a new chat, and **New chat** returns optional access to off.
- The Assistant can send Gemini coordinate-free saved-route summaries selected for a question, including route names that may contain place information. It cannot access or send raw activity or route files, saved-route bounds, route geometry, waypoints, direct write tools, or dashboard settings. A prepared proposal cannot apply itself. Its server-owned conversation keeps at most six completed turns and bounded expiring proposals, becomes unavailable about seven days after the latest completed turn or reset (with at most four extra minutes for a response already in progress), and is then deleted asynchronously by Firestore TTL.
- The Policies page includes provider-specific sections for [Garmin Data](/policies#garmin-data), [Suunto Data](/policies#suunto-data), [COROS Data](/policies#coros-data), [Wahoo Data](/policies#wahoo-data), and [AI & Third-Party Processing](/policies#ai-and-third-party-processing).
- The dedicated [Privacy Policy](/privacy) and [Terms of Service](/terms) pages are public and readable without signing in.

## Settings you can change yourself

Settings uses one column on desktop and phones. Choose **Theme** directly at the top, then expand
**Units & formatting**, **Dashboard**, **Charts**, **Maps**, **Privacy & emails**, or **Account**.
The section summaries reflect your current choices, including unsaved edits. Opening another section keeps those
edits. A **Save changes** bar appears when you make changes and stays available as you scroll; it applies edits
across all sections. Failed saves keep your choices so you can retry. Privacy & emails is immediately before Account.

**Units & formatting** contains the unit preset, regional format, and start of week. Select **Customize units** to
change individual preferences such as weight or swim pace. Mixed choices are labelled **Custom unit choices**.
Choosing a preset replaces the individual distance, speed, pace, swim pace, and vertical speed choices; weight,
week start, and regional format remain independent. Presets require **Save changes**. Your name and identity details are in **Account**;
custom watermark text is in **Charts**. Account deletion remains separate at the bottom of Account.

In [Settings → Privacy & emails](/settings?section=privacy), turn **Usage analytics** or **Marketing emails** off, then select **Save changes**. Theme is directly available at the top of Settings. Other Settings sections let you customize charts, maps, units, and regional formatting.

Marketing emails are occasional founder messages about product updates and offers. They go only to accounts that explicitly opt in. Your login provider and email verification state do not change this preference. Every marketing email includes an unsubscribe link: opening it shows a confirmation page, and confirming turns the preference off without signing in. Its **Email preferences** link opens Settings → Privacy & emails. Turning marketing emails off does not stop transactional account or billing messages.

Admins can use [Marketing campaigns](/admin/marketing) to write with a formatting toolbar and see the complete founder email, including its footer, update beside the editor at desktop or phone width, or as plain text. Set **Sender name** to the personal name recipients should see. The sending address stays **updates@quantified-self.io**, and replies go to **Dimitrios <dimitrios@quantified-self.io>**. The preview shows From, Reply-to, and Subject. Preview links open separately so the email remains visible. Send a test to an address you choose directly from the composer, even before saving a campaign. This test does not create a campaign. A test is marked in its subject, and its unsubscribe link cannot change anyone's preference. Changing the saved email, including only its sender name, clears its earlier test result. Changing only the **internal name** or **sending schedule** keeps the current test approval. Select plans and inclusive UTC signup dates, prepare the fixed recipient list, then start, pause, resume, or clone the campaign. A saved campaign needs its own test accepted by the mail service before sending starts.

Use the trash button beside a draft or prepared campaign in the campaign list, or select it and choose **Delete draft** or **Delete campaign** beside its name, to remove it after confirmation. A prepared campaign can be deleted before **Start**; its recipient list is removed too. Campaigns that have started cannot be deleted, even if their scheduled sending time has not arrived. Unsaved edits to that draft are discarded too; deleting a different campaign keeps your current message in the editor. Test emails already submitted still send and keep their daily-limit usage. If cleanup is interrupted, the list refreshes and **Retry deletion** finishes removing the campaign.

Choose **Send now** to begin on Start, or **Send daily at…** with a time and timezone before preparing the audience. Daily sending waits for the next occurrence of that time; the worker checks every five minutes and sends up to the remaining shared daily limit. Test emails send immediately. The limit resets at midnight UTC, even when you choose another timezone; daily campaigns wait for their selected time before starting another batch. The daily time follows daylight-saving changes. A time skipped by a clock change moves forward by that gap, and a repeated time uses its first occurrence.

To change a running campaign's sender name, message or schedule, **Pause**, edit, then **Save changes**. If you changed the sender name, subject, body, formatting, links or button, send a new test of the saved message and wait for SMTP acceptance before **Resume**. Changing only the internal name or sending schedule lets you resume with the existing successful test. Edits apply to remaining recipients and explicit retries. Emails already queued keep their original content and may still send while paused. Your audience and sending progress are preserved. Pausing and resuming without saving edits keeps the previous successful test. A daily campaign can continue a batch already started on the current UTC day; otherwise Resume waits for the next selected time. Changing the schedule also waits for its next occurrence. If another admin changes the saved message, **Refresh status** and review that version before testing, starting or resuming. Refreshing preserves your unsaved edits. The global UTC daily limit counts tests and retries. The delivery view distinguishes queued, SMTP-accepted, failed, and skipped recipients; SMTP acceptance does not prove inbox delivery or opens.

### Regional formatting

Open **Settings -> Units & formatting -> Regional formatting** to choose how the app displays dates, times, numbers, percentages,
month names, and weekday names. **Automatic (browser)** is the recommended default and follows the first supported
language in your browser preferences. You can instead select a specific regional format, which is saved to your account
and follows you between devices. When a changed selection is saved, the app reloads once so every screen uses it
consistently.

Regional formatting does not change the app language, timezone, measurement units, start of week, stored data,
calculations, APIs, or connected-service behavior. Machine-readable CSV dates and generated filenames remain in the
unambiguous **YYYY-MM-DD** format.

Review and revoke authorized MCP clients under [**Connections -> MCP**](/services?serviceName=mcp).
Each connection separates **Data access** from optional **Changes**, and labels every permission **Granted** or
**Not granted**. These indicators are read-only; start authorization again from that MCP app and review its authorization
choices to change access.
Use the info button beside a permission in **Authorization and data access** to read what it includes and any required permissions.

### If an MCP permission is missing

Missing tools do not mean you have no plans, workouts, or recorded data. The MCP app may not have that permission, or it
may still be using an older tool catalog.

1. In ChatGPT or your other MCP app, open its Quantified Self connection and start authorization again.
2. On the Quantified Self approval screen, select the missing permission. For Training, choose **Training plans and planned workouts** to read plans. Also select
   **Change Training plans and workouts** to propose schedule edits and/or **Change planned-workout sync** to propose
   delivery actions. For note changes, select **Timeline notes** and **Change Timeline notes**. For event tags or title,
   select **Individual activity details** and **Change events**; description editing also needs **Activity descriptions**.
   For reflections, select **Individual activity details** and **Private workout reflections**; saves/deletes also need **Change workout reflections**.
   For completed-session or local-day Training impact, select both **Activity and Training metrics** and **Individual
   activity details**. Each change permission requires its matching read permission.
3. Finish the app's authorization flow. Your existing connection remains usable until the new flow completes.
4. Start a new chat or refresh the app's Quantified Self tools. If the Training choices are not offered, refresh or rescan
   the app's Quantified Self connection first.

In ChatGPT, use **Settings -> Apps** (or **Plugins**) -> **Quantified Self** -> **Reconnect** when that action is shown.
If the permission is missing from the approval screen or its tool is still absent afterward, refresh/rescan the app's
actions or ask the workspace administrator to update them. Disconnect and connect again only when the client explicitly
offers no reconnect action. Uninstall and reinstall is a last resort for a stale local plugin or app bundle, not the
normal way to add a permission.

Training delivery can still be unavailable after its permission is granted: it also requires Pro, a connected supported
provider, and current rollout/compatibility approval. Do not disconnect an app just to add a permission.

The built-in Assistant is separate: open **Examples & data access** in the Assistant, enable **Training plans**, and
optionally enable its two Training-change choices. That starts a fresh chat; it does not require MCP-app authorization.

## MCP client access

- **Deleting plans and planned workouts:** the focused deletion preview asks whether to also remove older, uncompleted copies from connected services. Upcoming eligible copies already withdraw automatically. Review the choice before approving. This needs both Training change permissions; with a cached older catalog, refresh the client's tools after release. Deletion queues best-effort service cleanup, not instant app/watch removal. Completed activities are never deleted. Without the optional cleanup, older copies stay.

- **Training plans and planned workouts** is an independent read permission for names, dates, authored phases and optional descriptions, complete instructions, authored notes, exact stored completion links and existing service sync summaries. Text may contain sensitive personal information. **Training plan and workout changes** and **Training provider delivery changes** are separate child permissions; either also requires the read permission. Existing clients must explicitly reauthorize and refresh cannot add access. A client first previews at most 25 strict changes, then uses a separate write tool governed by ChatGPT, Claude or the other MCP host's native approval controls. Keep automatic approval disabled if you want to inspect every proposal. In Claude, do not choose **Allow always**, and disable Training write tools while using Research because Research can invoke connector tools without another approval. Plan deletion is reviewed by itself and requires choosing whether its workouts become standalone or are permanently deleted; the plan and its history are permanently removed. Permanent single-workout deletion and history restoration remain unavailable. Provider changes remain Pro, connection-, permission-, configuration-, and compatibility-gated and return independent results.

- **Private workout reflections** is an independent permission for selected private notes of up to 2000 characters. It also requires **Individual activity details**. **Change workout reflections** needs both reads and allows focused revision-checked saves/permanent deletes through native client approval. Existing grants are never expanded automatically. Private context is separate from event RPE, prescriptions, Timeline notes and Health, and never changes Training calculations. [Reflection help](#post-workout-reflections) explains retention and app-owned Assistant review.

- **Activity descriptions** lets a client read the full private description shown in the QS.io event editor for a selected activity. Activities in the same event share that description. This permission is selected by default when requested; uncheck it before approving to withhold access. It requires **Individual activity details**; existing clients missing the grant must reauthorize because refresh cannot add it. Text can include health, personal or location information even without **Activity locations** permission. Missing descriptions are reported as absent; oversized descriptions fail without truncation and can be read in QS.io. Revocation blocks future reads but cannot erase received copies. Descriptions are user-reported context, never instructions or permission to change your data. External editing additionally needs **Change events** and client approval. The built-in Assistant does not receive this permission.

- **Timeline notes** is an independent read permission for full private titles and details, categories, actual dates and captured time zones, including notes hidden from charts. **Change Timeline notes** is a separate child permission for creating, editing, and permanently deleting notes through the MCP client's native approval UI. Existing notes are selected through owner- and connection-bound references, edits and deletes require their current revision, and creates use a stable operation ID so uncertain retries do not duplicate a note. Deletion cannot be undone and leaves only a content-free receipt. Both permissions are selected by default when requested; uncheck either before approving. Existing clients must reauthorize and refresh cannot add them. Queries use inclusive calendar windows of at most 366 days and return full text in bounded pages. Ongoing periods end today in their original time zone. This text may contain sensitive health or personal information. Revocation blocks future access but cannot erase copies already received. Neither permission grants Training plan writes. The built-in Assistant uses separate default-off Timeline-note read and change choices and app-owned confirmation.

- An MCP client receives only the capabilities you approve after signing in. Every requested permission starts checked, including permissions added later; uncheck anything you do not want to grant. Data categories remain separate read permissions. Timeline-note and event changes require their explicit child permission and the MCP host's native approval UI. Training changes additionally require a bounded preview and separate apply tool. The MCP host controls whether it asks on every call. Activity locations and event changes require activity details; Timeline-note changes require Timeline notes; saved-route locations require saved-route summaries. Removing any parent removes its dependent children.
- **Health metrics** covers recorded all-day heart rate, HRV, stress, resources or Body Battery, movement, energy, blood pressure and fitness metrics. Discover the Health catalog, then query a metric over inclusive provider-calendar dates: up to 366 days for stored summaries or 31 days for bounded sample trends. Each provider, local account number and statistic stays separate. Sample points include exact UTC times. Garmin Body Battery stays on its labelled Garmin points scale, never treated as a percentage; other native-only values, device details, account IDs and provider payloads are excluded. Representative trends can omit points and incomplete scans are labelled. Empty summaries may mean the metric has sample-only data. Body composition also needs **Body measurements** permission and returns only identity-free calendar-day measurements. Weight and normalized Sleep keep their existing tools and permissions. Existing clients must reconnect to grant Health access. MCP cannot add, edit, delete or backfill measurements.
- **Personal HRV range.** With both Health metrics and Sleep summaries permission, ask your MCP client to compare nightly HRV with your personal range. This uses the Health chart's shared 60-day calculation, source-separated historical classifications, and seven-day headline. It reads extra baseline history without displaying it as part of your requested period. A band on a missing-reading day is not a measurement; insufficient history stays unavailable. The range is shared with current Training readiness for matching overnight evidence, but the HRV range alone is not a readiness score or a medical assessment.
- Metric access covers persisted numeric activity metrics and ready Training-derived snapshots. Clients can compare up to four activity metrics over one bounded range and can first check the human-readable Training metric catalog to distinguish ready, rebuilding, stale, missing, and incompatible snapshots. When **Individual activity details** is also granted, a client can inspect which metrics, laps, jumps, swim lengths, and chart streams are available for one referenced activity, request up to 25 explicitly selected canonical numeric Sports Lib metrics, rank activities by one metric over an explicit bounded range or a processing-bounded all-history scan, or request identity-safe **Training impact**. Training impact prepares the existing Form snapshot and accepts one exact completed activity or up to 32 exact activity references returned for one local date and IANA timezone. It returns only coverage counts, one TSS/CTL/ATL/Form contribution aggregate, and one or two dated UTC Training-day outcomes after decay—never per-session day rows, activity/event IDs, references, labels, exact start times, devices, providers, or source provenance. Missing TSS, incomplete or benchmark/merge records, partial coverage, and updating/failed Form remain explicit; planned workouts are excluded. It is a TSS-based load model, not measured physiological adaptation, and adds no write access or provider action. Oversized rankings fail instead of returning partial records. MTB jump superlatives reuse that ranking and treat the persisted maximum as authoritative; individual jump records remain an optional detail read, and jump count is not treated as jump quality. These paths do not add a separate stored metric catalog. Precise latitude/longitude and first-class body-measurement metrics are excluded, and Training event/activity IDs, names, labels, source fingerprints, and imported device/provider source keys are removed.
- To get a current Training-derived snapshot through MCP, ask the client to prepare the selected metric first. Preparation can request a rebuild and returns a retry delay if the snapshot is still building. It shares the existing **Activity and Training metrics** permission, returns no metric values, and the client reads the snapshot only after it is ready.
- **Manage manual Health measurements** is an independent MCP permission for exact-time lookup and create/edit/permanent-delete of the eight types available in Health: weight, VO2 max, body fat, blood pressure, muscle mass, body water, bone mass and blood oxygen. Requested consent starts checked but needs approval. Existing clients must authorize again and refresh tools; token refresh cannot add it. It grants neither imported history nor Body measurements/Health reads. Use explicit units/times, read the exact current entry before edits and review each write through client approval. Deleting blood pressure removes the pair and optional pulse. No provider is called.
- Body-measurement access covers first-class body-measurement history. Body-weight history is available for bounded ranges up to 366 days as identity-free day, week, or month values using median, average, minimum, maximum, or latest aggregation. It contains provider or manual canonical Health Weight point measurements—not workout profile fallback—and is not a medical or health assessment. It excludes exact source measurement timestamps, event/activity identity, names, provider/device metadata, and source provenance.
- Any authorized MCP client can discover canonical Sports Lib activity types for filters; that static catalog contains no account data. Individual activity detail access covers non-location summaries and parent event tags, laps, swim lengths, MTB jump measurements, signed-in app links, selected persisted numeric metrics such as Stroke Rate, and bounded chart-ready heart-rate, power, cadence, altitude, grade, distance, speed, and activity-appropriate pace streams. Activities from the same event share tags. Tags can contain personal, health, or location context and clients must treat them as untrusted labels, not instructions or verified facts. Clients can filter newest-first activity scans by one or more types and request **today** or **yesterday** in an explicit IANA timezone. They can also read tags or filter by exact case-insensitive tag matches using any/all semantics. **Change events** is a separate child permission for focused event-owned edits. It lets external MCP clients replace the complete parent-event tag list or title after reading the exact current value; an activity or workout rename means changing this shared event title. Editing the shared description additionally requires **Activity descriptions** access and the exact current text. The client requests approval for each edit. A concurrent edit fails instead of being overwritten, and benchmark events are read-only. These tools cannot change recorded activity metrics, source files, or provider records. Existing clients missing a required grant must reauthorize; refresh cannot add it. Adding another editable event field later still requires a dedicated, reviewed MCP tool; stored fields are never exposed automatically. The built-in Assistant has a separate default-off Activity tag changes choice that remains tag-only, uses the same current-tag precondition, and requires app-owned review. Bounded pages report scan completion so a client can distinguish a complete no-match result from older history that remains to be checked. Chart streams are parsed temporarily from an existing FIT, GPX, TCX, Suunto JSON/SML, or gzip original file, downsampled over the complete activity, and discarded without a reparse, backfill, cache, or additional activity storage. Historical chart access therefore depends on the original file still being available and within the documented limits.
- If a client rejects a dated activity query before it reaches Quantified Self, ask it to use the standard activity list with the same date and sport filters. Do not repeatedly retry the rejected query or assume you have no completed workout; the list uses the same activity permission.
- Activity location access separately covers exact activity start/end coordinates, nearby activity searches, MTB jump coordinates, and bounded breadcrumb traces returned with a chart. Without it, summaries and jump measurements remain available with coordinates omitted. Exact activity locations can reveal your home, workplace, frequent trailhead, or other sensitive places.
- **Nightly HRV in Sleep and reports.** Some services send overnight HRV separately from Sleep. When both records match the same account and night, missing Sleep HRV can use that overnight average. This works for existing imported history and updates when the provider sends a correction. An HRV value already recorded in Sleep is kept. Spot checks and conflicting readings are not substituted. MCP needs both **Health metrics** and **Sleep summaries** permission for the separate Health reading. Missing overnight heart rate remains unavailable unless the provider recorded a sleep heart-rate aggregate.
- Sleep access covers normalized session summaries, day/week/month aggregates, bounded discovery of recorded safe aggregate vital types, and a one-call sleep trend that combines coverage with duration, score, stages, HRV, heart-rate, blood-oxygen, and respiration values for the requested period. These sleep tools share the same normalized projection and aggregation path, and a missing vital remains unavailable rather than becoming zero. Raw samples remain excluded, and the result cannot diagnose illness. When you also grant **Activity and Training metrics**, a client can request the same live UTC-day Readiness used by Dashboard Today: current Form/ramp plus the latest eligible sleep score, the seven-day HRV average and same-source 60-day personal range, the latest nightly HRV, overnight-heart-rate values and their baseline medians, evidence counts, and explicit missing or insufficient-history states. The current readiness history uses the same calculation and also needs **Health metrics** permission, because saved HRV history may include overnight Health readings. Older client tools retain their legacy formula and are labelled accordingly. The IANA timezone supplies local-day context while Readiness remains UTC-day based. The preferred daily report returns the latest completed non-nap sleep with recorded average/overnight HRV and average/minimum sleep heart rate, a same-provider duration comparison, live Readiness, and current-versus-usual equivalent 28-day Training totals and Running/Cycling/Swimming mix. It keeps the Readiness explanation brief. The older compact briefing remains physiology-free for compatibility. These projections exclude provider identity, provider user/session IDs, provider payloads, raw sleep-stage intervals, score components, raw HRV samples, SpO2 and respiration samples, locations, activities, body measurements, workout plans, and medical advice.
- **Saved-route summaries**. Saved-route summary access covers route names, activity types, bounded metrics and route/waypoint/point counts, import/update times, and signed-in app links. Clients can filter bounded newest-first scans by canonical Sports Lib activity type or a case-insensitive part of the route name, and scan completion distinguishes a complete no-match from older history. It omits exact bounds and reports that location was redacted.
- **Saved-route locations and geometry**. Saved-route location access separately covers exact bounds, simplified preview geometry and segment endpoints, nearby route searches, and waypoint coordinates, altitude, and distance. Existing clients retain non-location route summaries but must reconnect and approve the new location permission to regain coordinate-bearing route tools.
- **Detailed activity samples:** for interval analysis or calculations, an MCP client can request every available elapsed-second value for up to four supported chart metrics, with an optional start/end range. Missing readings remain gaps. Data arrive in bounded pages, and the client follows the continuation until the requested range is complete. Charts keep their compact overview format; their sampled points should not be used to calculate time in zones or whole-workout averages. Detailed samples use your existing **Individual activity details** permission, with no new permission or provider reconnection. A client that caches available tools may need its connection refreshed before it discovers the new tool. Availability depends on the existing original file and supported metrics, not the provider brand. Only selected numeric samples may be reused in server memory for up to two minutes to avoid parsing the same file for every page; they are never saved as another activity or persistent sample store. Access and the source revision are checked on every page. The built-in Assistant continues to use compact chart data.
- Original files, unbounded recordings, raw unrequested streams, internal IDs, source keys, device identities, parser extensions, and Storage paths are never returned. Activity charts exclude full-resolution recordings and absolute sample times; separately approved Health trends include UTC sample times and provider names, but never account keys or device details. Activity and saved-route location grants are independent: granting one never exposes the other.
- Nearby MCP searches accept either direct latitude/longitude or a place name such as a city. Direct coordinates are processed inside Quantified Self. For place names, Quantified Self sends only the location text to Mapbox for forward geocoding; it does not send activity, route, account, or prompt data to Mapbox for this lookup.
- Only clients that finish authorization appear in [**Connections -> MCP**](/services?serviceName=mcp). Authorizing the same verified MCP client again keeps its current grant usable until the new code exchange succeeds; successful reauthorization replaces the previous permissions and credentials instead of creating another logical connection. Failed or abandoned authorization attempts do not replace an existing grant, are not active connections, and their codes expire automatically. Some clients can notify Quantified Self through standard server-to-server token revocation, but they may not do so when removed or uninstalled. **Disconnect** in Connections remains the authoritative control: it invalidates the current grant and any older duplicate records for that verified client without affecting your other MCP clients. The external client may retain data it already received under its own policy.
- See the [MCP Server feature page](/features/mcp-server) for a public overview of the available data categories and access boundaries.
- See [Policies -> MCP Client Access](/policies#mcp-clients) for the complete disclosure.

## Use with ChatGPT

1. In ChatGPT on the web, turn on Developer mode and create a custom app.
2. Use the Quantified Self MCP endpoint: **https://quantified-self.io/mcp**.
3. Let ChatGPT scan the available tools, then sign in to Quantified Self and approve only the read or Training-change permissions you want to grant.
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
      { label: 'Privacy Email', icon: 'shield', kind: 'email', target: PRIVACY_MAILTO },
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
- If you see **We couldn't load your account** or **We can't reach your account data**, check your connection and select **Retry**. This keeps you signed in while your account data is verified again; it does not reset your account or require you to repeat onboarding. If your sign-in session has actually expired, sign in again.

## Imports taking longer than expected

- Garmin history imports can arrive gradually.
- Suunto and COROS imports run in the background and can take hours or days.
- If Suunto temporarily returns an incomplete activity file, Quantified Self validates it and retries automatically instead of saving an empty activity.
- Automatic Suunto activity imports accept files up to 128 MiB. Larger files stop automatic processing; contact support if an activity is missing for this reason.
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
      { label: 'Email Support', icon: 'email', kind: 'email', target: SUPPORT_MAILTO },
      { label: 'Report a Bug', icon: 'bug_report', kind: 'external', target: GITHUB_ISSUES_URL },
      { label: 'Release Notes', icon: 'campaign', kind: 'route', target: '/releases' },
    ],
  },
];
