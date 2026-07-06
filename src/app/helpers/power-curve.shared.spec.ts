import { describe, expect, it } from 'vitest';
import {
  buildPowerCurveEnvelope,
  filterPowerCurvePointsByMaxDuration,
  normalizePowerCurvePoints,
  toPowerCurveFiniteNumber,
} from '@shared/power-curve';

describe('power-curve shared helpers', () => {
  it('normalizes primitive, wrapped, and nested numeric point values', () => {
    const result = normalizePowerCurvePoints([
      {
        duration: { getValue: () => 60 },
        power: { watts: 310 },
        wattsPerKg: '4.10',
      },
      {
        duration: '300',
        power: { getValue: () => '280' },
        wattsPerKg: { getValue: () => 3.7 },
      },
    ]);

    expect(result.droppedPointCount).toBe(0);
    expect(result.points).toEqual([
      { duration: 60, power: 310, wattsPerKg: 4.1 },
      { duration: 300, power: 280, wattsPerKg: 3.7 },
    ]);
  });

  it('keeps the strongest point for duplicate durations and uses watts-per-kg as a tie-breaker', () => {
    const result = normalizePowerCurvePoints([
      { duration: 60, power: 300, wattsPerKg: 3.8 },
      { duration: 60, power: 310, wattsPerKg: 3.7 },
      { duration: 60, power: 310, wattsPerKg: 4.1 },
    ]);

    expect(result.points).toEqual([
      { duration: 60, power: 310, wattsPerKg: 4.1 },
    ]);
  });

  it('tracks dropped malformed point samples without treating missing stats as malformed', () => {
    expect(normalizePowerCurvePoints(null)).toEqual({
      points: [],
      droppedPointCount: 0,
      droppedPointSamples: [],
    });

    const result = normalizePowerCurvePoints([
      null,
      { duration: 60, power: 0 },
      'bad',
    ]);

    expect(result.points).toEqual([]);
    expect(result.droppedPointCount).toBe(3);
    expect(result.droppedPointSamples).toHaveLength(3);
  });

  it('builds a best-power envelope across point collections without mutating source points', () => {
    const first = [{ duration: 60, power: 300, wattsPerKg: 4.0 }];
    const second = [{ duration: 60, power: 320, wattsPerKg: 3.9 }, { duration: 300, power: 260 }];

    const envelope = buildPowerCurveEnvelope([first, second]);

    expect(envelope).toEqual([
      { duration: 60, power: 320, wattsPerKg: 3.9 },
      { duration: 300, power: 260 },
    ]);
    expect(envelope[0]).not.toBe(second[0]);
  });

  it('filters points longer than the owning event or activity duration', () => {
    const points = [
      { duration: 300, power: 280 },
      { duration: 900, power: 220 },
      { duration: 1200, power: 190 },
    ];

    expect(filterPowerCurvePointsByMaxDuration(points, 1195.27)).toEqual([
      { duration: 300, power: 280 },
      { duration: 900, power: 220 },
    ]);
    expect(filterPowerCurvePointsByMaxDuration(points, 1199.2)).toEqual(points);
    expect(filterPowerCurvePointsByMaxDuration(points, null)).toEqual(points);
  });

  it('does not recurse forever on cyclic wrapper objects', () => {
    const cyclic: { value?: unknown; self?: unknown } = {};
    cyclic.value = { getValue: () => undefined };
    cyclic.self = cyclic;

    expect(toPowerCurveFiniteNumber(cyclic)).toBeNull();
  });
});
