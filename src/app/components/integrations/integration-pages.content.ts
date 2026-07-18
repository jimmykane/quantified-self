import { ServiceNames } from '@sports-alliance/sports-lib';
import { getProviderDisplayName } from '@shared/provider-presentation';

export type IntegrationProviderKey = 'garmin' | 'suunto' | 'coros' | 'wahoo';

export interface IntegrationFlow {
  icon: string;
  title: string;
  copy: string;
}

export interface IntegrationFaq {
  question: string;
  answer: string;
}

export interface ProviderSource {
  label: string;
  serviceName: ServiceNames;
}

export interface ProviderIntegrationPage {
  slug: IntegrationProviderKey;
  label: string;
  serviceName: ServiceNames;
  h1: string;
  heroCopy: string;
  providerSources: readonly ProviderSource[];
  summary: string;
  highlights: readonly string[];
  syncEyebrow: string;
  syncTitle: string;
  syncCopy: string;
  syncFlows: readonly IntegrationFlow[];
  toolsEyebrow: string;
  toolsTitle: string;
  toolsCopy: string;
  tools: readonly IntegrationFlow[];
  dashboardEyebrow: string;
  dashboardTitle: string;
  dashboardCopy: string;
  dashboardPoints: readonly IntegrationFlow[];
  faqItems: readonly IntegrationFaq[];
  closingTitle: string;
  closingCopy: string;
}

export interface IntegrationHubCard {
  slug: IntegrationProviderKey;
  label: string;
  serviceName: ServiceNames;
  subtitle: string;
  summary: string;
  highlights: readonly string[];
}

export interface IntegrationRouteData {
  title: string;
  preload: boolean;
  animation: string;
  description: string;
  jsonLd: Record<string, unknown>;
}

const ALL_PROVIDER_SOURCES: readonly ProviderSource[] = [
  { label: getProviderDisplayName(ServiceNames.GarminAPI, 'source'), serviceName: ServiceNames.GarminAPI },
  { label: getProviderDisplayName(ServiceNames.SuuntoApp, 'source'), serviceName: ServiceNames.SuuntoApp },
  { label: getProviderDisplayName(ServiceNames.COROSAPI, 'source'), serviceName: ServiceNames.COROSAPI },
  { label: getProviderDisplayName(ServiceNames.WahooAPI, 'source'), serviceName: ServiceNames.WahooAPI },
];

