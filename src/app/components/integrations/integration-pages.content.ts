import { ServiceNames } from '@sports-alliance/sports-lib';

export type IntegrationProviderKey = 'garmin' | 'suunto' | 'coros';

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
  { label: 'Garmin', serviceName: ServiceNames.GarminAPI },
  { label: 'Suunto', serviceName: ServiceNames.SuuntoApp },
  { label: 'COROS', serviceName: ServiceNames.COROSAPI },
];

export const PROVIDER_INTEGRATION_PAGES: Record<IntegrationProviderKey, ProviderIntegrationPage> = {
  garmin: {
    slug: 'garmin',
    label: 'Garmin',
    serviceName: ServiceNames.GarminAPI,
    h1: 'Garmin Integration and Private Training Dashboard',
    heroCopy: 'Connect Garmin to Quantified Self to keep Garmin activities in a private training dashboard, sync new Garmin activities to Suunto, and bring Garmin, Suunto, and COROS workouts into one view with AI insights.',
    providerSources: ALL_PROVIDER_SOURCES,
    summary: 'Use Quantified Self as a private dashboard for Garmin data, with Garmin history imports, Garmin -> Suunto sync, AI insights, and multi-service workout history.',
    highlights: [
      'Private Garmin training dashboard',
      'Garmin -> Suunto automatic sync',
      'Garmin, Suunto, and COROS in one dashboard',
    ],
    syncEyebrow: 'Garmin Workflows',
    syncTitle: 'Garmin data, Suunto sync, and history import',
    syncCopy: 'Connect Garmin once, keep permissions active, and decide which Garmin workflows should feed Suunto or your private Quantified Self dashboard.',
    syncFlows: [
      {
        icon: 'history',
        title: 'Garmin history import',
        copy: 'Queue Garmin history imports for up to five years of data per request, with Garmin import requests limited by the provider cooldown documented in Help.',
      },
      {
        icon: 'sync_alt',
        title: 'Garmin -> Suunto automatic sync',
        copy: 'Connect Garmin and Suunto, enable the route toggle in Garmin Services, and newly imported Garmin activities can be sent to Suunto automatically.',
      },
      {
        icon: 'published_with_changes',
        title: 'Manual Garmin catch-up',
        copy: 'Choose a date range in Services to queue Garmin -> Suunto sync jobs for Garmin activities already stored in Quantified Self.',
      },
    ],
    toolsEyebrow: 'Garmin Tools',
    toolsTitle: 'Original files, exports, and training context',
    toolsCopy: 'Garmin activities can remain useful beyond the first import because Quantified Self keeps source context available for dashboards, exports, and analysis.',
    tools: [
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
        answer: 'Yes. Connect Garmin and Suunto, enable the Garmin -> Suunto route toggle, and new Garmin activities can be sent to Suunto automatically when they arrive in Quantified Self.',
      },
      {
        question: 'Can I centralize Garmin, Suunto, and COROS workout data?',
        answer: 'Yes. Connect the services you use to centralize Garmin, Suunto, and COROS workout data, then review synced activities, uploads, routes, recovery context, and AI-backed summaries from one dashboard.',
      },
    ],
    closingTitle: 'Connect Garmin, then keep every workout in context',
    closingCopy: 'Start with Garmin, add Suunto or COROS when needed, and keep sync, history, and analysis workflows in one private training dashboard.',
  },
  suunto: {
    slug: 'suunto',
    label: 'Suunto',
    serviceName: ServiceNames.SuuntoApp,
    h1: 'Suunto Integration for Activity and Route Sync',
    heroCopy: 'Use Quantified Self as a private training dashboard, automatically sync Garmin and COROS activities to Suunto, import Suunto routes into Routes, and send saved GPX routes to Suunto.',
    providerSources: ALL_PROVIDER_SOURCES,
    summary: 'Sync Garmin and COROS workouts to Suunto, upload FIT activities and GPX routes, import Suunto routes, run route catch-up, import Suunto history, and keep training data centralized.',
    highlights: [
      'Garmin -> Suunto automatic sync',
      'COROS -> Suunto automatic sync',
      'Suunto route import and catch-up',
      'FIT activity and GPX route upload to Suunto',
    ],
    syncEyebrow: 'Automatic Sync',
    syncTitle: 'How to sync Garmin and COROS data to Suunto automatically',
    syncCopy: 'Quantified Self keeps the sync route explicit: connect the source service, connect Suunto, enable the route toggle, and keep the relevant service permissions active.',
    syncFlows: [
      {
        icon: 'sync_alt',
        title: 'Garmin -> Suunto automatic sync',
        copy: 'Connect Garmin and Suunto, enable the route toggle in Garmin Services, and new Garmin activities can be sent to Suunto automatically when they arrive in Quantified Self.',
      },
      {
        icon: 'published_with_changes',
        title: 'COROS -> Suunto automatic sync',
        copy: 'Connect COROS and Suunto, enable the COROS route toggle, and new COROS workouts can be forwarded to Suunto through the same private training hub.',
      },
      {
        icon: 'history',
        title: 'Manual catch-up for existing workouts',
        copy: 'Choose a date range in Services to queue Garmin -> Suunto or COROS -> Suunto catch-up jobs for activities already stored in Quantified Self.',
      },
      {
        icon: 'route',
        title: 'Suunto route import and catch-up',
        copy: 'Import new and updated Suunto routes into Routes automatically, or run route catch-up to queue the current Suunto route library after first connection or reconnect.',
      },
    ],
    toolsEyebrow: 'Suunto Tools',
    toolsTitle: 'Activity, route, history, and sleep workflows',
    toolsCopy: 'Suunto is not only a sync destination. Quantified Self also supports direct Suunto workflows for uploads, route import, route catch-up, history, and recovery context.',
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
        copy: 'Bring Suunto routes back into Quantified Self automatically, then use manual route catch-up when older Suunto routes need to be queued.',
      },
      {
        icon: 'bedtime',
        title: 'Suunto history and sleep imports',
        copy: 'Use Suunto imports and sleep backfill tools when your Suunto account is the source of historical activity or recovery data.',
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
        answer: 'Yes. Quantified Self can import new and updated Suunto routes into Routes, queue manual Suunto route catch-up, and send saved FIT or GPX routes to Suunto from the route library.',
      },
    ],
    closingTitle: 'Connect once, then keep your services aligned',
    closingCopy: 'New Garmin and COROS workouts can move to Suunto automatically after setup. Existing activities and Suunto routes can be queued later with manual catch-up from Services.',
  },
  coros: {
    slug: 'coros',
    label: 'COROS',
    serviceName: ServiceNames.COROSAPI,
    h1: 'COROS Integration for Suunto Sync and Centralized Training Data',
    heroCopy: 'Connect COROS to Quantified Self, sync COROS activities to Suunto, import recent COROS history, and centralize Garmin, Suunto, and COROS workout data in a private dashboard.',
    providerSources: ALL_PROVIDER_SOURCES,
    summary: 'Connect COROS for recent history imports, COROS -> Suunto sync, sleep summaries, FIT uploads to COROS, and centralized multi-service training analysis.',
    highlights: [
      'COROS -> Suunto automatic sync',
      'Recent COROS history imports',
      'COROS, Garmin, and Suunto in one dashboard',
    ],
    syncEyebrow: 'COROS Workflows',
    syncTitle: 'COROS activity import and Suunto sync',
    syncCopy: 'Connect COROS, keep the connection active, and use route-based sync when COROS workouts should move to Suunto automatically.',
    syncFlows: [
      {
        icon: 'sync_alt',
        title: 'COROS -> Suunto automatic sync',
        copy: 'Connect COROS and Suunto, enable the COROS route toggle, and newly imported COROS workouts can be sent to Suunto automatically.',
      },
      {
        icon: 'history',
        title: 'COROS history import',
        copy: 'Import the last 3 months of COROS history within the current provider limit, then review the imported activities from the same dashboard as Garmin and Suunto.',
      },
      {
        icon: 'published_with_changes',
        title: 'Manual COROS catch-up',
        copy: 'Choose a date range in COROS Services to queue COROS -> Suunto sync jobs for events already stored in Quantified Self.',
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
        answer: 'Connect COROS and Suunto, enable the COROS -> Suunto route toggle in Services, and keep both connections active so newly imported COROS activities can be sent to Suunto.',
      },
      {
        question: 'Can I centralize COROS with Garmin and Suunto?',
        answer: 'Yes. Quantified Self can centralize Garmin, Suunto, and COROS workout data so COROS activities, Garmin files, Suunto history, routes, and AI insights stay in one dashboard.',
      },
      {
        question: 'How much COROS history can I import?',
        answer: 'COROS history import is currently limited to the last 3 months because of provider API restrictions. The Help page documents queue behavior for larger import jobs.',
      },
    ],
    closingTitle: 'Connect COROS, then keep service data aligned',
    closingCopy: 'Use COROS on its own or with Garmin and Suunto, then keep sync, catch-up, recovery, and analysis workflows in one private training dashboard.',
  },
};

