import { AI_INSIGHTS_REQUEST_LIMITS, ROUTE_USAGE_LIMITS, USAGE_LIMITS } from '@shared/limits';

export type PublicSeoPageKey =
  | 'featuresHub'
  | 'aiInsights'
  | 'workoutFileComparison'
  | 'fitGpxTcxFileAnalyzer'
  | 'routeFiles'
  | 'sportsWatchBenchmark'
  | 'guidesHub'
  | 'syncGarminToSuunto'
  | 'syncCorosToSuunto'
  | 'syncSuuntoRoutesToGarmin'
  | 'centralizeWorkoutData';

export interface PublicSeoAction {
  label: string;
  routerLink: string;
  icon?: string;
  fragment?: string;
  variant: 'flat' | 'stroked';
}

export interface PublicSeoContentItem {
  icon: string;
  title: string;
  copy: string;
}

export interface PublicSeoSection {
  eyebrow: string;
  title: string;
  copy: string;
  items: readonly PublicSeoContentItem[];
}

export interface PublicSeoFaqItem {
  question: string;
  answer: string;
}

export interface PublicSeoPage {
  key: PublicSeoPageKey;
  path: string;
  eyebrow: string;
  title: string;
  description: string;
  h1: string;
  intro: string;
  chips: readonly string[];
  actions: readonly PublicSeoAction[];
  sections: readonly PublicSeoSection[];
  faqItems: readonly PublicSeoFaqItem[];
  closingTitle: string;
  closingCopy: string;
  closingActions: readonly PublicSeoAction[];
  howToSteps?: readonly string[];
}

export interface PublicSeoRouteData {
  title: string;
  preload: boolean;
  animation: string;
  description: string;
  publicSeoPage: PublicSeoPage;
  jsonLd: Record<string, unknown>;
}

export const PUBLIC_FEATURE_PATHS = {
  hub: 'features',
  aiInsights: 'features/ai-insights',
  workoutFileComparison: 'features/workout-file-comparison',
  fitGpxTcxFileAnalyzer: 'features/fit-gpx-tcx-file-analyzer',
  routeFiles: 'features/fit-gpx-route-files',
  sportsWatchBenchmark: 'features/sports-watch-benchmark',
} as const;

export const PUBLIC_GUIDE_PATHS = {
  hub: 'guides',
  syncGarminToSuunto: 'guides/sync-garmin-to-suunto',
  syncCorosToSuunto: 'guides/sync-coros-to-suunto',
  syncSuuntoRoutesToGarmin: 'guides/sync-suunto-routes-to-garmin-courses',
  centralizeWorkoutData: 'guides/centralize-garmin-suunto-coros-workout-data',
} as const;

const SITE_ORIGIN = 'https://quantified-self.io';
const STARTER_ACTIVITY_LIMIT = USAGE_LIMITS.free;
const STARTER_ROUTE_LIMIT = ROUTE_USAGE_LIMITS.free;
const FREE_AI_REQUEST_LIMIT = AI_INSIGHTS_REQUEST_LIMITS.free;

function pageUrl(path: string): string {
  return `${SITE_ORIGIN}/${path}`;
}

function routeAction(
  label: string,
  routerLink: string,
  variant: PublicSeoAction['variant'] = 'stroked',
  icon?: string,
  fragment?: string,
): PublicSeoAction {
  return { label, routerLink, variant, icon, fragment };
}

