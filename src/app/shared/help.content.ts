import { environment } from '../../environments/environment';
import { AI_INSIGHTS_REQUEST_LIMITS, ROUTE_USAGE_LIMITS, USAGE_LIMITS } from '../../../shared/limits';
import {
  POLICIES_AI_AND_PROCESSORS_FRAGMENT,
  POLICIES_CONNECTED_SERVICES_FRAGMENT,
  POLICIES_COROS_DATA_FRAGMENT,
  POLICIES_GARMIN_DATA_FRAGMENT,
  POLICIES_SUUNTO_DATA_FRAGMENT,
} from './policies.content';

export type HelpSectionId =
  | 'getting-started'
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
- **My Tracks** maps positional activities and supports date range, custom date, and activity type filters.
- **Services** is where you connect Garmin, Suunto, and COROS.
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
- **Curated Form/TSS** computes from full history and does not react to event table or custom tile date ranges. Its **W / M / Y** view setting is saved on that dashboard tile.
- New curated charts: **Freshness Forecast**, **Intensity Distribution**, and **Efficiency Trend**.
- The default KPI rows are the current-state set: **Load Status**, **Form Now**, **Fitness Trend**, **Fatigue Trend**, **Recovery Debt**, and **Training Balance**.
- Additional KPI rows such as **Fitness (CTL)**, **Fatigue (ATL)**, **ACWR**, **Ramp Rate**, **Monotony / Strain**, **Form +7d**, **Easy %**, **Hard %**, and **Efficiency Δ (4w)** remain available from Dashboard manager.
- KPI rows are shown in the compact **Today** section above the main dashboard grid.
- The **Today** header can show **Uploaded activities**, which counts current uploaded activity events.
- On mobile, Today rows stay compact while the chart/map grid stays unchanged below.
- KPI choices in Dashboard manager are grouped as **Load**, **Readiness**, and **Execution** for both manual and preset flows.
- Curated and KPI tiles include an **info** icon beside the title with formulas and interpretation guidance.
- On supported mobile devices, dashboard buttons and chart interactions provide lightweight haptic feedback.
- Haptics automatically fall back to no-op when vibration support is unavailable or reduced-motion is enabled.
- Event search filters only the dashboard event table.
- **Custom** charts use their own tile date-range and activity filters, with matching controls in Dashboard manager.
- Dashboard **Action prompts** are contextual setup cards shown above your dashboard when an account action needs attention.
- New users can choose a kilometers or miles preset from the dashboard **Default units** action prompt; choose **Advanced settings** there, or open **Settings -> Units**, to fine-tune individual unit preferences later.
- Users without Pro access and no uploaded activities may see an **Upload your first activities** action prompt with options to upload FIT, GPX, TCX, JSON, or SML files, or upgrade to Pro for automatic activity sync. Dismissing it hides the prompt; manual uploads remain available from the header and upload tools.
- Pro users without a connected activity service may see a one-time **Connect a service** action prompt; dismissing it hides the prompt permanently, and services can still be connected later from **Services**.
- Pro users with Suunto plus Garmin and/or COROS connected may see a **Send new activities to Suunto** action prompt when an eligible auto-sync route is still disabled. Enabling it turns on future Garmin/COROS -> Suunto imports only; existing activities can still be queued from **Services** with Manual Catch-up. Dismissing it hides the prompt permanently.
- If Suunto disconnects server-side or stops accepting the stored token, the dashboard can show a **Reconnect Suunto** action prompt. Reconnecting restarts sleep sync, history imports, and upload tools. Garmin/COROS -> Suunto auto-sync routes stay disabled until you enable them again in **Services**; dismissing the card only hides the reminder.
- Distance values in dashboards, event charts, activity chips, and CSV exports follow your kilometers or miles preference from **Settings -> Units**; jump distances display in feet when miles are selected.
- **Map** tiles use their own tile date-range and activity filters, independent from the event table search.
- Curated, KPI, form, recovery, sleep, and other derived tiles stay independent from event table filters and custom/map tile filters.
- When sleep sync imports sleep sessions, the dashboard can add the **Sleep** tile once, and you can also add it manually from Dashboard manager; removing an auto-added Sleep tile prevents future automatic Sleep tile adds.
- Existing dashboards can receive the default curated chart set and core KPI row set automatically once; removing an auto-added curated chart or KPI prevents that chart from being suggested again.
- Derived curated and KPI chart types are unique: only one tile per special derived chart type can exist at a time.
- Map tiles are also unique: only one map tile can exist at a time.
- Map style and cluster-marker settings are edited inside Dashboard manager.
- Default manager sizes: dashboard tiles start at **1x1**.
- Dashboard manager bulk actions can add the recommended default dashboard, add every available preset tile, or remove every dashboard chart/map tile and keep automatic suggestions dismissed.

