import { ASSISTANT_REQUEST_LIMITS, ROUTE_USAGE_LIMITS, USAGE_LIMITS } from '@shared/limits';
import {
  PUBLIC_FEATURE_PATHS,
  PUBLIC_GUIDE_PATHS,
} from './public-seo-pages.paths';
import type { PublicSeoPageKey } from './public-seo-pages.paths';

export {
  PUBLIC_FEATURE_PATHS,
  PUBLIC_GUIDE_PATHS,
} from './public-seo-pages.paths';
export type { PublicSeoPageKey } from './public-seo-pages.paths';

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

const SITE_ORIGIN = 'https://quantified-self.io';
const STARTER_ACTIVITY_LIMIT = USAGE_LIMITS.free;
const STARTER_ROUTE_LIMIT = ROUTE_USAGE_LIMITS.free;
const FREE_ASSISTANT_REQUEST_LIMIT = ASSISTANT_REQUEST_LIMITS.free;

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
    description: 'Explore an activity calendar, training analysis, the grounded Quantified Self Assistant, read-only MCP access, workout file comparison, FIT/GPX/TCX tools, sports watch benchmark reports, and a private dashboard.',
    h1: 'Features for endurance training data',
    intro: 'Use Quantified Self to centralize provider activities, uploaded files, and saved routes, review workout history in an activity calendar, analyze training context, compare recordings, benchmark devices, and ask questions through the built-in Assistant or an MCP client you explicitly authorize.',
    chips: ['Activity calendar', 'Training analysis', 'Assistant', 'MCP server', 'Workout comparison', 'Route files', 'Benchmarks'],
    actions: [
      routeAction('Training Analysis', '/features/training-analysis', 'flat', 'arrow_forward'),
      routeAction('Activity Calendar', '/features/activity-calendar'),
      routeAction('MCP Server', '/features/mcp-server'),
      routeAction('Assistant', '/features/ai-insights'),
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
            icon: 'calendar_month',
            title: 'Activity calendar',
            copy: 'Scan Week, Month, and Year views with duration-scaled activity circles, period totals, activity-group bars, and day details.',
          },
          {
            icon: 'monitoring',
            title: 'Training analysis',
            copy: 'Compare current training with your usual workload, then inspect readiness, load, intensity, durability, sleep context, and selected historical builds.',
          },
          {
            icon: 'auto_awesome',
            title: 'Grounded Assistant',
            copy: `Ask follow-up questions about sleep, readiness, Training, measurements, and activities through the same validated read-only tools used by MCP. Free accounts include ${FREE_ASSISTANT_REQUEST_LIMIT} requests per calendar month.`,
          },
          {
            icon: 'devices',
            title: 'Read-only MCP access',
            copy: 'Authorize ChatGPT or another compatible MCP client to read only the activity metrics, Training analysis, activity details, sleep summaries, or saved routes you approve.',
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
            copy: 'Put Garmin, Suunto, COROS, Wahoo, service exports, and one-off test files in the same comparison workflow without making one provider the source of truth.',
          },
        ],
      },
    ],
    faqItems: [
      {
        question: 'What is the Training workspace?',
        answer: 'Training is a curated analysis workspace for current versus usual workload, readiness context, load trends, intensity, durability, swimming pace, and selected historical build comparisons. Dashboard remains the configurable workspace.',
      },
      {
        question: 'What Quantified Self features should I start with?',
        answer: 'Start with the activity calendar for a visual workout history, integrations for provider sync, workout file comparison for exported files, sports watch benchmarks for device evidence, the Assistant for built-in grounded answers, or the MCP server when you want to use a compatible external client with explicitly approved read-only data.',
      },
      {
        question: 'Can I compare custom files and provider data?',
        answer: 'Yes. Quantified Self can compare compatible Garmin, Suunto, COROS, Wahoo, and uploaded FIT, TCX, GPX, JSON, and SML activity data in the same private dashboard.',
      },
      {
        question: 'Which features are available on the free plan?',
        answer: `Manual uploads, core analysis, benchmark comparisons, and ${FREE_ASSISTANT_REQUEST_LIMIT} Assistant requests per calendar month are available on the free plan. Automatic provider sync and higher limits require a paid plan.`,
      },
    ],
    closingTitle: 'Choose the feature that matches the data problem',
    closingCopy: 'Use the hub when you are deciding between a visual activity calendar, curated training analysis, built-in AI analysis, read-only MCP access, file comparison, device benchmarks, provider sync, and centralized workout history.',
    closingActions: [
      routeAction('Explore Integrations', '/integrations', 'flat', 'arrow_forward'),
      routeAction('Training Guides', '/guides'),
    ],
  },
  activityCalendar: {
    key: 'activityCalendar',
    path: PUBLIC_FEATURE_PATHS.activityCalendar,
    eyebrow: 'Activity Calendar',
    title: 'Activity Calendar for Endurance Training',
    description: 'Review running, cycling, swimming, skiing, and other workouts in Week, Month, and Year calendar views with duration-scaled circles and period totals.',
    h1: 'Activity calendar for endurance training',
    intro: 'Turn Garmin, Suunto, COROS, Wahoo, and uploaded workout history into a private visual calendar. Move between Week, Month, and Year views, scan duration-scaled activity groups, and open any active day for its recorded workouts.',
    chips: ['Week view', 'Month view', 'Year view', 'Duration circles', 'Distance and ascent', 'Private activity data'],
    actions: [
      routeAction('Start Free', '/login', 'flat', 'arrow_forward'),
      routeAction('Open Calendar', '/calendar', 'stroked', 'calendar_month'),
      routeAction('Calendar Help', '/help', 'stroked', undefined, 'activity-calendar'),
    ],
    sections: [
      {
        eyebrow: 'Visual History',
        title: 'Scan training days at the scale you need',
        copy: 'The calendar keeps the same activity-group language from the dashboard while adapting its layout to the available space.',
        items: [
          {
            icon: 'date_range',
            title: 'Week, Month, and Year views',
            copy: 'Move one week, month, or year at a time, return to today, and keep the selected view and date in the URL.',
          },
          {
            icon: 'bubble_chart',
            title: 'Duration-scaled activity circles',
            copy: 'Colors identify activity groups and circle size reflects recorded duration. Compact calendars place multiple groups concentrically around one center.',
          },
          {
            icon: 'event_note',
            title: 'Day activity details',
            copy: 'Select an active day to review its total duration, activity-group totals, and individual workouts without leaving calendar context.',
          },
        ],
      },
      {
        eyebrow: 'Period Context',
        title: 'Read totals and activity mix below the calendar',
        copy: 'The selected period has its own summary and duration comparison, independent from dashboard event-search filters and custom tile ranges.',
        items: [
          {
            icon: 'analytics',
            title: 'Distance, duration, and ascent',
            copy: 'Read selected-period totals above the calendar in your preferred units. Adjacent dates shown only to complete a month grid do not change month totals.',
          },
          {
            icon: 'bar_chart',
            title: 'Activity-group duration bars',
            copy: 'Each bar compares one group with the longest recorded group in the period. Available duration, distance, ascent, and descent totals appear beneath it.',
          },
          {
            icon: 'tune',
            title: 'Your week and summary settings',
            copy: 'Weekday order follows the configured start of week, units follow account preferences, and ascent or descent exclusions also apply to calendar summaries.',
          },
        ],
      },
    ],
    faqItems: [
      {
        question: 'Which activities appear in the calendar?',
        answer: 'The calendar uses normal activity events already imported or uploaded to your private Quantified Self account. Merge and benchmark records are excluded so comparison artifacts do not inflate training days or totals.',
      },
      {
        question: 'What do the calendar circle colors and sizes mean?',
        answer: 'Color identifies the activity group, such as Running, Cycling, Mountain Biking, Swimming, or Indoor Sports. Size reflects recorded duration, with a bounded scale so long activities remain readable.',
      },
      {
        question: 'Does the activity calendar follow the dashboard event search?',
        answer: 'No. The full calendar queries its visible week, month, or year independently. The dashboard calendar tile also loads its own current-month window rather than reusing event-table search results.',
      },
      {
        question: 'Can I change the first day of the week and measurement units?',
        answer: 'Yes. Start of week and unit preferences come from Settings. Weekend columns remain identifiable, and the selected start day is marked in the weekday header.',
      },
    ],
    closingTitle: 'See the rhythm behind the activity list',
    closingCopy: 'Start with the current month, open a day for individual workouts, then move to Week or Year when you need a tighter or broader view of training consistency.',
    closingActions: [
      routeAction('Start Free', '/login', 'flat', 'arrow_forward'),
      routeAction('Open Calendar', '/calendar', 'stroked', 'calendar_month'),
      routeAction('Training Analysis', '/features/training-analysis'),
    ],
  },
  trainingAnalysis: {
    key: 'trainingAnalysis',
    path: PUBLIC_FEATURE_PATHS.trainingAnalysis,
    eyebrow: 'Training Analysis',
    title: 'Training Analysis for Endurance Athletes',
    description: 'Analyze eight sport families—from running, cycling, swimming, and rowing to walking and hiking, Nordic skiing, strength, and paddling—with readiness, load trends, intensity, durability, sleep context, and historical build comparisons, all through context-aware summaries.',
    h1: 'Training analysis for endurance athletes',
    intro: 'Training is a curated workspace for understanding your current workload in context: compare it with your usual training, see what changed, and inspect the evidence behind readiness, performance, and long-session durability.',
    chips: ['Training readiness', 'Eight sport families', 'Gravity MTB', 'Context summaries', 'Durability', 'Best build'],
    actions: [
      routeAction('Start Free', '/login', 'flat', 'arrow_forward'),
      routeAction('Open Training', '/training'),
      routeAction('Training Help', '/help', 'stroked', undefined, 'getting-started'),
    ],
    sections: [
      {
        eyebrow: 'Current Context',
        title: 'See the training pattern, not just the latest workout',
        copy: 'Training turns already imported or uploaded activity data into a readable current-versus-usual picture. It is context for your decisions, not a workout prescription or medical score.',
        items: [
          {
            icon: 'compare_arrows',
            title: '28-day training comparison',
            copy: 'Compare current sessions and training time with a normalized preceding 84-day reference, with unavailable data kept explicit instead of shown as zero.',
          },
          {
            icon: 'monitor_heart',
            title: 'Readiness and recovery context',
            copy: 'Review current load alongside recorded sleep, HRV, and overnight heart-rate evidence when those signals are available from connected providers.',
          },
          {
            icon: 'account_tree',
            title: 'What drove the change',
            copy: 'See parent-event load, top contributors, sport-specific load changes, and training rhythm without hiding other eligible sports from the overall explanation.',
          },
        ],
      },
      {
        eyebrow: 'Discipline Evidence',
        title: 'Keep sport-specific evidence in the right context',
        copy: 'Eight conservative sport families keep materially different contexts separate, including individual registered legs from multisport activities.',
        items: [
          {
            icon: 'directions_run',
            title: 'Power and capacity evidence',
            copy: 'Inspect imported Running and Cycling FTP/VO₂ max provenance, power-profile retention, and exact-type CP, W′, and Pmax capacity from the preceding 42 completed UTC days where stored power curves support it.',
          },
          {
            icon: 'pool',
            title: 'Pool and open-water swimming',
            copy: 'Review twelve weeks of pool and open-water pace separately, with comparable SWOLF context when active swim lengths provide it.',
          },
          {
            icon: 'show_chart',
            title: 'Context-aware sport summaries',
            copy: 'Keep indoor and on-water rowing, snow and roller skiing, walking and hiking, paddling types, and gravity MTB contexts separate. Downhill and Enduro use recorded volume, descent, jump count, and longest-jump evidence without invented run segmentation.',
          },
        ],
      },
      {
        eyebrow: 'Historical Evidence',
        title: 'Compare a build deliberately, then keep limitations visible',
        copy: 'The workspace favors comparable evidence over oversized charts or invented estimates, so a historical reference and long-session trend remain understandable.',
        items: [
          {
            icon: 'history',
            title: 'Best build vs now',
            copy: 'Choose one 8-, 10-, or 12-week historical benchmark per sport and compare workload, intensity, available sleep context, and matching durability evidence.',
          },
          {
            icon: 'trending_down',
            title: 'Long-session durability',
            copy: 'Track eligible steady aerobic sessions with matching output and heart-rate evidence. Weeks without comparable sessions explain why they are unavailable.',
          },
          {
            icon: 'visibility_off',
            title: 'Honest missing-data states',
            copy: 'Missing TSS, zones, power, heart rate, pace, sleep, and durability evidence stays unavailable rather than becoming a misleading zero or generic score.',
          },
        ],
      },
    ],
    faqItems: [
      {
        question: 'What data does Training use?',
        answer: 'Training uses derived snapshots built from activities already imported or uploaded to your private Quantified Self account. The browser does not reparse source files or query raw activity history to calculate the workspace.',
      },
      {
        question: 'Which sports does Training support?',
        answer: 'Training supports eight conservative families: Running; Cycling including road, indoor, virtual, e-bike, standard MTB, Enduro, and Downhill; Pool and Open Water Swimming; indoor and on-water Rowing; Walking and Hiking; Nordic and Roller Skiing; Strength; and Paddling. Multisport files are split into their registered activity legs when available. Nearby unlisted sports remain Other rather than being guessed into a family.',
      },
      {
        question: 'Does Training tell me what workout to do?',
        answer: 'No. Training presents load, readiness, sleep, and performance evidence as context. It does not prescribe workouts, diagnose health conditions, or turn missing data into a recommendation.',
      },
      {
        question: 'How is Training different from the Dashboard?',
        answer: 'Dashboard remains the configurable place for charts, maps, and tiles. Training is a fixed, curated analytical workspace that combines related evidence into a consistent current, historical, and discipline-specific view.',
      },
    ],
    closingTitle: 'Start with the work you already recorded',
    closingCopy: 'Connect the services you use or upload activity files, then open Training to see your current workload in context without changing your Dashboard layout.',
    closingActions: [
      routeAction('Start Free', '/login', 'flat', 'arrow_forward'),
      routeAction('Explore Integrations', '/integrations'),
      routeAction('Training Help', '/help', 'stroked', undefined, 'getting-started'),
    ],
  },
  mcpServer: {
    key: 'mcpServer',
    path: PUBLIC_FEATURE_PATHS.mcpServer,
    eyebrow: 'MCP Server',
    title: 'Read-only MCP Server for Training Data',
    description: 'Connect ChatGPT and compatible MCP clients to activity metrics, body-weight history, Training analysis, sleep summaries, activity details, and saved routes through a read-only MCP server.',
    h1: 'Connect ChatGPT to your training data with a read-only MCP server',
    intro: 'Connect ChatGPT or another compatible Model Context Protocol client to Quantified Self, approve only the read-only data categories you want it to use, and ask questions about your training history without exposing your entire account by default.',
    chips: ['MCP server', 'ChatGPT', 'Read-only', 'Activity metrics', 'Body weight', 'Sleep summaries', 'Saved routes'],
    actions: [
      routeAction('Start Free', '/login', 'flat', 'arrow_forward'),
      routeAction('Set Up MCP', '/help', 'stroked', undefined, 'data-and-privacy'),
      routeAction('Read Access Policy', '/policies', 'stroked', undefined, 'mcp-clients'),
    ],
    sections: [
      {
        eyebrow: 'Training Questions',
        title: 'Ask about metrics, individual activities, sleep, and routes',
        copy: 'The server exposes bounded tools for discovery and analysis. Every result is projected through the permissions you approve instead of returning raw account documents.',
        items: [
          {
            icon: 'monitoring',
            title: 'Activity, body measurement, and Training analysis',
            copy: 'Discover available activity metrics, query bounded identity-free body-weight history by day, week, or month, and inspect ready Training analysis such as load, readiness, intensity, durability, and sport-specific evidence.',
          },
          {
            icon: 'directions_run',
            title: 'Individual activity details and charts',
            copy: 'Discover canonical Sports Lib activity types, filter bounded newest-first scans for requests such as your latest run, resolve today or yesterday in an explicit IANA timezone, and inspect summaries, laps, swim lengths, MTB jumps, app links, selected numeric metrics, or bounded chart-ready data. Metric ranking supports explicit periods or a processing-bounded all-history scan, so a client can use the relevant persisted maximum-jump metric as the authoritative record and request individual jump details only when needed.',
          },
          {
            icon: 'bedtime',
            title: 'Sleep trends, live readiness, and a daily report',
            copy: 'Ask for one bounded sleep trend that combines recorded-vital coverage with duration, score, stages, HRV, heart rate, blood oxygen, and respiration across daily, weekly, or monthly buckets. With both sleep and Training-metrics permission, ask for one daily report with your latest completed sleep, recorded aggregate HRV and sleep heart rate, Dashboard Today’s live UTC-day Readiness, and current-versus-usual 28-day Training totals and sport mix. It keeps readiness concise and exposes safe same-provider baselines and evidence states without returning provider identity, raw physiological samples, a workout plan, diagnosis, or medical advice.',
          },
          {
            icon: 'route',
            title: 'Saved-route summaries and optional locations',
            copy: 'Filter bounded newest-first route scans by canonical activity type or route-name text, then read names, metrics, counts, and timestamps. A separate saved-route location permission enables exact bounds, simplified geometry, nearby search, segment endpoints, and waypoints.',
          },
        ],
      },
      {
        eyebrow: 'Access Boundaries',
        title: 'Read-only by design, with separate permissions',
        copy: 'MCP access uses an authorization flow designed for external clients. The client receives only the scopes you approve and can be disconnected from Connections.',
        items: [
          {
            icon: 'fact_check',
            title: 'Separate optional scopes',
            copy: 'Activity and Training metrics, body measurements, individual activity details, activity locations, sleep summaries, saved-route summaries, and saved-route locations are explicit grants. Each location scope depends on its matching data scope, and the activity and route location domains remain independent.',
          },
          {
            icon: 'lock',
            title: 'No settings or data writes',
            copy: 'MCP clients cannot create, edit, or delete activities, routes, sleep records, dashboard settings, or Training state. Revocation blocks future access.',
          },
          {
            icon: 'shield',
            title: 'Safe projections and location warnings',
            copy: 'Original files, full-resolution recordings, absolute sample timestamps, unrequested streams, provider credentials, source keys, and device provenance are excluded. Exact coordinates appear only under the matching location permission.',
          },
          {
            icon: 'location_searching',
            title: 'Coordinate or place-name search',
            copy: 'Direct-coordinate searches stay within Quantified Self. For a place-name search, only the supplied location text is sent to Mapbox for geocoding—not your activity, route, account, or unrelated prompt data.',
          },
        ],
      },
    ],
    faqItems: [
      {
        question: 'What does the Quantified Self MCP server do?',
        answer: 'It gives a compatible external client a bounded, read-only way to discover and query approved Quantified Self activity metrics, body-weight history, Training analysis, individual activity details, sleep summaries, and saved routes.',
      },
      {
        question: 'Can I use the MCP server with ChatGPT?',
        answer: 'Yes. Add https://quantified-self.io/mcp as a custom app endpoint in ChatGPT, sign in to Quantified Self, and approve the read-only permissions you want to grant. ChatGPT is an external client with its own privacy and retention practices.',
      },
      {
        question: 'Can an MCP client rearrange my dashboard or change my data?',
        answer: 'No. The MCP server is read-only. It cannot write dashboard settings, activities, routes, Training state, or sleep records.',
      },
      {
        question: 'Does MCP access expose my original activity or route files?',
        answer: 'No. An activity chart may selectively parse an existing original file in memory, but the file itself, full-resolution recording, absolute sample timestamps, unrequested streams, provider payloads, credentials, and storage paths are not returned or copied into another activity store.',
      },
      {
        question: 'Can an MCP client see exact locations?',
        answer: 'Only if you separately approve Activity locations or Saved-route locations and geometry. Activity location covers starts, ends, MTB jumps, nearby activity search, and optional breadcrumbs. Route location covers bounds, previews, segment endpoints, nearby route search, and waypoints. Granting one never exposes the other.',
      },
    ],
    closingTitle: 'Choose the data scopes, then keep control',
    closingCopy: 'Create an account, connect the training sources you use, and authorize only the MCP permissions needed for the questions you want to ask. Review or revoke completed client connections at any time.',
    closingActions: [
      routeAction('Start Free', '/login', 'flat', 'arrow_forward'),
      routeAction('MCP Setup Guide', '/help', 'stroked', undefined, 'data-and-privacy'),
      routeAction('MCP Client Policy', '/policies', 'stroked', undefined, 'mcp-clients'),
    ],
  },
  assistant: {
    key: 'assistant',
    path: PUBLIC_FEATURE_PATHS.assistant,
    eyebrow: 'Quantified Self Assistant',
    title: 'AI Training Assistant Grounded in Your Fitness Data',
    description: `Chat with the built-in fitness-data Assistant grounded in read-only Quantified Self tools for sleep, HRV, readiness, Training, body measurements, activities, saved-route summaries, and optional interactive charts or activity maps. Free accounts include ${FREE_ASSISTANT_REQUEST_LIMIT} requests per calendar month.`,
    h1: 'A fitness-data Assistant grounded in your own history',
    intro: `Ask follow-up questions about sleep, overnight HRV, readiness, Training load, body measurements, recent activities, or saved routes. The Assistant chooses bounded read-only tools, shows the results that grounded each answer, and can add a deterministic chart or opt-in activity map when it clarifies the result. Free accounts include ${FREE_ASSISTANT_REQUEST_LIMIT} requests per calendar month.`,
    chips: ['Sleep & HRV', 'Readiness', 'Training', 'Measurements', 'Activities', 'Charts & maps', 'Saved routes'],
    actions: [
      routeAction('Open Assistant', '/ai-insights', 'flat', 'arrow_forward'),
      routeAction('View Membership', '/pricing'),
      routeAction('Assistant Help', '/help', 'stroked', undefined, 'ai-insights'),
    ],
    sections: [
      {
        eyebrow: 'Conversational analysis',
        title: 'Ask naturally, then follow up',
        copy: 'The built-in Assistant uses the same validated MCP server foundation without making you install another client. It is coordinate-free by default, with explicit per-chat access to precise activity locations.',
        items: [
          {
            icon: 'bedtime',
            title: 'Sleep and recovery context',
            copy: 'Ask about duration, stages, overnight HRV, sleeping heart rate, SpO2, respiration, trends, readiness, and missing-data coverage.',
          },
          {
            icon: 'monitoring',
            title: 'Training and activity context',
            copy: 'Compare current load, Form, ramp, volume, intensity, and recent workouts with the ready Training snapshots already used in the app. For MTB jump records, the Assistant ranks the relevant persisted maximum-jump metric across matching activities instead of guessing from jump count or a recent sample, and reads individual jump details only when requested.',
          },
          {
            icon: 'scale',
            title: 'Measurements and trends',
            copy: 'Query first-class body measurements such as weight over explicit date ranges instead of hiding them among activity metrics.',
          },
          {
            icon: 'route',
            title: 'Saved-route summaries',
            copy: 'Find recent saved routes by sport, name, or recency while coordinate fields, saved bounds, geometry, and waypoints stay unavailable. Route names may contain place information.',
          },
          {
            icon: 'monitoring',
            title: 'Deterministic charts and activity maps',
            copy: 'When a visual materially helps, the answer can include an interactive chart built from validated measurement, sleep, Training, metric, ranking, jump, or workout-chart results. A map rendered with the user’s separate Assistant map style can use only activity coordinates already allowed by the current precise-location chat; Gemini selects a safe source while Quantified Self owns every plotted value, coordinate, label, and renderer setting.',
          },
        ],
      },
      {
        eyebrow: 'Grounding and privacy',
        title: 'Bounded tools, visible evidence, short retention',
        copy: 'Each current answer must use at least one validated read-only result. The app shows compact evidence instead of asking you to trust an unsupported narrative.',
        items: [
          {
            icon: 'fact_check',
            title: 'Grounded every turn',
            copy: 'Answers must call a current Quantified Self tool. Missing values remain missing, and the response must distinguish recorded facts from interpretation.',
          },
          {
            icon: 'location_on',
            title: 'Precise activity locations stay opt-in',
            copy: 'Activity start/end, chart breadcrumbs, and MTB jump coordinates stay redacted by default. You can start a fresh chat with precise activity locations enabled for location-relevant questions, activity maps, and nearby activity searches. Opening a map sends the displayed tile area to Mapbox, regardless of the selected Assistant map style. Saved-route bounds, route geometry, waypoints, original files, write tools, and dashboard settings remain unavailable.',
          },
          {
            icon: 'timer',
            title: 'Short-lived conversation',
            copy: 'Only the latest six completed turns are retained in one server-owned active conversation. It becomes unavailable about seven days after the latest completed turn or reset; a response already in progress can protect an imminent expiry for at most four extra minutes. Firestore TTL deletes it asynchronously, and New chat clears it immediately.',
          },
        ],
      },
    ],
    faqItems: [
      {
        question: 'What can the Quantified Self Assistant answer?',
        answer: 'It can use bounded read-only tools for daily reports, readiness, sleep and recorded vitals, Training metrics, body measurements, activity metrics, recent activities, laps, jumps, swim lengths, bounded workout charts, and coordinate-free saved-route summaries. It can show deterministic charts from those results. Exact activity start/end, chart breadcrumbs, MTB jump locations, nearby activity search, and activity maps are available only after you explicitly enable precise activity locations for a fresh chat.',
      },
      {
        question: 'Does the Assistant send raw files or route locations to Gemini?',
        answer: 'No raw files or saved-route locations are sent. Along with your message, browser timezone, and bounded recent conversation context, Gemini receives the validated read-only tool results selected for the current question. Results are coordinate-free by default. If you explicitly enable precise activity locations for a fresh chat, those results may include exact activity start/end and MTB jump coordinates, bounded chart breadcrumbs, or nearby activity matches. Place-name searches send only the location text to Mapbox; opening a satellite map separately sends its displayed tile area to Mapbox. Coordinate-free saved-route summaries may include route names with place information, but saved bounds, route geometry, and waypoints remain unavailable. Direct in-app URLs are withheld, and opaque references cannot be returned in an answer.',
      },
      {
        question: 'Is the Assistant available on the free plan?',
        answer: `Yes. Free accounts include up to ${FREE_ASSISTANT_REQUEST_LIMIT} Assistant requests per calendar month. Basic and Pro increase the request limits.`,
      },
      {
        question: 'Can I still use ChatGPT through MCP?',
        answer: 'Yes. External MCP connections remain the advanced bring-your-own-AI path, with separate permissions including optional route and location access. External client usage does not consume the in-app Assistant allowance.',
      },
    ],
    closingTitle: 'Start with today, then ask why',
    closingCopy: 'Open with a daily report or a focused sleep, Training, measurement, activity, or saved-route question, then use follow-ups and deterministic visuals to compare the evidence over time.',
    closingActions: [
      routeAction('Open Assistant', '/ai-insights', 'flat', 'arrow_forward'),
      routeAction('Assistant Help', '/help', 'stroked', undefined, 'ai-insights'),
      routeAction('External MCP Overview', '/features/mcp-server', 'stroked', 'extension'),
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
    title: 'FIT and GPX Route Files with Multi-Provider Delivery',
    description: `Save FIT course files and GPX route or track files in a private route library, send saved routes to Suunto, Garmin Connect, or Wahoo, use pilot COROS route delivery when approved, import Suunto routes into Routes, and use free-plan storage for up to ${STARTER_ROUTE_LIMIT} saved routes.`,
    h1: 'Save FIT and GPX route files, then send them to connected services',
    intro: `Upload route-only FIT course files or GPX route/track files, keep the original file attached, send saved routes to Suunto, Garmin Connect, or Wahoo, and import new or existing Suunto routes into a private dashboard. Saved-route storage is free for up to ${STARTER_ROUTE_LIMIT} routes; provider delivery requires Pro and a connected destination account, Garmin also requires Course Import permission, and COROS delivery is currently limited to approved pilot accounts.`,
    chips: ['FIT course files', 'GPX route/track files', 'Suunto route sync', 'Garmin course send', 'Wahoo route send', 'COROS route pilot'],
    actions: [
      routeAction('Start Free', '/login', 'flat', 'arrow_forward'),
      routeAction('Garmin Integration', '/integrations/garmin', 'stroked', 'route'),
      routeAction('Suunto Integration', '/integrations/suunto', 'stroked', 'published_with_changes'),
      routeAction('COROS Integration', '/integrations/coros', 'stroked', 'route'),
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
        title: 'Move routes between Quantified Self and connected services',
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
            icon: 'near_me',
            title: 'Send saved routes to Wahoo or pilot COROS accounts',
            copy: 'Use the Routes table or bulk actions to send FIT- or GPX-backed routes to Wahoo. Approved COROS route-pilot accounts also see COROS in the table, bulk actions, and route detail menu.',
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
        question: 'Can I send saved routes to Wahoo or COROS?',
        answer: 'Wahoo route delivery is available with Pro and a connected account. COROS route delivery is currently limited to approved pilot accounts while production route-push permission is verified.',
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
    closingCopy: 'Use Routes when you have a planned course, GPX route, provider route target, or device route file that should stay attached to its original source file without mixing into workout history.',
    closingActions: [
      routeAction('Start Free', '/login', 'flat', 'arrow_forward'),
      routeAction('Garmin Integration', '/integrations/garmin', 'stroked', 'route'),
      routeAction('Suunto Integration', '/integrations/suunto', 'stroked', 'published_with_changes'),
      routeAction('COROS Integration', '/integrations/coros', 'stroked', 'route'),
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
    description: 'Step-by-step guides to import activities to Suunto or Wahoo, Garmin to Suunto activity sync, COROS to Suunto activity sync, Wahoo to Suunto activity sync, sending Suunto routes to Garmin, and centralizing workout data in one private dashboard.',
    h1: 'Training data sync guides',
    intro: 'Choose the guide that matches the workflow you need: import activities to Suunto or Wahoo, sync Garmin, COROS, or Wahoo activities to Suunto, send Suunto routes to Garmin courses, or build a centralized multi-provider workout archive.',
    chips: ['Import to Suunto', 'Import to Wahoo', 'Garmin to Suunto', 'COROS to Suunto', 'Wahoo to Suunto', 'Past activity sync'],
    actions: [
      routeAction('Import to Suunto', '/guides/import-activities-to-suunto', 'flat', 'arrow_forward'),
      routeAction('Import to Wahoo', '/guides/import-activities-to-wahoo'),
      routeAction('Garmin to Suunto', '/guides/sync-garmin-to-suunto'),
      routeAction('COROS to Suunto', '/guides/sync-coros-to-suunto'),
      routeAction('Wahoo to Suunto', '/guides/sync-wahoo-to-suunto'),
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
            icon: 'directions_bike',
            title: 'Wahoo to Suunto activity sync',
            copy: 'Connect Wahoo and Suunto, turn on automatic activity sync, and choose a date range to send retained Wahoo FIT activities that are already in Quantified Self.',
          },
          {
            icon: 'upload_file',
            title: 'Import activities to Suunto',
            copy: 'Upload a selected FIT activity to Suunto, or connect Garmin, COROS, or Wahoo when you want eligible activities sent automatically or by date range.',
          },
          {
            icon: 'upload_file',
            title: 'Import activities to Wahoo',
            copy: 'Send a selected FIT activity to Wahoo, or connect Garmin, COROS, or Suunto when you want eligible activities delivered automatically or by date range.',
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
        copy: 'The centralization guide explains how provider imports, manual uploads, source files, benchmark reports, exports, and the built-in Assistant fit together.',
        items: [
          {
            icon: 'hub',
            title: 'Garmin, Suunto, COROS, and Wahoo together',
            copy: 'Centralize Garmin, Suunto, COROS, and Wahoo workout data while preserving provider source context for each activity.',
          },
          {
            icon: 'upload_file',
            title: 'Files when services are not enough',
            copy: 'Use FIT, TCX, GPX, JSON, and SML uploads for unsupported services, review units, lab tests, and custom exports.',
          },
          {
            icon: 'compare_arrows',
            title: 'Analysis after import',
            copy: 'Once data is centralized, use comparison features, benchmark reports, exports, and grounded Assistant questions from the same archive.',
          },
        ],
      },
    ],
    faqItems: [
      {
        question: 'Which guide should I use first?',
        answer: 'Use an import-activities guide to send a selected FIT activity or activities from connected providers to Suunto or Wahoo. Use the Garmin to Suunto, COROS to Suunto, or Wahoo to Suunto guide for a source-specific Suunto sync, the Suunto routes to Garmin guide for sending routes to Garmin Connect, and the centralization guide for a private dashboard across providers and uploaded files.',
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
  syncWahooToSuunto: {
    key: 'syncWahooToSuunto',
    path: PUBLIC_GUIDE_PATHS.syncWahooToSuunto,
    eyebrow: 'Wahoo to Suunto Guide',
    title: 'How to Sync Wahoo Activities to Suunto Automatically',
    description: 'Learn how to sync Wahoo FIT activities to Suunto automatically, connect both accounts, and sync past retained Wahoo activities by date with Quantified Self.',
    h1: 'How to sync Wahoo activities to Suunto automatically',
    intro: 'Connect Wahoo and Suunto, then choose whether new eligible Wahoo activities should be sent to Suunto automatically. You can also sync past retained Wahoo FIT activities from a date range whenever you need to.',
    chips: ['Wahoo', 'Suunto', 'FIT activities', 'Automatic activity sync', 'Past activity sync', 'Pro'],
    actions: [
      routeAction('Start Setup', '/login', 'flat', 'arrow_forward'),
      routeAction('Wahoo Integration', '/integrations/wahoo'),
      routeAction('Sync Help', '/help', 'stroked', undefined, 'service-connections'),
    ],
    sections: [
      {
        eyebrow: 'Setup',
        title: 'Connect Wahoo and Suunto before turning on activity sync',
        copy: 'Both accounts must be connected and active before Quantified Self can send eligible Wahoo activities to Suunto.',
        items: [
          {
            icon: 'login',
            title: 'Connect both providers',
            copy: 'Connect Wahoo and Suunto in Services, then confirm both connections are active before enabling cross-service sync.',
          },
          {
            icon: 'toggle_on',
            title: 'Turn on automatic activity sync',
            copy: 'Open Wahoo Services and turn on automatic activity sync so new imported Wahoo FIT activities can be sent to Suunto.',
          },
          {
            icon: 'history',
            title: 'Import Wahoo history when needed',
            copy: 'Choose a date range in Wahoo Services to queue Wahoo history. Only records with an available FIT file are eligible for import and later sync.',
          },
        ],
      },
      {
        eyebrow: 'Past Activities',
        title: 'Sync retained Wahoo FIT activities by date',
        copy: 'Syncing past activities is separate from automatic sync and uses FIT activity files already retained with eligible Wahoo events.',
        items: [
          {
            icon: 'published_with_changes',
            title: 'Sync past Wahoo activities',
            copy: 'Choose a date range in Wahoo Services to send retained Wahoo FIT activities already stored in Quantified Self to Suunto.',
          },
          {
            icon: 'file_download',
            title: 'FIT-backed activity requirement',
            copy: 'Wahoo records without an available FIT file are skipped. Wahoo workouts identified as originating from a third-party fitness application are not imported through this integration.',
          },
          {
            icon: 'sync_problem',
            title: 'Reconnect when access fails',
            copy: 'If Wahoo or Suunto shows Reconnect required, reconnect before trying automatic activity sync again.',
          },
        ],
      },
    ],
    faqItems: [
      {
        question: 'Can Wahoo activities sync to Suunto automatically?',
        answer: 'Yes. Connect Wahoo and Suunto, then turn on automatic activity sync in Wahoo Services. New eligible Wahoo FIT activities can then be sent to Suunto automatically.',
      },
      {
        question: 'Can I sync old Wahoo activities to Suunto?',
        answer: 'Yes. Import Wahoo history first when needed, then use Sync past activities to choose a date range. Only retained Wahoo activities with their original FIT file can be sent to Suunto.',
      },
      {
        question: 'Does syncing past Wahoo activities turn on automatic sync?',
        answer: 'No. Sync past activities only sends activities from the date range you choose. It does not turn on automatic sync for future Wahoo imports.',
      },
      {
        question: 'Will activities sent to Wahoo come back as Wahoo imports?',
        answer: 'No. Wahoo does not expose completed workouts that it identifies as coming from a third-party fitness application through this integration, preventing that return path from creating a sync loop.',
      },
    ],
    closingTitle: 'Keep Wahoo and Suunto aligned without losing the archive',
    closingCopy: 'Use automatic sync for new eligible Wahoo FIT activities and Sync past activities for retained Wahoo workouts already in your Quantified Self archive.',
    closingActions: [
      routeAction('Wahoo Integration', '/integrations/wahoo', 'flat', 'arrow_forward'),
      routeAction('Suunto Integration', '/integrations/suunto'),
      routeAction('All Integrations', '/integrations'),
    ],
    howToSteps: [
      'Connect Wahoo to Quantified Self.',
      'Connect Suunto to Quantified Self.',
      'Turn on automatic activity sync in Wahoo Services.',
      'Use Sync past activities for retained Wahoo FIT activities when needed.',
    ],
  },
  importActivitiesToSuunto: {
    key: 'importActivitiesToSuunto',
    path: PUBLIC_GUIDE_PATHS.importActivitiesToSuunto,
    eyebrow: 'Suunto Activity Import Guide',
    title: 'Import Activities to Suunto: FIT Files and Sync',
    description: 'Import FIT activities to Suunto manually, or sync new and past Garmin, COROS, and Wahoo activities with Quantified Self.',
    h1: 'How to import activities to Suunto',
    intro: 'Use Quantified Self to send a selected FIT activity to Suunto, automatically deliver eligible new Garmin, COROS, or Wahoo activities, or choose a date range for activities already in your private archive.',
    chips: ['Suunto', 'FIT activities', 'Garmin', 'COROS', 'Wahoo', 'Pro'],
    actions: [
      routeAction('Start Setup', '/login', 'flat', 'arrow_forward'),
      routeAction('Suunto Integration', '/integrations/suunto'),
      routeAction('Sync Help', '/help', 'stroked', undefined, 'service-connections'),
    ],
    sections: [
      {
        eyebrow: 'FIT Activity Upload',
        title: 'Import a selected FIT activity to Suunto',
        copy: 'Connect Suunto in Quantified Self, then use its Uploads tool when you need to send one selected FIT activity for a missing session, one-off correction, or migration.',
        items: [
          {
            icon: 'login',
            title: 'Connect Suunto',
            copy: 'Sign in with Pro access, connect Suunto in Services, and keep the connection active before starting an activity upload.',
          },
          {
            icon: 'upload_file',
            title: 'Select a FIT activity',
            copy: 'Open Suunto Services, choose Uploads, and select the FIT activity file you want to send. This is an activity workflow, not a route upload.',
          },
          {
            icon: 'sync',
            title: 'Check each upload status',
            copy: 'Suunto FIT activity uploads show a status for each file, with retry controls when a file needs another attempt.',
          },
        ],
      },
      {
        eyebrow: 'Provider Activity Sync',
        title: 'Send activities from Garmin, COROS, or Wahoo',
        copy: 'Connect the source provider and Suunto, then decide whether eligible future activities should be sent automatically or whether you only need a selected history range.',
        items: [
          {
            icon: 'sync_alt',
            title: 'Turn on automatic activity sync',
            copy: 'In the source provider’s Services tools, turn on automatic activity sync to send eligible new Garmin, COROS, or Wahoo activities to Suunto after Quantified Self imports them.',
          },
          {
            icon: 'published_with_changes',
            title: 'Sync past activities by date',
            copy: 'Use Sync past activities in the source provider’s Services tools to choose a date range for activities already stored in Quantified Self. This does not turn on future automatic sync.',
          },
          {
            icon: 'route',
            title: 'Keep routes separate from activities',
            copy: 'GPX and FIT route delivery is a separate workflow. Sending a route to Suunto does not import it as an activity.',
          },
        ],
      },
    ],
    faqItems: [
      {
        question: 'Can I import a FIT activity to Suunto?',
        answer: 'Yes. With Pro access and an active Suunto connection, open Uploads in Suunto Services and select the FIT activity file you want to send.',
      },
      {
        question: 'Can I automatically sync Garmin, COROS, or Wahoo activities to Suunto?',
        answer: 'Yes. Connect Suunto and the source provider, then turn on automatic activity sync in that source provider’s Services tools. Eligible new activities are sent after they arrive in Quantified Self.',
      },
      {
        question: 'Can I import past activities to Suunto?',
        answer: 'Yes. Use Sync past activities in the source provider’s Services tools and choose a date range for activities already stored in Quantified Self. Future automatic sync stays off unless you enable it separately.',
      },
      {
        question: 'Can I import a GPX route to Suunto as an activity?',
        answer: 'No. Routes and activities are separate workflows. Use a FIT activity file for an activity upload; GPX and FIT route delivery sends a route to Suunto instead.',
      },
    ],
    closingTitle: 'Choose a FIT upload or connected-provider activity sync',
    closingCopy: 'Send one selected FIT activity when you need a manual import, or connect Garmin, COROS, or Wahoo when you want eligible activities sent automatically or from a selected date range.',
    closingActions: [
      routeAction('Suunto Integration', '/integrations/suunto', 'flat', 'arrow_forward'),
      routeAction('Wahoo to Suunto', '/guides/sync-wahoo-to-suunto'),
      routeAction('All Guides', '/guides'),
    ],
    howToSteps: [
      'Connect Suunto to Quantified Self with Pro access.',
      'For one activity file, open Uploads in Suunto Services and select a FIT activity.',
      'For provider sync, connect Garmin, COROS, or Wahoo and turn on automatic activity sync in its Services tools.',
      'Use Sync past activities in the source provider’s Services tools when you need an existing date range.',
    ],
  },
  importActivitiesToWahoo: {
    key: 'importActivitiesToWahoo',
    path: PUBLIC_GUIDE_PATHS.importActivitiesToWahoo,
    eyebrow: 'Wahoo Activity Import Guide',
    title: 'Import Activities to Wahoo: FIT Files and Sync',
    description: 'Import FIT activities to Wahoo manually, or send new and past FIT-backed Garmin, COROS, and Suunto activities with Quantified Self.',
    h1: 'How to import activities to Wahoo',
    intro: 'Use Quantified Self to send a selected FIT activity to Wahoo, automatically deliver eligible new Garmin, COROS, or Suunto activities, or choose a date range for FIT-backed activities already in your private archive.',
    chips: ['Wahoo', 'FIT activities', 'Garmin', 'COROS', 'Suunto', 'Pro'],
    actions: [
      routeAction('Start Setup', '/login', 'flat', 'arrow_forward'),
      routeAction('Wahoo Integration', '/integrations/wahoo'),
      routeAction('Sync Help', '/help', 'stroked', undefined, 'service-connections'),
    ],
    sections: [
      {
        eyebrow: 'FIT Activity Delivery',
        title: 'Import a selected FIT activity to Wahoo',
        copy: 'Connect Wahoo in Quantified Self, then use its activity delivery tool when you need to send one selected FIT activity without adding a new activity to your Quantified Self archive.',
        items: [
          {
            icon: 'login',
            title: 'Connect Wahoo',
            copy: 'Sign in with Pro access, connect Wahoo in Services, and reconnect it once if activity write access was not included in an earlier connection.',
          },
          {
            icon: 'upload_file',
            title: 'Select a FIT activity',
            copy: 'Open Wahoo Services and select the FIT activity file you want to send. This direct delivery does not create or retain a Quantified Self activity.',
          },
          {
            icon: 'sync',
            title: 'Check the upload status',
            copy: 'Wahoo can process an activity upload asynchronously, so Wahoo Services keeps its status available to refresh.',
          },
        ],
      },
      {
        eyebrow: 'Provider Activity Sync',
        title: 'Send activities from Garmin, COROS, or Suunto',
        copy: 'Connect the source provider and Wahoo, then decide whether eligible future activities should be delivered automatically or whether you only need a selected history range.',
        items: [
          {
            icon: 'sync_alt',
            title: 'Turn on automatic activity sync',
            copy: 'In the source provider’s Services tools, turn on automatic activity sync to send eligible new Garmin, COROS, or Suunto activities to Wahoo after Quantified Self imports them.',
          },
          {
            icon: 'published_with_changes',
            title: 'Sync past activities by date',
            copy: 'Use Sync past activities in the source provider’s Services tools to choose a date range for FIT-backed activities already stored in Quantified Self. This does not turn on future automatic sync.',
          },
          {
            icon: 'route',
            title: 'Keep routes separate from activities',
            copy: 'GPX and FIT route delivery is a separate workflow. Sending a route to Wahoo does not import it as an activity.',
          },
        ],
      },
    ],
    faqItems: [
      {
        question: 'Can I import a FIT activity to Wahoo?',
        answer: 'Yes. With Pro access and an active Wahoo connection, select a FIT activity file in Wahoo Services to send it directly to Wahoo.',
      },
      {
        question: 'Can I automatically send Garmin, COROS, or Suunto activities to Wahoo?',
        answer: 'Yes. Connect Wahoo and the source provider, then turn on automatic activity sync in that source provider’s Services tools. Eligible new activities are delivered after they arrive in Quantified Self.',
      },
      {
        question: 'Can I import past activities to Wahoo?',
        answer: 'Yes. Use Sync past activities in the source provider’s Services tools and choose a date range for FIT-backed activities already stored in Quantified Self. Future automatic sync stays off unless you enable it separately.',
      },
      {
        question: 'Can I import a GPX route to Wahoo as an activity?',
        answer: 'No. Routes and activities are separate workflows. Use a FIT activity file for activity delivery; GPX and FIT route delivery sends a course or route to Wahoo instead.',
      },
    ],
    closingTitle: 'Choose a FIT upload or connected-provider activity sync',
    closingCopy: 'Send one selected FIT activity when you need a manual import, or connect Garmin, COROS, or Suunto when you want eligible FIT-backed activities delivered automatically or from a selected date range.',
    closingActions: [
      routeAction('Wahoo Integration', '/integrations/wahoo', 'flat', 'arrow_forward'),
      routeAction('All Guides', '/guides'),
      routeAction('Sync Help', '/help', 'stroked', undefined, 'service-connections'),
    ],
    howToSteps: [
      'Connect Wahoo to Quantified Self with Pro access.',
      'For one activity file, open Wahoo Services and select a FIT activity to send directly to Wahoo.',
      'For provider sync, connect Garmin, COROS, or Suunto and turn on automatic activity sync in its Services tools.',
      'Use Sync past activities in the source provider’s Services tools when you need an existing FIT-backed date range.',
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
    title: 'Centralize Garmin, Suunto, COROS, and Wahoo Workout Data',
    description: 'Centralize Garmin, Suunto, COROS, and Wahoo workout data in one private training dashboard with source files, manual uploads, provider sync, benchmark reports, exports, and a grounded Assistant.',
    h1: 'Centralize Garmin, Suunto, COROS, and Wahoo workout data',
    intro: 'Use Quantified Self as the private training hub when your workouts, source files, routes, and analysis are spread across Garmin, Suunto, COROS, Wahoo, and exported activity files.',
    chips: ['Garmin', 'Suunto', 'COROS', 'Wahoo', 'Source files', 'Exports', 'Benchmarks'],
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
            copy: 'Review Garmin, Suunto, COROS, Wahoo, and manually uploaded activities in one account with source context intact.',
          },
          {
            icon: 'file_download',
            title: 'Original files and exports',
            copy: 'Keep original source files useful for downloads, reprocessing, sending activities to Suunto, and benchmark comparisons.',
          },
          {
            icon: 'dashboard_customize',
            title: 'One private dashboard',
            copy: 'Use one dashboard for maps, routes, load, readiness, sleep context, file uploads, benchmark reports, and grounded Assistant questions.',
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
            copy: 'Set up Garmin to Suunto, COROS to Suunto, or Wahoo to Suunto activity sync when Suunto should receive newly imported activities.',
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
        question: 'Can I centralize Garmin, Suunto, COROS, and Wahoo workout data?',
        answer: 'Yes. Quantified Self is designed to keep Garmin, Suunto, COROS, Wahoo, and uploaded activity files in one private training dashboard.',
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
    closingCopy: 'Start with the providers and files you already use, then add activity sync, uploads, benchmark reports, and the Assistant as your training archive grows.',
    closingActions: [
      routeAction('Training Analysis', '/features/training-analysis', 'flat', 'arrow_forward'),
      routeAction('All Integrations', '/integrations', 'stroked', 'arrow_forward'),
      routeAction('Workout File Comparison', '/features/workout-file-comparison'),
    ],
    howToSteps: [
      'Connect the providers you use or upload supported activity files.',
      'Import history or recent activities into Quantified Self.',
      'Turn on cross-service activity sync only when you want future activities sent to Suunto.',
      'Use dashboard, export, Assistant, and benchmark workflows from the centralized archive.',
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
  activityCalendar: buildRouteData(PUBLIC_SEO_PAGES.activityCalendar),
  trainingAnalysis: buildRouteData(PUBLIC_SEO_PAGES.trainingAnalysis),
  mcpServer: buildRouteData(PUBLIC_SEO_PAGES.mcpServer),
  assistant: buildRouteData(PUBLIC_SEO_PAGES.assistant),
  workoutFileComparison: buildRouteData(PUBLIC_SEO_PAGES.workoutFileComparison),
  fitGpxTcxFileAnalyzer: buildRouteData(PUBLIC_SEO_PAGES.fitGpxTcxFileAnalyzer),
  routeFiles: buildRouteData(PUBLIC_SEO_PAGES.routeFiles),
  sportsWatchBenchmark: buildRouteData(PUBLIC_SEO_PAGES.sportsWatchBenchmark),
  guidesHub: buildRouteData(PUBLIC_SEO_PAGES.guidesHub),
  syncGarminToSuunto: buildRouteData(PUBLIC_SEO_PAGES.syncGarminToSuunto),
  syncCorosToSuunto: buildRouteData(PUBLIC_SEO_PAGES.syncCorosToSuunto),
  syncWahooToSuunto: buildRouteData(PUBLIC_SEO_PAGES.syncWahooToSuunto),
  importActivitiesToSuunto: buildRouteData(PUBLIC_SEO_PAGES.importActivitiesToSuunto),
  importActivitiesToWahoo: buildRouteData(PUBLIC_SEO_PAGES.importActivitiesToWahoo),
  syncSuuntoRoutesToGarmin: buildRouteData(PUBLIC_SEO_PAGES.syncSuuntoRoutesToGarmin),
  centralizeWorkoutData: buildRouteData(PUBLIC_SEO_PAGES.centralizeWorkoutData),
};