export const PROVIDER_INTEGRATION_PAGES: Record<IntegrationProviderKey, ProviderIntegrationPage> = {
  garmin: {
    slug: 'garmin',
    label: 'Garmin',
    serviceName: ServiceNames.GarminAPI,
    h1: 'Garmin Integration and Private Training Dashboard',
    heroCopy: 'Connect Garmin to Quantified Self to keep Garmin activities in a private training dashboard, send saved routes to Garmin Connect, sync new Garmin activities to Suunto, and bring Garmin, Suunto, and COROS workouts into one view with AI insights.',
    providerSources: ALL_PROVIDER_SOURCES,
    summary: 'Use Quantified Self as a private dashboard for Garmin data, with Garmin history imports, saved routes sent to Garmin Connect, Garmin to Suunto activity sync, AI insights, and multi-service workout history.',
    highlights: [
      'Private Garmin training dashboard',
      'Send saved routes to Garmin Connect',
      'Garmin to Suunto automatic activity sync',
      'Garmin, Suunto, and COROS in one dashboard',
    ],
    syncEyebrow: 'Garmin Workflows',
    syncTitle: 'Garmin data, saved routes, and Suunto activity sync',
    syncCopy: 'Connect Garmin once, keep permissions active, and choose whether to import Garmin data, send saved routes to Garmin Connect, or send Garmin activities to Suunto.',
    syncFlows: [
      {
        icon: 'history',
        title: 'Garmin history import',
        copy: 'Import up to five years of Garmin history per request. Garmin limits how often a new history import can be started, as documented in Help.',
      },
      {
        icon: 'route',
        title: 'Send saved routes to Garmin Connect',
        copy: 'Send saved FIT and GPX routes from Routes to Garmin Connect when the connected Garmin account includes COURSE_IMPORT. Re-sending the same saved route updates the existing Garmin course for that Garmin account instead of creating duplicates.',
      },
      {
        icon: 'sync_alt',
        title: 'Garmin to Suunto automatic activity sync',
        copy: 'Connect Garmin and Suunto, turn on automatic activity sync in Connections, and new Garmin activities can be sent to Suunto automatically.',
      },
      {
        icon: 'published_with_changes',
        title: 'Sync past Garmin activities to Suunto',
        copy: 'Choose a date range in Connections to send Garmin activities already stored in Quantified Self to Suunto.',
      },
    ],
    toolsEyebrow: 'Garmin Tools',
    toolsTitle: 'Saved routes, original files, and training context',
    toolsCopy: 'Garmin workflows stay useful beyond the first import because Quantified Self keeps route and activity source context available for sending, dashboards, exports, and analysis.',
    tools: [
      {
        icon: 'published_with_changes',
        title: 'Send routes to Garmin Connect',
        copy: 'Use Routes to send saved FIT and GPX routes to Garmin Connect with the saved Quantified Self route name. Sending the same route again updates it.',
      },
      {
        icon: 'file_download',
        title: 'Original activity files',
        copy: 'Use stored original files for exports, reprocessing, and Suunto sync workflows that need source activity data.',
      },
      {
        icon: 'map',
        title: 'Maps and route context',
        copy: 'Review Garmin activity maps, GPX exports, and route context next to load, readiness, and source metadata.',
      },
      {
        icon: 'insights',
        title: 'AI insights for Garmin data',
        copy: 'Ask focused questions about Garmin activity statistics and get chart-backed answers grounded in your stored training history.',
      },
    ],
    dashboardEyebrow: 'Training Dashboard',
    dashboardTitle: 'Private Garmin training dashboard',
    dashboardCopy: 'Quantified Self is designed for Garmin users who want private data ownership, connected Suunto and COROS workouts, and training analysis that does not stop at one ecosystem.',
    dashboardPoints: [
      {
        icon: 'dashboard_customize',
        title: 'Centralized workout data',
        copy: 'Centralize Garmin, Suunto, and COROS workout data in one dashboard, then review load, maps, routes, source files, and recovery context together.',
      },
      {
        icon: 'security',
        title: 'Private by design',
        copy: 'Your Garmin data stays in your Quantified Self account with clear support for account deletion, exports, and privacy controls.',
      },
      {
        icon: 'query_stats',
        title: 'Training trends',
        copy: 'Use persisted Garmin statistics for load, fatigue, form, charts, and AI-backed summaries across your training history.',
      },
    ],
    faqItems: [
      {
        question: 'What makes Quantified Self a private training dashboard for Garmin data?',
        answer: 'Quantified Self is built for athletes who want a private Garmin training dashboard with original files, maps, load metrics, AI insights, exports, and optional Suunto or COROS workouts.',
      },
      {
        question: 'Can Garmin workouts sync to Suunto automatically?',
        answer: 'Yes. Connect Garmin and Suunto, turn on automatic activity sync in Connections, and new Garmin activities can be sent to Suunto automatically when they arrive in Quantified Self.',
      },
      {
        question: 'Can I send saved routes to Garmin Connect?',
        answer: 'Yes. Saved FIT and GPX routes can be sent from Routes to Garmin Connect when the connected Garmin account includes COURSE_IMPORT. Re-sending the same saved route updates the same Garmin course for that Garmin account.',
      },
      {
        question: 'Can I centralize Garmin, Suunto, and COROS workout data?',
        answer: 'Yes. Connect the services you use to centralize Garmin, Suunto, and COROS workout data, then review synced activities, uploads, routes, recovery context, and AI-backed summaries from one dashboard.',
      },
    ],
    closingTitle: 'Connect Garmin, then keep every workout in context',
    closingCopy: 'Start with Garmin, add route sending or Suunto and COROS workflows when needed, and keep sync, history, and analysis in one private training dashboard.',
  },
  suunto: {
    slug: 'suunto',
    label: 'Suunto',
    serviceName: ServiceNames.SuuntoApp,
    h1: 'Suunto Integration for Activity and Route Sync',
    heroCopy: 'Use Quantified Self as a private training dashboard, automatically sync Garmin and COROS activities to Suunto, import Suunto routes, send Suunto routes to Garmin, and send saved GPX routes to Suunto.',
    providerSources: ALL_PROVIDER_SOURCES,
    summary: 'Sync Garmin and COROS workouts to Suunto, upload FIT activities and GPX routes, import existing Suunto routes, send Suunto routes to Garmin, import Suunto history, and keep training data centralized.',
    highlights: [
      'Garmin to Suunto automatic activity sync',
      'COROS to Suunto automatic activity sync',
      'Automatic and existing Suunto route imports',
      'Send Suunto routes to Garmin',
      'FIT activity and GPX route upload to Suunto',
    ],
    syncEyebrow: 'Automatic Sync',
    syncTitle: 'How to sync activities to Suunto and send Suunto routes to Garmin',
    syncCopy: 'Connect the source and destination services, turn on the sync you want, and keep the relevant service permissions active.',
    syncFlows: [
      {
        icon: 'sync_alt',
        title: 'Garmin to Suunto automatic activity sync',
        copy: 'Connect Garmin and Suunto, turn on automatic activity sync in Connections, and new Garmin activities can be sent to Suunto automatically.',
      },
      {
        icon: 'published_with_changes',
        title: 'COROS to Suunto automatic activity sync',
        copy: 'Connect COROS and Suunto, turn on automatic activity sync in Connections, and new COROS workouts can be sent to Suunto.',
      },
      {
        icon: 'history',
        title: 'Sync past activities to Suunto',
        copy: 'Choose a date range in Connections to send Garmin or COROS activities already stored in Quantified Self to Suunto.',
      },
      {
        icon: 'route',
        title: 'Import routes from Suunto',
        copy: 'Import new and updated Suunto routes automatically, or import your existing Suunto route library after connecting or reconnecting.',
      },
      {
        icon: 'send',
        title: 'Send Suunto routes to Garmin',
        copy: 'Connect Garmin, allow Course Import, and choose whether new and updated Suunto routes should be sent to Garmin automatically.',
      },
    ],
    toolsEyebrow: 'Suunto Tools',
    toolsTitle: 'Activity, route, history, and sleep workflows',
    toolsCopy: 'Suunto is not only a sync destination. Quantified Self also supports uploads, automatic and existing route imports, sending routes to Garmin, history imports, and recovery context.',
    tools: [
      {
        icon: 'upload_file',
        title: 'FIT activity upload',
        copy: 'Send FIT activities to Suunto manually for missing sessions, one-off corrections, and migration workflows.',
      },
      {
        icon: 'route',
        title: 'GPX route upload',
        copy: 'Send saved FIT and GPX routes to Suunto from Routes. Quantified Self reparses the original file, creates a fresh GPX route, and uses the saved route name in Suunto.',
      },
      {
        icon: 'sync',
        title: 'Suunto route import',
        copy: 'Bring new Suunto routes into Quantified Self automatically, then import existing routes when your current Suunto library is missing.',
      },
      {
        icon: 'send',
        title: 'Send Suunto routes to Garmin',
        copy: 'Send Suunto routes already saved in Quantified Self to Garmin Connect when Course Import is allowed.',
      },
      {
        icon: 'bedtime',
        title: 'Suunto history and sleep imports',
        copy: 'Use Suunto activity and sleep history imports when your Suunto account is the source of historical training or recovery data.',
      },
    ],
    dashboardEyebrow: 'Training Dashboard',
    dashboardTitle: 'Centralize Garmin, Suunto, and COROS workout data',
    dashboardCopy: 'The Suunto integration works with the rest of Quantified Self, so Garmin files, Suunto history, Suunto route imports, COROS workouts, FIT uploads, GPX route sends, metrics, AI insights, and export workflows stay connected in one private dashboard.',
    dashboardPoints: [
      {
        icon: 'dashboard_customize',
        title: 'Centralized workout data',
        copy: 'Use Quantified Self to centralize Garmin, Suunto, and COROS workout data in one dashboard, then review load, readiness, maps, routes, and source files together.',
      },
      {
        icon: 'insights',
        title: 'AI insights for endurance training data',
        copy: 'Ask focused questions about your stored activity statistics and get chart-backed answers for trends, latest activities, and training summaries.',
      },
      {
        icon: 'security',
        title: 'Private by design',
        copy: 'Quantified Self is built for athletes who want a private training dashboard when Garmin, Suunto, and COROS data all matter.',
      },
    ],
    faqItems: [
      {
        question: 'Is Quantified Self a private training dashboard for Garmin data?',
        answer: 'Quantified Self is built for athletes who want a private Garmin training dashboard that keeps original files, maps, load metrics, AI insights, and connected Suunto or COROS workflows under their own account.',
      },
      {
        question: 'Can I centralize Garmin, Suunto, and COROS workout data?',
        answer: 'Yes. Connect Garmin, Suunto, and COROS to centralize Garmin, Suunto, and COROS workout data, then review synced activities, uploads, routes, recovery context, and AI-backed summaries from one dashboard.',
      },
      {
        question: 'Can Quantified Self sync routes with Suunto?',
        answer: 'Yes. Quantified Self can import new and updated Suunto routes, import your existing Suunto route library, and send saved FIT or GPX routes to Suunto.',
      },
      {
        question: 'Can Suunto routes sync to Garmin courses?',
        answer: 'Yes. Connect Suunto and Garmin, allow Course Import in Garmin Connect, and turn on automatic route sending. You can also send Suunto routes already saved in Quantified Self without importing them again.',
      },
    ],
    closingTitle: 'Connect once, then keep your services aligned',
    closingCopy: 'New Garmin and COROS workouts can move to Suunto automatically after setup. Suunto routes can be imported into Quantified Self and sent to Garmin when both connections are ready.',
  },
  coros: {
    slug: 'coros',
    label: 'COROS',
    serviceName: ServiceNames.COROSAPI,
    h1: 'COROS Integration for Suunto Sync and Centralized Training Data',
    heroCopy: 'Connect COROS to Quantified Self, sync COROS activities to Suunto, import recent COROS history, and centralize Garmin, Suunto, and COROS workout data in a private dashboard.',
    providerSources: ALL_PROVIDER_SOURCES,
    summary: 'Connect COROS for recent history imports, COROS to Suunto activity sync, sleep summaries, FIT uploads to COROS, and centralized multi-service training analysis.',
    highlights: [
      'COROS to Suunto automatic activity sync',
      'Recent COROS history imports',
      'COROS, Garmin, and Suunto in one dashboard',
    ],
    syncEyebrow: 'COROS Workflows',
    syncTitle: 'COROS activity import and Suunto sync',
    syncCopy: 'Connect COROS, keep the connection active, and choose whether new COROS activities should be sent to Suunto automatically.',
    syncFlows: [
      {
        icon: 'sync_alt',
        title: 'COROS to Suunto automatic activity sync',
        copy: 'Connect COROS and Suunto, turn on automatic activity sync in Connections, and new COROS workouts can be sent to Suunto automatically.',
      },
      {
        icon: 'history',
        title: 'COROS history import',
        copy: 'Import the last 3 months of COROS history within the current provider limit, then review the imported activities from the same dashboard as Garmin and Suunto.',
      },
      {
        icon: 'published_with_changes',
        title: 'Sync past COROS activities to Suunto',
        copy: 'Choose a date range in Connections to send COROS activities already stored in Quantified Self to Suunto.',
      },
    ],
    toolsEyebrow: 'COROS Tools',
    toolsTitle: 'History, sleep, and upload workflows',
    toolsCopy: 'COROS integrations support the workflows that matter when COROS is either your source device or one part of a larger training archive.',
    tools: [
      {
        icon: 'bedtime',
        title: 'COROS sleep summaries',
        copy: 'Sync recent COROS sleep summaries when available and review recovery context alongside activity history.',
      },
      {
        icon: 'upload_file',
        title: 'FIT activity upload to COROS',
        copy: 'Use FIT activity upload workflows for corrections, migrations, or missing sessions when COROS is the destination.',
      },
      {
        icon: 'source',
        title: 'Source-aware training archive',
        copy: 'Keep COROS activity source context visible while comparing workouts with Garmin and Suunto sessions.',
      },
    ],
    dashboardEyebrow: 'Training Dashboard',
    dashboardTitle: 'Centralized workout data for COROS, Garmin, and Suunto',
    dashboardCopy: 'COROS data becomes more useful when it can sit next to Garmin and Suunto workouts, maps, load, recovery, exports, and AI-backed analysis.',
    dashboardPoints: [
      {
        icon: 'dashboard_customize',
        title: 'Centralized workout data',
        copy: 'Centralize Garmin, Suunto, and COROS workout data so COROS runs, rides, and recovery context are not isolated in one service account.',
      },
      {
        icon: 'insights',
        title: 'AI insights for endurance training data',
        copy: 'Ask questions across COROS, Garmin, and Suunto statistics and get chart-backed answers for training summaries and trends.',
      },
      {
        icon: 'security',
        title: 'Private by design',
        copy: 'Use Quantified Self as a private training dashboard for connected service data, exports, and account-owned analysis workflows.',
      },
    ],
    faqItems: [
      {
        question: 'How do I sync COROS data to Suunto automatically?',
        answer: 'Connect COROS and Suunto, turn on automatic activity sync in Connections, and keep both connections active so new COROS activities can be sent to Suunto.',
      },
      {
        question: 'Can I centralize COROS with Garmin and Suunto?',
        answer: 'Yes. Quantified Self can centralize Garmin, Suunto, and COROS workout data so COROS activities, Garmin files, Suunto history, routes, and AI insights stay in one dashboard.',
      },
      {
        question: 'How much COROS history can I import?',
        answer: 'COROS history import is currently limited to the last 3 months because of provider API restrictions. The Help page explains processing times for larger imports.',
      },
    ],
    closingTitle: 'Connect COROS, then keep service data aligned',
    closingCopy: 'Use COROS on its own or with Garmin and Suunto, then keep current and past activity sync, recovery, and analysis in one private training dashboard.',
  },
  wahoo: {
    slug: 'wahoo',
    label: 'Wahoo',
    serviceName: ServiceNames.WahooAPI,
    h1: 'Wahoo Integration for Activity History and Training Analysis',
    heroCopy: 'Connect Wahoo to Quantified Self to import new Wahoo-recorded workouts, queue FIT-backed history, and analyze Wahoo activities beside Garmin, Suunto, and COROS data.',
    providerSources: ALL_PROVIDER_SOURCES,
    summary: 'Use the Pro Wahoo connection for automatic workout imports, date-range history imports, original FIT retention, and private multi-provider training analysis.',
    highlights: [
      'Automatic Wahoo workout imports',
      'FIT-backed Wahoo history import',
      'Wahoo, Garmin, Suunto, and COROS in one dashboard',
    ],
    syncEyebrow: 'Wahoo Workflows',
    syncTitle: 'Import Wahoo workouts automatically',
    syncCopy: 'Authorize Wahoo once and Quantified Self receives completed Wahoo workout summaries through Wahoo webhooks while the connection stays active.',
    syncFlows: [
      {
        icon: 'sync',
        title: 'New workout imports',
        copy: 'Completed Wahoo workouts with an available FIT file are queued automatically, deduplicated by Wahoo workout ID, and updated when Wahoo sends a newer summary revision.',
      },
      {
        icon: 'history',
        title: 'Wahoo history import',
        copy: 'Choose a date range in Services to page through Wahoo history and queue workouts that include an importable FIT file.',
      },
      {
        icon: 'update',
        title: 'Revision-aware processing',
        copy: 'Duplicate webhook deliveries are safe, and a newer Wahoo workout-summary revision replaces an older queued revision before processing.',
      },
    ],
    toolsEyebrow: 'Wahoo Tools',
    toolsTitle: 'FIT source files and provider-aware analysis',
    toolsCopy: 'Wahoo is an import source in this release. Uploads, sleep sync, route delivery, and automatic forwarding to another provider are not enabled.',
    tools: [
      {
        icon: 'source',
        title: 'Source-aware activities',
        copy: 'Imported events retain Wahoo source identifiers and summary revision metadata for reliable deduplication and attribution.',
      },
      {
        icon: 'file_download',
        title: 'Original FIT files',
        copy: 'Quantified Self retains imported FIT files with the event for downloads, exports, and reprocessing after the short-lived Wahoo download URL expires.',
      },
      {
        icon: 'security',
        title: 'Server-only OAuth credentials',
        copy: 'Wahoo access and refresh tokens are never readable by the browser; the app displays only a safe connection-state projection.',
      },
    ],
    dashboardEyebrow: 'Training Dashboard',
    dashboardTitle: 'Keep Wahoo workouts in your private training archive',
    dashboardCopy: 'Review Wahoo workouts next to other activity sources using the same event analysis, maps, charts, exports, and training metrics.',
    dashboardPoints: [
      {
        icon: 'dashboard_customize',
        title: 'Centralized activity history',
        copy: 'Bring Wahoo, Garmin, Suunto, COROS, and uploaded activity files into one account-owned dashboard.',
      },
      {
        icon: 'query_stats',
        title: 'Consistent analysis',
        copy: 'Use the same load, trend, map, lap, and source-file tools for Wahoo FIT activities as other imported workouts.',
      },
      {
        icon: 'lock',
        title: 'Explicit retention',
        copy: 'Disconnecting stops future Wahoo access but does not delete activities already imported into Quantified Self. Account deletion removes them.',
      },
    ],
    faqItems: [
      {
        question: 'Which Wahoo workouts can Quantified Self import?',
        answer: 'Quantified Self imports completed workouts exposed by Wahoo with a downloadable FIT file. Wahoo does not expose completed workouts originating from third-party applications through this API.',
      },
      {
        question: 'Does disconnecting Wahoo delete imported activities?',
        answer: 'No. Disconnecting revokes future Wahoo access and stops new imports, while previously imported activities remain in your Quantified Self account until you delete them or delete the account.',
      },
      {
        question: 'Is the Wahoo integration available on every plan?',
        answer: 'No. Connecting Wahoo and importing Wahoo activity history are Pro features.',
      },
    ],
    closingTitle: 'Connect Wahoo and keep completed workouts in context',
    closingCopy: 'Import Wahoo FIT activities automatically, add the history range you need, and analyze them in the same private archive as your other training data.',
  },
};

