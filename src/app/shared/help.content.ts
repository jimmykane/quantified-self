import { environment } from '../../environments/environment';
import { AI_INSIGHTS_REQUEST_LIMITS } from '../../../shared/limits';

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
- **Services** is where you connect Garmin, Suunto, and COROS.
- **Settings** is where you manage profile details, consent options, charts, maps, and units.
- **Subscription** is where you review your current plan.
- **Release Notes** shows product updates and fixes.

## Good first workflow

- Upload a few files manually if you want to test the app before connecting services.
- Move to **Pro** when you need automatic integrations or history import tools.

## Core dashboard features

### Chart manager

- Use the **Chart manager** button above dashboard tiles to add or edit chart tiles.
- You can choose between **Curated** and **Custom** chart categories.
- **Curated** charts (Recovery, Form/TSS) are fixed insights and do not react to dashboard date-range changes.
- **Custom** charts keep the existing configurable behavior and react to dashboard filters/date range.
- Curated chart types are unique: only one Recovery and one Form tile can exist at a time.

### Reorder dashboard tiles

- On desktop, drag dashboard tiles from the tile action area to reorder them.
- On mobile and touch devices, open any tile menu with the three-dot button.
- Use **Move earlier** or **Move later** when drag-and-drop is unavailable.
- Tile order is saved automatically to your account.

### Recovery tile summary

- The curated **Recovery** pie tile is optional and not added automatically.
- The tile shows live recovery split between **Left now** and **Elapsed**.
- The summary shows **Recovery Left Now** and **Total recovery** summed across all recovery-enabled events.
- Remaining recovery updates every minute while the tile is visible.
- You can still move or remove this tile from the tile menu.

### Form tile (CTL / ATL / TSB)

- The tile derives daily load from **Training Stress Score**.
- Legacy **Power Training Stress Score** is used automatically when current TSS is missing.
- It shows three headline stats: **Fitness (CTL)**, **Fatigue (ATL)**, and **Form (TSB)**.
- **Form (TSB)** is shown as **prior-day readiness** using the prior day CTL - ATL.
- Form and RecoveryNow tiles use precomputed derived snapshots from your full history (UTC day buckets), not only the currently selected dashboard date range.
- When snapshots are missing or stale, they rebuild asynchronously; refresh usually follows within a few minutes.
- While rebuilding, the dashboard shows a small training-metrics status notice above tiles.
- The status title updates dynamically from current Form bands:
  - **High fatigue** at very negative Form values,
  - **Building fitness** while carrying meaningful load,
  - **Maintaining fitness** around neutral Form,
  - **Fresh** when Form is clearly positive.

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

### Event jump tables

- Event details now include a **Jumps** table when selected activities contain jump events.
- The jump table appears in activity tabs and only shows columns with available data.
- Jump metrics use your preferred units from **Settings** when unit conversion is supported.

### Event chart x-axis fallback

- In Event details, if selected indoor activities do not include distance data, the chart automatically falls back to a **Duration** x-axis.
- In that case, the **Distance** x-axis option stays visible but is disabled until a compatible activity selection is active.`,
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

- AI Insights is available for **Basic** and **Pro** accounts.
- Free accounts are redirected to the subscription flow for AI Insights access.
- Prompts are currently **English only**.
- For AI Insights, we do **not** share your raw activities, routes, or uploaded files with AI providers.
- We only send the minimum derived stats needed to generate answers.
- **Why do I get the same answer for the same prompt?**
  - AI Insights is mostly deterministic for the same prompt and same data scope.
  - Answers change when the underlying stats change, like new activities, a different date range, or a changed prompt.
- Request limits per billing period:
  - Basic: up to **${AI_INSIGHTS_REQUEST_LIMITS.basic}** requests
  - Pro: up to **${AI_INSIGHTS_REQUEST_LIMITS.pro}** requests
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
- **Anomaly callouts**: deterministic spike/drop/activity-mix shift callouts for aggregate and date-grouped multi-metric results.
- **Confidence & evidence chips**: compact chips under supported AI result narratives and callouts that show confidence tier and linked deterministic evidence.
- **Empty**: the request shape is valid but no matching data was found in scope.
- **Unsupported**: the request could not be mapped confidently; suggested prompts are returned.

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

- Up to **100 activities**
- Manual activity uploads (\`.fit\`, \`.gpx\`, \`.tcx\`, \`.json\`, \`.sml\`)
- Core dashboard and event analysis tools

### Basic

- Everything in Starter
- Up to **1,000 activities**
- **My Tracks (Beta)** access
- Paid-only profile customization such as custom chart watermark text

### Pro

- Everything in Basic
- **Unlimited activities**
- Garmin, Suunto, and COROS integration workflows
- History import workflows (provider limits still apply)
- Suunto FIT activity upload and GPX route upload tools

## Feature access by area

- **Dashboard / event analysis:** Starter, Basic, Pro
- **My Tracks (Beta):** Basic, Pro
- **Service connections and sync actions:** Pro (or active Pro grace period)
- **History imports:** Pro (or active Pro grace period)

## Billing basics

- Paid plans renew automatically until you cancel.
- You can manage billing from the subscription area.
- Cancellation takes effect at the end of the current billing period.

## Downgrades and grace period

If you downgrade from a paid plan, the app keeps your access through the current billing period and then applies a **30-day grace period**.

After the grace period:

- Pro-only sync connections can be disconnected.
- Existing activities are retained. New uploads follow your current plan limit.

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

## Activity limits

- Manual uploads count toward your activity limit on limited plans.
- **Starter** and **Basic** have activity caps.
- **Pro** does not have an activity cap.

## Common upload issues

- Your session may have expired. Sign in again and retry.
- You may have reached your current plan's activity limit.
- The file may be invalid, unsupported, or unreadable by the importer.

## Export and backup options

- You can export dashboard activity tables to CSV.
- From selected dashboard rows, CSV export and original-file download actions support your current multi-selection.
- If an activity has positional data, you can download **GPX**.
- If original source files are stored for an activity, you can download the original file or files.

## Reprocessing a single activity

From an activity action menu you can also:

- **Regenerate activity statistics**
- **Reimport activity from file** when original source files are available`,
    links: [
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

## Suunto

Suunto tools currently include:

- connecting your account,
- importing history,
- uploading FIT activities to Suunto,
- uploading GPX routes to Suunto.

## Garmin

Garmin history import has two important limits:

- one import request every **30 days**,
- and up to **5 years** of data per request.

Garmin can deliver imported activities gradually over hours or days.

If Garmin permissions are missing, reconnect the app and grant the required export and history permissions in Garmin Connect.

## COROS

COROS history import is limited to the last **3 months** because of API restrictions.

## Queue behavior

Suunto and COROS history imports are queued jobs. Large ranges can take hours or days to finish, depending on volume and queue load.`,
    links: [
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

## Merge and benchmark checks

- Merge requires at least two selected events.
- Merge requests are limited to 10 events at a time.
- If merge fails because source files are missing, select events that still have their original uploaded files.
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
