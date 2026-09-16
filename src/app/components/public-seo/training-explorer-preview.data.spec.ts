import { describe, expect, it } from 'vitest';
import { DataDistance, DistanceUnits } from '@sports-alliance/sports-lib';
import { formatUnitAwareDataValue, normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { buildTrainingPreviewBuildRows, buildTrainingPreviewMix, TRAINING_PREVIEW_DURABILITY, TRAINING_PREVIEW_POWER, TRAINING_PREVIEW_READINESS, TRAINING_PREVIEW_SPORTS } from './training-explorer-preview.data';

describe('Training public example fixtures', () => {
  it('uses deterministic readiness variation with consistent status and coverage', () => {
    expect(TRAINING_PREVIEW_READINESS).toHaveLength(14);
    expect(new Set(TRAINING_PREVIEW_READINESS.map(p => p.score)).size).toBeGreaterThan(8);
    for (const point of TRAINING_PREVIEW_READINESS) {
      expect(point.score).toBeGreaterThanOrEqual(0);
      expect(point.score).toBeLessThanOrEqual(100);
      expect(point.statusLabel).toBe(point.score! >= 75 ? 'Ready' : point.score! >= 55 ? 'Mixed' : 'Recover');
      expect(point.availableSignalCount).toBe(4);
    }
    expect(TRAINING_PREVIEW_READINESS.at(-1)?.score).toBe(78);
  });

  it('preserves unavailable capacity and durability as gaps', () => {
    for (const trend of TRAINING_PREVIEW_POWER) {
      expect(trend.points).toHaveLength(12);
      expect(trend.points.some(p => p.value === null)).toBe(true);
      expect(trend.points.at(-1)?.isCurrent).toBe(true);
      expect(trend.points.at(-1)?.dayMs).toBe(trend.rangeEndDayMs);
      expect(trend.points.every(p => p.dayMs >= trend.rangeStartDayMs)).toBe(true);
    }
    const gaps = TRAINING_PREVIEW_DURABILITY.points.filter(p => p.value === null);
    expect(gaps).toHaveLength(TRAINING_PREVIEW_DURABILITY.noEligibleWeekCount);
    expect(gaps.every(p => p.eligibleSampleCount === 0 && !p.hasEligibleSamples)).toBe(true);
    expect(TRAINING_PREVIEW_DURABILITY.points.reduce((sum, p) => sum + p.sourceActivityCount, 0)).toBe(36);
    expect(TRAINING_PREVIEW_DURABILITY.points.reduce((sum, p) => sum + p.eligibleSampleCount, 0)).toBe(20);
  });

  it('keeps each sport separate and its displayed zone shares consistent', () => {
    for (const sport of TRAINING_PREVIEW_SPORTS) {
      const view = buildTrainingPreviewMix(sport);
      expect(view.label).toBe(sport);
      expect(view.zones.reduce((sum, z) => sum + z.currentPercent!, 0)).toBe(100);
      expect(view.zones.reduce((sum, z) => sum + z.baselinePercent!, 0)).toBe(100);
    }
  });

  it.each([DistanceUnits.Kilometers, DistanceUnits.Miles])('formats build distance through Sports Lib with %s', distanceUnit => {
    const units = normalizeUserUnitSettings({ distanceUnits: distanceUnit });
    const row = buildTrainingPreviewBuildRows(units).find(r => r.label === 'Distance')!;
    expect(row.currentText).toBe(formatUnitAwareDataValue(DataDistance.type, 812000, units));
    expect(row.benchmarkText).toBe(formatUnitAwareDataValue(DataDistance.type, 746000, units));
    expect(row.currentText.toLowerCase()).toContain(distanceUnit === DistanceUnits.Miles ? 'mi' : 'km');
    expect(row.deltaText).toBe('+' + formatUnitAwareDataValue(DataDistance.type, 66000, units));
  });
});