export const PUBLIC_SEO_PAGES: Record<PublicSeoPageKey, PublicSeoPage> = {
  featuresHub: {
    key: 'featuresHub',
    path: PUBLIC_FEATURE_PATHS.hub,
    eyebrow: 'Features',
    title: 'Features for Endurance Training Data',
    description: 'Explore Quantified Self features for endurance training data: AI Insights, workout file comparison, FIT/GPX/TCX file analysis, FIT and GPX route files, sports watch benchmark reports, and a private dashboard for Garmin, Suunto, COROS, and uploaded activity files.',
    h1: 'Features for endurance training data',
    intro: 'Use Quantified Self to centralize provider activities, uploaded files, and saved route files, compare recordings, benchmark devices, and ask chart-backed questions about your training history.',
    chips: ['AI Insights', 'Workout comparison', 'FIT/TCX/GPX', 'Route files', 'Benchmarks', 'Free tools'],
    actions: [
      routeAction('AI Insights', '/features/ai-insights', 'flat', 'arrow_forward'),
      routeAction('Workout Data Comparison', '/features/workout-data-comparison'),
      routeAction('Compare Files', '/features/workout-file-comparison'),
      routeAction('Analyze Files', '/features/fit-gpx-tcx-file-analyzer'),
      routeAction('Route Files', '/features/fit-gpx-route-files'),
      routeAction('Device Benchmarks', '/features/sports-watch-benchmark'),
    ],
    sections: [
      {
        eyebrow: 'Analysis',
        title: 'Turn scattered training data into usable analysis',
        copy: 'The feature pages cover the workflows people search for after their data is spread across watches, services, and exported activity files.',
        items: [
          {
            icon: 'query_stats',
            title: 'AI Insights',
            copy: `Ask focused questions about stored Garmin, Suunto, COROS, and uploaded activity data. Free accounts include ${FREE_AI_REQUEST_LIMIT} AI requests per calendar month.`,
          },
          {
            icon: 'compare_arrows',
            title: 'Workout data comparison',
            copy: 'Compare provider activities and uploaded files with overlays, stat deltas, source context, and benchmark-ready reporting.',
          },
          {
            icon: 'dashboard_customize',
            title: 'Private training dashboard',
            copy: 'Keep activities, files, maps, exports, derived charts, sleep context, and cross-service sync workflows in one private account.',
          },
        ],
      },
      {
        eyebrow: 'Files and Devices',
        title: 'Compare any service data, device recording, or exported file',
        copy: 'Manual uploads make the comparison workflow useful even when a device, lab system, reviewer unit, or service is not directly connected.',
        items: [
          {
            icon: 'upload_file',
            title: 'FIT, TCX, GPX, JSON, and SML uploads',
            copy: `Upload activity files, compare compatible streams, and keep manual uploads available on the free plan for up to ${STARTER_ACTIVITY_LIMIT} activities.`,
          },
          {
            icon: 'analytics',
            title: 'FIT, GPX, and TCX file analysis',
            copy: 'Analyze uploaded workout files for maps, route context, charts, statistics, source files, exports, and reprocessing before using them in comparisons.',
          },
          {
            icon: 'route',
            title: 'FIT course and GPX route files',
            copy: `Save route-only FIT and GPX files as first-class route records, keep original files available for download, and use the free plan for up to ${STARTER_ROUTE_LIMIT} saved routes.`,
          },
          {
            icon: 'rate_review',
            title: 'Sports watch benchmark reports',
            copy: 'Create repeatable evidence for device reviews, YouTube videos, blog posts, firmware tests, coaching notes, and sensor comparisons.',
          },
          {
            icon: 'hub',
            title: 'Provider data plus custom files',
            copy: 'Put Garmin, Suunto, COROS, service exports, and one-off test files in the same comparison workflow without making one provider the source of truth.',
          },
        ],
      },
    ],
    faqItems: [
      {
        question: 'What Quantified Self features should I start with?',
        answer: 'Start with integrations when you need provider sync, workout file comparison when you have exported files, sports watch benchmarks when you need device evidence, and AI Insights when you want chart-backed answers from stored training data.',
      },
      {
        question: 'Can I compare custom files and provider data?',
        answer: 'Yes. Quantified Self can compare compatible Garmin, Suunto, COROS, and uploaded FIT, TCX, GPX, JSON, and SML activity data in the same private dashboard.',
      },
      {
        question: 'Which features are available on the free plan?',
        answer: `Manual uploads, core analysis, benchmark comparisons, and ${FREE_AI_REQUEST_LIMIT} AI Insight requests per calendar month are available on the free plan. Automatic provider sync and higher limits require a paid plan.`,
      },
    ],
    closingTitle: 'Choose the feature that matches the data problem',
    closingCopy: 'Use the hub when you are deciding between AI analysis, file comparison, device benchmarks, provider sync, and centralized workout history.',
    closingActions: [
      routeAction('Explore Integrations', '/integrations', 'flat', 'arrow_forward'),
      routeAction('Training Guides', '/guides'),
    ],
  },
  aiInsights: {
    key: 'aiInsights',
    path: PUBLIC_FEATURE_PATHS.aiInsights,
    eyebrow: 'AI Insights',
    title: 'AI Insights for Endurance Training Data',
    description: `Ask focused questions about endurance training data and get chart-backed AI insights from Garmin, Suunto, COROS, and uploaded activity history. Free accounts include ${FREE_AI_REQUEST_LIMIT} AI requests per calendar month.`,
    h1: 'AI insights for endurance training data',
    intro: `Ask focused questions about your training history and get chart-backed answers grounded in stored Garmin, Suunto, COROS, and uploaded activity data. Free accounts include ${FREE_AI_REQUEST_LIMIT} AI requests per calendar month.`,
    chips: ['Garmin', 'Suunto', 'COROS', 'Charts', 'Private data'],
    actions: [
      routeAction('Try AI Insights', '/ai-insights', 'flat', 'arrow_forward'),
      routeAction('View Membership', '/pricing'),
      routeAction('Read Help', '/help', 'stroked', undefined, 'ai-insights'),
    ],
    sections: [
      {
        eyebrow: 'Training Questions',
        title: 'Turn specific prompts into usable answers',
        copy: 'AI Insights works best when you ask about one metric, activity type, date range, or trend at a time.',
        items: [
          {
            icon: 'query_stats',
            title: 'Trend and aggregate answers',
            copy: 'Ask about distance, duration, power, heart rate, cadence, zones, freshness, or efficiency over a date range.',
          },
          {
            icon: 'map',
            title: 'Location-aware prompts',
            copy: 'Mention a city, region, radius, or coordinate pair when you want answers limited to activities in a place.',
          },
          {
            icon: 'fact_check',
            title: 'Evidence before advice',
            copy: 'Supported answers can include charts, summary cards, event evidence, confidence labels, and deterministic no-data states.',
          },
        ],
      },
      {
        eyebrow: 'Privacy',
        title: 'Designed around derived training stats',
        copy: 'The AI workflow is built to avoid sending raw routes, uploaded files, or complete activity payloads to AI providers.',
        items: [
          {
            icon: 'shield',
            title: 'Raw files stay out of prompts',
            copy: 'AI Insights uses the minimum derived statistics needed for the requested answer instead of raw FIT, TCX, GPX, JSON, or SML files.',
          },
          {
            icon: 'lock',
            title: 'Private dashboard context',
            copy: 'Answers are generated from activity data in your Quantified Self account, not from a public social feed or shared leaderboard.',
          },
          {
            icon: 'restart_alt',
            title: 'Repeatable result handling',
            copy: 'Latest completed answers can be restored, refreshed with new data, or replaced when your prompt or date scope changes.',
          },
        ],
      },
    ],
    faqItems: [
      {
        question: 'Can AI Insights analyze Garmin, Suunto, COROS, and uploaded workouts?',
        answer: 'Yes. AI Insights works from the training statistics stored in your account, whether the activity came from Garmin, Suunto, COROS, or supported uploaded files.',
      },
      {
        question: 'Does AI Insights send raw activity files to AI providers?',
        answer: 'No. Quantified Self does not send raw activities, routes, or uploaded files to AI providers for AI Insights. It sends the minimum derived stats needed for the answer.',
      },
      {
        question: 'Is AI Insights available on the free plan?',
        answer: `Yes. Free accounts include up to ${FREE_AI_REQUEST_LIMIT} AI Insight requests per calendar month. Basic and Pro increase the request limits.`,
      },
    ],
    closingTitle: 'Ask better questions of the training history you already have',
    closingCopy: 'Start with a focused date range, metric, and activity type, then use the answer as a chart-backed starting point for deeper analysis.',
    closingActions: [
      routeAction('Open AI Insights', '/ai-insights', 'flat', 'arrow_forward'),
      routeAction('AI Help', '/help', 'stroked', undefined, 'ai-insights'),
    ],
  },
  workoutFileComparison: {
    key: 'workoutFileComparison',
    path: PUBLIC_FEATURE_PATHS.workoutFileComparison,
    eyebrow: 'Workout File Comparison',
    title: 'FIT, TCX, GPX Workout File Comparison',
    description: `Compare FIT, TCX, GPX, JSON, and SML workout files from services, exports, lab tests, review units, and unsupported devices. Manual uploads and benchmark comparisons are free for up to ${STARTER_ACTIVITY_LIMIT} activities.`,
    h1: 'Compare FIT, TCX, GPX, JSON, and SML workout files',
    intro: `Upload activity files from services, unsupported devices, lab tests, review units, or custom exports, then compare them beside Garmin, Suunto, and COROS provider data. Manual uploads and benchmark comparisons are available on the free plan for up to ${STARTER_ACTIVITY_LIMIT} activities.`,
    chips: ['FIT', 'TCX', 'GPX', 'JSON', 'SML', 'Free uploads'],
    actions: [
      routeAction('Start Free', '/login', 'flat', 'arrow_forward'),
      routeAction('Compare Workout Data', '/features/workout-data-comparison'),
      routeAction('Upload Help', '/help', 'stroked', undefined, 'uploads-and-imports'),
    ],
    sections: [
      {
        eyebrow: 'File Sources',
        title: 'Bring exported workouts into the same dashboard',
        copy: 'File comparison is for athletes and testers who have recordings outside the normal provider sync path.',
        items: [
          {
            icon: 'upload_file',
            title: 'Manual file uploads',
            copy: 'Import FIT, TCX, GPX, JSON, and SML activity files, then keep them available for charts, exports, reprocessing, and comparison.',
          },
          {
            icon: 'source',
            title: 'Custom and unsupported services',
            copy: 'Use exported files from unsupported tools, beta firmware, lab systems, or one-off device tests without losing source context.',
          },
          {
            icon: 'hub',
            title: 'Provider data beside files',
            copy: 'Compare custom files with Garmin, Suunto, and COROS activities that already live in your Quantified Self account.',
          },
        ],
      },
      {
        eyebrow: 'Comparison',
        title: 'When two recordings tell a different story',
        copy: 'Use the same benchmark workflow for service imports and uploaded files so disagreement is visible instead of hidden in averages.',
        items: [
          {
            icon: 'merge_type',
            title: 'Reference and test roles',
            copy: 'Pick the trusted recording as the reference, pick the file or device under test, and rerun the comparison when needed.',
          },
          {
            icon: 'stacked_line_chart',
            title: 'Shared metric overlays',
            copy: 'Compare pace or speed, heart rate, power, cadence, elevation, distance, and other compatible streams when the files include them.',
          },
          {
            icon: 'route',
            title: 'Route and distance disagreement',
            copy: 'Inspect GPS traces and stat deltas so a distance, ascent, or duration difference is easier to explain.',
          },
        ],
      },
    ],
    faqItems: [
      {
        question: 'Is Quantified Self a FIT, TCX, or GPX file viewer?',
        answer: 'Quantified Self can keep FIT, TCX, GPX, JSON, and SML files useful after import, but it is a private training dashboard rather than a standalone public file viewer.',
      },
      {
        question: 'Can I compare custom files with Garmin, Suunto, and COROS activities?',
        answer: 'Yes. Uploaded files and provider-imported activities can be compared when compatible activity data and streams are available.',
      },
      {
        question: 'Is workout file comparison free?',
        answer: `Manual uploads, core analysis, and benchmark comparisons are available on the free plan for up to ${STARTER_ACTIVITY_LIMIT} activities. Automatic service sync and higher limits require a paid plan.`,
      },
    ],
    closingTitle: 'Upload the files, keep the context, compare the disagreement',
    closingCopy: 'Start with the activity files you already have, then move to provider sync only when you need automatic imports or higher activity limits.',
    closingActions: [
      routeAction('Start Free', '/login', 'flat', 'arrow_forward'),
      routeAction('Analyze Workout Files', '/features/fit-gpx-tcx-file-analyzer'),
      routeAction('Sports Watch Benchmarks', '/features/sports-watch-benchmark'),
    ],
  },
  fitGpxTcxFileAnalyzer: {
    key: 'fitGpxTcxFileAnalyzer',
    path: PUBLIC_FEATURE_PATHS.fitGpxTcxFileAnalyzer,
    eyebrow: 'Workout File Analyzer',
    title: 'FIT, GPX, TCX File Analyzer',
    description: `Use Quantified Self as a private FIT file analyzer, GPX file analyzer, and TCX workout file analyzer with maps, charts, source-file context, exports, reprocessing, and free-plan manual uploads for up to ${STARTER_ACTIVITY_LIMIT} activities.`,
    h1: 'Analyze FIT, GPX, and TCX workout files',
    intro: `Upload FIT, GPX, TCX, JSON, or SML activity files and turn them into private maps, charts, stats, exports, and source-file context. Manual uploads and core analysis are available on the free plan for up to ${STARTER_ACTIVITY_LIMIT} activities.`,
    chips: ['FIT file analyzer', 'GPX file analyzer', 'TCX file analyzer', 'Maps', 'Charts', 'Free uploads'],
    actions: [
      routeAction('Start Free', '/login', 'flat', 'arrow_forward'),
      routeAction('Compare Files', '/features/workout-file-comparison'),
      routeAction('Upload Help', '/help', 'stroked', undefined, 'uploads-and-imports'),
    ],
    sections: [
      {
        eyebrow: 'File Analysis',
        title: 'Turn activity files into readable workout context',
        copy: 'Use the analyzer workflow when you want to inspect a workout export before comparing it, reprocessing it, or keeping it in your training archive.',
        items: [
          {
            icon: 'map',
            title: 'Route maps and source context',
            copy: 'Review route context when files include position data, and keep each imported workout tied to its original source file.',
          },
          {
            icon: 'query_stats',
            title: 'Charts and activity statistics',
            copy: 'Inspect available streams such as pace or speed, heart rate, power, cadence, elevation, distance, duration, and other compatible metrics.',
          },
          {
            icon: 'file_download',
            title: 'Exports and original files',
            copy: 'Keep source files available for original-file download, GPX export when route data exists, CSV exports, and future reprocessing.',
          },
        ],
      },
      {
        eyebrow: 'Supported Workflows',
        title: 'Analyze files from services, devices, tests, and custom exports',
        copy: 'The same private dashboard can hold provider imports and standalone files from unsupported tools or review workflows.',
        items: [
          {
            icon: 'upload_file',
            title: 'FIT, GPX, TCX, JSON, and SML uploads',
            copy: 'Upload common workout file formats from services, watch exports, lab files, firmware tests, review units, and one-off recordings.',
          },
          {
            icon: 'restart_alt',
            title: 'Reprocess when parser support improves',
            copy: 'Use stored original files for reimport and statistics regeneration workflows when you need a cleaner parse later.',
          },
          {
            icon: 'compare_arrows',
            title: 'Move from analysis to comparison',
            copy: 'After a file is imported, compare compatible recordings with provider workouts, benchmark reports, and device-to-device analysis.',
          },
        ],
      },
    ],
    faqItems: [
      {
        question: 'Can I analyze FIT files?',
        answer: 'Yes. Upload a FIT activity file to Quantified Self to inspect available maps, charts, statistics, original-file context, exports, and reprocessing options in a private dashboard.',
      },
      {
        question: 'Can I analyze GPX and TCX files too?',
        answer: 'Yes. Quantified Self supports GPX and TCX activity uploads alongside FIT, JSON, and SML files when the file can be parsed as a workout activity.',
      },
      {
        question: 'Is this a public FIT or GPX file viewer?',
        answer: 'No. Quantified Self is a private training dashboard. Imported files are tied to your account so they can support analysis, exports, reprocessing, and comparisons without becoming a public upload.',
      },
      {
        question: 'Is workout file analysis free?',
        answer: `Manual uploads and core analysis are available on the free plan for up to ${STARTER_ACTIVITY_LIMIT} activities. Automatic provider sync and higher activity limits require a paid plan.`,
      },
    ],
    closingTitle: 'Upload the file, inspect the workout, then decide what to compare',
    closingCopy: 'Start with one exported workout file, verify the available route and stream data, then keep it for later dashboards, exports, reprocessing, or benchmark comparisons.',
    closingActions: [
      routeAction('Start Free', '/login', 'flat', 'arrow_forward'),
      routeAction('Workout File Comparison', '/features/workout-file-comparison'),
      routeAction('Route Files', '/features/fit-gpx-route-files'),
    ],
  },
  routeFiles: {
    key: 'routeFiles',
    path: PUBLIC_FEATURE_PATHS.routeFiles,
    eyebrow: 'Route Files',
    title: 'FIT, GPX Route Files, Suunto Route Sync, and Garmin Course Send',
    description: `Save FIT course files and GPX route or track files in a private route library, send saved routes to Suunto or Garmin Connect, import Suunto routes into Routes, and use free-plan storage for up to ${STARTER_ROUTE_LIMIT} saved routes.`,
    h1: 'Save FIT and GPX route files, then send them to Suunto or Garmin Connect',
    intro: `Upload route-only FIT course files or GPX route/track files, keep the original file attached, send saved routes to Suunto or Garmin Connect, and import new or existing Suunto routes into a private dashboard. Saved-route storage is free for up to ${STARTER_ROUTE_LIMIT} routes; sending routes requires a connected provider account, and Garmin also requires Course Import permission.`,
    chips: ['FIT course files', 'GPX route/track files', 'Suunto route sync', 'Garmin course send', 'Saved routes', 'Original files'],
    actions: [
      routeAction('Start Free', '/login', 'flat', 'arrow_forward'),
      routeAction('Garmin Integration', '/integrations/garmin', 'stroked', 'route'),
      routeAction('Suunto Integration', '/integrations/suunto', 'stroked', 'published_with_changes'),
      routeAction('Upload Help', '/help', 'stroked', undefined, 'uploads-and-imports'),
    ],
    sections: [
      {
        eyebrow: 'Route Library',
        title: 'Keep planned routes separate from completed workouts',
        copy: 'Saved route files are for courses, GPX routes, and planned paths that should not be forced into the activity history.',
        items: [
          {
            icon: 'route',
            title: 'First-class saved routes',
            copy: 'Store route-only files under Routes with route count, point count, waypoint count, activity type hints, and source-file metadata.',
          },
          {
            icon: 'description',
            title: 'Original file retention',
            copy: 'Keep the uploaded FIT course or GPX route/track file attached to the saved route so it can be downloaded later.',
          },
          {
            icon: 'inventory_2',
            title: 'Plan-aware limits',
            copy: `Starter includes up to ${STARTER_ROUTE_LIMIT} saved routes, Basic includes up to ${ROUTE_USAGE_LIMITS.basic} saved routes, and Pro supports unlimited saved routes.`,
          },
        ],
      },
      {
        eyebrow: 'Send Routes',
        title: 'Move routes between Quantified Self, Suunto, and Garmin Connect',
        copy: 'Use Routes as the private route library between planning files, saved provider routes, and connected device ecosystems without turning planned courses into completed activities.',
        items: [
          {
            icon: 'published_with_changes',
            title: 'Send saved routes to Suunto',
            copy: 'Send saved FIT and GPX route records to Suunto from the Routes table. Quantified Self reparses the original route file and uploads a fresh GPX route using the saved route name.',
          },
          {
            icon: 'route',
            title: 'Send saved routes to Garmin Connect',
            copy: 'Send saved FIT and GPX route records to Garmin Connect as Garmin courses when Course Import is allowed. Sending the same saved route again updates the same Garmin course for that account.',
          },
          {
            icon: 'sync',
            title: 'Import routes from Suunto',
            copy: 'Connected Suunto accounts can import new and updated routes automatically. Use Import existing routes when you also want routes already in your Suunto account.',
          },
        ],
      },
      {
        eyebrow: 'Formats',
        title: 'Use route files without pretending they are activities',
        copy: 'Route parsing is separate from activity upload parsing, so course files can stay useful even when they have no workout recording.',
        items: [
          {
            icon: 'directions',
            title: 'FIT course support',
            copy: 'Upload FIT route or course files exported from planning tools and devices when they describe a route instead of a completed workout.',
          },
          {
            icon: 'map',
            title: 'GPX route and track support',
            copy: 'Upload GPX files with route points or track geometry and preserve route summaries, waypoints, and source filename context.',
          },
          {
            icon: 'download',
            title: 'Download when you need the source',
            copy: 'Use the saved route list to download the original route file for device transfer, backup, or later reprocessing.',
          },
        ],
      },
    ],
    faqItems: [
      {
        question: 'Can I upload FIT course files as routes?',
        answer: 'Yes. Quantified Self supports route-only FIT uploads for saved route records when the file parses as a route or course instead of a completed activity.',
      },
      {
        question: 'Can I upload GPX route or track files?',
        answer: 'Yes. GPX files with route points or track geometry can be uploaded to Routes, where Quantified Self stores route summaries and keeps the original GPX file available for download.',
      },
      {
        question: 'Can I send saved routes to Suunto?',
        answer: 'Yes, when Suunto is connected. Saved FIT and GPX routes can be sent to Suunto from Routes. Quantified Self reparses the original file, generates a GPX route, and uploads it with the saved route name.',
      },
      {
        question: 'Can I send saved routes to Garmin Connect?',
        answer: 'Yes, when Garmin is connected and Course Import is allowed. Saved FIT and GPX routes can be sent to Garmin Connect from Routes, and sending the same saved route again updates the same Garmin course for that account.',
      },
      {
        question: 'Can Quantified Self import routes from Suunto?',
        answer: 'Yes, when Suunto is connected. New and updated Suunto routes are imported automatically, and Services includes Import existing routes for routes already in your Suunto account.',
      },
      {
        question: 'Are route files counted separately from activities?',
        answer: `Yes. Saved route limits are separate from activity limits. Free accounts include up to ${STARTER_ROUTE_LIMIT} saved routes, Basic includes up to ${ROUTE_USAGE_LIMITS.basic}, and Pro includes unlimited saved routes.`,
      },
      {
        question: 'Is this a public route planner?',
        answer: 'No. Quantified Self stores uploaded route files privately in your account. It is not a public route sharing site or route editor.',
      },
    ],
    closingTitle: 'Save the route file, then send it where it needs to go',
    closingCopy: 'Use Routes when you have a planned course, GPX route, Suunto route, Garmin course target, or device route file that should stay attached to its original source file without mixing into workout history.',
    closingActions: [
      routeAction('Start Free', '/login', 'flat', 'arrow_forward'),
      routeAction('Garmin Integration', '/integrations/garmin', 'stroked', 'route'),
      routeAction('Suunto Integration', '/integrations/suunto', 'stroked', 'published_with_changes'),
      routeAction('Upload Help', '/help', 'stroked', undefined, 'uploads-and-imports'),
    ],
  },
  sportsWatchBenchmark: {
    key: 'sportsWatchBenchmark',
    path: PUBLIC_FEATURE_PATHS.sportsWatchBenchmark,
    eyebrow: 'Device Benchmarks',
    title: 'Sports Watch Benchmark Reports',
    description: `Create sports watch benchmark reports for device reviews, YouTube videos, blog posts, coaching notes, firmware tests, and sensor comparisons using Garmin, Suunto, COROS, or uploaded workout files.`,
    h1: 'Sports watch benchmark reports for reviewers and device tests',
    intro: 'Compare same-session recordings, assign reference and test roles, auto-align time, and turn device disagreement into a repeatable benchmark report for reviews, coaching notes, blog posts, YouTube videos, and firmware QA.',
    chips: ['Device reviews', 'GNSS', 'Heart rate', 'Power', 'YouTube', 'Blog posts'],
    actions: [
      routeAction('Start Free', '/login', 'flat', 'arrow_forward'),
      routeAction('Compare Workout Data', '/features/workout-data-comparison'),
      routeAction('File Comparison', '/features/workout-file-comparison'),
    ],
    sections: [
      {
        eyebrow: 'Review Workflow',
        title: 'Use repeatable evidence instead of screenshots alone',
        copy: 'Benchmark reports are built for tests where two devices record the same session and the differences need to be explained.',
        items: [
          {
            icon: 'rate_review',
            title: 'Reviewer-ready reports',
            copy: 'Use saved benchmark outputs as evidence for sports watch reviews, bike computer tests, sensor comparisons, and firmware follow-up posts.',
          },
          {
            icon: 'published_with_changes',
            title: 'Role swap and rerun',
            copy: 'Set a reference device, swap roles when needed, and rerun the benchmark after selecting better-aligned activities.',
          },
          {
            icon: 'ios_share',
            title: 'Shareable context',
            copy: 'Use benchmark outputs to support YouTube videos, blog posts, coaching summaries, and private QA notes without publishing raw training history.',
          },
        ],
      },
      {
        eyebrow: 'Metrics',
        title: 'Measure where devices agree and where they drift',
        copy: 'Quantified Self focuses on shared streams and stats that make sports watch comparisons defensible.',
        items: [
          {
            icon: 'route',
            title: 'GNSS trace comparison',
            copy: 'Compare positional disagreement with route traces, distance differences, and accuracy-style summary metrics.',
          },
          {
            icon: 'monitor_heart',
            title: 'Sensor agreement',
            copy: 'Review compatible heart-rate, power, cadence, and pace or speed streams with correlation and error-style summaries.',
          },
          {
            icon: 'data_object',
            title: 'Files and services',
            copy: 'Benchmark provider-imported activities or uploaded FIT, TCX, GPX, JSON, and SML files from review units and test devices.',
          },
        ],
      },
    ],
    faqItems: [
      {
        question: 'Can sports tech reviewers use benchmark reports?',
        answer: 'Yes. Reviewers, YouTube creators, bloggers, coaches, and testers can compare two recordings and use the report as evidence for device or firmware evaluation.',
      },
      {
        question: 'Do benchmark reports work with uploaded files?',
        answer: 'Yes. You can use provider-imported activities or uploaded FIT, TCX, GPX, JSON, and SML files when the recordings include compatible data.',
      },
      {
        question: 'Is device benchmarking available on the free plan?',
        answer: `Yes. Manual uploads and benchmark comparisons are available on the free plan for up to ${STARTER_ACTIVITY_LIMIT} activities. Automatic sync and higher limits require a paid plan.`,
      },
    ],
    closingTitle: 'Create a cleaner benchmark before publishing a device opinion',
    closingCopy: 'Use the same private archive for test files, service imports, comparison reports, and follow-up analysis as firmware and devices change.',
    closingActions: [
      routeAction('Start Free', '/login', 'flat', 'arrow_forward'),
      routeAction('Compare Files', '/features/workout-file-comparison'),
    ],
  },
  guidesHub: {
    key: 'guidesHub',
    path: PUBLIC_GUIDE_PATHS.hub,
    eyebrow: 'Guides',
    title: 'Training Data Sync Guides',
    description: 'Step-by-step guides for Garmin to Suunto activity sync, COROS to Suunto activity sync, sending Suunto routes to Garmin, and centralizing workout data in one private dashboard.',
    h1: 'Training data sync guides',
    intro: 'Choose the guide that matches the workflow you need: Garmin to Suunto activities, COROS to Suunto activities, Suunto routes to Garmin courses, or a centralized Garmin, Suunto, and COROS workout archive.',
    chips: ['Garmin to Suunto', 'COROS to Suunto', 'Suunto routes to Garmin', 'Centralized data', 'Past activity sync', 'Provider setup'],
    actions: [
      routeAction('Garmin to Suunto', '/guides/sync-garmin-to-suunto', 'flat', 'arrow_forward'),
      routeAction('COROS to Suunto', '/guides/sync-coros-to-suunto'),
      routeAction('Suunto Routes to Garmin', '/guides/sync-suunto-routes-to-garmin-courses'),
      routeAction('Centralize Data', '/guides/centralize-garmin-suunto-coros-workout-data'),
    ],
    sections: [
      {
        eyebrow: 'Sync Setup',
        title: 'Choose a guide for the connection you need',
        copy: 'Each guide explains which accounts to connect, how to turn on automatic sync, and how to send activities or saved routes that are already in Quantified Self.',
        items: [
          {
            icon: 'sync_alt',
            title: 'Garmin to Suunto activity sync',
            copy: 'Connect Garmin and Suunto, turn on automatic activity sync, and choose a date range when you want to sync past Garmin activities.',
          },
          {
            icon: 'published_with_changes',
            title: 'COROS to Suunto activity sync',
            copy: 'Connect COROS and Suunto, turn on automatic activity sync, and use the available recent COROS history when syncing past activities.',
          },
          {
            icon: 'route',
            title: 'Send Suunto routes to Garmin',
            copy: 'Connect Suunto and Garmin, allow Course Import in Garmin, and automatically send new and updated Suunto routes to Garmin Connect.',
          },
          {
            icon: 'toggle_on',
            title: 'You control automatic sync',
            copy: 'Automatic sync is always opt-in. You can also send past activities or saved routes without turning on automatic sync.',
          },
        ],
      },
      {
        eyebrow: 'Centralized Archive',
        title: 'Plan the dashboard before you connect everything',
        copy: 'The centralization guide explains how provider imports, manual uploads, source files, benchmark reports, exports, and AI Insights fit together.',
        items: [
          {
            icon: 'hub',
            title: 'Garmin, Suunto, and COROS together',
            copy: 'Centralize Garmin, Suunto, and COROS workout data while preserving provider source context for each activity.',
          },
          {
            icon: 'upload_file',
            title: 'Files when services are not enough',
            copy: 'Use FIT, TCX, GPX, JSON, and SML uploads for unsupported services, review units, lab tests, and custom exports.',
          },
          {
            icon: 'compare_arrows',
            title: 'Analysis after import',
            copy: 'Once data is centralized, use comparison features, benchmark reports, exports, and chart-backed AI questions from the same archive.',
          },
        ],
      },
    ],
    faqItems: [
      {
        question: 'Which guide should I use first?',
        answer: 'Use the Garmin to Suunto or COROS to Suunto guide for activity sync, the Suunto routes to Garmin guide for sending routes to Garmin Connect, and the centralization guide for a private dashboard across providers and uploaded files.',
      },
      {
        question: 'Does automatic activity sync include old workouts?',
        answer: 'No. Automatic sync handles newly imported activities. Use provider history import first, then choose a date range to send past activities to another service.',
      },
      {
        question: 'Where do I find provider-specific setup details?',
        answer: 'Use the integration pages for provider-specific capabilities, permissions, imports, uploads, and troubleshooting, then use these guides for the workflow sequence.',
      },
    ],
    closingTitle: 'Start with the workflow, then connect the services',
    closingCopy: 'Pick the guide that matches what you want to do: sync activities, send saved routes, or bring your training data together for analysis.',
    closingActions: [
      routeAction('All Integrations', '/integrations', 'flat', 'arrow_forward'),
      routeAction('Feature Hub', '/features'),
    ],
  },
  syncGarminToSuunto: {
    key: 'syncGarminToSuunto',
    path: PUBLIC_GUIDE_PATHS.syncGarminToSuunto,
    eyebrow: 'Garmin to Suunto Guide',
    title: 'How to Sync Garmin Data to Suunto Automatically',
    description: 'Learn how to sync Garmin activities to Suunto automatically, connect both accounts, and sync past Garmin activities by date with Quantified Self.',
    h1: 'How to sync Garmin data to Suunto automatically',
    intro: 'Connect Garmin and Suunto, then choose whether new Garmin activities should be sent to Suunto automatically. You can also sync past activities from a date range whenever you need to.',
    chips: ['Garmin', 'Suunto', 'Automatic activity sync', 'Past activity sync', 'Pro'],
    actions: [
      routeAction('Start Setup', '/login', 'flat', 'arrow_forward'),
      routeAction('Garmin Integration', '/integrations/garmin'),
      routeAction('Sync Help', '/help', 'stroked', undefined, 'service-connections'),
    ],
    sections: [
      {
        eyebrow: 'Setup',
        title: 'Choose how Garmin activities are sent to Suunto',
        copy: 'You decide whether new Garmin activities are sent automatically and when past activities should be synced.',
        items: [
          {
            icon: 'login',
            title: 'Connect Garmin and Suunto',
            copy: 'Sign in, connect Garmin, connect Suunto, and allow Activity Export when Garmin asks for permissions.',
          },
          {
            icon: 'toggle_on',
            title: 'Turn on automatic activity sync',
            copy: 'Open Garmin Services and turn on automatic activity sync. New Garmin activities will be sent to Suunto after they reach Quantified Self.',
          },
          {
            icon: 'published_with_changes',
            title: 'Sync past Garmin activities',
            copy: 'Choose a date range to send Garmin activities that are already stored in Quantified Self to Suunto.',
          },
        ],
      },
      {
        eyebrow: 'Expectations',
        title: 'Know what sync does and does not do',
        copy: 'Activity sync uses the original files already saved with your activities and requires both provider connections to be active.',
        items: [
          {
            icon: 'schedule',
            title: 'New imports only',
            copy: 'Automatic sync handles newly imported Garmin activities. Use Sync past activities for workouts that are already in Quantified Self.',
          },
          {
            icon: 'vpn_key',
            title: 'Reconnect if permissions change',
            copy: 'If Garmin or Suunto revokes access, reconnect the provider and turn automatic activity sync back on.',
          },
          {
            icon: 'workspace_premium',
            title: 'Paid-plan automation',
            copy: 'Automatic service connections and cross-service sync require Pro. Manual uploads remain available on the free plan.',
          },
        ],
      },
    ],
    faqItems: [
      {
        question: 'Can I sync Garmin data to Suunto automatically?',
        answer: 'Yes. Connect Garmin and Suunto in Quantified Self and turn on automatic activity sync. New Garmin activities can then be sent to Suunto automatically.',
      },
      {
        question: 'Does Garmin to Suunto sync include my old Garmin history?',
        answer: 'Not automatically. Import your Garmin history first, then use Sync past activities to send activities from a selected date range to Suunto.',
      },
      {
        question: 'Can I sync past activities while automatic sync is off?',
        answer: 'Yes. You can send activities from a selected date range without turning on automatic sync for future activities.',
      },
    ],
    closingTitle: 'Connect both services, then keep Garmin and Suunto aligned',
    closingCopy: 'Use automatic sync for new Garmin activities and Sync past activities for workouts already in your Quantified Self archive.',
    closingActions: [
      routeAction('Garmin Integration', '/integrations/garmin', 'flat', 'arrow_forward'),
      routeAction('All Integrations', '/integrations'),
    ],
    howToSteps: [
      'Connect Garmin to Quantified Self.',
      'Connect Suunto to Quantified Self.',
      'Turn on automatic activity sync in Garmin Services.',
      'Use Sync past activities for existing Garmin activities when needed.',
    ],
  },
  syncCorosToSuunto: {
    key: 'syncCorosToSuunto',
    path: PUBLIC_GUIDE_PATHS.syncCorosToSuunto,
    eyebrow: 'COROS to Suunto Guide',
    title: 'How to Sync COROS Workouts to Suunto Automatically',
    description: 'Learn how to sync COROS activities to Suunto automatically, connect both accounts, and sync past COROS activities by date with Quantified Self.',
    h1: 'How to sync COROS workouts to Suunto automatically',
    intro: 'Connect COROS and Suunto, then choose whether new COROS activities should be sent to Suunto automatically. You can also sync past activities from a date range.',
    chips: ['COROS', 'Suunto', 'Automatic sync', 'Recent history', 'Pro'],
    actions: [
      routeAction('Start Setup', '/login', 'flat', 'arrow_forward'),
      routeAction('COROS Integration', '/integrations/coros'),
      routeAction('Sync Help', '/help', 'stroked', undefined, 'service-connections'),
    ],
    sections: [
      {
        eyebrow: 'Setup',
        title: 'Connect COROS and Suunto before turning on activity sync',
        copy: 'Both accounts must be connected before Quantified Self can send COROS activities to Suunto.',
        items: [
          {
            icon: 'login',
            title: 'Connect both providers',
            copy: 'Connect COROS and Suunto, then confirm both connections are active before enabling cross-service sync.',
          },
          {
            icon: 'toggle_on',
            title: 'Turn on automatic activity sync',
            copy: 'Open COROS Services and turn on automatic activity sync so new COROS activities can be sent to Suunto.',
          },
          {
            icon: 'history',
            title: 'Import recent COROS history',
            copy: 'COROS history import is currently limited to the last 3 months by provider API restrictions.',
          },
        ],
      },
      {
        eyebrow: 'Past Activities',
        title: 'Sync existing activities by date',
        copy: 'Syncing past activities is separate from automatic sync and lets you choose the date range.',
        items: [
          {
            icon: 'published_with_changes',
            title: 'Sync past COROS activities',
            copy: 'Choose a date range in COROS Services to send activities already stored in Quantified Self to Suunto.',
          },
          {
            icon: 'sync_problem',
            title: 'Reconnect when tokens fail',
            copy: 'If COROS or Suunto shows Reconnect required, reconnect before trying automatic activity sync again.',
          },
          {
            icon: 'dashboard_customize',
            title: 'Keep analysis centralized',
            copy: 'Review COROS, Suunto, Garmin, uploaded files, maps, and benchmark reports from the same private dashboard.',
          },
        ],
      },
    ],
    faqItems: [
      {
        question: 'Can COROS workouts sync to Suunto automatically?',
        answer: 'Yes. Connect COROS and Suunto and turn on automatic activity sync. New COROS activities can then be sent to Suunto automatically.',
      },
      {
        question: 'How much COROS history can I import?',
        answer: 'COROS history import is currently limited to the last 3 months because of provider API restrictions.',
      },
      {
        question: 'Does syncing past activities turn on automatic COROS sync?',
        answer: 'No. Sync past activities only sends activities from the date range you choose. It does not turn on automatic sync for future activities.',
      },
    ],
    closingTitle: 'Keep COROS and Suunto connected without losing the archive',
    closingCopy: 'Use Quantified Self as the private hub for COROS to Suunto activity sync, recent history imports, and training analysis.',
    closingActions: [
      routeAction('COROS Integration', '/integrations/coros', 'flat', 'arrow_forward'),
      routeAction('All Integrations', '/integrations'),
    ],
    howToSteps: [
      'Connect COROS to Quantified Self.',
      'Connect Suunto to Quantified Self.',
      'Turn on automatic activity sync in COROS Services.',
      'Use Sync past activities for already imported COROS activities when needed.',
    ],
  },
  syncSuuntoRoutesToGarmin: {
    key: 'syncSuuntoRoutesToGarmin',
    path: PUBLIC_GUIDE_PATHS.syncSuuntoRoutesToGarmin,
    eyebrow: 'Suunto Routes to Garmin Guide',
    title: 'How to Send Suunto Routes to Garmin Courses',
    description: 'Learn how to send Suunto routes to Garmin Connect as courses, connect both accounts, allow Garmin Course Import, and send routes already saved in Quantified Self.',
    h1: 'How to send Suunto routes to Garmin courses',
    intro: 'Quantified Self can send Suunto routes from your private Routes library to Garmin Connect as courses after both accounts are connected and Course Import is allowed in Garmin.',
    chips: ['Suunto routes', 'Garmin courses', 'Course Import', 'Automatic route sending', 'Saved routes'],
    actions: [
      routeAction('Start Setup', '/login', 'flat', 'arrow_forward'),
      routeAction('Suunto Integration', '/integrations/suunto'),
      routeAction('Garmin Integration', '/integrations/garmin'),
      routeAction('Route Files', '/features/fit-gpx-route-files'),
    ],
    sections: [
      {
        eyebrow: 'Setup',
        title: 'Connect Suunto and Garmin before sending routes',
        copy: 'Quantified Self sends routes already saved in your Routes library, and you choose whether new routes should be sent automatically.',
        items: [
          {
            icon: 'login',
            title: 'Connect Suunto',
            copy: 'Connect Suunto so new and updated Suunto routes can be imported into the private Routes library.',
          },
          {
            icon: 'vpn_key',
            title: 'Allow Course Import in Garmin',
            copy: 'Garmin must be connected with Course Import permission before Quantified Self can create or update Garmin courses.',
          },
          {
            icon: 'toggle_on',
            title: 'Send new routes automatically',
            copy: 'Open Suunto Services and turn on automatic route sending so new and updated Suunto routes can be sent to Garmin.',
          },
        ],
      },
      {
        eyebrow: 'Behavior',
        title: 'Use saved route metadata instead of provider downloads',
        copy: 'Route sending uses the route records and original files already stored in Quantified Self.',
        items: [
          {
            icon: 'route',
            title: 'New and updated Suunto routes',
            copy: 'When Quantified Self imports a new or updated Suunto route, it can create or update the matching course in Garmin.',
          },
          {
            icon: 'published_with_changes',
            title: 'Send saved routes now',
            copy: 'Use Send routes to send Suunto routes that are already saved in Quantified Self but have not yet been sent to Garmin.',
          },
          {
            icon: 'sync_problem',
            title: 'Only saved routes are sent',
            copy: 'Sending saved routes does not fetch anything from Suunto or Garmin. Import existing Suunto routes first if one is missing from the Routes library.',
          },
        ],
      },
      {
        eyebrow: 'Sending Routes',
        title: 'Garmin courses are updated instead of duplicated',
        copy: 'Quantified Self remembers which Garmin course belongs to each saved route, so sending it again can update the existing course.',
        items: [
          {
            icon: 'update',
            title: 'Update existing Garmin courses',
            copy: 'If a saved route was already sent to the same Garmin account, sending it again can update that course instead of creating a duplicate.',
          },
          {
            icon: 'shield',
            title: 'Disconnect-safe controls',
            copy: 'Disconnecting Suunto or Garmin turns off automatic route sending until you reconnect and enable it again.',
          },
          {
            icon: 'workspace_premium',
            title: 'Pro route automation',
            copy: 'Automatic provider connections and route sending require Pro. Manual saved-route uploads remain available according to route storage limits.',
          },
        ],
      },
    ],
    faqItems: [
      {
        question: 'Can Suunto routes sync to Garmin courses automatically?',
        answer: 'Yes. Connect Suunto and Garmin, allow Course Import in Garmin, and turn on automatic route sending in Suunto Services. New and updated Suunto routes can then be sent to Garmin as courses.',
      },
      {
        question: 'Does Send routes fetch routes from Suunto?',
        answer: 'No. Send routes only uses Suunto routes already saved in Quantified Self. Import existing Suunto routes first if a route is not yet in the Routes library.',
      },
      {
        question: 'Will sending a route again create a duplicate Garmin course?',
        answer: 'Quantified Self remembers the Garmin course for each saved route and account, so later sends can update the same course when possible.',
      },
      {
        question: 'What Garmin permission is required?',
        answer: 'Garmin Course Import permission is required. If it is missing, reconnect Garmin and allow Course Import in Garmin Connect before sending routes.',
      },
    ],
    closingTitle: 'Import Suunto routes once, then send them to Garmin when needed',
    closingCopy: 'Use Quantified Self as the private route library between Suunto route imports, manual route files, and Garmin Connect.',
    closingActions: [
      routeAction('Suunto Integration', '/integrations/suunto', 'flat', 'arrow_forward'),
      routeAction('Garmin Integration', '/integrations/garmin'),
      routeAction('Route Files', '/features/fit-gpx-route-files'),
    ],
    howToSteps: [
      'Connect Suunto to Quantified Self.',
      'Connect Garmin to Quantified Self and allow Course Import.',
      'Import existing Suunto routes so they are saved in Quantified Self.',
      'Turn on automatic route sending in Suunto Services if you want new routes sent automatically.',
      'Use Send routes for Suunto routes already saved in Quantified Self.',
    ],
  },
  centralizeWorkoutData: {
    key: 'centralizeWorkoutData',
    path: PUBLIC_GUIDE_PATHS.centralizeWorkoutData,
    eyebrow: 'Training Data Hub',
    title: 'Centralize Garmin, Suunto, and COROS Workout Data',
    description: 'Centralize Garmin, Suunto, and COROS workout data in one private training dashboard with source files, manual uploads, provider sync, benchmark reports, exports, and AI Insights.',
    h1: 'Centralize Garmin, Suunto, and COROS workout data',
    intro: 'Use Quantified Self as the private training hub when your workouts, source files, routes, and analysis are spread across Garmin, Suunto, COROS, and exported activity files.',
    chips: ['Garmin', 'Suunto', 'COROS', 'Source files', 'Exports', 'Benchmarks'],
    actions: [
      routeAction('Explore Integrations', '/integrations', 'flat', 'arrow_forward'),
      routeAction('Compare Workout Data', '/features/workout-data-comparison'),
      routeAction('Start Free', '/login'),
    ],
    sections: [
      {
        eyebrow: 'Archive',
        title: 'Keep each provider useful without making one provider the source of truth',
        copy: 'Centralizing data gives you one place to inspect activities while still preserving where each workout came from.',
        items: [
          {
            icon: 'hub',
            title: 'Provider-aware history',
            copy: 'Review Garmin, Suunto, COROS, and manually uploaded activities in one account with source context intact.',
          },
          {
            icon: 'file_download',
            title: 'Original files and exports',
            copy: 'Keep original source files useful for downloads, reprocessing, sending activities to Suunto, and benchmark comparisons.',
          },
          {
            icon: 'dashboard_customize',
            title: 'One private dashboard',
            copy: 'Use one dashboard for maps, routes, load, readiness, sleep context, file uploads, benchmark reports, and AI Insights.',
          },
        ],
      },
      {
        eyebrow: 'Workflows',
        title: 'Use sync, files, and analysis together',
        copy: 'The same activity archive can support automatic imports, cross-service sync, manual uploads, and device comparisons.',
        items: [
          {
            icon: 'sync_alt',
            title: 'Cross-service sync',
            copy: 'Set up Garmin to Suunto or COROS to Suunto activity sync when Suunto should receive newly imported activities.',
          },
          {
            icon: 'upload_file',
            title: 'Manual uploads',
            copy: 'Add FIT, TCX, GPX, JSON, and SML files when a provider does not support direct sync or a test file lives outside your normal account.',
          },
          {
            icon: 'compare_arrows',
            title: 'Benchmark reports',
            copy: 'Compare activities from different services or files when devices disagree on GPS, heart rate, power, cadence, distance, or duration.',
          },
        ],
      },
    ],
    faqItems: [
      {
        question: 'Can I centralize Garmin, Suunto, and COROS workout data?',
        answer: 'Yes. Quantified Self is designed to keep Garmin, Suunto, COROS, and uploaded activity files in one private training dashboard.',
      },
      {
        question: 'Do I have to connect every service?',
        answer: 'No. You can start with manual uploads on the free plan, then connect provider services when you need automatic sync, history imports, or cross-service routes.',
      },
      {
        question: 'Can centralized data also be used for device comparison?',
        answer: 'Yes. Once activities are in the same archive, compatible recordings can be used for benchmark reports and workout data comparison.',
      },
    ],
    closingTitle: 'Build the archive first, then choose the workflows you need',
    closingCopy: 'Start with the providers and files you already use, then add activity sync, uploads, benchmark reports, and AI Insights as your training archive grows.',
    closingActions: [
      routeAction('All Integrations', '/integrations', 'flat', 'arrow_forward'),
      routeAction('Workout File Comparison', '/features/workout-file-comparison'),
    ],
    howToSteps: [
      'Connect the providers you use or upload supported activity files.',
      'Import history or recent activities into Quantified Self.',
      'Turn on cross-service activity sync only when you want future activities sent to Suunto.',
      'Use dashboard, export, AI Insights, and benchmark workflows from the centralized archive.',
    ],
  },
};

