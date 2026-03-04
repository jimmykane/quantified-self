import { environment } from '../../environments/environment';

export type HelpSectionId =
  | 'getting-started'
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
    summary: 'Sign in, pick a plan, and learn where the core parts of the app live.',
    content: `## Start in three steps

1. Sign in with an email magic link, Google, or GitHub.
2. Complete onboarding and accept the required policies.
3. Start with manual uploads, or upgrade to Pro if you want service connections and history imports.

## Where things live

- **Dashboard** is your main activity overview.
- **Services** is where you connect Garmin, Suunto, and COROS.
- **Settings** is where you manage profile, privacy, charts, maps, and units.
- **Subscription** is where you review your current plan.
- **Release Notes** shows product updates and fixes.

## Good first workflow

- Upload a few files manually if you want to test the app before connecting services.
- Move to **Pro** when you need automatic integrations or history import tools.`,
    links: [
      { label: 'Login', icon: 'login', kind: 'route', target: '/login' },
      { label: 'Membership', icon: 'card_membership', kind: 'route', target: '/pricing' },
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
- Activities above the new plan limit can be permanently removed.

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
    summary: 'Manual file uploads, supported formats, export options, and common upload errors.',
    content: `## Manual uploads

The app accepts these file types for manual activity upload:

- \`.fit\`
- \`.gpx\`
- \`.tcx\`
- \`.json\`
- \`.sml\`

## Limits

- Manual uploads count toward your activity limit on limited plans.
- **Starter** and **Basic** have activity caps.
- **Pro** does not have an activity cap.

## Common upload failures

- **401** usually means your session is no longer authorized. Sign in again.
- **429** usually means you reached the limit for your current plan.
- **400** usually means the file could not be processed or is not valid for this importer.

## Export and backup options

- You can export dashboard activity tables to CSV.
- From an activity action menu, you can download **JSON**.
- If an activity has positional data, you can download **GPX**.
- If original source files are stored for an activity, you can download the original file or files.

## Reprocessing a single activity

From an activity action menu you can also:

- **Regenerate activity statistics**
- **Reimport activity from file** when original source files are available`,
    links: [
      { label: 'Subscription', icon: 'credit_card', kind: 'route', target: '/subscriptions' },
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
    summary: 'Control visibility, analytics consent, account deletion, and privacy-related requests.',
    content: `## Privacy controls

- Your profile and activity visibility can be controlled from Settings.
- Sharing a profile or activity can make it public and copy a share link.
- Privacy settings should be reviewed before sharing data externally.

## Settings you can change yourself

In Settings you can:

- change profile visibility,
- turn anonymous usage statistics on or off,
- turn marketing emails on or off,
- and customize charts, maps, and units.

## Account deletion

You can delete your account from **Settings -> Profile -> Danger Zone**.

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

## Garmin permissions

If Garmin import is blocked by missing permissions:

1. Open Garmin Connect.
2. Open the connected-app permissions area.
3. Update permissions.
4. Reconnect Quantified Self.

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
