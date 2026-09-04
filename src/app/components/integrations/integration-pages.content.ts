import { ServiceNames } from '@sports-alliance/sports-lib';
import { getProviderDisplayName } from '@shared/provider-presentation';
import { SOCIAL_IMAGES, type SocialImageRouteData } from '../../shared/social-image-route-data';

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

export interface ProviderGuideAction {
  label: string;
  routerLink: string;
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
  relatedGuideActions?: readonly ProviderGuideAction[];
}

export interface IntegrationHubCard {
  slug: IntegrationProviderKey;
  label: string;
  serviceName: ServiceNames;
  subtitle: string;
  summary: string;
  highlights: readonly string[];
}

export interface IntegrationRouteData extends SocialImageRouteData {
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
    h1: 'Garmin Integration and Training Dashboard',
    heroCopy: 'Connect Garmin to Quantified Self to keep Garmin activities, Sleep, and supported source-attributed Health summaries in one dashboard, send saved or selected GPX/FIT routes to Garmin Connect, and sync new Garmin activities to Suunto, Wahoo, or COROS.',
    providerSources: ALL_PROVIDER_SOURCES,
    summary: 'Use Quantified Self as a dashboard for Garmin activities, Sleep, and Health summaries, with history imports, direct and saved GPX/FIT routes sent to Garmin Connect, opt-in activity delivery, and multi-service workout history.',
    highlights: [
      'Garmin training dashboard',
      'Garmin Sleep and Health summaries',
      'Send saved routes to Garmin Connect',
      'Send selected GPX/FIT routes to Garmin',
      'Garmin to Suunto automatic activity sync',
      'Garmin activity delivery to Wahoo and COROS',
      'Garmin, Suunto, and COROS in one dashboard',
    ],
    syncEyebrow: 'Garmin Workflows',
    syncTitle: 'Garmin activities, Sleep, Health, routes, and sync',
    syncCopy: 'Connect Garmin once, keep permissions active, and choose whether to import Garmin history, receive supported Health summaries, send routes to Garmin Connect, or deliver Garmin activities to Suunto, Wahoo, or COROS.',
    syncFlows: [
      {
        icon: 'history',
        title: 'Garmin history import',
        copy: 'Import activities from Garmin\'s latest rolling five-year history window. Garmin limits how often a new history import can be started, as documented in Help.',
      },
      {
        icon: 'monitor_heart',
        title: 'Sleep and Health summaries',
        copy: 'Import normalized Garmin Sleep sessions and supported Daily, Stress, HRV, body, respiration, blood-pressure, skin-temperature, and Health Snapshot history; Health records stay source-attributed and separate from workouts and Sleep.',
      },
      {
        icon: 'route',
        title: 'Send saved routes to Garmin Connect',
        copy: 'Send saved FIT and GPX routes from Routes to Garmin Connect when the connected Garmin account includes COURSE_IMPORT. Re-sending the same saved route updates the existing Garmin course for that Garmin account instead of creating duplicates.',
      },
      {
        icon: 'upload_file',
        title: 'Direct GPX/FIT route delivery',
        copy: 'Choose a GPX or FIT route in Garmin Services to create a Garmin Connect course without adding a route to your Quantified Self library. Course Import permission is required.',
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
      {
        icon: 'published_with_changes',
        title: 'Send Garmin activities to Wahoo or COROS',
        copy: 'Opt in to automatic delivery for new Garmin FIT activities, or choose a date range to send activities already stored in Quantified Self while future sync stays off.',
      },
    ],
    toolsEyebrow: 'Garmin Tools',
    toolsTitle: 'Route delivery, original files, and training context',
    toolsCopy: 'Garmin workflows stay useful beyond the first import because Quantified Self supports both direct GPX/FIT route delivery and saved-route updates, while keeping route and activity source context available for dashboards, exports, and analysis.',
    tools: [
      {
        icon: 'published_with_changes',
        title: 'Send routes to Garmin Connect',
        copy: 'Use Routes to send saved FIT and GPX routes to Garmin Connect with the saved Quantified Self route name. Sending the same route again updates it.',
      },
      {
        icon: 'upload_file',
        title: 'GPX and FIT route upload',
        copy: 'Use Garmin Services to select a GPX or FIT route file and create a Garmin course directly. This direct upload is not added to your Quantified Self route library.',
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
        title: 'Grounded Assistant for Garmin data',
        copy: 'Ask focused questions about Garmin activity statistics and get conversational answers with compact evidence grounded in your stored training history.',
      },
    ],
    dashboardEyebrow: 'Training Dashboard',
    dashboardTitle: 'Garmin training dashboard',
    dashboardCopy: 'Quantified Self is designed for Garmin users who want data ownership, connected Suunto and COROS workouts, and training analysis that does not stop at one ecosystem.',
    dashboardPoints: [
      {
        icon: 'dashboard_customize',
        title: 'Centralized workout data',
        copy: 'Centralize Garmin, Suunto, and COROS workout data in one dashboard, then review load, maps, routes, source files, and recovery context together.',
      },
      {
        icon: 'security',
        title: 'Your data stays yours',
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
        question: 'What can Quantified Self do with Garmin data?',
        answer: 'Quantified Self combines Garmin original files, maps, load metrics, grounded Assistant answers, exports, and optional Suunto or COROS workouts in one account.',
      },
      {
        question: 'Can Garmin workouts sync to Suunto automatically?',
        answer: 'Yes. Connect Garmin and Suunto, turn on automatic activity sync in Connections, and new Garmin activities can be sent to Suunto automatically when they arrive in Quantified Self.',
      },
      {
        question: 'Can Garmin workouts sync to Wahoo or COROS?',
        answer: 'Yes. Connect the destination, then opt in to automatic delivery for new Garmin FIT activities or send a past date range already stored in Quantified Self.',
      },
      {
        question: 'Can I send saved routes to Garmin Connect?',
        answer: 'Yes. Saved FIT and GPX routes can be sent from Routes to Garmin Connect when the connected Garmin account includes COURSE_IMPORT. Re-sending the same saved route updates the same Garmin course for that Garmin account.',
      },
      {
        question: 'Can I upload a GPX or FIT route directly to Garmin?',
        answer: 'Yes. In Garmin Services, choose a GPX or FIT route file to create a Garmin Connect course. It requires Course Import permission and does not add the selected route to your Quantified Self route library.',
      },
      {
        question: 'Can I centralize Garmin, Suunto, and COROS workout data?',
        answer: 'Yes. Connect the services you use to centralize Garmin, Suunto, and COROS workout data, then review synced activities, uploads, routes, recovery context, and AI-backed summaries from one dashboard.',
      },
    ],
    closingTitle: 'Connect Garmin, then keep every workout in context',
    closingCopy: 'Start with Garmin, add route sending or Suunto and COROS workflows when needed, and keep sync, history, and analysis in one training dashboard.',
  },
  suunto: {
    slug: 'suunto',
    label: 'Suunto',
    serviceName: ServiceNames.SuuntoApp,
    h1: 'Suunto Integration for Activity and Route Sync',
    heroCopy: 'Use Quantified Self as a training dashboard, automatically sync Garmin and COROS activities to Suunto, import Suunto routes, send Suunto routes to Garmin, Wahoo, or COROS, upload GPX or FIT routes, and import source-attributed 24/7 Health data.',
    providerSources: ALL_PROVIDER_SOURCES,
    summary: 'Sync Garmin and COROS workouts to Suunto, upload FIT activities and GPX/FIT routes, import existing Suunto routes, send Suunto routes to Garmin, Wahoo, or COROS, import Suunto history, and keep training data centralized.',
    highlights: [
      'Garmin to Suunto automatic activity sync',
      'COROS to Suunto and Wahoo automatic activity sync',
      'Suunto activity delivery to Wahoo and COROS',
      'Automatic and existing Suunto route imports',
      'Send Suunto routes to Garmin',
      'Send Suunto routes to Wahoo',
      'Suunto route delivery to COROS',
      'FIT activity and GPX/FIT route upload to Suunto',
      'Source-attributed Suunto 24/7 Health',
    ],
    syncEyebrow: 'Automatic Sync',
    syncTitle: 'How to sync activities to Suunto and send Suunto routes to Garmin, Wahoo, or COROS',
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
        icon: 'published_with_changes',
        title: 'Send Suunto activities to Wahoo or COROS',
        copy: 'Opt in to automatic delivery for new Suunto FIT activities, or choose a date range to send past activities already stored in Quantified Self.',
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
      {
        icon: 'directions_bike',
        title: 'Send Suunto routes to Wahoo',
        copy: 'Connect Wahoo, then choose whether new and updated Suunto routes saved in Quantified Self should be sent to Wahoo automatically as FIT courses. You can also send saved routes now without enabling future delivery.',
      },
      {
        icon: 'send',
        title: 'Send Suunto routes to COROS',
        copy: 'With Pro and connected Suunto and COROS accounts, you can opt in to send new and updated saved Suunto routes automatically or send existing saved routes now. Cycling routes use the COROS bike type; other routes use the running type.',
      },
    ],
    toolsEyebrow: 'Suunto Tools',
    toolsTitle: 'Activity, route, history, Sleep, and Health workflows',
    toolsCopy: 'Suunto is not only a sync destination. Quantified Self also supports uploads, automatic and existing route imports, sending routes to Garmin, Wahoo, or COROS, history imports, Sleep, and source-attributed 24/7 Health.',
    tools: [
      {
        icon: 'upload_file',
        title: 'FIT activity upload',
        copy: 'Send FIT activities to Suunto manually for missing sessions, one-off corrections, and migration workflows.',
      },
      {
        icon: 'route',
        title: 'GPX and FIT route upload',
        copy: 'Choose a GPX or FIT route in Suunto Services for direct delivery without creating a Quantified Self route. FIT sources are converted to GPX for Suunto; saved routes sent from Routes also receive a fresh GPX export with the saved route name.',
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
        icon: 'directions_bike',
        title: 'Send Suunto routes to Wahoo',
        copy: 'Use Suunto Services to automatically send new and updated saved Suunto routes to Wahoo as FIT courses, or send the existing saved routes now. Reconnect Wahoo once if route access is missing.',
      },
      {
        icon: 'send',
        title: 'Send Suunto routes to COROS',
        copy: 'With Pro and connected Suunto and COROS accounts, use Suunto Services to opt in to new and updated saved-route delivery to COROS, or send existing saved routes without enabling future delivery.',
      },
      {
        icon: 'bedtime',
        title: 'Suunto history, Sleep, and Health imports',
        copy: 'Use Suunto activity and Sleep history imports when your Suunto account is the source of historical training or recovery data. Connected accounts can queue separate 24/7 Activity, daily-statistics, and Recovery Health records through the combined Sleep & Health history control while Suunto Health is enabled.',
      },
    ],
    dashboardEyebrow: 'Training Dashboard',
    dashboardTitle: 'Centralize Garmin, Suunto, and COROS workout data',
    dashboardCopy: 'The Suunto integration works with the rest of Quantified Self, so Garmin files, Suunto history, Suunto route imports, COROS workouts, FIT uploads, GPX route sends, metrics, grounded Assistant answers, and export workflows stay connected in one dashboard.',
    dashboardPoints: [
      {
        icon: 'dashboard_customize',
        title: 'Centralized workout data',
        copy: 'Use Quantified Self to centralize Garmin, Suunto, and COROS workout data in one dashboard, then review load, readiness, maps, routes, and source files together.',
      },
      {
        icon: 'insights',
        title: 'Grounded Assistant for endurance training data',
        copy: 'Ask focused questions about your stored activity statistics and get conversational answers with compact evidence for trends, latest activities, and Training summaries.',
      },
      {
        icon: 'security',
        title: 'Your data stays yours',
        copy: 'Quantified Self is built for athletes who want one training dashboard when Garmin, Suunto, and COROS data all matter.',
      },
    ],
    faqItems: [
      {
        question: 'How does Quantified Self combine Garmin, Suunto, and COROS data?',
        answer: 'Quantified Self keeps original files, maps, load metrics, grounded Assistant answers, and connected Garmin, Suunto, or COROS workflows under one account.',
      },
      {
        question: 'Can I centralize Garmin, Suunto, and COROS workout data?',
        answer: 'Yes. Connect Garmin, Suunto, and COROS to centralize Garmin, Suunto, and COROS workout data, then review synced activities, uploads, routes, recovery context, and AI-backed summaries from one dashboard.',
      },
      {
        question: 'Can Quantified Self sync routes with Suunto?',
        answer: 'Yes. Quantified Self can import new and updated Suunto routes, import your existing Suunto route library, and send saved or selected FIT and GPX routes to Suunto. Selected FIT routes are converted to GPX for Suunto.',
      },
      {
        question: 'Can Suunto routes sync to Garmin courses?',
        answer: 'Yes. Connect Suunto and Garmin, allow Course Import in Garmin Connect, and turn on automatic route sending. You can also send Suunto routes already saved in Quantified Self without importing them again.',
      },
      {
        question: 'Can Suunto routes sync to Wahoo?',
        answer: 'Yes. Connect Suunto and Wahoo, then turn on automatic route sending in Suunto Services. New and updated saved Suunto routes are sent to Wahoo as FIT courses; you can also send existing saved routes without turning on future delivery. Reconnect Wahoo once if it was connected before route access was added.',
      },
      {
        question: 'Can Suunto routes sync to COROS?',
        answer: 'Yes. With Pro and connected Suunto and COROS accounts, turn on the opt-in route in Suunto Services or send existing saved routes now.',
      },
      {
        question: 'Does the Suunto connection import 24/7 Health metrics?',
        answer: 'Yes. Connected Suunto accounts can import available 24/7 Activity, daily-statistics, and Recovery values as source-attributed Health records. They stay separate from workout FIT data and Sleep sessions.',
      },
    ],
    closingTitle: 'Connect once, then keep your services aligned',
    closingCopy: 'New Garmin and COROS workouts can move to Suunto automatically after setup. Suunto routes can be imported into Quantified Self and sent to Garmin, Wahoo, or COROS.',
    relatedGuideActions: [
      { label: 'Import Activities to Suunto', routerLink: '/guides/import-activities-to-suunto' },
    ],
  },
  coros: {
    slug: 'coros',
    label: 'COROS',
    serviceName: ServiceNames.COROSAPI,
    h1: 'COROS Integration for Activity Sync and Route Delivery',
    heroCopy: 'Connect COROS to Quantified Self, import recent COROS history, send FIT activities and GPX/FIT routes to COROS, and opt in to activity or saved-route delivery from your other connected services.',
    providerSources: ALL_PROVIDER_SOURCES,
    summary: 'Connect COROS for recent history and sleep imports, two-way provider activity workflows, FIT activity delivery, GPX/FIT route and saved Suunto route delivery, and centralized multi-service training analysis.',
    highlights: [
      'COROS to Suunto automatic activity sync',
      'Garmin, Suunto, and Wahoo activity delivery to COROS',
      'Direct and saved route delivery to COROS',
      'Recent COROS history imports',
      'COROS, Garmin, Suunto, and Wahoo in one dashboard',
    ],
    syncEyebrow: 'COROS Workflows',
    syncTitle: 'COROS activity import, delivery, and route sync',
    syncCopy: 'Connect one active COROS account, then choose each automatic activity or saved-route path you want. Route backfills can send existing saved routes without enabling future delivery.',
    syncFlows: [
      {
        icon: 'sync_alt',
        title: 'COROS to Suunto automatic activity sync',
        copy: 'Connect COROS and Suunto, turn on the activity route in Connections, and new COROS workouts can be sent to Suunto automatically.',
      },
      {
        icon: 'sync_alt',
        title: 'COROS to Wahoo automatic activity sync',
        copy: 'Connect COROS and Wahoo, turn on the activity route in Connections, and new COROS workouts can be sent to Wahoo automatically.',
      },
      {
        icon: 'history',
        title: 'COROS history import',
        copy: 'Import the last 3 months of COROS history within the current provider limit, then review the imported activities from the same dashboard as Garmin and Suunto.',
      },
      {
        icon: 'published_with_changes',
        title: 'Sync past COROS activities to Suunto or Wahoo',
        copy: 'Choose a date range in Connections to send COROS activities already stored in Quantified Self to Suunto or Wahoo.',
      },
      {
        icon: 'upload_file',
        title: 'Send activities to COROS',
        copy: 'Automatically send new Garmin, Suunto, or Wahoo FIT activities to COROS, or choose a date range to send past activities already stored in Quantified Self.',
      },
      {
        icon: 'route',
        title: 'Send routes to COROS',
        copy: 'Eligible connected Pro users can send a GPX or FIT file directly, send saved routes from the Routes page, or opt in to automatic and existing saved Suunto route delivery.',
      },
    ],
    toolsEyebrow: 'COROS Tools',
    toolsTitle: 'History, sleep, activity, and route workflows',
    toolsCopy: 'COROS integrations support the workflows that matter when COROS is either your source device or one part of a larger training archive.',
    tools: [
      {
        icon: 'bedtime',
        title: 'Daily COROS Health and sleep',
        copy: 'COROS data imports every 24 hours with sleep timing, steps, the provider calorie value, resting and sleep heart rate, overnight HRV, and available detailed HRV samples. Pro users can also request the available three-month Sleep and Health history from Connections. Missing values stay missing, and the current COROS API does not expose sleep stages.',
      },
      {
        icon: 'verified_user',
        title: 'Connection health check',
        copy: 'Opening the COROS connection overview verifies that the active account is still bound. An unbound account changes to Reconnect required and turns off related automatic activity and saved-route settings; a temporary provider error can be retried without disconnecting it.',
      },
      {
        icon: 'upload_file',
        title: 'FIT activity upload to COROS',
        copy: 'Use asynchronous FIT activity uploads for corrections, migrations, or missing sessions. Per-file status and retry controls resume the same COROS upload instead of blindly sending it again.',
      },
      {
        icon: 'route',
        title: 'GPX and FIT route delivery',
        copy: 'Eligible connected Pro users can send a selected GPX or FIT route without saving it first, or send saved routes individually or in bulk. Cycling routes are sent as bike routes; other or unspecified activity types use COROS running routes.',
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
        title: 'Grounded Assistant for endurance training data',
        copy: 'Ask questions across COROS, Garmin, and Suunto statistics and get conversational answers with compact evidence for Training summaries and trends.',
      },
      {
        icon: 'security',
        title: 'Account-owned workflows',
        copy: 'Use Quantified Self as a training dashboard for connected service data, exports, and account-owned analysis workflows.',
      },
    ],
    faqItems: [
      {
        question: 'How do I sync COROS data to Suunto automatically?',
        answer: 'Connect COROS and Suunto, turn on automatic activity sync in Connections, and keep both connections active so new COROS activities can be sent to Suunto.',
      },
      {
        question: 'Can I sync activities from another service to COROS?',
        answer: 'Yes. Connect COROS plus Garmin, Suunto, or Wahoo, then opt in to the direction you want. New FIT activities can be delivered automatically, and past stored activities can be sent by date range while automatic sync remains off.',
      },
      {
        question: 'Can I send routes to COROS?',
        answer: 'Yes. Eligible connected Pro users can send selected GPX/FIT routes, use saved-route row or bulk sends, and opt in to saved Suunto route delivery.',
      },
      {
        question: 'Can I centralize COROS with Garmin and Suunto?',
        answer: 'Yes. Quantified Self can centralize Garmin, Suunto, and COROS workout data so COROS activities, Garmin files, Suunto history, routes, and grounded Assistant answers stay in one dashboard.',
      },
      {
        question: 'How much COROS history can I import?',
        answer: 'COROS history import is currently limited to the last 3 months because of provider API restrictions. The Help page explains processing times for larger imports.',
      },
      {
        question: 'What happens if COROS is no longer connected?',
        answer: 'The COROS connection overview verifies the active account with COROS. If COROS reports it unbound, Quantified Self shows Reconnect required and turns off related automatic activity and saved-route settings. Temporary verification failures show a retry without changing the connection.',
      },
    ],
    closingTitle: 'Connect COROS, then keep service data aligned',
    closingCopy: 'Use COROS on its own or with Garmin, Suunto, and Wahoo, then keep current and past activity and route delivery, recovery, and analysis in one training dashboard.',
  },
  wahoo: {
    slug: 'wahoo',
    label: 'Wahoo',
    serviceName: ServiceNames.WahooAPI,
    h1: 'Wahoo Integration for Activity Sync and Training Analysis',
    heroCopy: 'Connect Wahoo to Quantified Self to import new Wahoo-recorded workouts, queue FIT-backed history, sync retained Wahoo activities to Suunto or COROS, send FIT activities, GPX/FIT courses/routes, or saved Suunto routes to Wahoo, and analyze every connected activity together.',
    providerSources: ALL_PROVIDER_SOURCES,
    summary: 'Use the Pro Wahoo connection for automatic workout imports, FIT-backed history, Wahoo-to-Suunto/COROS activity sync, direct FIT activity and GPX/FIT course/route delivery, saved Suunto route delivery, Garmin/COROS/Suunto-to-Wahoo activity sync, and multi-provider training analysis.',
    highlights: [
      'Automatic Wahoo workout imports',
      'FIT-backed Wahoo history import',
      'Wahoo-to-Suunto/COROS sync and FIT activity/GPX-FIT route delivery to Wahoo',
      'Send saved Suunto routes to Wahoo',
      'Wahoo, Garmin, Suunto, and COROS in one dashboard',
    ],
    syncEyebrow: 'Wahoo Workflows',
    syncTitle: 'Import Wahoo workouts, sync them to Suunto or COROS, and send activities or routes to Wahoo',
    syncCopy: 'Authorize Wahoo once to receive completed Wahoo workout summaries, then choose automatic or date-range Wahoo-to-Suunto/COROS sync, direct FIT activity or GPX/FIT course/route delivery, or Garmin, COROS, and Suunto activity sync to Wahoo.',
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
      {
        icon: 'published_with_changes',
        title: 'Wahoo to Suunto sync',
        copy: 'Turn on automatic delivery for new Wahoo FIT activities or choose a date range to send retained Wahoo activities already stored in Quantified Self to Suunto.',
      },
      {
        icon: 'published_with_changes',
        title: 'Wahoo to COROS sync',
        copy: 'Turn on automatic delivery for new Wahoo FIT activities or choose a date range to send retained Wahoo activities already stored in Quantified Self to COROS.',
      },
      {
        icon: 'upload_file',
        title: 'Direct FIT activity delivery',
        copy: 'Choose a FIT activity file in Wahoo Services to send it directly to Wahoo. This does not create or retain a Quantified Self activity.',
      },
      {
        icon: 'route',
        title: 'Direct GPX/FIT course/route delivery',
        copy: 'Choose a GPX or FIT course or route file in Wahoo Services to send it directly to Wahoo. Quantified Self converts GPX to FIT in memory; this does not create or retain a Quantified Self route. If Wahoo route access is missing, the send flow offers a reconnect action; reconnect once, then send the route again.',
      },
      {
        icon: 'directions_bike',
        title: 'Suunto saved routes to Wahoo',
        copy: 'In Suunto Services, connect Wahoo and opt in to send new and updated saved Suunto routes to Wahoo as FIT courses. You can also backfill routes already saved in Quantified Self; revisions update the same Wahoo route.',
      },
      {
        icon: 'published_with_changes',
        title: 'Garmin, COROS, and Suunto to Wahoo sync',
        copy: 'Connect Wahoo and the source service, then turn on automatic delivery for new activities or choose a date range for activities already stored in Quantified Self.',
      },
    ],
    toolsEyebrow: 'Wahoo Tools',
    toolsTitle: 'FIT source files, Wahoo delivery, and provider-aware analysis',
    toolsCopy: 'Wahoo-origin FIT activities can be delivered to Suunto or COROS after explicit opt-in. Wahoo also accepts direct FIT activity and GPX/FIT course/route delivery plus opt-in saved Suunto route delivery. Imported Wahoo routes sync to the Wahoo App and directly to an ELEMNT bike computer, not the ELEMNT App; sleep sync and plans are not forwarded.',
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
      {
        icon: 'sync',
        title: 'Asynchronous upload status',
        copy: 'Wahoo can process a FIT upload asynchronously. Quantified Self keeps the Wahoo upload identifier for status checks without posting the same source file again.',
      },
      {
        icon: 'route',
        title: 'Course and route requirements',
        copy: 'Wahoo route delivery accepts GPX and FIT files. Quantified Self converts a selected GPX route to a FIT course in memory; it must contain exactly one route with valid coordinates. A selected route is sent directly to Wahoo and is not added to the Quantified Self route library.',
      },
      {
        icon: 'sync',
        title: 'Saved Suunto route delivery',
        copy: 'Opt in from Suunto Services to send new and updated saved Suunto routes to Wahoo, or send existing saved routes now. Quantified Self uses a stable route key so revisions update the same Wahoo route.',
      },
    ],
    dashboardEyebrow: 'Training Dashboard',
    dashboardTitle: 'Keep Wahoo workouts in your training archive',
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
      {
        question: 'Can I sync Wahoo activities to Suunto automatically?',
        answer: 'Yes. Connect Wahoo and Suunto, turn on automatic activity sync in Wahoo Services, and newly imported eligible Wahoo FIT activities can be sent to Suunto. Use Sync past activities for retained Wahoo FIT activities already in Quantified Self.',
      },
      {
        question: 'Can I sync Wahoo activities to COROS?',
        answer: 'Yes. Connect Wahoo and COROS, then opt in to automatic delivery for new retained Wahoo FIT activities or choose a date range for past activities already stored in Quantified Self.',
      },
      {
        question: 'Can I send Garmin, COROS, or Suunto activities to Wahoo?',
        answer: 'Yes. Connect Wahoo and the source service, then use the Activity Sync controls to turn on new activity delivery or choose a date range for already imported FIT-backed activities.',
      },
      {
        question: 'Can I send a route to Wahoo?',
        answer: 'Yes. In Wahoo Services, choose a GPX or FIT course or route file for direct delivery. In Suunto Services, you can also opt in to deliver saved Suunto routes to Wahoo automatically or send existing saved routes now. Quantified Self converts GPX and saved Suunto routes to FIT courses in memory; direct uploads are not stored as Quantified Self routes, while saved-route revisions update the corresponding Wahoo route. Reconnect Wahoo once if it was connected before route delivery was available. Wahoo routes sync to the Wahoo App and directly to an ELEMNT bike computer, not the ELEMNT App.',
      },
    ],
    closingTitle: 'Connect Wahoo and keep completed workouts in context',
    closingCopy: 'Import Wahoo FIT activities automatically, sync eligible retained Wahoo activities to Suunto or COROS, send the FIT activities or GPX/FIT courses/routes you choose directly to Wahoo, optionally deliver saved Suunto routes to Wahoo, add the history range you need, and analyze everything in the same archive.',
    relatedGuideActions: [
      { label: 'Import Activities to Wahoo', routerLink: '/guides/import-activities-to-wahoo' },
    ],
  },
};

