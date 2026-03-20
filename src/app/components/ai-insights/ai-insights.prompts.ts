import {
  getAiInsightsHeroPrompts,
  getAiInsightsPickerPromptGroups,
  getAiInsightsPromptGroupsForPrompts,
  type AiInsightsPromptGroup,
} from '@shared/ai-insights-prompts';

export const AI_INSIGHTS_FEATURED_PROMPTS = getAiInsightsHeroPrompts();
export const AI_INSIGHTS_DEFAULT_PROMPT_GROUPS = getAiInsightsPickerPromptGroups();
export const AI_INSIGHTS_DEFAULT_PICKER_PROMPTS = AI_INSIGHTS_DEFAULT_PROMPT_GROUPS
  .flatMap((group) => group.prompts.map((prompt) => prompt.prompt));

export function resolveAiInsightsPromptGroups(
  prompts: readonly string[] | null | undefined,
): readonly AiInsightsPromptGroup[] {
  return prompts?.length
    ? getAiInsightsPromptGroupsForPrompts(prompts)
    : AI_INSIGHTS_DEFAULT_PROMPT_GROUPS;
}

export type { AiInsightsPromptGroup };