export const INTEGRATION_HUB_CARDS: readonly IntegrationHubCard[] = [
  {
    slug: 'garmin',
    label: getProviderDisplayName(ServiceNames.GarminAPI, 'source'),
    serviceName: ServiceNames.GarminAPI,
    subtitle: 'Private dashboard, history import, and Suunto sync',
    summary: 'Connect Garmin to import history, send new Garmin activities to Suunto, and analyze Garmin data beside Suunto and COROS in one private dashboard.',
    highlights: [
      'Import Garmin history',
      'Sync Garmin activities to Suunto automatically',
      'Analyze Garmin with Suunto and COROS',
    ],
  },
  {
    slug: 'suunto',
    label: getProviderDisplayName(ServiceNames.SuuntoApp, 'source'),
    serviceName: ServiceNames.SuuntoApp,
    subtitle: 'Activity sync, route imports, and sending routes to Garmin',
    summary: 'Connect Suunto to receive Garmin and COROS activities, import Suunto routes, send Suunto routes to Garmin, upload FIT activities and GPX routes to Suunto, and keep Suunto history in the same private dashboard.',
    highlights: [
      'Receive Garmin activities automatically',
      'Receive COROS activities automatically',
      'Send Suunto routes to Garmin',
    ],
  },
  {
    slug: 'coros',
    label: getProviderDisplayName(ServiceNames.COROSAPI, 'source'),
    serviceName: ServiceNames.COROSAPI,
    subtitle: 'Recent history import and Suunto sync',
    summary: 'Connect COROS to import recent history, send new COROS workouts to Suunto, and compare COROS data beside Garmin and Suunto in one private dashboard.',
    highlights: [
      'Import recent COROS history',
      'Sync COROS activities to Suunto automatically',
      'Analyze COROS with Garmin and Suunto',
    ],
  },
  {
    slug: 'wahoo',
    label: getProviderDisplayName(ServiceNames.WahooAPI, 'source'),
    serviceName: ServiceNames.WahooAPI,
    subtitle: 'Automatic FIT activity and history import',
    summary: 'Connect Wahoo to import completed FIT-backed workouts and analyze them beside Garmin, Suunto, and COROS in one private dashboard.',
    highlights: [
      'Import new Wahoo workouts automatically',
      'Queue Wahoo history by date range',
      'Retain imported activities after disconnect',
    ],
  },
];

