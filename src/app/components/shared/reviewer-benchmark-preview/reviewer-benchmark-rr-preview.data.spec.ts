import { describe, expect, it } from 'vitest';
import { DistanceUnits } from '@sports-alliance/sports-lib';
import { getDefaultUserUnitSettings } from '@shared/unit-aware-display';
import { REVIEWER_RR_BEATS, REVIEWER_RR_CHART_DESCRIPTION, REVIEWER_RR_EXCERPT_DURATION_MS, REVIEWER_RR_SUMMARY,
  buildReviewerRRChartOption, buildReviewerRRMetricRows } from './reviewer-benchmark-rr-preview.data';

describe('public reviewer R–R sample', () => {
  it('retains only the first 90 seconds of relative beat data and algorithmic flags', () => {
    expect(REVIEWER_RR_EXCERPT_DURATION_MS).toBe(90_000);
    expect(REVIEWER_RR_BEATS).toHaveLength(151);
    expect(REVIEWER_RR_BEATS.slice(0, 4).map(beat => [beat.time, beat.interval])).toEqual([
      [613, 613], [1324, 711], [1751, 427], [2696, 945],
    ]);
    for (const [index, beat] of REVIEWER_RR_BEATS.entries()) {
      expect(Object.keys(beat).sort()).toEqual(['classification', 'interval', 'segment', 'time']);
      expect(Number.isFinite(beat.time) && Number.isFinite(beat.interval)).toBe(true);
      expect(beat.time).toBeGreaterThan(index ? REVIEWER_RR_BEATS[index - 1].time : 0);
      expect(beat.time).toBeLessThanOrEqual(90_000);
      expect(beat.interval).toBeGreaterThan(0);
      expect(beat.segment).toBe(0);
      expect(['accepted', 'short', 'long', 'out-of-range', 'suspected-ectopic']).toContain(beat.classification);
    }
    expect(REVIEWER_RR_BEATS.filter(beat => beat.classification !== 'accepted')).toHaveLength(7);
    expect(Object.keys(REVIEWER_RR_SUMMARY).sort()).toEqual(['artifactPercentage', 'coveragePercentage', 'rmssd']);
  });

  it.each([DistanceUnits.Kilometers, DistanceUnits.Miles])('keeps verified full-recording values canonical with %s preferences', distanceUnits => {
    expect(buildReviewerRRMetricRows({ ...getDefaultUserUnitSettings(), distanceUnits })).toEqual([
      { label: 'R–R coverage', display: '100.0 %' },
      { label: 'Artifacts', display: '1.5 %' },
      { label: 'RMSSD', display: '8.1 ms' },
    ]);
    const excerptFlagPercentage = 100 * REVIEWER_RR_BEATS.filter(beat => beat.classification !== 'accepted').length / REVIEWER_RR_BEATS.length;
    expect(REVIEWER_RR_SUMMARY.artifactPercentage).not.toBeCloseTo(excerptFlagPercentage, 1);
  });

  it.each([false, true])('plots one recorded source without zoom controls, input handlers or fixture mutations (dark: %s)', darkTheme => {
    const before = JSON.stringify(REVIEWER_RR_BEATS);
    const option = buildReviewerRRChartOption(darkTheme, 320);
    expect(option.xAxis).toMatchObject({ min: 0, max: 90_000 });
    expect([0, 30_000, 60_000, 90_000].map(option.xAxis.axisLabel.formatter))
      .toEqual(['00:00', '00:30', '01:00', '01:30']);
    expect(option.dataZoom).toEqual([]);
    expect(option.tooltip).toEqual({ show: false });
    expect(option.animation).toBe(false);
    expect(option.aria).toEqual({ enabled: true, label: { description: REVIEWER_RR_CHART_DESCRIPTION } });
    expect(option.aria.label.description).toContain('First 90 seconds of one anonymized recorded R–R signal');
    expect(option.aria.label.description).toContain('full-recording HRV statistics');
    expect(option.series).toHaveLength(3);
    expect(option.series.map(series => series.type)).toEqual(['line', 'scatter', 'scatter']);
    expect(option.series.every(series => series.silent === true)).toBe(true);
    expect(option.series[0]).toMatchObject({ id: 'recorded-rr-sample:rr', connectNulls: false });
    expect(option.series[0].data).toHaveLength(151);
    expect(option.series.slice(1).flatMap(series => series.data)).toHaveLength(7);
    expect(JSON.stringify(REVIEWER_RR_BEATS)).toBe(before);
  });
});
