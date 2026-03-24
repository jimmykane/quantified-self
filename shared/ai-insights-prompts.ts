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

export type AiInsightsPopularPromptCategory =
  | 'Recent activity'
  | 'Progress over time'
  | 'Compare & explore'
  | 'Best efforts';

export type AiInsightsPromptMetricKey =
  | 'distance'
  | 'duration'
  | 'ascent'
  | 'descent'
  | 'jump_hang_time'
  | 'jump_distance'
  | 'jump_speed'
  | 'jump_score'
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
  | 'body_weight'
  | 'calories';

export interface AiInsightsPromptDefinition {
  id: string;
  prompt: string;
  category: AiInsightsPromptCategory | AiInsightsPopularPromptCategory;
  featured: boolean;
  surfaces: readonly AiInsightsPromptSurface[];
  metricKey?: AiInsightsPromptMetricKey;
}

export interface AiInsightsPromptGroup {
  category: AiInsightsPromptDefinition['category'];
  prompts: readonly AiInsightsPromptDefinition[];
}

export interface AiInsightsPromptSection {
  title: 'Popular Ways To Ask' | 'Browse By Metric' | 'Suggested Prompts';
  groups: readonly AiInsightsPromptGroup[];
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

const AI_INSIGHTS_POPULAR_PROMPT_CATEGORY_ORDER: readonly AiInsightsPopularPromptCategory[] = [
  'Recent activity',
  'Progress over time',
  'Compare & explore',
  'Best efforts',
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
    prompt: 'Show my total calories burned over time this year.',
    category: 'Volume & Distance',
    featured: true,
    surfaces: ['hero', 'picker', 'unsupported'],
    metricKey: 'calories',
  },
  {
    id: 'jump-distance-over-time-season',
    prompt: 'Show my jump distance over time this season.',
    category: 'Cardio & Speed',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'jump_distance',
  },
  {
    id: 'jump-hang-time-over-time-90-days',
    prompt: 'Show my jump hang time over time this year.',
    category: 'Cardio & Speed',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'jump_hang_time',
  },
  {
    id: 'jump-speed-over-time-90-days',
    prompt: 'Show my jump speed over time this year.',
    category: 'Cardio & Speed',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'jump_speed',
  },
  {
    id: 'jump-score-over-time-90-days',
    prompt: 'Show my jump score over time this year.',
    category: 'Cardio & Speed',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'jump_score',
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
    prompt: 'Show my average heart rate over time for running this year.',
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
    prompt: 'Show my average swim pace over time for swimming this year.',
    category: 'Cardio & Speed',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'swim_pace',
  },
  {
    id: 'gap-trail-running-90-days',
    prompt: 'Show my average grade adjusted pace over time for trail running this year.',
    category: 'Terrain & Pace Variants',
    featured: false,
    surfaces: ['unsupported'],
    metricKey: 'grade_adjusted_pace',
  },
  {
    id: 'vam-climbing-90-days',
    prompt: 'Show my average VAM over time for climbing activities this year.',
    category: 'Terrain & Pace Variants',
    featured: false,
    surfaces: ['unsupported'],
    metricKey: 'avg_vam',
  },
  {
    id: 'power-cycling-90-days',
    prompt: 'Show my average power over time for cycling this year.',
    category: 'Power & Load',
    featured: true,
    surfaces: ['hero', 'picker', 'unsupported'],
    metricKey: 'power',
  },
  {
    id: 'tss-cycling-90-days',
    prompt: 'Show my total TSS over time for cycling this year.',
    category: 'Power & Load',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'training_stress_score',
  },
  {
    id: 'normalized-power-cycling-90-days',
    prompt: 'Show my average normalized power over time for cycling this year.',
    category: 'Power & Load',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'normalized_power',
  },
  {
    id: 'intensity-factor-cycling-90-days',
    prompt: 'Show my average intensity factor over time for cycling this year.',
    category: 'Power & Load',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'intensity_factor',
  },
  {
    id: 'power-work-cycling-90-days',
    prompt: 'Show my total power work over time for cycling this year.',
    category: 'Power & Load',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'power_work',
  },
  {
    id: 'best-power-curve',
    prompt: 'What is my best power curve?',
    category: 'Power & Load',
    featured: false,
    surfaces: ['picker'],
  },
  {
    id: 'compare-power-curve-last-3-months',
    prompt: 'Compare my power curve over the last 3 months.',
    category: 'Power & Load',
    featured: false,
    surfaces: ['picker'],
  },
  {
    id: 'power-curve-over-time-this-year',
    prompt: 'Show my power curve over time this year.',
    category: 'Power & Load',
    featured: false,
    surfaces: ['picker'],
  },
  {
    id: 'vo2max-running-90-days',
    prompt: 'Show my average VO2 max over time for running this year.',
    category: 'Recovery & Performance',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'vo2_max',
  },
  {
    id: 'epoc-running-90-days',
    prompt: 'Show my average EPOC over time for running this year.',
    category: 'Recovery & Performance',
    featured: false,
    surfaces: [],
    metricKey: 'epoc',
  },
  {
    id: 'aerobic-training-effect-running-90-days',
    prompt: 'Show my average aerobic training effect over time for running this year.',
    category: 'Recovery & Performance',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'aerobic_training_effect',
  },
  {
    id: 'anaerobic-training-effect-cycling-90-days',
    prompt: 'Show my average anaerobic training effect over time for cycling this year.',
    category: 'Recovery & Performance',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'anaerobic_training_effect',
  },
  {
    id: 'recovery-time-running-90-days',
    prompt: 'Show my average recovery time over time for running this year.',
    category: 'Recovery & Performance',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'recovery_time',
  },
  {
    id: 'weight-over-time-this-year',
    prompt: 'Show my weight over time this year.',
    category: 'Recovery & Performance',
    featured: false,
    surfaces: ['picker', 'unsupported'],
    metricKey: 'body_weight',
  },
  {
    id: 'latest-event-last-ride',
    prompt: 'When was my last ride?',
    category: 'Advanced Examples',
    featured: true,
    surfaces: ['hero', 'picker'],
  },
  {
    id: 'latest-event-last-run',
    prompt: 'When was my last run?',
    category: 'Advanced Examples',
    featured: false,
    surfaces: ['picker'],
  },
  {
    id: 'latest-event-last-swim',
    prompt: 'When was my last swim?',
    category: 'Advanced Examples',
    featured: false,
    surfaces: ['picker'],
  },
  {
    id: 'multi-metric-cadence-power-cycling-3-months',
    prompt: 'Show me avg cadence and avg power for the last 3 months for cycling.',
    category: 'Advanced Examples',
    featured: true,
    surfaces: ['hero', 'picker'],
  },
  {
    id: 'compare-max-heart-rate-2024-2025',
    prompt: 'Compare my max heart rate in 2024 and 2025.',
    category: 'Advanced Examples',
    featured: false,
    surfaces: ['picker'],
    metricKey: 'heart_rate',
  },
  {
    id: 'stacked-max-heart-rate-by-activity',
    prompt: 'Show my max heart rate last month as stacked columns by activity type over time.',
    category: 'Advanced Examples',
    featured: false,
    surfaces: ['picker'],
    metricKey: 'heart_rate',
  },
  {
    id: 'event-lookup-longest-distance-cycling',
    prompt: 'I want to know when I had my longest distance in cycling.',
    category: 'Advanced Examples',
    featured: false,
    surfaces: ['picker'],
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
  {
    id: 'event-lookup-biggest-jump',
    prompt: 'Find my biggest jump.',
    category: 'Advanced Examples',
    featured: false,
    surfaces: ['picker'],
    metricKey: 'jump_distance',
  },
  {
    id: 'event-lookup-longest-jump',
    prompt: 'Find my longest jump.',
    category: 'Advanced Examples',
    featured: false,
    surfaces: ['picker'],
    metricKey: 'jump_distance',
  },
  {
    id: 'event-lookup-biggest-hang-time',
    prompt: 'Find my biggest hang time.',
    category: 'Advanced Examples',
    featured: false,
    surfaces: ['picker'],
    metricKey: 'jump_hang_time',
  },
  {
    id: 'event-lookup-lowest-weight',
    prompt: 'When did I have my lowest weight?',
    category: 'Advanced Examples',
    featured: false,
    surfaces: ['picker'],
    metricKey: 'body_weight',
  },
  {
    id: 'event-lookup-highest-weight',
    prompt: 'When did I have my highest weight?',
    category: 'Advanced Examples',
    featured: false,
    surfaces: ['picker'],
    metricKey: 'body_weight',
  },
] as const satisfies readonly AiInsightsPromptDefinition[];

export const AI_INSIGHTS_CURATED_PROMPT_CATALOG = [
  {
    id: 'popular-last-ride',
    prompt: 'When was my last ride?',
    category: 'Recent activity',
    featured: true,
    surfaces: ['hero', 'picker'],
  },
  {
    id: 'popular-last-run',
    prompt: 'When was my last run?',
    category: 'Recent activity',
    featured: false,
    surfaces: ['picker'],
  },
  {
    id: 'popular-last-swim',
    prompt: 'When was my last swim?',
    category: 'Recent activity',
    featured: false,
    surfaces: ['picker'],
  },
  {
    id: 'popular-training-time-this-year',
    prompt: 'Show my training time over time this year.',
    category: 'Progress over time',
    featured: true,
    surfaces: ['hero', 'picker'],
    metricKey: 'duration',
  },
  {
    id: 'popular-distance-by-sport-this-year',
    prompt: 'Show my distance by sport this year.',
    category: 'Progress over time',
    featured: false,
    surfaces: ['picker'],
    metricKey: 'distance',
  },
  {
    id: 'popular-running-heart-rate-90-days',
    prompt: 'Show my running heart rate over time this year.',
    category: 'Progress over time',
    featured: true,
    surfaces: ['hero', 'picker'],
    metricKey: 'heart_rate',
  },
  {
    id: 'popular-cycling-power-90-days',
    prompt: 'Show my cycling power over time this year.',
    category: 'Progress over time',
    featured: true,
    surfaces: ['hero', 'picker'],
    metricKey: 'power',
  },
  {
    id: 'popular-running-pace-trend-this-year',
    prompt: 'Show my average pace trend for running this year.',
    category: 'Progress over time',
    featured: true,
    surfaces: ['hero', 'picker'],
    metricKey: 'pace',
  },
  {
    id: 'popular-cadence-power-cycling-3-months',
    prompt: 'Show cadence vs power over time in the last 3 months for cycling.',
    category: 'Compare & explore',
    featured: true,
    surfaces: ['hero', 'picker'],
  },
  {
    id: 'popular-best-power-curve',
    prompt: 'What is my best power curve?',
    category: 'Best efforts',
    featured: true,
    surfaces: ['hero', 'picker'],
  },
  {
    id: 'popular-compare-power-curve-3-months',
    prompt: 'Compare my power curve over the last 3 months.',
    category: 'Compare & explore',
    featured: true,
    surfaces: ['hero', 'picker'],
  },
  {
    id: 'popular-weekly-distance-last-8-weeks',
    prompt: 'Compare my weekly distance for the last 8 weeks.',
    category: 'Compare & explore',
    featured: true,
    surfaces: ['hero', 'picker'],
    metricKey: 'distance',
  },
  {
    id: 'popular-compare-heart-rate-2024-vs-2025',
    prompt: 'Compare my max heart rate in 2024 vs 2025.',
    category: 'Compare & explore',
    featured: false,
    surfaces: ['picker'],
    metricKey: 'heart_rate',
  },
  {
    id: 'popular-max-heartrate-all-time',
    prompt: 'What was my maximum heartrate all time?',
    category: 'Best efforts',
    featured: true,
    surfaces: ['hero', 'picker'],
    metricKey: 'heart_rate',
  },
  {
    id: 'popular-longest-jump-event',
    prompt: 'When did I have my longest jump?',
    category: 'Best efforts',
    featured: false,
    surfaces: ['picker'],
    metricKey: 'jump_distance',
  },
  {
    id: 'popular-biggest-jump-event',
    prompt: 'When did I have my biggest jump?',
    category: 'Best efforts',
    featured: false,
    surfaces: ['picker'],
    metricKey: 'jump_distance',
  },
  {
    id: 'popular-highest-power-rides-this-month',
    prompt: 'Which rides had my highest power output this month?',
    category: 'Best efforts',
    featured: true,
    surfaces: ['hero', 'picker'],
    metricKey: 'power',
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
  categoryOrder: readonly AiInsightsPromptDefinition['category'][],
): readonly AiInsightsPromptGroup[] {
  return categoryOrder
    .map((category): AiInsightsPromptGroup => ({
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
  return AI_INSIGHTS_CURATED_PROMPT_CATALOG
    .filter((prompt) => prompt.featured && hasSurface(prompt, 'hero'))
    .map((prompt) => prompt.prompt);
}

export function getAiInsightsPickerPromptGroups(): readonly AiInsightsPromptGroup[] {
  const curatedPromptSet = new Set<string>(
    AI_INSIGHTS_CURATED_PROMPT_CATALOG
      .filter((prompt) => hasSurface(prompt, 'picker'))
      .map((prompt) => prompt.prompt),
  );
  return groupPromptEntries(
    getAiInsightsPromptEntriesBySurface('picker')
      .filter((prompt) => !curatedPromptSet.has(prompt.prompt)),
    AI_INSIGHTS_PROMPT_CATEGORY_ORDER,
  );
}

export function getAiInsightsPopularPromptGroups(): readonly AiInsightsPromptGroup[] {
  return groupPromptEntries(
    AI_INSIGHTS_CURATED_PROMPT_CATALOG.filter((prompt) => hasSurface(prompt, 'picker')),
    AI_INSIGHTS_POPULAR_PROMPT_CATEGORY_ORDER,
  );
}

export function getAiInsightsDefaultPickerPromptSections(): readonly AiInsightsPromptSection[] {
  const sections: AiInsightsPromptSection[] = [];
  const popularGroups = getAiInsightsPopularPromptGroups();
  const metricGroups = getAiInsightsPickerPromptGroups();

  if (popularGroups.length > 0) {
    sections.push({
      title: 'Popular Ways To Ask',
      groups: popularGroups,
    });
  }

  if (metricGroups.length > 0) {
    sections.push({
      title: 'Browse By Metric',
      groups: metricGroups,
    });
  }

  return sections;
}

export function getAiInsightsPromptGroupsForPrompts(
  prompts: readonly string[],
): readonly AiInsightsPromptGroup[] {
  const promptLookup = new Map<string, AiInsightsPromptDefinition>(
    [
      ...AI_INSIGHTS_CURATED_PROMPT_CATALOG,
      ...AI_INSIGHTS_PROMPT_CATALOG,
    ].map((prompt) => [prompt.prompt, prompt] as const),
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

  return [
    {
      category: 'Suggested next prompts',
      prompts: resolvedPrompts,
    },
  ];
}

export function getAiInsightsPromptSectionsForPrompts(
  prompts: readonly string[],
): readonly AiInsightsPromptSection[] {
  const groups = getAiInsightsPromptGroupsForPrompts(prompts);
  return groups.length
    ? [{
      title: 'Suggested Prompts',
      groups,
    }]
    : [];
}

export function getAiInsightsDefaultMetricPrompt(
  metricKey: AiInsightsPromptMetricKey,
): string {
  const prompt = AI_INSIGHTS_PROMPT_CATALOG.find((entry) => (
    'metricKey' in entry
    && entry.metricKey === metricKey
  ))?.prompt;

  if (!prompt) {
    throw new Error(`Missing default AI insights prompt for metric ${metricKey}`);
  }

  return prompt;
}
