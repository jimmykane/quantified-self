export type AiInsightsPromptSurface =
  | 'hero'
  | 'picker'
  | 'unsupported';

export type AiInsightsPromptCategory =
  | 'Volume & Distance'
  | 'Cardio & Speed'
  | 'Terrain & Pace Variants'
  | 'Power & Load'
  | 'Recovery & Performance'
  | 'Advanced Examples'
  | 'Suggested next prompts';

export type AiInsightsPromptMetricKey =
  | 'distance'
  | 'duration'
  | 'ascent'
  | 'descent'
  | 'cadence'
  | 'power'
  | 'heart_rate'
  | 'speed'
  | 'pace'
  | 'grade_adjusted_pace'
  | 'effort_pace'
  | 'swim_pace'
  | 'training_stress_score'
  | 'normalized_power'
  | 'intensity_factor'
  | 'power_work'
  | 'vo2_max'
  | 'epoc'
  | 'avg_vam'
  | 'aerobic_training_effect'
  | 'anaerobic_training_effect'
  | 'recovery_time'
  | 'calories';

export interface AiInsightsPromptDefinition {
  id: string;
  prompt: string;
  category: AiInsightsPromptCategory;
  featured: boolean;
  surfaces: readonly AiInsightsPromptSurface[];
  metricKey?: AiInsightsPromptMetricKey;
}

export interface AiInsightsPromptGroup {
  category: AiInsightsPromptCategory;
  prompts: readonly AiInsightsPromptDefinition[];
}

const AI_INSIGHTS_PROMPT_CATEGORY_ORDER: readonly AiInsightsPromptCategory[] = [
  'Volume & Distance',
  'Cardio & Speed',
  'Terrain & Pace Variants',
  'Power & Load',
  'Recovery & Performance',
  'Advanced Examples',
  'Suggested next prompts',
] as const;

export const AI_INSIGHTS_PROMPT_CATALOG = [
  {
    id: 'distance-by-activity-this-year',
    prompt: 'Show my total distance by activity type this year.',
    category: 'Volume & Distance',
    featured: true,
    surfaces: ['hero', 'picker', 'unsupported'],
    metricKey: 'distance',
  },
  {
    id: 'duration-over-time-this-year',
    prompt: 'Show my total training duration over time this year.',
    category: 'Volume & Distance',
    featured: true,
    surfaces: ['hero', 'picker', 'unsupported'],
    metricKey: 'duration',
  },
  {
    id: 'ascent-trail-running-this-year',
    prompt: 'Show my total ascent over time for trail running this year.',
    category: 'Volume & Distance',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'ascent',
  },
  {
    id: 'descent-skiing-this-year',
    prompt: 'Show my total descent over time for skiing this year.',
    category: 'Volume & Distance',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'descent',
  },
  {
    id: 'calories-over-time-90-days',
    prompt: 'Show my total calories burned over time in the last 90 days.',
    category: 'Volume & Distance',
    featured: true,
    surfaces: ['hero', 'picker', 'unsupported'],
    metricKey: 'calories',
  },
  {
    id: 'cadence-cycling-3-months',
    prompt: 'Tell me my average cadence for cycling over the last 3 months.',
    category: 'Cardio & Speed',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'cadence',
  },
  {
    id: 'heart-rate-running-90-days',
    prompt: 'Show my average heart rate over time for running in the last 90 days.',
    category: 'Cardio & Speed',
    featured: true,
    surfaces: ['hero', 'picker', 'unsupported'],
    metricKey: 'heart_rate',
  },
  {
    id: 'speed-cycling-3-months',
    prompt: 'Show my average speed over time for cycling in the last 3 months.',
    category: 'Cardio & Speed',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'speed',
  },
  {
    id: 'pace-running-3-months',
    prompt: 'Show my average pace over time for running in the last 3 months.',
    category: 'Cardio & Speed',
    featured: true,
    surfaces: ['hero', 'picker', 'unsupported'],
    metricKey: 'pace',
  },
  {
    id: 'swim-pace-swimming-90-days',
    prompt: 'Show my average swim pace over time for swimming in the last 90 days.',
    category: 'Cardio & Speed',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'swim_pace',
  },
  {
    id: 'gap-trail-running-90-days',
    prompt: 'Show my average grade adjusted pace over time for trail running in the last 90 days.',
    category: 'Terrain & Pace Variants',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'grade_adjusted_pace',
  },
  {
    id: 'effort-pace-running-90-days',
    prompt: 'Show my average effort pace over time for running in the last 90 days.',
    category: 'Terrain & Pace Variants',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'effort_pace',
  },
  {
    id: 'vam-climbing-90-days',
    prompt: 'Show my average VAM over time for climbing activities in the last 90 days.',
    category: 'Terrain & Pace Variants',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'avg_vam',
  },
  {
    id: 'power-cycling-90-days',
    prompt: 'Show my average power over time for cycling in the last 90 days.',
    category: 'Power & Load',
    featured: true,
    surfaces: ['hero', 'picker', 'unsupported'],
    metricKey: 'power',
  },
  {
    id: 'tss-cycling-90-days',
    prompt: 'Show my total TSS over time for cycling in the last 90 days.',
    category: 'Power & Load',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'training_stress_score',
  },
  {
    id: 'normalized-power-cycling-90-days',
    prompt: 'Show my average normalized power over time for cycling in the last 90 days.',
    category: 'Power & Load',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'normalized_power',
  },
  {
    id: 'intensity-factor-cycling-90-days',
    prompt: 'Show my average intensity factor over time for cycling in the last 90 days.',
    category: 'Power & Load',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'intensity_factor',
  },
  {
    id: 'power-work-cycling-90-days',
    prompt: 'Show my total power work over time for cycling in the last 90 days.',
    category: 'Power & Load',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'power_work',
  },
  {
    id: 'vo2max-running-90-days',
    prompt: 'Show my average VO2 max over time for running in the last 90 days.',
    category: 'Recovery & Performance',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'vo2_max',
  },
  {
    id: 'epoc-running-90-days',
    prompt: 'Show my average EPOC over time for running in the last 90 days.',
    category: 'Recovery & Performance',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'epoc',
  },
  {
    id: 'aerobic-training-effect-running-90-days',
    prompt: 'Show my average aerobic training effect over time for running in the last 90 days.',
    category: 'Recovery & Performance',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'aerobic_training_effect',
  },
  {
    id: 'anaerobic-training-effect-cycling-90-days',
    prompt: 'Show my average anaerobic training effect over time for cycling in the last 90 days.',
    category: 'Recovery & Performance',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'anaerobic_training_effect',
  },
  {
    id: 'recovery-time-running-90-days',
    prompt: 'Show my average recovery time over time for running in the last 90 days.',
    category: 'Recovery & Performance',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'recovery_time',
  },
  {
    id: 'stacked-max-heart-rate-by-activity',
    prompt: 'Show my max heart rate last month as stacked columns by activity type over time.',
    category: 'Advanced Examples',
    featured: true,
    surfaces: ['hero', 'picker'],
    metricKey: 'heart_rate',
  },
  {
    id: 'event-lookup-longest-distance-cycling',
    prompt: 'I want to know when I had my longest distance in cycling.',
    category: 'Advanced Examples',
    featured: true,
    surfaces: ['hero', 'picker'],
    metricKey: 'distance',
  },
  {
    id: 'distance-by-sport-excluding-indoor',
    prompt: 'Show my longest distances by sport all time excluding indoor activities.',
    category: 'Advanced Examples',
    featured: false,
    surfaces: ['picker'],
    metricKey: 'distance',
  },
] as const satisfies readonly AiInsightsPromptDefinition[];