export function getProviderIntegrationPage(key: unknown): ProviderIntegrationPage {
  if (key === 'garmin' || key === 'suunto' || key === 'coros' || key === 'wahoo') {
    return PROVIDER_INTEGRATION_PAGES[key];
  }

  return PROVIDER_INTEGRATION_PAGES.suunto;
}

function providerWebPageJsonLd(page: ProviderIntegrationPage, metadataDescription: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.h1,
    description: metadataDescription,
    url: `https://quantified-self.io/integrations/${page.slug}`,
    inLanguage: 'en',
    isPartOf: {
      '@type': 'WebSite',
      name: 'Quantified Self',
      url: 'https://quantified-self.io',
    },
    about: [
      ...page.highlights,
      page.dashboardTitle,
      'AI insights for endurance training data',
      'Private training dashboard',
    ],
    mainEntity: [
      {
        '@type': 'SoftwareApplication',
        name: 'Quantified Self',
        applicationCategory: 'HealthApplication',
        operatingSystem: 'Web',
        featureList: [
          ...page.highlights,
          ...page.syncFlows.map(flow => flow.title),
          ...page.tools.map(tool => tool.title),
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: page.faqItems.map(item => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: item.answer,
          },
        })),
      },
    ],
  };
}

export const INTEGRATIONS_HUB_ROUTE_DATA: IntegrationRouteData = {
  title: 'Integrations',
  preload: true,
  animation: 'Integrations',
  description: 'Explore Garmin, Suunto, COROS, and Wahoo integrations for automatic activity imports and sync, history imports, route sending, uploads, and a private training dashboard.',
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Quantified Self Integrations',
    description: 'Public integration hub for Garmin, Suunto, COROS, and Wahoo activity imports and sync, history imports, route sending, uploads, and private training analysis.',
    url: 'https://quantified-self.io/integrations',
    inLanguage: 'en',
    hasPart: INTEGRATION_HUB_CARDS.map(page => ({
      '@type': 'WebPage',
      name: `${page.label} Integration`,
      url: `https://quantified-self.io/integrations/${page.slug}`,
    })),
  },
};

