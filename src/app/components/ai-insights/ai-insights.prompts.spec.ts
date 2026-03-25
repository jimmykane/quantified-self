import { describe, expect, it } from 'vitest';
import {
  AI_INSIGHTS_PROMPT_CATALOG,
  getAiInsightsDefaultMetricPrompt,
  getAiInsightsPromptEntriesBySurface,
} from '@shared/ai-insights-prompts';
import {
  AI_INSIGHTS_DEFAULT_PICKER_PROMPTS,
  AI_INSIGHTS_DEFAULT_POPULAR_PROMPT_GROUPS,
  AI_INSIGHTS_DEFAULT_PROMPT_GROUPS,
  AI_INSIGHTS_DEFAULT_PROMPT_SECTIONS,
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

  it('keeps the technical metric prompt groups valid', () => {
    const metricPromptSet = new Set(
      AI_INSIGHTS_DEFAULT_PROMPT_GROUPS.flatMap((group) => group.prompts.map((prompt) => prompt.prompt)),
    );

    expect(AI_INSIGHTS_DEFAULT_PROMPT_GROUPS.length).toBeGreaterThan(0);
    expect(AI_INSIGHTS_DEFAULT_PROMPT_GROUPS.every((group) => group.prompts.length > 0)).toBe(true);
    expect(
      AI_INSIGHTS_DEFAULT_PROMPT_GROUPS.every((group) => (
        group.prompts.every((prompt) => prompt.category === group.category && metricPromptSet.has(prompt.prompt))
      )),
    ).toBe(true);
  });

  it('builds default prompt sections with popular prompts first and metric browsing second', () => {
    expect(AI_INSIGHTS_DEFAULT_PROMPT_SECTIONS.map((section) => section.title)).toEqual([
      'Popular Ways To Ask',
      'Browse By Metric',
    ]);

    const popularPrompts = AI_INSIGHTS_DEFAULT_POPULAR_PROMPT_GROUPS
      .flatMap((group) => group.prompts.map((prompt) => prompt.prompt));

    expect(popularPrompts).toEqual([
      'When was my last ride?',
      'When was my last run?',
      'When was my last swim?',
      'Show my training time over time this year.',
      'Show my distance by sport this year.',
      'Show my running heart rate over time this year.',
      'Show my cycling power over time this year.',
      'Show my average pace trend for running this year.',
      'Show cadence vs power over time in the last 3 months for cycling.',
      'Compare my power curve over the last 3 months.',
      'Compare my weekly distance for the last 8 weeks.',
      'Compare my max heart rate in 2024 vs 2025.',
      'What is my best power curve?',
      'What was my maximum heartrate all time?',
      'When did I have my longest jump?',
      'When did I have my biggest jump?',
      'Which rides had my highest power output this month?',
    ]);
  });

  it('marks unsupported suggestions from the shared prompt catalog', () => {
    const unsupportedPrompts = getAiInsightsPromptEntriesBySurface('unsupported').map((prompt) => prompt.prompt);
    const sharedPromptSet = new Set(AI_INSIGHTS_PROMPT_CATALOG.map((prompt) => prompt.prompt));

    expect(unsupportedPrompts.length).toBeGreaterThanOrEqual(3);
    expect(unsupportedPrompts.every((prompt) => sharedPromptSet.has(prompt))).toBe(true);
  });

  it('includes new jump prompts in the default picker catalog', () => {
    const pickerPromptSet = new Set(AI_INSIGHTS_DEFAULT_PICKER_PROMPTS);
    const expectedJumpPrompts = [
      'Find my longest jump.',
      'Find my biggest hang time.',
      'Show my jump distance over time this season.',
      'Show my weight over time this year.',
      'When did I have my lowest weight?',
    ];

    expect(expectedJumpPrompts.every((prompt) => pickerPromptSet.has(prompt))).toBe(true);
  });

  it('includes latest-event and multi-metric prompts in picker and hero sets', () => {
    const pickerPromptSet = new Set(AI_INSIGHTS_DEFAULT_PICKER_PROMPTS);
    const featuredPromptSet = new Set(AI_INSIGHTS_FEATURED_PROMPTS);

    expect(pickerPromptSet.has('When was my last ride?')).toBe(true);
    expect(pickerPromptSet.has('When was my last run?')).toBe(true);
    expect(pickerPromptSet.has('When was my last swim?')).toBe(true);
    expect(pickerPromptSet.has('Show cadence vs power over time in the last 3 months for cycling.')).toBe(true);
    expect(pickerPromptSet.has('Show my average pace trend for running this year.')).toBe(true);
    expect(pickerPromptSet.has('Compare my weekly distance for the last 8 weeks.')).toBe(true);
    expect(pickerPromptSet.has('Compare my max heart rate in 2024 vs 2025.')).toBe(true);
    expect(pickerPromptSet.has('Compare my power curve over the last 3 months.')).toBe(true);
    expect(pickerPromptSet.has('What is my best power curve?')).toBe(true);
    expect(pickerPromptSet.has('What was my maximum heartrate all time?')).toBe(true);
    expect(pickerPromptSet.has('When did I have my biggest jump?')).toBe(true);
    expect(pickerPromptSet.has('Which rides had my highest power output this month?')).toBe(true);

    expect(featuredPromptSet.has('When was my last ride?')).toBe(true);
    expect(featuredPromptSet.has('Show my training time over time this year.')).toBe(true);
    expect(featuredPromptSet.has('Show my running heart rate over time this year.')).toBe(true);
    expect(featuredPromptSet.has('Show my cycling power over time this year.')).toBe(true);
    expect(featuredPromptSet.has('Show my average pace trend for running this year.')).toBe(true);
    expect(featuredPromptSet.has('Show cadence vs power over time in the last 3 months for cycling.')).toBe(true);
    expect(featuredPromptSet.has('Compare my power curve over the last 3 months.')).toBe(true);
    expect(featuredPromptSet.has('What is my best power curve?')).toBe(true);
    expect(featuredPromptSet.has('Compare my weekly distance for the last 8 weeks.')).toBe(true);
    expect(featuredPromptSet.has('What was my maximum heartrate all time?')).toBe(true);
    expect(featuredPromptSet.has('Which rides had my highest power output this month?')).toBe(true);
    expect(AI_INSIGHTS_FEATURED_PROMPTS).toEqual([
      'When was my last ride?',
      'Show my training time over time this year.',
      'Show my running heart rate over time this year.',
      'Show my cycling power over time this year.',
      'Show my average pace trend for running this year.',
      'Show cadence vs power over time in the last 3 months for cycling.',
      'What is my best power curve?',
      'Compare my power curve over the last 3 months.',
      'Compare my weekly distance for the last 8 weeks.',
      'What was my maximum heartrate all time?',
      'Which rides had my highest power output this month?',
    ]);
  });

  it('resolves unsupported default prompts for jump metrics in the shared catalog', () => {
    expect(getAiInsightsDefaultMetricPrompt('jump_hang_time')).toBe('Show my jump hang time over time this year.');
    expect(getAiInsightsDefaultMetricPrompt('jump_distance')).toBe('Show my jump distance over time this season.');
    expect(getAiInsightsDefaultMetricPrompt('jump_speed')).toBe('Show my jump speed over time this year.');
    expect(getAiInsightsDefaultMetricPrompt('jump_score')).toBe('Show my jump score over time this year.');
    expect(getAiInsightsDefaultMetricPrompt('body_weight')).toBe('Show my weight over time this year.');
  });
});
