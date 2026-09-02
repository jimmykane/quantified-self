import { ServiceNames } from '@sports-alliance/sports-lib';
import { USAGE_LIMITS } from '@shared/limits';
import { getProviderDisplayName } from '@shared/provider-presentation';
import { WORKOUT_DATA_COMPARISON_PATH } from './workout-data-comparison-page.paths';

export { WORKOUT_DATA_COMPARISON_PATH } from './workout-data-comparison-page.paths';

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

export const WORKOUT_DATA_COMPARISON_URL = `https://quantified-self.io/${WORKOUT_DATA_COMPARISON_PATH}`;
export const COMPARISON_FREE_PLAN_ACTIVITY_LIMIT = USAGE_LIMITS.free;

export const COMPARISON_PROVIDER_SOURCES: readonly ComparisonProviderSource[] = [
  { label: getProviderDisplayName(ServiceNames.GarminAPI, 'source'), serviceName: ServiceNames.GarminAPI },
  { label: getProviderDisplayName(ServiceNames.SuuntoApp, 'source'), serviceName: ServiceNames.SuuntoApp },
  { label: getProviderDisplayName(ServiceNames.COROSAPI, 'source'), serviceName: ServiceNames.COROSAPI },
  { label: getProviderDisplayName(ServiceNames.WahooAPI, 'source'), serviceName: ServiceNames.WahooAPI },
];

export const COMPARISON_SOURCE_ITEMS: readonly ComparisonFeatureItem[] = [
  {
    icon: 'hub',
    title: 'Connected provider activities',
    copy: 'Use activities imported from Garmin, Suunto, COROS, and Wahoo while keeping the source service and available original files visible.',
  },
  {
    icon: 'upload_file',
    title: 'Uploaded workout files',
    copy: 'Import FIT, TCX, GPX, JSON, and SML activity files from device exports, unsupported services, lab tests, beta firmware, and review units.',
  },
  {
    icon: 'compare_arrows',
    title: 'Mixed-source comparisons',
    copy: 'Compare a provider activity with an uploaded file, or two recordings from different providers, through the same benchmark workflow used for same-source recordings.',
  },
];

export const COMPARISON_ANALYSIS_ITEMS: readonly ComparisonFeatureItem[] = [
  {
    icon: 'merge_type',
    title: 'Reference and test roles',
    copy: 'Choose the trusted recording as the reference, assign the activity under test, automatically align their timelines, swap roles, and rerun the benchmark when needed.',
  },
  {
    icon: 'stacked_line_chart',
    title: 'Synchronized metric overlays',
    copy: 'Inspect compatible pace or speed, heart rate, power, cadence, altitude, distance, and other recorded streams on synchronized charts.',
  },
  {
    icon: 'route',
    title: 'GNSS and route disagreement',
    copy: 'Compare GPS traces point by point with distance differences, CEP50, CEP95, RMSE, maximum deviation, and other available positional metrics.',
  },
  {
    icon: 'sensors',
    title: 'Sensor agreement and artifacts',
    copy: 'Review available correlation and error metrics for shared streams, then surface detected dropouts, stuck values, cadence lock, and preprocessing context.',
  },
];

export const COMPARISON_REVIEW_ITEMS: readonly ComparisonFeatureItem[] = [
  {
    icon: 'summarize',
    title: 'At-a-glance benchmark reports',
    copy: 'Save the device pair, overall agreement, GNSS, heart-rate, altitude, quality, and timing context in one reusable report.',
  },
  {
    icon: 'palette',
    title: 'Stable device colors and review tags',
    copy: 'Keep device colors consistent across activity toggles, event tables, charts, maps, and benchmark dialogs, then label saved comparisons with review tags.',
  },
  {
    icon: 'ios_share',
    title: 'Copy, share, or download the result',
    copy: 'Copy the reviewer summary or export the benchmark image for device reviews, YouTube videos, blog posts, coaching notes, firmware tests, and QA.',
  },
  {
    icon: 'history',
    title: 'One archive for repeat tests',
    copy: 'Keep provider imports and test files in the same account so later firmware, hardware, and sensor comparisons use the same workflow and reporting language.',
  },
];

export const COMPARISON_FAQ_ITEMS: readonly ComparisonFaqItem[] = [
  {
    question: 'Can I compare Garmin, COROS, Suunto, Wahoo, and uploaded workout files?',
    answer: 'Yes. Import provider activities or upload FIT, TCX, GPX, JSON, and SML files, then compare compatible recordings with source-aware maps, charts, overlays, and benchmark reports from the same dashboard.',
  },
  {
    question: 'Is Quantified Self a FIT file viewer?',
    answer: 'Yes. Quantified Self works as a FIT and workout-file viewer: upload FIT, TCX, GPX, JSON, or SML activities to inspect their maps, charts, statistics, and recorded metrics. Imported files remain available for exports, reprocessing, and side-by-side benchmark comparisons.',
  },
  {
    question: 'What does a sports-device benchmark report include?',
    answer: 'A saved report can include reference and test roles, timeline alignment, stat differences, GNSS accuracy, shared-stream agreement, detected quality issues, reviewer tags, and an at-a-glance summary when the required data is available.',
  },
  {
    question: 'Can reviewers export or share a benchmark?',
    answer: 'Yes. Reviewers can copy the benchmark summary and share or download the report image for a sports watch review, video, blog post, coaching note, firmware test, or QA record.',
  },
  {
    question: 'Is workout data comparison available on the free plan?',
    answer: `Yes. Manual uploads, core analysis tools, and benchmark comparisons are available on the free plan for up to ${COMPARISON_FREE_PLAN_ACTIVITY_LIMIT} activities. Automatic service sync and higher activity limits require a paid plan.`,
  },
];

export const WORKOUT_DATA_COMPARISON_ROUTE_DATA: ComparisonRouteData = {
  title: 'Workout File, Provider & Sports Device Comparison',
  preload: true,
  animation: 'Features',
  description: 'Compare Garmin, Suunto, COROS, Wahoo, FIT, TCX, GPX, JSON, and SML workouts with synchronized charts, GNSS analysis, and reviewer-ready benchmarks.',
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Compare workout files, providers, and sports devices',
    description: 'Compare Garmin, Suunto, COROS, Wahoo, FIT, TCX, GPX, JSON, and SML workouts with synchronized charts, GNSS analysis, and reviewer-ready benchmarks.',
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
      'GNSS track comparison',
      'Heart-rate and power sensor comparison',
    ],
    mainEntity: [
      {
        '@type': 'SoftwareApplication',
        name: 'Quantified Self',
        applicationCategory: 'HealthApplication',
        operatingSystem: 'Web',
        featureList: [
          ...COMPARISON_SOURCE_ITEMS.map(item => item.title),
          ...COMPARISON_ANALYSIS_ITEMS.map(item => item.title),
          ...COMPARISON_REVIEW_ITEMS.map(item => item.title),
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
