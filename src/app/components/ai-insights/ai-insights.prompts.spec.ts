import { describe, expect, it } from 'vitest';
import {
  AI_INSIGHTS_PROMPT_CATALOG,
  getAiInsightsPromptEntriesBySurface,
} from '@shared/ai-insights-prompts';
import {
  AI_INSIGHTS_DEFAULT_PICKER_PROMPTS,
  AI_INSIGHTS_DEFAULT_PROMPT_GROUPS,
  AI_INSIGHTS_FEATURED_PROMPTS,
} from './ai-insights.prompts';

describe('ai-insights prompts', () => {
  it('defines unique prompt ids with non-empty prompt copy', () => {
    const ids = AI_INSIGHTS_PROMPT_CATALOG.map((prompt) => prompt.id);
    const prompts = AI_INSIGHTS_PROMPT_CATALOG.map((prompt) => prompt.prompt.trim());

    expect(new Set(ids).size).toBe(ids.length);
    expect(prompts.every((prompt) => prompt.length > 0)).toBe(true);
  });

  it('keeps featured prompts inside the default picker catalog', () => {
    const pickerPromptSet = new Set(AI_INSIGHTS_DEFAULT_PICKER_PROMPTS);

    expect(AI_INSIGHTS_FEATURED_PROMPTS.length).toBeGreaterThan(0);
    expect(AI_INSIGHTS_FEATURED_PROMPTS.every((prompt) => pickerPromptSet.has(prompt))).toBe(true);
  });

  it('groups the default picker prompts into valid categories', () => {
    const pickerPromptSet = new Set(AI_INSIGHTS_DEFAULT_PICKER_PROMPTS);

    expect(AI_INSIGHTS_DEFAULT_PROMPT_GROUPS.length).toBeGreaterThan(0);
    expect(AI_INSIGHTS_DEFAULT_PROMPT_GROUPS.every((group) => group.prompts.length > 0)).toBe(true);
    expect(AI_INSIGHTS_DEFAULT_PROMPT_GROUPS.flatMap((group) => group.prompts.map((prompt) => prompt.prompt)))
      .toEqual(AI_INSIGHTS_DEFAULT_PICKER_PROMPTS);
    expect(
      AI_INSIGHTS_DEFAULT_PROMPT_GROUPS.every((group) => (
        group.prompts.every((prompt) => prompt.category === group.category && pickerPromptSet.has(prompt.prompt))
      )),
    ).toBe(true);
  });

  it('marks unsupported suggestions from the shared prompt catalog', () => {
    const unsupportedPrompts = getAiInsightsPromptEntriesBySurface('unsupported').map((prompt) => prompt.prompt);

    expect(unsupportedPrompts.length).toBeGreaterThanOrEqual(3);
    expect(unsupportedPrompts.every((prompt) => AI_INSIGHTS_DEFAULT_PICKER_PROMPTS.includes(prompt))).toBe(true);
  });
});
