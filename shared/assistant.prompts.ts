export interface AssistantPromptWorkflow {
  id: string;
  toolWorkflow: readonly string[];
  routingHint: string;
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
  return findAssistantPromptExample(prompt);
}
