import type { TrainingSportId } from './training-disciplines';

export interface AssistantPromptWorkflow {
  id: string;
  toolWorkflow: readonly string[];
  routingHint: string;
  /** Server-owned fixed inputs that override model-selected values. */
  toolInputOverrides?: Readonly<Record<
    string,
    Readonly<Record<string, unknown>>
  >>;
  /** App-owned activity family expanded by the backend for the named tools. */
  activityDisciplineOverrides?: Readonly<Record<string, TrainingSportId>>;
  /** Server-owned lookback applied to the named range tools. */
  dateRange?: {
    lookbackDays: number;
    toolNames: readonly string[];
  };
  /**
   * When a supported jump workflow reads subrecords, constrain the opaque
   * activity reference to an activity discovered by its preceding step.
   */
  jumpDetailSource?: 'ranked_record' | 'recent_activity_with_jumps';
  /** A jump-location request may only render the map produced by this tool. */
  mapSourceToolName?: 'list_activity_jumps';
}

export interface AssistantPromptExample extends AssistantPromptWorkflow {
  prompt: string;
  shortLabel: string;
  icon: string;
}

export const ASSISTANT_PROMPT_EXAMPLES = [
  {
    id: 'daily-report',
    prompt: "Give me today's sleep, readiness, and Training report.",
    shortLabel: 'Today',
    icon: 'today',
    toolWorkflow: ['get_daily_report'],
    routingHint: 'Use the daily report for the requested local day and cover sleep first, readiness briefly, then Training.',
  },
  {
    id: 'sleep-trend',
    prompt: 'How have my sleep, overnight HRV, and sleeping heart rate changed this week?',
    shortLabel: 'Sleep & HRV',
    icon: 'bedtime',
    toolWorkflow: ['get_sleep_trend'],
    routingHint: 'Use one bounded sleep trend for this week and report recorded coverage or missing values instead of treating missing vitals as zero.',
  },
  {
    id: 'training-load-and-form',
    prompt: 'How is my Training load and Form compared with usual?',
    shortLabel: 'Training & Form',
    icon: 'monitoring',
    toolWorkflow: ['list_training_metrics', 'get_training_metric'],
    routingHint: 'Discover the ready Training metric kinds, then read the current Form and Training summary snapshots needed for the comparison.',
  },
  {
    id: 'body-weight-trend',
    prompt: 'Show my body-weight trend over the last 30 days.',
    shortLabel: 'Weight trend',
    icon: 'scale',
    toolWorkflow: ['list_measurement_types', 'query_measurements'],
    routingHint: 'Discover the recorded body-weight measurement type, then query its bounded 30-day history rather than using an activity metric.',
  },
  {
    id: 'saved-cycling-routes',
    prompt: 'Show my most recently saved cycling routes.',
    shortLabel: 'Saved routes',
    icon: 'route',
    toolWorkflow: ['list_activity_types', 'list_routes'],
    routingHint: 'Discover the canonical cycling activity types, then list the newest matching saved-route summaries without requesting location, geometry, or waypoints.',
  },
  {
    id: 'biggest-mtb-jump',
    prompt: 'What was my biggest MTB jump?',
    shortLabel: 'Biggest MTB jump',
    icon: 'terrain',
    toolWorkflow: ['list_activity_types', 'rank_activities_by_metric'],
    routingHint: 'Discover the Mountain Biking activityGroup, pass that exact group to the ranking tool with the server-mapped Maximum Jump Distance metric, and rank all of its server-expanded activity types across all available history. Treat the top ranked metric value and unit as authoritative, and use that same result\'s exact ISO startTime when stating when it happened; never substitute the current date. Do not spend the bounded workflow on jump-detail pagination unless the user explicitly asks for subrecord details, and never substitute jump count or an activity-page sample for the ranking.',
  },
] as const satisfies readonly AssistantPromptExample[];

export type AssistantPublishedPromptExample =
  typeof ASSISTANT_PROMPT_EXAMPLES[number];

export const ASSISTANT_RECORD_MTB_JUMP_LOCATION_WORKFLOW = {
  id: 'record-mtb-jump-location',
  toolWorkflow: [
    'list_activity_types',
    'rank_activities_by_metric',
    'list_activity_jumps',
  ],
  routingHint: 'Discover the Mountain Biking activityGroup, rank the matching persisted Maximum Jump metric across all available history in highest order, then use only the rank-one opaque activity reference with list_activity_jumps. For a map or coordinates, select only the jump-record map descriptor for that ranked activity; never substitute an activity start or end position for a jump position.',
  jumpDetailSource: 'ranked_record',
  mapSourceToolName: 'list_activity_jumps',
} as const satisfies AssistantPromptWorkflow;

