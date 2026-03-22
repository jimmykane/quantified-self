import {
  getAiInsightsDefaultPickerPromptSections,
  getAiInsightsHeroPrompts,
  getAiInsightsPopularPromptGroups,
  getAiInsightsPickerPromptGroups,
  getAiInsightsPromptGroupsForPrompts,
  getAiInsightsPromptSectionsForPrompts,
  type AiInsightsPromptGroup,
  type AiInsightsPromptSection,
} from '@shared/ai-insights-prompts';

export const AI_INSIGHTS_FEATURED_PROMPTS = getAiInsightsHeroPrompts();
export const AI_INSIGHTS_DEFAULT_POPULAR_PROMPT_GROUPS = getAiInsightsPopularPromptGroups();
export const AI_INSIGHTS_DEFAULT_PROMPT_GROUPS = getAiInsightsPickerPromptGroups();
export const AI_INSIGHTS_DEFAULT_PROMPT_SECTIONS = getAiInsightsDefaultPickerPromptSections();
export const AI_INSIGHTS_DEFAULT_PICKER_PROMPTS = Array.from(new Set(
  AI_INSIGHTS_DEFAULT_PROMPT_SECTIONS.flatMap((section) => (
    section.groups.flatMap((group) => group.prompts.map((prompt) => prompt.prompt))
  )),
));

export function resolveAiInsightsPromptGroups(
  prompts: readonly string[] | null | undefined,
): readonly AiInsightsPromptGroup[] {
  return prompts?.length
    ? getAiInsightsPromptGroupsForPrompts(prompts)
    : AI_INSIGHTS_DEFAULT_PROMPT_GROUPS;
}

export function resolveAiInsightsPromptSections(
  prompts: readonly string[] | null | undefined,
): readonly AiInsightsPromptSection[] {
  return prompts?.length
    ? getAiInsightsPromptSectionsForPrompts(prompts)
    : AI_INSIGHTS_DEFAULT_PROMPT_SECTIONS;
}

export type { AiInsightsPromptGroup, AiInsightsPromptSection };
