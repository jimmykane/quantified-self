export interface AssistantPromptExample {
  id: string;
  prompt: string;
  shortLabel: string;
  icon: string;
  toolWorkflow: readonly string[];
  routingHint: string;
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
    routingHint: 'Discover the Mountain Biking activityGroup, pass that exact group to the ranking tool with the server-mapped Maximum Jump Distance metric, and rank all of its server-expanded activity types across all available history. Treat the top ranked metric value and unit as authoritative. Do not spend the bounded workflow on jump-detail pagination unless the user explicitly asks for subrecord details, and never substitute jump count or an activity-page sample for the ranking.',
  },
] as const satisfies readonly AssistantPromptExample[];

export type AssistantPublishedPromptExample =
  typeof ASSISTANT_PROMPT_EXAMPLES[number];

export const ASSISTANT_STARTER_PROMPTS: readonly string[] =
  ASSISTANT_PROMPT_EXAMPLES.map(example => example.prompt);

export const ASSISTANT_COMPOSER_EXAMPLE_PROMPT =
  ASSISTANT_PROMPT_EXAMPLES[1].prompt;

function normalizeExamplePrompt(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function findAssistantPromptExample(
  prompt: string,
): AssistantPublishedPromptExample | null {
  const normalizedPrompt = normalizeExamplePrompt(prompt);
  return ASSISTANT_PROMPT_EXAMPLES.find(
    example => normalizeExamplePrompt(example.prompt) === normalizedPrompt,
  ) || null;
}