### Reorder dashboard tiles

- On desktop, drag dashboard tiles from the tile action area to reorder them.
- On mobile and touch devices, open any tile menu with the three-dot button.
- Use **Move earlier** or **Move later** when drag-and-drop is unavailable.
- Tile order is saved automatically to your account.

### Recovery tile summary

- The curated **Recovery** pie tile is optional; existing dashboards can receive it once through the default curated auto-add, and removing it prevents future automatic adds.
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
- Form/TSS uses adaptive render granularity by view: **W = daily points**, **M = weekly points**, **Y = monthly points**.
- While derived metrics are refreshing, the tile shows a training-metrics **updating** message instead of generic no-data text.
- When snapshots are missing or stale, they rebuild asynchronously; refresh usually follows within a few minutes.
- Opening the dashboard also runs a freshness check against your latest events and requeues a rebuild automatically if snapshots are behind.
- If rebuilding requests fail repeatedly, the dashboard shows a retry notification and continues with last known snapshot values.
- If a stale/building state is stuck for too long, the dashboard switches to a retryable failed state so you can trigger a rebuild immediately.
- While rebuilding, the dashboard shows a small training-metrics status notice above tiles.
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
- **Form Now** uses current TSB readiness from the latest derived load state.
- **Fitness (CTL)** uses current 42-day chronic training load from the derived Form model.
- **Fatigue (ATL)** uses current 7-day acute training load from the derived Form model.
- **Fitness Trend** shows recent CTL direction from the derived Form model.
- **Fatigue Trend** shows recent ATL direction from the derived Form model.
- **Recovery Debt** estimates zero-load days until current TSB returns to neutral.
- **Form +7d** projects current TSB at day +7 assuming zero load.
- **Training Balance** summarizes the latest weekly Easy/Moderate/Hard intensity mix.
- **Easy %** and **Hard %** use the latest weekly intensity distribution bucket.
- **Efficiency Δ (4w)** shows current efficiency versus the prior 4-week baseline as absolute + percent delta.
- **Freshness Forecast** projects 7 future days with zero load from the latest derived day.
- **Intensity Distribution** uses power zones when available, otherwise heart-rate zones, grouped to Easy/Moderate/Hard by week.
- Intensity Distribution headline percentages are labeled as **Current week**; when no current-week bucket exists they are labeled **Latest week**.
- **Efficiency Trend** uses weekly duration-weighted average of avgPower/avgHeartRate.
- Intensity Distribution and Efficiency Trend include compact **8w / 12w / 6m / 1y / All** range selectors that only change the visible derived weekly history and are saved per dashboard tile.
- Training-derived tiles do not fall back to currently loaded dashboard events.

### Merge events

- In the dashboard event table, select at least two events and use the merge action.
- Merge requests support up to **10 events** at once.
- Selected events must still have original source file metadata available.
- **Benchmark merge** creates a merged event for benchmark workflows.
- **Multi activity merge** creates a standard merged event for regular multi-activity analysis.

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
- Each event chart panel can use the **Overlay** button to compare one other available metric on a shared y-axis when metrics are compatible, otherwise on a right-side y-axis; overlay choices are saved globally by primary metric, so **Heart Rate** can always request **Altitude** when both streams exist.
- Right-clicking an event chart copies a themed image of the full chart panel, including the chart title, legend, and range statistics.
- Swim activities with per-length pool data show a **Show Swim Lengths** chart option that overlays swim length end boundaries on the chart; active and idle/rest lengths are both included.
- When an overlay is active, the primary metric keeps its normal line and fill, while the overlay renders as a plain solid no-fill line using the overlay metric's series color. On merged and benchmark events, overlay legend and tooltip rows include both metric and activity labels.
- When Grade Smooth or Grade streams are available, **Altitude** charts can color the altitude line by grade; the chart option **Color Altitude by Grade** is on by default and can be turned off from Chart options.
- When provider heart-rate or power zone boundaries are available on non-merged events, the **Heart Rate** and **Power** charts color their lines and visible fill by zone.`,
    links: [
      { label: 'Login', icon: 'login', kind: 'route', target: '/login' },
      { label: 'Dashboard', icon: 'space_dashboard', kind: 'route', target: '/dashboard' },
      { label: 'Membership', icon: 'card_membership', kind: 'route', target: '/pricing' },
      { label: 'Release Notes', icon: 'campaign', kind: 'route', target: '/releases' },
    ],
  },
  {
    id: 'ai-insights',
    icon: 'insights',
    title: 'AI Insights',
    summary: 'How prompt execution, result types, quotas, and restore behavior work in the AI Insights page.',
    content: `## Access and quota