function buildJsonLd(page: PublicSeoPage): Record<string, unknown> {
  const mainEntity: Record<string, unknown>[] = [
    {
      '@type': 'SoftwareApplication',
      name: 'Quantified Self',
      applicationCategory: 'HealthApplication',
      operatingSystem: 'Web',
      featureList: [
        ...page.sections.flatMap(section => section.items.map(item => item.title)),
        ...page.chips,
      ],
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
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
  ];

  if (page.howToSteps?.length) {
    mainEntity.unshift({
      '@type': 'HowTo',
      name: page.h1,
      step: page.howToSteps.map((step, index) => ({
        '@type': 'HowToStep',
        position: index + 1,
        name: step,
        text: step,
      })),
    });
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.h1,
    description: page.description,
    url: pageUrl(page.path),
    inLanguage: 'en',
    isPartOf: {
      '@type': 'WebSite',
      name: 'Quantified Self',
      url: SITE_ORIGIN,
    },
    about: [
      page.h1,
      ...page.chips,
      ...page.sections.map(section => section.title),
    ],
    mainEntity,
  };
}

function buildRouteData(page: PublicSeoPage): PublicSeoRouteData {
  return {
    title: page.title,
    preload: true,
    animation: 'PublicSeo',
    description: page.description,
    publicSeoPage: page,
    jsonLd: buildJsonLd(page),
  };
}

export const PUBLIC_SEO_ROUTE_DATA: Record<PublicSeoPageKey, PublicSeoRouteData> = {
  featuresHub: buildRouteData(PUBLIC_SEO_PAGES.featuresHub),
  aiInsights: buildRouteData(PUBLIC_SEO_PAGES.aiInsights),
  workoutFileComparison: buildRouteData(PUBLIC_SEO_PAGES.workoutFileComparison),
  fitGpxTcxFileAnalyzer: buildRouteData(PUBLIC_SEO_PAGES.fitGpxTcxFileAnalyzer),
  routeFiles: buildRouteData(PUBLIC_SEO_PAGES.routeFiles),
  sportsWatchBenchmark: buildRouteData(PUBLIC_SEO_PAGES.sportsWatchBenchmark),
  guidesHub: buildRouteData(PUBLIC_SEO_PAGES.guidesHub),
  syncGarminToSuunto: buildRouteData(PUBLIC_SEO_PAGES.syncGarminToSuunto),
  syncCorosToSuunto: buildRouteData(PUBLIC_SEO_PAGES.syncCorosToSuunto),
  syncSuuntoRoutesToGarmin: buildRouteData(PUBLIC_SEO_PAGES.syncSuuntoRoutesToGarmin),
  centralizeWorkoutData: buildRouteData(PUBLIC_SEO_PAGES.centralizeWorkoutData),
};