export const ASSISTANT_RECENT_JUMP_DETAILS_WORKFLOW = {
  id: 'recent-jump-details',
  toolWorkflow: ['query_activities', 'list_activity_jumps'],
  routingHint: 'Query activities newest first without date selectors. Select the first returned activity with jumpCount greater than zero, then pass only that activity\'s opaque reference to list_activity_jumps. Continue the same bounded activity scan with nextCursor only when no returned activity has jumps. For a map or coordinates, select only the jump-record map descriptor; never substitute an activity start or end position for a jump position.',
  jumpDetailSource: 'recent_activity_with_jumps',
  mapSourceToolName: 'list_activity_jumps',
} as const satisfies AssistantPromptWorkflow;

export interface AssistantAnalyticalPromptWorkflow
  extends AssistantPromptWorkflow {
  examplePrompt: string;
}

/**
 * High-value analytical intents that need a bounded, deterministic path but
 * are deliberately not part of the public starter-prompt catalog.
 */
export const ASSISTANT_ANALYTICAL_PROMPT_WORKFLOWS = [
  {
    id: 'cycling-load-sleep-hrv-comparison',
    examplePrompt: 'Compare my cycling load, sleep and HRV over the last six weeks.',
    toolWorkflow: ['query_metric', 'get_sleep_trend'],
    routingHint: 'Query weekly total cycling load and weekly main-sleep duration plus recorded HRV over the same exact six-week range. Compare aligned weeks, report coverage, and never treat missing sleep or HRV as zero. The server owns the canonical Cycling-family activity types and Training Stress Score selector.',
    toolInputOverrides: {
      query_metric: {
        metric: 'Training Stress Score',
        aggregation: 'total',
        groupBy: 'date',
        interval: 'weekly',
      },
      get_sleep_trend: {
        includeNaps: false,
        groupBy: 'week',
      },
    },
    dateRange: {
      lookbackDays: 42,
      toolNames: ['query_metric', 'get_sleep_trend'],
    },
    activityDisciplineOverrides: {
      query_metric: 'cycling',
    },
  },
  {
    id: 'late-session-cycling-power-decline',
    examplePrompt: 'Which long rides showed the greatest late-session power decline?',
    toolWorkflow: ['get_training_metric'],
    routingHint: 'Read the ready Aerobic durability snapshot using the server-owned training_durability metric kind. Use only the Cycling scope and its recent supporting eligible activities. Rank late-session fade by the persisted output-retention and decoupling evidence, identify rides by their recorded UTC day, state the snapshot window and coverage, and do not substitute a sample of raw power charts or claim an all-time result.',
    toolInputOverrides: {
      get_training_metric: {
        metricKind: 'training_durability',
      },
    },
  },
  {
    id: 'strongest-training-build-comparison',
    examplePrompt: 'What changed between my strongest training build and what I’m doing now?',
    toolWorkflow: ['get_training_metric'],
    routingHint: 'Read Best build comparison using the server-owned training_build_comparison metric kind. Compare the configured historical build with the equal-length current build, including workload, intensity, durability, and recovery evidence that is actually available. If no valid benchmark is configured, say so; never replace the requested build comparison with current-versus-usual or a daily report.',
    toolInputOverrides: {
      get_training_metric: {
        metricKind: 'training_build_comparison',
      },
    },
  },
  {
    id: 'body-weight-training-volume-comparison',
    examplePrompt: 'How has my body weight moved alongside training volume?',
    toolWorkflow: ['query_measurements', 'get_training_metric'],
    routingHint: 'Use weekly median body-weight measurements for the latest 28 days, then read the ready Training summary using the server-owned selectors for its aligned current 28-day volume and equivalent usual 28-day comparison. Describe the two recorded movements side by side without claiming causation or treating missing weigh-ins as zero.',
    toolInputOverrides: {
      query_measurements: {
        measurementType: 'body_weight',
        aggregation: 'median',
        interval: 'week',
      },
      get_training_metric: {
        metricKind: 'training_summary',
      },
    },
    dateRange: {
      lookbackDays: 28,
      toolNames: ['query_measurements'],
    },
  },
  {
    id: 'two-hour-endurance-route-suitability',
    examplePrompt: 'Which saved routes would suit a two-hour endurance ride?',
    toolWorkflow: ['list_routes'],
    routingHint: 'List saved routes once using the server-owned complete Cycling-family filter. Compare the available route distance and ascent summaries. Recommend only plausible options, explain when none fit, and state that exact ride time depends on the rider and conditions rather than inventing a duration.',
    toolInputOverrides: {
      list_routes: {
        limit: 100,
      },
    },
    activityDisciplineOverrides: {
      list_routes: 'cycling',
    },
  },
] as const satisfies readonly AssistantAnalyticalPromptWorkflow[];

type AssistantAnalyticalPromptWorkflowId =
  typeof ASSISTANT_ANALYTICAL_PROMPT_WORKFLOWS[number]['id'];

export const ASSISTANT_STARTER_PROMPTS: readonly string[] =
  ASSISTANT_PROMPT_EXAMPLES.map(example => example.prompt);

export const ASSISTANT_COMPOSER_EXAMPLE_PROMPT =
  ASSISTANT_PROMPT_EXAMPLES[1].prompt;