- AI Insights is available for **Free**, **Basic**, and **Pro** accounts.
- Prompts are currently **English only**.
- The public [AI Insights for Endurance Training Data](/features/ai-insights) page explains the search-facing version of this feature.
- For AI Insights, we do **not** share your raw activities, routes, or uploaded files with AI providers.
- We only send the minimum derived stats needed to generate answers.
- **Why do I get the same answer for the same prompt?**
  - AI Insights is mostly deterministic for the same prompt and same data scope.
  - Answers change when the underlying stats change, like new activities, a different date range, or a changed prompt.
- Request limits:
  - Free: up to **${AI_INSIGHTS_REQUEST_LIMITS.free}** requests per calendar month
  - Basic: up to **${AI_INSIGHTS_REQUEST_LIMITS.basic}** requests per billing period
  - Pro: up to **${AI_INSIGHTS_REQUEST_LIMITS.pro}** requests per billing period
- The prompt card always shows your live remaining requests and reset timing.

## Prompt flow and execution

- Type a prompt and press **Ask AI** to execute.
- Hero rotating examples at the top now **fill the input only**. They do not run automatically.
- **Browse prompts** opens the prompt picker dialog. Selecting a prompt there runs it immediately.
- If your prompt does not include a date range, AI Insights defaults to **current year to date**.
- Mention an optional location directly in your prompt, such as a city, region, country, or latitude/longitude coordinates.
- You can also mention a radius in the prompt, for example \`within 20 km of Athens\`.
- AI Insights tries to infer a location from the prompt when it can do so deterministically.
- The backend geocodes locations with **Mapbox** and, if needed, makes one AI fallback attempt to repair an unresolved location string.
- Country and region requests use Mapbox's returned **bounding box** as a best-effort scope, not an exact border polygon.
- City, locality, and place requests use the resolved center point plus your chosen **radius**.
- Event-backed AI Insights results can show a **map** below the result when surfaced events have recorded start positions.
- When a location is resolved, the map also draws the resolved search scope: a **radius** circle for point-based places or a **bbox** region for country/region matches, and camera framing includes both scope and surfaced event starts.
- Add **all time** to query your full history.
- For power-curve prompts, **excluding cycling** removes the whole cycling family (Cycling, Indoor Cycling, Virtual Cycling, and E-Biking).

## Supported result modes

- **Aggregate**: narrative + summary cards + chart, with optional ranked event links.
- **Compare delta explanation**: compare-mode aggregate results include deterministic period deltas with likely contributor series, and deterministic event evidence remains available in the expandable evidence panel.
- **Event lookup**: best matching event plus top-ranked matching events.
- **Latest event**: most recent matching event in scope (single primary event card).
- **Multi-metric aggregate**: combined chart for multiple metrics with merged summary cards.
- **Digest narrative**: ask for a weekly, monthly, or yearly digest to get deterministic period-by-period summaries with explicit no-data periods.
- **Advisory**: metric-generic deterministic advisory payloads with structured fields (\`semanticKind\`, \`estimate\`, \`interval\`, \`observed\`, \`confidence\`, \`method\`, and \`evidence\`).
  - For max-heart-rate advisory, \`semanticKind\` can be **current ceiling** (current achievable max based on observed tail) or **potential ceiling** (deterministic potential estimate constrained by observed evidence quality).
  - Current-ceiling max-heart-rate output anchors the point estimate to the strongest observed max-heart-rate sample in scope after deterministic quality filtering.
  - Potential-ceiling max-heart-rate output can estimate above observed max when deterministic headroom is justified by tail/coverage/recency signals.
  - Max-heart-rate advisory requires enough effort-quality signal (at least 8 valid sessions across at least 3 training weeks, plus tail-quality checks near observed max).
  - Low-intensity-only scopes (for example hiking, walking, or yoga), sparse samples, stale recency, or weak tail signal return **insufficient data** with an explicit reason code and a suggested executable fallback query.
  - Confidence includes both a deterministic tier and score, and method metadata includes an explicit deterministic method id/version.
- **Anomaly callouts**: deterministic spike/drop/activity-mix shift callouts for aggregate and date-grouped multi-metric results.
- **Confidence & evidence chips**: compact chips under supported AI result narratives and callouts that show confidence tier and linked deterministic evidence.
- **Interpreted badge**: shown when query synthesis rewrites your prompt and the synthesized prompt passes score-gated deterministic validation.
- **Empty**: the request shape is valid but no matching data was found in scope.
- **Unsupported**: the request could not be mapped confidently; suggested prompts are returned.

## Supported metric highlights

- Power profiling includes **FTP**, **Critical Power**, and **Power-to-Weight (W/kg)** prompts.
- Running dynamics includes **Ground Contact Time**, **Vertical Oscillation**, **Vertical Ratio**, and **Leg Stiffness** prompts.
- Zone prompts support deterministic aggregate trends such as **time in Heart Rate Zone 2**, **Power Zone 2**, and **Speed Zone 2** over time.

## Confidence and anomaly guardrails

- Confidence tiers are deterministic and based on coverage, sample size, and signal strength.
- Evidence chips only render when deterministic references exist (for example buckets, series, or event IDs).
- Low-signal ranges suppress anomaly callouts so weak/noisy ranges do not produce alerts.

## Saved latest result behavior

- The latest completed AI result is restored automatically when you open the page.
- Restored results are marked with a **Restored** chip and saved-date metadata.
- Invalid latest snapshots are automatically cleared and ignored.
- **Refresh with latest data & dates** reruns the current result prompt with fresh data.

## Troubleshooting quick checks

- **App verification failed**: refresh and retry.
- **Invalid request**: include one metric, an activity/sport, and a date scope.
- **Location could not be resolved**: try a clearer city, region, country, or coordinate pair.
- **Permission denied**: ensure your account has Basic or Pro access.
- **Quota reached**: wait for reset or upgrade.
- If you need a metric that is not currently supported, contact support.`,
    links: [
      { label: 'AI Insights', icon: 'insights', kind: 'route', target: '/ai-insights' },
      { label: 'AI Insights Overview', icon: 'query_stats', kind: 'route', target: '/features/ai-insights' },
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
- Garmin, Suunto, and COROS integration workflows
- History import workflows (provider limits still apply)
- Suunto FIT activity upload and GPX route upload tools
- COROS FIT activity upload tool

## Feature access by area

- **Dashboard / event analysis:** Starter, Basic, Pro
- **My Tracks (Beta):** Basic, Pro
- **Service connections and sync actions:** Pro (or active Pro grace period)
- **History imports:** Pro (or active Pro grace period)

## Billing basics

- Paid plans renew automatically until you cancel.
- You can manage billing from the subscription area.
- Cancellation takes effect at the end of the current billing period.
- When a paid plan has a trial configured, the pricing card shows the exact trial length in days.
- Trial offers are only shown for accounts without prior paid subscription history.
- Yearly paid plans appear automatically when active yearly Stripe prices are available.
- Yearly plans can show a **Save X% vs monthly** label based on the matching monthly price.
- If you start monthly, you can switch to yearly later from the billing portal.

## Downgrades and grace period

If you downgrade from a paid plan, the app keeps your access through the current billing period and then applies a **30-day grace period**.

After the grace period:

- Pro-only sync connections can be disconnected.
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

The public [Workout File Analyzer](/features/fit-gpx-tcx-file-analyzer) page explains how FIT, GPX, TCX, JSON, and SML activity uploads can be analyzed with maps, charts, statistics, exports, source-file context, and reprocessing. The public [Workout File Comparison](/features/workout-file-comparison) page explains how those files can be compared with provider activities and benchmark reports. The public [FIT and GPX Route Files](/features/fit-gpx-route-files) page explains saved route-only FIT course and GPX route uploads, original-file retention, downloads, and route limits.

Saved routes open from **Routes** with the details action. Route details parse the original FIT or GPX file in memory to show the route summary, all segments, map, elevation and grade charts, waypoints, and original-file download. The original uploaded route file remains the canonical source; parsed points and streams are not saved back to Firestore.

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
    title: 'Service Connections',
    summary: 'Garmin, Suunto, and COROS connection rules, limits, and expected import behavior.',
    content: `## Pro requirement

Garmin, Suunto, and COROS connections are part of **Pro**.

## Integration pages overview

The public [Integrations hub](/integrations) links to focused [Garmin Integration](/integrations/garmin), [Suunto Integration](/integrations/suunto), and [COROS Integration](/integrations/coros) pages. They explain Garmin -> Suunto sync, COROS -> Suunto sync, Garmin saved-route delivery to Garmin Connect, manual catch-up, provider history imports, FIT activity uploads, GPX route uploads, and how those workflows connect to the private training dashboard.

Provider-specific privacy details live on [Policies -> Connected Services](/policies#connected-services-data), with separate sections for [Garmin Data](/policies#garmin-data), [Suunto Data](/policies#suunto-data), [COROS Data](/policies#coros-data), and [AI & Third-Party Processing](/policies#ai-and-third-party-processing).

The public [Training Data Sync Guides](/guides) hub links to the [Garmin to Suunto sync guide](/guides/sync-garmin-to-suunto), [COROS to Suunto sync guide](/guides/sync-coros-to-suunto), and [centralized workout data guide](/guides/centralize-garmin-suunto-coros-workout-data) for step-by-step setup.

The public [Tools hub](/tools) links to the [File Comparison Tool](/tools/compare), which creates saved benchmark events directly from FIT, GPX, and TCX files.

The public [Features hub](/features) links to [Workout Data Comparison](/features/workout-data-comparison), [Workout File Comparison](/features/workout-file-comparison), [Workout File Analyzer](/features/fit-gpx-tcx-file-analyzer), [FIT and GPX Route Files](/features/fit-gpx-route-files), and [Sports Watch Benchmark](/features/sports-watch-benchmark) pages that explain how centralized Garmin, Suunto, COROS, uploaded FIT/TCX/GPX/JSON/SML activity files, and saved route-only FIT/GPX files support benchmark reports, metric overlays, maps, charts, source-file workflows, and reviewer workflows for device tests, YouTube videos, and blog posts. Manual uploads, core analysis, and benchmark comparisons are available on the free plan for up to ${USAGE_LIMITS.free} activities and ${ROUTE_USAGE_LIMITS.free} saved routes; automatic provider sync and higher limits require a paid plan.

## Sleep data

Sleep sync is server-owned health data. When available, Garmin, Suunto, and COROS sleep sessions are imported as separate source records and shown by the dashboard **Sleep** tile. The sleep chart has its own 14d, 30d, 90d, and 1y range control with older/newer paging, independent from dashboard event filters. It stacks sleep stages and overlays recorded sleep HRV with an average HRV reference line when the provider includes it. Suunto and Garmin Pro users can queue **Backfill Sleep History** from History Import; Garmin users may also see a one-time dashboard prompt. Suunto queues sleep from Jan 1, 2016 to today with a 7-day cooldown. Garmin requests sleep from Jan 1, 2016 to today, receives records asynchronously from Garmin, and uses a 30-day cooldown.

## Suunto

Suunto tools currently include:

- connecting your account,
- syncing recent sleep samples,
- backfilling sleep history from Jan 1, 2016,
- importing history,
- automatically importing saved Suunto routes,
- queueing a manual Suunto route catch-up,
- uploading FIT activities to Suunto,
- uploading GPX routes to Suunto.

Suunto FIT activity uploads in Services show a per-file queue with upload status, duplicate detection, failure messages, and retry controls for failed files. Large upload batches are processed one file at a time with short pauses between provider upload calls.

While your Suunto account is connected, Quantified Self also imports new and updated Suunto routes into **Routes** automatically. Services includes a **Route Sync** panel with manual catch-up, which queues every current Suunto route again for first-time imports or reconnect cases. The **Routes** page can also show a one-time prompt for the same first-time Suunto route catch-up.

Saved FIT and GPX routes can be sent to Suunto from **Routes** using a row action or the selected-row bulk toolbar. Quantified Self reparses each saved route from its original source file, generates a fresh GPX export, and uses the saved Quantified Self route name as the route name sent to Suunto. Routes imported from Suunto are not sent back to the same connected Suunto account, but they can still be sent to a different connected Suunto account when one exists. Bulk sends upload routes one at a time so partial failures can be reported without stopping successful routes.

See [Policies -> Suunto Data](/policies#suunto-data) for the provider-specific privacy summary for Suunto imports, sleep sync, route imports, and route delivery.

## Garmin

Garmin history import has two important limits:

- one import request every **30 days**,
- and up to **5 years** of data per request.

Garmin can deliver imported activities gradually over hours or days.

Garmin sleep history backfill is separate from activity history import. It requests sleep through Garmin Health API and records appear later as Garmin sends sleep notifications.

If Garmin permissions are missing, reconnect the app and grant the required export, history, and health permissions in Garmin Connect.

Saved FIT and GPX routes can also be sent to Garmin Connect from **Routes**. This is a user-initiated route delivery workflow, not a Garmin route import or catch-up feature. Garmin route delivery requires a connected Garmin account with **COURSE_IMPORT** permission. If that permission is missing, open Garmin Connect, go to **Connected Apps**, update the Quantified Self permissions, and reconnect Garmin in **Services**. Quantified Self reparses the original saved route file, sends the saved Quantified Self route name, and updates the same Garmin course on resend for the same Garmin account instead of creating duplicates.
See [Policies -> Garmin Data](/policies#garmin-data) for the provider-specific privacy summary for Garmin imports, sleep history, and Garmin to Suunto sync.

Garmin -> Suunto activity sync is route-based:

- you must connect both Garmin and Suunto,
- enable the route toggle in Garmin Services,
- and keep Garmin ACTIVITY_EXPORT permission enabled.

Disconnecting Garmin, COROS, or Suunto automatically disables related route auto-sync settings. After reconnecting, re-enable the route toggle if you want automatic sync to resume.

If a provider revokes access or rejects the stored refresh token, Quantified Self marks that connection as **Reconnect required** in Services and may also show a dashboard reconnect prompt. Reconnecting creates a fresh token chain; dismissing the prompt does not reconnect automatically.

Automatic sync runs only for newly imported Garmin activities and uses the stored original activity file from your event.

Manual catch-up is available in Garmin Services: choose a date range to queue Garmin -> Suunto sync jobs for events already imported into Quantified Self.

Manual catch-up is a convenience tool for queuing a period on demand. It uses stored original files already attached to existing Quantified Self events.

Manual catch-up can run even when the Garmin -> Suunto auto-sync toggle is off, and it does not enable auto-sync for future imports.

When Garmin and Suunto are connected, the dashboard may offer a one-time action prompt to enable Garmin -> Suunto auto-sync. Dismissing the prompt hides it permanently; Manual catch-up remains available in Services.

## COROS

COROS history import is limited to the last **3 months** because of API restrictions.

COROS tools currently include:

- connecting your account,
- syncing recent sleep summaries,
- importing history,
- uploading FIT activities to COROS.

COROS FIT activity uploads in Services use the same per-file queue, short provider upload pacing, and failed-file retry controls as Suunto uploads.

COROS -> Suunto activity sync is route-based:

- you must connect both COROS and Suunto,
- enable the route toggle in COROS Services,
- and keep both service connections active.

Automatic sync runs only for newly imported COROS activities and uses the stored original activity file from your event.

Manual catch-up is available in COROS Services: choose a date range to queue COROS -> Suunto sync jobs for events already imported into Quantified Self.

Manual catch-up can run even when the COROS -> Suunto auto-sync toggle is off, and it does not enable auto-sync for future imports.

When COROS and Suunto are connected, the dashboard may offer a one-time action prompt to enable COROS -> Suunto auto-sync. Dismissing the prompt hides it permanently; Manual catch-up remains available in Services.

See [Policies -> COROS Data](/policies#coros-data) for the provider-specific privacy summary for COROS imports, sleep summaries, uploads, and COROS to Suunto sync.

## Queue behavior

Suunto and COROS history imports are queued jobs. Large ranges can take hours or days to finish, depending on volume and queue load.`,
    links: [
      { label: 'Integrations', icon: 'hub', kind: 'route', target: '/integrations' },
      { label: 'Features', icon: 'dashboard_customize', kind: 'route', target: '/features' },
      { label: 'Training Guides', icon: 'menu_book', kind: 'route', target: '/guides' },
      { label: 'Workout Data Comparison', icon: 'compare_arrows', kind: 'route', target: '/features/workout-data-comparison' },
      { label: 'Compare Files Tool', icon: 'compare_arrows', kind: 'route', target: '/tools/compare' },
      { label: 'Workout File Analyzer', icon: 'analytics', kind: 'route', target: '/features/fit-gpx-tcx-file-analyzer' },
      { label: 'FIT and GPX Route Files', icon: 'route', kind: 'route', target: '/features/fit-gpx-route-files' },
      { label: 'Garmin to Suunto Guide', icon: 'sync_alt', kind: 'route', target: '/guides/sync-garmin-to-suunto' },
      { label: 'COROS to Suunto Guide', icon: 'published_with_changes', kind: 'route', target: '/guides/sync-coros-to-suunto' },
      { label: 'Centralize Workout Data', icon: 'hub', kind: 'route', target: '/guides/centralize-garmin-suunto-coros-workout-data' },
      { label: 'Garmin Integration', icon: 'sync_alt', kind: 'route', target: '/integrations/garmin' },
      { label: 'Suunto Integration', icon: 'published_with_changes', kind: 'route', target: '/integrations/suunto' },
      { label: 'COROS Integration', icon: 'sync', kind: 'route', target: '/integrations/coros' },
      { label: 'Connected Service Privacy', icon: 'policy', kind: 'route', target: '/policies', fragment: POLICIES_CONNECTED_SERVICES_FRAGMENT },
      { label: 'Garmin Data Privacy', icon: 'policy', kind: 'route', target: '/policies', fragment: POLICIES_GARMIN_DATA_FRAGMENT },
      { label: 'Suunto Data Privacy', icon: 'policy', kind: 'route', target: '/policies', fragment: POLICIES_SUUNTO_DATA_FRAGMENT },
      { label: 'COROS Data Privacy', icon: 'policy', kind: 'route', target: '/policies', fragment: POLICIES_COROS_DATA_FRAGMENT },
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
- Share actions that auto-change visibility are disabled.
- For AI Insights, we do **not** share your raw activity data with AI providers.
- Only the minimum derived stats required to answer your prompt are sent.
- The Policies page includes provider-specific sections for [Garmin Data](/policies#garmin-data), [Suunto Data](/policies#suunto-data), [COROS Data](/policies#coros-data), and [AI & Third-Party Processing](/policies#ai-and-third-party-processing).

## Settings you can change yourself

In Settings you can:

- turn anonymous usage statistics on or off,
- turn marketing emails on or off,
- and customize charts, maps, and units.

## Account deletion

You can delete your account from **Settings -> Profile -> Danger Zone**.

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
      { label: 'Policies', icon: 'policy', kind: 'route', target: '/policies' },
      { label: 'Garmin Data Privacy', icon: 'policy', kind: 'route', target: '/policies', fragment: POLICIES_GARMIN_DATA_FRAGMENT },
      { label: 'Suunto Data Privacy', icon: 'policy', kind: 'route', target: '/policies', fragment: POLICIES_SUUNTO_DATA_FRAGMENT },
      { label: 'COROS Data Privacy', icon: 'policy', kind: 'route', target: '/policies', fragment: POLICIES_COROS_DATA_FRAGMENT },
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

- Garmin backfills can arrive gradually.
- Suunto and COROS imports are queue-based and can take hours or days.
- Check cooldowns and connection status before retrying.
- If Services shows **Reconnect required**, reconnect that provider before retrying imports or sleep sync.

## Merge and benchmark checks

- Merge requires at least two selected events.
- Merge requests are limited to 10 events at a time.
- If merge fails because source files are missing, select events that still have their original uploaded files.
- If merge fails due to identical source files, remove duplicate events/files from the selection and retry.
- If merge fails at plan limits, free space or upgrade your plan before retrying.
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
