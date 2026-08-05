export interface AssistantPromptExample {
  id: string;
  prompt: string;
  toolWorkflow: readonly string[];
  routingHint: string;
}

export const ASSISTANT_PROMPT_EXAMPLES = [
  {
    id: 'daily-report',
    prompt: "Give me today's sleep, readiness, and Training report.",
    toolWorkflow: ['get_daily_report'],
    routingHint: 'Use the daily report for the requested local day and cover sleep first, readiness briefly, then Training.',
  },
  {
    id: 'sleep-trend',
    prompt: 'How have my sleep, overnight HRV, and sleeping heart rate changed this week?',
    toolWorkflow: ['get_sleep_trend'],
    routingHint: 'Use one bounded sleep trend for this week and report recorded coverage or missing values instead of treating missing vitals as zero.',
  },
  {
    id: 'training-load-and-form',
    prompt: 'How is my Training load and Form compared with usual?',
    toolWorkflow: ['list_training_metrics', 'get_training_metric'],
    routingHint: 'Discover the ready Training metric kinds, then read the current Form and Training summary snapshots needed for the comparison.',
  },
  {
    id: 'body-weight-trend',
    prompt: 'Show my body-weight trend over the last 30 days.',
    toolWorkflow: ['list_measurement_types', 'query_measurements'],
    routingHint: 'Discover the recorded body-weight measurement type, then query its bounded 30-day history rather than using an activity metric.',
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
