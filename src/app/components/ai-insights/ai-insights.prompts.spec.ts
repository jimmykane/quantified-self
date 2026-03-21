import { describe, expect, it } from 'vitest';
import {
  AI_INSIGHTS_PROMPT_CATALOG,
  getAiInsightsDefaultMetricPrompt,
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

  it('includes new jump prompts in the default picker catalog', () => {
    const pickerPromptSet = new Set(AI_INSIGHTS_DEFAULT_PICKER_PROMPTS);
    const expectedJumpPrompts = [
      'Find my longest jump.',
      'Find my highest jump.',
      'Find my biggest hang time.',
      'Show my jump height over time in the last 90 days.',
      'Show my jump distance over time this season.',
    ];

    expect(expectedJumpPrompts.every((prompt) => pickerPromptSet.has(prompt))).toBe(true);
  });

  it('includes latest-event and multi-metric prompts in picker and hero sets', () => {
    const pickerPromptSet = new Set(AI_INSIGHTS_DEFAULT_PICKER_PROMPTS);
    const featuredPromptSet = new Set(AI_INSIGHTS_FEATURED_PROMPTS);

    expect(pickerPromptSet.has('When was my last ride?')).toBe(true);
    expect(pickerPromptSet.has('When was my last run?')).toBe(true);
    expect(pickerPromptSet.has('When was my last swim?')).toBe(true);
    expect(pickerPromptSet.has('Show me avg cadence and avg power for the last 3 months for cycling.')).toBe(true);
    expect(pickerPromptSet.has('Compare my max heart rate in 2024 and 2025.')).toBe(true);
    expect(pickerPromptSet.has('Find my biggest jump.')).toBe(true);

    expect(featuredPromptSet.has('When was my last ride?')).toBe(true);
    expect(featuredPromptSet.has('Show me avg cadence and avg power for the last 3 months for cycling.')).toBe(true);
    expect(featuredPromptSet.has('Show my max heart rate last month as stacked columns by activity type over time.')).toBe(false);
  });

  it('resolves unsupported default prompts for all jump metrics', () => {
    expect(getAiInsightsDefaultMetricPrompt('jump_height')).toBe('Show my jump height over time in the last 90 days.');
    expect(getAiInsightsDefaultMetricPrompt('jump_hang_time')).toBe('Show my jump hang time over time in the last 90 days.');
    expect(getAiInsightsDefaultMetricPrompt('jump_distance')).toBe('Show my jump distance over time this season.');
    expect(getAiInsightsDefaultMetricPrompt('jump_speed')).toBe('Show my jump speed over time in the last 90 days.');
    expect(getAiInsightsDefaultMetricPrompt('jump_rotations')).toBe('Show my jump rotations over time in the last 90 days.');
    expect(getAiInsightsDefaultMetricPrompt('jump_score')).toBe('Show my jump score over time in the last 90 days.');
  });
});
