import { ServiceNames } from '@sports-alliance/sports-lib';
import { ROUTE_USAGE_LIMITS, USAGE_LIMITS } from '@shared/limits';
import { getProviderDisplayName } from '@shared/provider-presentation';

export interface ComparisonProviderSource {
  label: string;
  serviceName: ServiceNames;
}

export interface ComparisonFeatureItem {
  icon: string;
  title: string;
  copy: string;
}

export interface ComparisonFaqItem {
  question: string;
  answer: string;
}

export interface ComparisonRouteData {
  title: string;
  preload: boolean;
  animation: string;
  description: string;
  jsonLd: Record<string, unknown>;
}

export const WORKOUT_DATA_COMPARISON_PATH = 'features/workout-data-comparison';
export const WORKOUT_DATA_COMPARISON_URL = `https://quantified-self.io/${WORKOUT_DATA_COMPARISON_PATH}`;
export const COMPARISON_FREE_PLAN_ACTIVITY_LIMIT = USAGE_LIMITS.free;
export const COMPARISON_FREE_PLAN_ROUTE_LIMIT = ROUTE_USAGE_LIMITS.free;

export const COMPARISON_PROVIDER_SOURCES: readonly ComparisonProviderSource[] = [
  { label: getProviderDisplayName(ServiceNames.GarminAPI, 'source'), serviceName: ServiceNames.GarminAPI },
  { label: getProviderDisplayName(ServiceNames.SuuntoApp, 'source'), serviceName: ServiceNames.SuuntoApp },
  { label: getProviderDisplayName(ServiceNames.COROSAPI, 'source'), serviceName: ServiceNames.COROSAPI },
  { label: getProviderDisplayName(ServiceNames.WahooAPI, 'source'), serviceName: ServiceNames.WahooAPI },
];

export const COMPARISON_FEATURE_ITEMS: readonly ComparisonFeatureItem[] = [
  {
    icon: 'compare_arrows',
    title: 'Device, provider, and file data in one view',
    copy: 'Bring Garmin, Suunto, COROS, Wahoo, manual FIT, TCX, GPX, JSON, and SML imports into one private dashboard so source service, original files, maps, routes, and workout metrics stay visible together.',
  },
  {
    icon: 'merge_type',
    title: 'Benchmark any two imported activities',
    copy: `Compare provider-synced workouts or custom activity files, choose reference and test roles, auto-align time, and save a reusable device-to-device report. Manual uploads and benchmark comparisons are available on the free plan for up to ${COMPARISON_FREE_PLAN_ACTIVITY_LIMIT} activities and ${COMPARISON_FREE_PLAN_ROUTE_LIMIT} saved routes.`,
  },
  {
    icon: 'stacked_line_chart',
    title: 'Metric overlays for shared signals',
    copy: 'Review pace or speed, heart rate, power, cadence, elevation, and distance overlays when compatible streams are available on the selected activities.',
  },
  {
    icon: 'rate_review',
    title: 'Reviewer-ready device comparisons',
    copy: 'Use benchmark reports when testing watches, bike computers, sensors, or firmware for YouTube reviews, blog posts, coaching notes, and device QA.',
  },
];

export const COMPARISON_SEARCH_INTENT_ITEMS: readonly ComparisonFeatureItem[] = [
  {
    icon: 'dashboard_customize',
    title: 'Private Garmin training dashboard',
    copy: 'Use Garmin data beyond Garmin Connect by keeping original activity files, maps, load metrics, routes, exports, and connected Suunto, COROS, or Wahoo workouts in your own account.',
  },
  {
    icon: 'sync_alt',
    title: 'Garmin and COROS to Suunto sync context',
    copy: 'Connect your services once and automatically send new Garmin or COROS activities to Suunto. You can also choose a date range to sync past activities.',
  },
  {
    icon: 'hub',
    title: 'Centralized multi-provider workout history',
    copy: 'Centralize Garmin, Suunto, COROS, and Wahoo workout data so each service can be useful without trapping analysis inside one device ecosystem.',
  },
  {
    icon: 'upload_file',
    title: 'Custom FIT, TCX, GPX, JSON, and SML imports',
    copy: `Upload files from lab tests, beta firmware, review units, exported workouts, or unsupported services, then compare them with the same benchmark workflow on the free plan, subject to the ${COMPARISON_FREE_PLAN_ACTIVITY_LIMIT}-activity Starter limit.`,
  },
  {
    icon: 'article',
    title: 'Evidence for device reviews and blog posts',
    copy: 'Create repeatable reports for sports watch reviews, sensor comparisons, coaching writeups, and YouTube videos without publishing raw private training history.',
  },
];

