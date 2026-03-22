import { describe, expect, it, vi } from 'vitest';
import {
  ChartDataValueTypes,
  DataJumpDistanceMax,
  DataJumpHangTimeMax,
} from '@sports-alliance/sports-lib';
import { getAiInsightsPromptEntriesBySurface } from '../../../../shared/ai-insights-prompts';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

import {
  findInsightMetricAliasMatch,
  getSuggestedInsightPrompts,
  getInsightMetricDefinition,
  isAggregationAllowedForMetric,
  resolveMetricVariantAlias,
  resolveInsightMetric,
} from './metric-catalog';

describe('metric-catalog', () => {
  it('resolves supported metrics from aliases', () => {
    expect(resolveInsightMetric('avg cadence')?.key).toBe('cadence');
    expect(resolveInsightMetric('mileage')?.key).toBe('distance');
    expect(resolveInsightMetric('gap')?.key).toBe('grade_adjusted_pace');
    expect(resolveInsightMetric('effort pace')?.key).toBe('effort_pace');
    expect(resolveInsightMetric('swim pace')?.key).toBe('swim_pace');
    expect(resolveInsightMetric('tss')?.key).toBe('training_stress_score');
    expect(resolveInsightMetric('normalized power')?.key).toBe('normalized_power');
    expect(resolveInsightMetric('intensity factor')?.key).toBe('intensity_factor');
    expect(resolveInsightMetric('power work')?.key).toBe('power_work');
    expect(resolveInsightMetric('vo2 max')?.key).toBe('vo2_max');
    expect(resolveInsightMetric('epoc')?.key).toBe('epoc');
    expect(resolveInsightMetric('avg vam')?.key).toBe('avg_vam');
    expect(resolveInsightMetric('aerobic training effect')?.key).toBe('aerobic_training_effect');
    expect(resolveInsightMetric('anaerobic training effect')?.key).toBe('anaerobic_training_effect');
    expect(resolveInsightMetric('recovery time')?.key).toBe('recovery_time');
    expect(resolveInsightMetric('longest jump')?.key).toBe('jump_distance');
    expect(resolveInsightMetric('highest jump')?.key).toBe('jump_height');
    expect(resolveInsightMetric('biggest jump')?.key).toBe('jump_distance');
    expect(resolveInsightMetric('air time')?.key).toBe('jump_hang_time');
  });

  it('resolves family metrics to the correct concrete max data type', () => {
    expect(resolveInsightMetric('heart rate', ChartDataValueTypes.Maximum)?.dataType).toBe('Maximum Heart Rate');
    expect(resolveInsightMetric('max heart rate', ChartDataValueTypes.Average)?.dataType).toBe('Maximum Heart Rate');
    expect(resolveInsightMetric('gap', ChartDataValueTypes.Maximum)?.dataType).toBe('Maximum Grade Adjusted Pace');
    expect(resolveInsightMetric('effort pace', ChartDataValueTypes.Minimum)?.dataType).toBe('Minimum Effort Pace');
    expect(resolveInsightMetric('swim pace', ChartDataValueTypes.Maximum)?.dataType).toBe('Maximum Swim Pace');
    expect(resolveInsightMetric('longest jump', ChartDataValueTypes.Maximum)?.dataType).toBe(DataJumpDistanceMax.type);
    expect(resolveInsightMetric('biggest jump', ChartDataValueTypes.Maximum)?.dataType).toBe(DataJumpDistanceMax.type);
    expect(resolveInsightMetric('biggest hang time', ChartDataValueTypes.Maximum)?.dataType).toBe(DataJumpHangTimeMax.type);
  });

  it('prefers the explicit prompt alias that matches the requested family variant', () => {
    const heartRateMetric = resolveInsightMetric('heart rate');
    expect(heartRateMetric).toBeTruthy();
    if (!heartRateMetric) {
      return;
    }

    expect(resolveMetricVariantAlias(
      heartRateMetric,
      'What was my highest average heart rate last month',
    )).toBe('average heart rate');
    expect(resolveMetricVariantAlias(
      heartRateMetric,
      'What was my highest max heart rate last month',
    )).toBe('max heart rate');
  });

  it('returns null for unsupported metrics', () => {
    expect(resolveInsightMetric('ground contact time')).toBeNull();
  });

  it('finds the most specific alias inside the original prompt text', () => {
    expect(findInsightMetricAliasMatch('Show my average gap for trail running this month')).toEqual(
      expect.objectContaining({
        alias: 'average gap',
        metric: expect.objectContaining({ key: 'grade_adjusted_pace' }),
      }),
    );
    expect(findInsightMetricAliasMatch('Show my effort pace for running this month')).toEqual(
      expect.objectContaining({
        alias: 'effort pace',
        metric: expect.objectContaining({ key: 'effort_pace' }),
      }),
    );
    expect(findInsightMetricAliasMatch('Show my swim pace over time')).toEqual(
      expect.objectContaining({
        alias: 'swim pace',
        metric: expect.objectContaining({ key: 'swim_pace' }),
      }),
    );
    expect(findInsightMetricAliasMatch('Show my average anaerobic training effect this month')).toEqual(
      expect.objectContaining({
        alias: 'average anaerobic training effect',
        metric: expect.objectContaining({ key: 'anaerobic_training_effect' }),
      }),
    );
  });

  it('exposes the supported aggregation set for each metric', () => {
    expect(isAggregationAllowedForMetric('distance', ChartDataValueTypes.Total)).toBe(true);
    expect(isAggregationAllowedForMetric('cadence', ChartDataValueTypes.Total)).toBe(false);
    expect(isAggregationAllowedForMetric('training_stress_score', ChartDataValueTypes.Total)).toBe(true);
    expect(isAggregationAllowedForMetric('normalized_power', ChartDataValueTypes.Total)).toBe(false);
    expect(isAggregationAllowedForMetric('recovery_time', ChartDataValueTypes.Maximum)).toBe(true);
  });

  it('can retrieve canonical metric definitions by key', () => {
    expect(getInsightMetricDefinition('power')?.dataType).toBeTruthy();
    expect(getInsightMetricDefinition('jump_height')?.suggestedPrompt).toBe('Show my jump height over time in the last 90 days.');
    expect(getInsightMetricDefinition('jump_distance')?.suggestedPrompt).toBe('Show my jump distance over time this season.');
    expect(getInsightMetricDefinition('jump_hang_time')?.suggestedPrompt).toBe('Show my jump hang time over time in the last 90 days.');
  });

  it('prioritizes context-matching suggested prompts instead of always returning the first metrics', () => {
    expect(getSuggestedInsightPrompts(3, 'show cadence per kilometer splits')[0]).toBe(
      'Tell me my average cadence for cycling over the last 3 months.',
    );
    expect(getSuggestedInsightPrompts(3, 'show average power per lap')[0]).toBe(
      'Show my average power over time for cycling in the last 90 days.',
    );
    expect(getSuggestedInsightPrompts(3, 'show swim pace per lap')[0]).toBe(
      'Show my average swim pace over time for swimming in the last 90 days.',
    );
  });

  it('returns unique unsupported suggestions from the shared prompt catalog', () => {
    const sharedUnsupportedPromptSet = new Set(
      getAiInsightsPromptEntriesBySurface('unsupported').map((prompt) => prompt.prompt),
    );
    const suggestions = getSuggestedInsightPrompts(5, 'show cadence per lap and splits');

    expect(new Set(suggestions).size).toBe(suggestions.length);
    expect(suggestions.every((prompt) => sharedUnsupportedPromptSet.has(prompt))).toBe(true);
  });
});
