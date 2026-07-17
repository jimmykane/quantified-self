import { describe, expect, it } from 'vitest';
import { segmentTrainingMetricText } from './training-metric-text.helper';

function metricText(value: string): string[] {
  return segmentTrainingMetricText(value)
    .filter(segment => segment.isMetric)
    .map(segment => segment.text);
}

describe('segmentTrainingMetricText', () => {
  it('keeps comparison language separate from its numeric value and unit', () => {
    expect(segmentTrainingMetricText('15% higher than usual')).toEqual([
      { text: '15%', isMetric: true },
      { text: ' higher than usual', isMetric: false },
    ]);
    expect(metricText('231 TSS higher')).toEqual(['231 TSS']);
    expect(metricText('2 active days higher')).toEqual(['2 active days']);
    expect(metricText('4/4 signals · 11 of 12 recent weeks')).toEqual(['4', '/4 signals', '11', '12 recent weeks']);
  });

  it('recognizes durations, physiological units, power ratios, pace, and signed deltas', () => {
    expect(metricText('8h 34m')).toEqual(['8h', '34m']);
    expect(metricText('224 W · 3.41 W/kg')).toEqual(['224 W', '3.41 W/kg']);
    expect(metricText('1:42 /100m faster')).toEqual(['1:42 /100m']);
    expect(metricText('±26m · −20m · +12 pts')).toEqual(['±26m', '−20m', '+12 pts']);
  });

  it('keeps connective copy in Inter-ready segments across compound summaries', () => {
    expect(metricText('11 activities in 90 days · 39 activities in 1 year')).toEqual([
      '11 activities',
      '90 days',
      '39 activities',
      '1 year',
    ]);
    expect(segmentTrainingMetricText('Same active days')).toEqual([
      { text: 'Same active days', isMetric: false },
    ]);
    expect(segmentTrainingMetricText('1,531, compared with usual')).toEqual([
      { text: '1,531', isMetric: true },
      { text: ', compared with usual', isMetric: false },
    ]);
  });
});