export const COMPARISON_FAQ_ITEMS: readonly ComparisonFaqItem[] = [
  {
    question: 'Can I compare Garmin, COROS, Suunto, Wahoo, and uploaded workout files?',
    answer: 'Yes. Import provider activities or upload FIT, TCX, GPX, JSON, and SML files, then compare compatible recordings with source-aware maps, charts, overlays, and benchmark reports from the same private dashboard.',
  },
  {
    question: 'Is Quantified Self a FIT file viewer?',
    answer: 'Quantified Self keeps original FIT, TCX, GPX, JSON, and SML activity files useful after import, including benchmark and reprocessing workflows, but it is a private dashboard rather than a standalone public file viewer.',
  },
  {
    question: 'Can device reviewers use benchmark reports?',
    answer: 'Yes. Reviewers, YouTube creators, bloggers, coaches, and testers can benchmark two recordings from different devices or files, then use the saved report as evidence for device comparisons.',
  },
  {
    question: 'Is workout data comparison available on the free plan?',
    answer: `Yes. Manual uploads, core analysis tools, and benchmark comparisons are available on the free plan for up to ${COMPARISON_FREE_PLAN_ACTIVITY_LIMIT} activities and ${COMPARISON_FREE_PLAN_ROUTE_LIMIT} saved routes. Automatic service sync and higher limits require a paid plan.`,
  },
  {
    question: 'Can I sync Garmin data to Suunto automatically?',
    answer: 'Yes. Connect Garmin and Suunto, turn on automatic activity sync in Connections, and new Garmin activities can be sent to Suunto automatically.',
  },
];

export const WORKOUT_DATA_COMPARISON_ROUTE_DATA: ComparisonRouteData = {
  title: 'Workout Data Comparison',
  preload: true,
  animation: 'Features',
  description: `Compare Garmin, Suunto, COROS, Wahoo, and custom FIT, TCX, or GPX workout data in one private training dashboard with free-plan manual uploads, benchmark reports, source files, and reviewer-ready device comparisons.`,
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Compare Garmin, Suunto, COROS, and Wahoo workout data',
    description: `Compare Garmin, Suunto, COROS, Wahoo, and custom FIT, TCX, or GPX workout data in one private training dashboard with free-plan manual uploads, benchmark reports, source files, and reviewer-ready device comparisons.`,
    url: WORKOUT_DATA_COMPARISON_URL,
    inLanguage: 'en',
    isPartOf: {
      '@type': 'WebSite',
      name: 'Quantified Self',
      url: 'https://quantified-self.io',
    },
    audience: [
      {
        '@type': 'Audience',
        audienceType: 'Endurance athletes',
      },
      {
        '@type': 'Audience',
        audienceType: 'Sports technology reviewers',
      },
    ],
    about: [
      'Garmin vs COROS workout data',
      'Garmin, Suunto, COROS, and Wahoo workout comparison',
      'Custom FIT and TCX workout file comparison',
      'Sports watch review benchmark reports',
      'Private Garmin training dashboard',
      'Garmin to Suunto activity sync',
      'COROS to Suunto activity sync',
    ],
    mainEntity: [
      {
        '@type': 'SoftwareApplication',
        name: 'Quantified Self',
        applicationCategory: 'HealthApplication',
        operatingSystem: 'Web',
        featureList: [
          ...COMPARISON_FEATURE_ITEMS.map(item => item.title),
          ...COMPARISON_SEARCH_INTENT_ITEMS.map(item => item.title),
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: COMPARISON_FAQ_ITEMS.map(item => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: item.answer,
          },
        })),
      },
    ],
  },
};
