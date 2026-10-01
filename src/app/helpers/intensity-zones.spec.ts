import { describe, expect, it } from 'vitest';
import { groupRecordedIntensityZones, hasCurrentIntensityPolicy, INTENSITY_POLICY_VERSION } from '@shared/intensity-zones';
import { DERIVED_METRIC_KINDS } from '@shared/derived-metrics';

describe('recorded intensity zones', () => {
  it('groups HR Z3 as moderate and Z4–5 as hard', () => {
    expect(groupRecordedIntensityZones([], [100, 200, 300, 400, 500])).toEqual({
      source: 'heart-rate', easySeconds: 300, moderateSeconds: 300, hardSeconds: 900, totalSeconds: 1500,
    });
  });
  it('uses power first, with Z4 moderate and Z5–7 hard', () => {
    expect(groupRecordedIntensityZones([10, 20, 30, 40, 50, 60, 70], [100, 200, 300, 400, 500])).toEqual({
      source: 'power', easySeconds: 30, moderateSeconds: 70, hardSeconds: 180, totalSeconds: 280,
    });
  });
  it('falls back to HR after excluding invalid power durations', () => {
    expect(groupRecordedIntensityZones([NaN, -1, Infinity, '20', null], [null, 0, 0, 60])?.hardSeconds).toBe(60);
    expect(groupRecordedIntensityZones([0], [0, -1, NaN])).toBeNull();
    expect(groupRecordedIntensityZones([], [])).toBeNull();
    expect(groupRecordedIntensityZones([60], [Number.MAX_VALUE, Number.MAX_VALUE])?.source).toBe('power');
    expect(groupRecordedIntensityZones([Number.MAX_VALUE, Number.MAX_VALUE], [60])?.source).toBe('heart-rate');
  });
  it('requires the current policy only for affected snapshots', () => {
    for (const kind of ['intensity_distribution', 'easy_percent', 'hard_percent', 'training_summary', 'training_build_comparison']) {
      expect(hasCurrentIntensityPolicy(kind, {})).toBe(false);
      expect(hasCurrentIntensityPolicy(kind, { intensityPolicyVersion: INTENSITY_POLICY_VERSION })).toBe(true);
      expect(hasCurrentIntensityPolicy(kind, { intensityPolicyVersion: 0 })).toBe(false);
    }
    expect(hasCurrentIntensityPolicy(DERIVED_METRIC_KINDS.Form, {})).toBe(true);
  });
});