export const INTEGRATION_HUB_CARDS: readonly IntegrationHubCard[] = [
  {
    slug: 'garmin',
    label: 'Garmin',
    serviceName: ServiceNames.GarminAPI,
    subtitle: 'Private dashboard, history import, and Suunto sync',
    summary: 'Connect Garmin to import history, send new Garmin activities to Suunto, and analyze Garmin data beside Suunto and COROS in one private dashboard.',
    highlights: [
      'Import Garmin history',
      'Sync Garmin -> Suunto automatically',
      'Analyze Garmin with Suunto and COROS',
    ],
  },
  {
    slug: 'suunto',
    label: 'Suunto',
    serviceName: ServiceNames.SuuntoApp,
    subtitle: 'Sync destination, route sync, and Suunto history',
    summary: 'Connect Suunto to receive Garmin and COROS activities, import Suunto routes, upload FIT activities and GPX routes to Suunto, and keep Suunto history in the same private dashboard.',
    highlights: [
      'Receive Garmin -> Suunto sync',
      'Receive COROS -> Suunto sync',
      'Import and send Suunto routes',
    ],
  },
  {
    slug: 'coros',
    label: 'COROS',
    serviceName: ServiceNames.COROSAPI,
    subtitle: 'Recent history import and Suunto sync',
    summary: 'Connect COROS to import recent history, send new COROS workouts to Suunto, and compare COROS data beside Garmin and Suunto in one private dashboard.',
    highlights: [
      'Import recent COROS history',
      'Sync COROS -> Suunto automatically',
      'Analyze COROS with Garmin and Suunto',
    ],
  },
];