export const PROVIDER_INTEGRATION_ROUTE_DATA: Record<IntegrationProviderKey, IntegrationRouteData> = {
  garmin: {
    title: 'Private Garmin Training Dashboard',
    preload: true,
    animation: 'Integrations',
    description: 'Use Quantified Self as a private Garmin training dashboard with history imports, routes sent to Garmin Connect, Garmin to Suunto activity sync, and AI insights.',
    jsonLd: providerWebPageJsonLd(
      PROVIDER_INTEGRATION_PAGES.garmin,
      'Use Quantified Self as a private Garmin training dashboard with history imports, routes sent to Garmin Connect, Garmin to Suunto activity sync, and AI insights.'
    ),
  },
  suunto: {
    title: 'Suunto Integration',
    preload: true,
    animation: 'Integrations',
    description: 'Sync Garmin and COROS activities to Suunto, import Suunto routes, send Suunto routes to Garmin, upload FIT activities and GPX routes, and centralize workout data.',
    jsonLd: providerWebPageJsonLd(
      PROVIDER_INTEGRATION_PAGES.suunto,
      'Sync Garmin and COROS activities to Suunto, import Suunto routes, send Suunto routes to Garmin, upload FIT activities and GPX routes, and centralize workout data.'
    ),
  },
  coros: {
    title: 'COROS Integration',
    preload: true,
    animation: 'Integrations',
    description: 'Connect COROS for COROS to Suunto activity sync, recent history imports, sleep summaries, FIT uploads, and centralized Garmin, Suunto, and COROS workout data.',
    jsonLd: providerWebPageJsonLd(
      PROVIDER_INTEGRATION_PAGES.coros,
      'Connect COROS for COROS to Suunto activity sync, recent history imports, sleep summaries, FIT uploads, and centralized Garmin, Suunto, and COROS workout data.'
    ),
  },
  wahoo: {
    title: 'Wahoo Integration',
    preload: true,
    animation: 'Integrations',
    description: 'Connect Wahoo to Quantified Self for automatic FIT activity imports, date-range history imports, original-file retention, and private multi-provider training analysis.',
    jsonLd: providerWebPageJsonLd(
      PROVIDER_INTEGRATION_PAGES.wahoo,
      'Connect Wahoo to Quantified Self for automatic FIT activity imports, date-range history imports, original-file retention, and private multi-provider training analysis.',
    ),
  },
};