export const INTEGRATION_HUB_CARDS: readonly IntegrationHubCard[] = [
  {
    slug: 'garmin',
    label: getProviderDisplayName(ServiceNames.GarminAPI, 'source'),
    serviceName: ServiceNames.GarminAPI,
    subtitle: 'Dashboard, history import, and Suunto sync',
    summary: 'Connect Garmin to import history, send GPX/FIT routes to Garmin Connect, send new Garmin activities to Suunto, and analyze Garmin data beside Suunto and COROS in one dashboard.',
    highlights: [
      'Import Garmin history',
      'Send GPX/FIT routes to Garmin Connect',
      'Sync Garmin activities to Suunto automatically',
      'Analyze Garmin with Suunto and COROS',
    ],
  },
  {
    slug: 'suunto',
    label: getProviderDisplayName(ServiceNames.SuuntoApp, 'source'),
    serviceName: ServiceNames.SuuntoApp,
    subtitle: 'Activity sync, route imports, and multi-provider route delivery',
    summary: 'Connect Suunto to receive Garmin and COROS activities, import Suunto routes, send Suunto routes to Garmin, Wahoo, or COROS, upload FIT activities and GPX/FIT routes, keep Suunto history in one dashboard, and import source-attributed 24/7 Health data.',
    highlights: [
      'Receive Garmin activities automatically',
      'Receive COROS activities automatically',
      'Send Suunto routes to Garmin',
      'Send Suunto routes to Wahoo',
      'Suunto route delivery to COROS',
    ],
  },
  {
    slug: 'coros',
    label: getProviderDisplayName(ServiceNames.COROSAPI, 'source'),
    serviceName: ServiceNames.COROSAPI,
    subtitle: 'Activity sync, FIT uploads, and route delivery',
    summary: 'Connect COROS to import recent history, send activities in supported directions, upload FIT activities and GPX/FIT routes, deliver saved Suunto routes, and compare COROS beside Garmin, Suunto, and Wahoo.',
    highlights: [
      'Import recent COROS history',
      'Sync COROS activities to Suunto automatically',
      'Send Garmin, Suunto, and Wahoo activities to COROS',
      'Direct and saved routes to COROS',
      'Analyze COROS with Garmin, Suunto, and Wahoo',
    ],
  },
  {
    slug: 'wahoo',
    label: getProviderDisplayName(ServiceNames.WahooAPI, 'source'),
    serviceName: ServiceNames.WahooAPI,
    subtitle: 'FIT import, delivery, and activity sync',
    summary: 'Connect Wahoo to import completed FIT-backed workouts, sync retained Wahoo activities to Suunto or COROS, send FIT activities and GPX/FIT courses/routes or saved Suunto routes to Wahoo, and analyze them beside Garmin, Suunto, and COROS in one dashboard.',
    highlights: [
      'Import new Wahoo workouts automatically',
      'Queue Wahoo history by date range',
      'Sync retained Wahoo activities to Suunto or COROS',
      'Send FIT activities and GPX/FIT courses/routes to Wahoo',
      'Send saved Suunto routes to Wahoo',
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
      'Grounded Assistant for endurance training data',
      'Training dashboard',
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
  description: 'Explore Garmin, Suunto, COROS, and Wahoo integrations for automatic activity imports and sync, history imports, route sending, uploads, and a training dashboard.',
  ...SOCIAL_IMAGES.integrations,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Quantified Self Integrations',
    description: 'Public integration hub for Garmin, Suunto, COROS, and Wahoo activity imports and sync, history imports, route sending, uploads, and training analysis.',
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
    title: 'Garmin Training Dashboard',
    preload: true,
    animation: 'Integrations',
    description: 'Use Quantified Self as a Garmin training dashboard with history imports, direct and saved GPX/FIT routes sent to Garmin Connect, Garmin to Suunto activity sync, activity delivery to Wahoo or COROS, and grounded Assistant answers.',
    jsonLd: providerWebPageJsonLd(
      PROVIDER_INTEGRATION_PAGES.garmin,
      'Use Quantified Self as a Garmin training dashboard with history imports, direct and saved GPX/FIT routes sent to Garmin Connect, Garmin to Suunto activity sync, activity delivery to Wahoo or COROS, and grounded Assistant answers.'
    ),
  },
  suunto: {
    title: 'Suunto Integration',
    preload: true,
    animation: 'Integrations',
    description: 'Sync Garmin and COROS activities to Suunto, import Suunto routes, send Suunto routes to Garmin, Wahoo, or COROS, upload FIT activities and GPX/FIT routes, and centralize workout data.',
    jsonLd: providerWebPageJsonLd(
      PROVIDER_INTEGRATION_PAGES.suunto,
      'Sync Garmin and COROS activities to Suunto, import Suunto routes, send Suunto routes to Garmin, Wahoo, or COROS, upload FIT activities and GPX/FIT routes, and centralize workout data.'
    ),
  },
  coros: {
    title: 'COROS Integration',
    preload: true,
    animation: 'Integrations',
    description: 'Connect COROS for COROS to Suunto activity sync, activity delivery from Garmin, Suunto, or Wahoo, FIT activity uploads, route delivery, and centralized Garmin, Suunto, and COROS workout data.',
    jsonLd: providerWebPageJsonLd(
      PROVIDER_INTEGRATION_PAGES.coros,
      'Connect COROS for COROS to Suunto activity sync, activity delivery from Garmin, Suunto, or Wahoo, FIT activity uploads, route delivery, and centralized Garmin, Suunto, and COROS workout data.'
    ),
  },
  wahoo: {
    title: 'Wahoo Activity Sync and Route Delivery',
    preload: true,
    animation: 'Integrations',
    description: 'Automatic FIT activity imports, Wahoo-to-Suunto activity sync, activity sync to Wahoo, GPX/FIT and saved Suunto route delivery, and training analysis.',
    jsonLd: providerWebPageJsonLd(
      PROVIDER_INTEGRATION_PAGES.wahoo,
      'Automatic FIT activity imports, Wahoo-to-Suunto activity sync, activity sync to Wahoo, GPX/FIT and saved Suunto route delivery, and training analysis.',
    ),
  },
};