export function getProviderIntegrationPage(key: unknown): ProviderIntegrationPage {
  if (key === 'garmin' || key === 'suunto' || key === 'coros') {
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
  description: 'Explore Garmin, Suunto, and COROS integrations for private training dashboards, provider sync, history imports, uploads, and centralized workout data.',
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Quantified Self Integrations',
    description: 'Public integration hub for Garmin, Suunto, and COROS workflows in Quantified Self.',
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
    description: 'Use Quantified Self as a private training dashboard for Garmin data with Garmin history imports, Garmin -> Suunto sync, AI insights, and centralized workout data.',
    jsonLd: providerWebPageJsonLd(
      PROVIDER_INTEGRATION_PAGES.garmin,
      'Use Quantified Self as a private training dashboard for Garmin data with Garmin history imports, Garmin -> Suunto sync, AI insights, and centralized workout data.'
    ),
  },
  suunto: {
    title: 'Suunto Integration',
    preload: true,
    animation: 'Integrations',
    description: 'Sync Garmin and COROS activities to Suunto, import Suunto routes, send saved GPX routes to Suunto, upload FIT activities, and centralize Garmin, Suunto, and COROS workout data.',
    jsonLd: providerWebPageJsonLd(
      PROVIDER_INTEGRATION_PAGES.suunto,
      'Sync Garmin and COROS activities to Suunto, import Suunto routes, send saved GPX routes to Suunto, upload FIT activities, and centralize Garmin, Suunto, and COROS workout data.'
    ),
  },
  coros: {
    title: 'COROS Integration',
    preload: true,
    animation: 'Integrations',
    description: 'Connect COROS to Quantified Self for COROS -> Suunto sync, recent history imports, sleep summaries, FIT uploads, and centralized Garmin, Suunto, and COROS workout data.',
    jsonLd: providerWebPageJsonLd(
      PROVIDER_INTEGRATION_PAGES.coros,
      'Connect COROS to Quantified Self for COROS -> Suunto sync, recent history imports, sleep summaries, FIT uploads, and centralized Garmin, Suunto, and COROS workout data.'
    ),
  },
};