function hasSurface(
  prompt: AiInsightsPromptDefinition,
  surface: AiInsightsPromptSurface,
): boolean {
  return prompt.surfaces.includes(surface);
}

function groupPromptEntries(
  promptEntries: readonly AiInsightsPromptDefinition[],
): readonly AiInsightsPromptGroup[] {
  return AI_INSIGHTS_PROMPT_CATEGORY_ORDER
    .map((category) => ({
      category,
      prompts: promptEntries.filter((entry) => entry.category === category),
    }))
    .filter((group) => group.prompts.length > 0);
}

export function getAiInsightsPromptEntriesBySurface(
  surface: AiInsightsPromptSurface,
): readonly AiInsightsPromptDefinition[] {
  return AI_INSIGHTS_PROMPT_CATALOG.filter((prompt) => hasSurface(prompt, surface));
}

export function getAiInsightsHeroPrompts(): readonly string[] {
  return AI_INSIGHTS_PROMPT_CATALOG
    .filter((prompt) => prompt.featured && hasSurface(prompt, 'hero'))
    .map((prompt) => prompt.prompt);
}

export function getAiInsightsPickerPromptGroups(): readonly AiInsightsPromptGroup[] {
  return groupPromptEntries(getAiInsightsPromptEntriesBySurface('picker'));
}

export function getAiInsightsPromptGroupsForPrompts(
  prompts: readonly string[],
): readonly AiInsightsPromptGroup[] {
  const promptLookup = new Map<string, AiInsightsPromptDefinition>(
    AI_INSIGHTS_PROMPT_CATALOG.map((prompt) => [prompt.prompt, prompt] as const),
  );
  const seenPrompts = new Set<string>();
  const resolvedPrompts: AiInsightsPromptDefinition[] = [];

  for (const prompt of prompts) {
    const normalizedPrompt = `${prompt}`.trim();
    if (!normalizedPrompt || seenPrompts.has(normalizedPrompt)) {
      continue;
    }

    seenPrompts.add(normalizedPrompt);
    resolvedPrompts.push(promptLookup.get(normalizedPrompt) ?? {
      id: `fallback-${resolvedPrompts.length + 1}`,
      prompt: normalizedPrompt,
      category: 'Suggested next prompts',
      featured: false,
      surfaces: ['picker'],
    });
  }

  return groupPromptEntries(resolvedPrompts);
}

export function getAiInsightsDefaultMetricPrompt(
  metricKey: AiInsightsPromptMetricKey,
): string {
  const prompt = AI_INSIGHTS_PROMPT_CATALOG.find((entry) => (
    entry.metricKey === metricKey
    && hasSurface(entry, 'unsupported')
  ))?.prompt;

  if (!prompt) {
    throw new Error(`Missing default AI insights prompt for metric ${metricKey}`);
  }

  return prompt;
}