function normalizeExamplePrompt(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isMtbRecordJumpPrompt(value: string): boolean {
  return /\b(?:biggest|longest|maximum|max|record|highest|fastest)\b/u.test(value)
    && /\b(?:mtb|mountain bike|mountain biking)\b/u.test(value)
    && /\bjumps?\b/u.test(value);
}

function isJumpDetailOrLocationPrompt(value: string): boolean {
  return /\b(?:map|where|location|coordinates?|detail|details)\b/u.test(value);
}

function isRecentJumpPrompt(value: string): boolean {
  return /\b(?:last|latest|recent|newest|most recent)\b/u.test(value)
    && /\bjumps?\b/u.test(value);
}

function isCyclingLoadSleepHrvComparisonPrompt(value: string): boolean {
  return /\bcycl(?:ing|e|ist)\b/u.test(value)
    && /\b(?:load|training stress|tss)\b/u.test(value)
    && /\bsleep\b/u.test(value)
    && /\bhrv\b/u.test(value)
    && /\b(?:six|6)[ -]?weeks?\b/u.test(value);
}

function isLateSessionCyclingPowerDeclinePrompt(value: string): boolean {
  return /\b(?:ride|rides|cycling)\b/u.test(value)
    && /\bpower\b/u.test(value)
    && /\b(?:decline|drop|fade|retention|decoupling)\b/u.test(value)
    && /\b(?:late[- ]session|later|second[- ]half)\b/u.test(value);
}

function isStrongestTrainingBuildPrompt(value: string): boolean {
  return /\b(?:strongest|best)\b/u.test(value)
    && /\b(?:training )?build\b/u.test(value)
    && /\b(?:now|current|currently|doing)\b/u.test(value);
}

function isBodyWeightTrainingVolumePrompt(value: string): boolean {
  return /\b(?:body[- ]?weight|weight)\b/u.test(value)
    && /\b(?:training|workout) volume\b/u.test(value)
    && /\b(?:alongside|compare|compared|moved|movement|trend)\b/u.test(value);
}

function isTwoHourEnduranceRoutePrompt(value: string): boolean {
  return /\bsaved routes?\b/u.test(value)
    && /\b(?:two|2)[ -]?hours?\b/u.test(value)
    && /\bendurance\b/u.test(value);
}

function findAssistantAnalyticalPromptWorkflow(
  prompt: string,
): AssistantAnalyticalPromptWorkflow | null {
  const normalizedPrompt = normalizeExamplePrompt(prompt);
  let workflowId: AssistantAnalyticalPromptWorkflowId | null = null;
  if (isCyclingLoadSleepHrvComparisonPrompt(normalizedPrompt)) {
    workflowId = 'cycling-load-sleep-hrv-comparison';
  } else if (isLateSessionCyclingPowerDeclinePrompt(normalizedPrompt)) {
    workflowId = 'late-session-cycling-power-decline';
  } else if (isStrongestTrainingBuildPrompt(normalizedPrompt)) {
    workflowId = 'strongest-training-build-comparison';
  } else if (isBodyWeightTrainingVolumePrompt(normalizedPrompt)) {
    workflowId = 'body-weight-training-volume-comparison';
  } else if (isTwoHourEnduranceRoutePrompt(normalizedPrompt)) {
    workflowId = 'two-hour-endurance-route-suitability';
  }
  return workflowId
    ? ASSISTANT_ANALYTICAL_PROMPT_WORKFLOWS.find(
        workflow => workflow.id === workflowId,
      ) || null
    : null;
}

export function findAssistantPromptExample(
  prompt: string,
): AssistantPublishedPromptExample | null {
  const normalizedPrompt = normalizeExamplePrompt(prompt);
  const exactExample = ASSISTANT_PROMPT_EXAMPLES.find(
    example => normalizeExamplePrompt(example.prompt) === normalizedPrompt,
  );
  if (exactExample) {
    return exactExample;
  }
  return isMtbRecordJumpPrompt(normalizedPrompt)
    ? ASSISTANT_PROMPT_EXAMPLES.find(example => example.id === 'biggest-mtb-jump') || null
    : null;
}

/**
 * Returns the deterministic supported workflow for a prompt. Most matches are
 * public starter examples; jump-detail variants add the one necessary
 * subrecord read so a start/end summary can never be mistaken for a jump.
 */
export function findAssistantPromptWorkflow(
  prompt: string,
): AssistantPromptWorkflow | null {
  const normalizedPrompt = normalizeExamplePrompt(prompt);
  if (
    isMtbRecordJumpPrompt(normalizedPrompt)
    && isJumpDetailOrLocationPrompt(normalizedPrompt)
  ) {
    return ASSISTANT_RECORD_MTB_JUMP_LOCATION_WORKFLOW;
  }
  if (isRecentJumpPrompt(normalizedPrompt)) {
    return ASSISTANT_RECENT_JUMP_DETAILS_WORKFLOW;
  }
  return findAssistantAnalyticalPromptWorkflow(prompt)
    || findAssistantPromptExample(prompt);
}
