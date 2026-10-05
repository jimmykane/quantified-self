import { describe, expect, it } from 'vitest';
import { buildPaceAxisConfig, computePaceAxisScaling } from './pace-axis.helper';

describe('pace-axis.helper', () => {
  it('keeps a constant prescribed pace inside a positive, nonzero axis range', () => {
    const axis = buildPaceAxisConfig([300, 300]);
    expect(axis.inverse).toBe(true);
    expect(axis.min).toBeGreaterThan(0);
    expect(axis.min).toBeLessThan(300);
    expect(axis.max).toBeGreaterThan(300);
    expect(axis.interval).toBeGreaterThan(0);
  });

  it('preserves authored extremes even when most steps have a much narrower pace range', () => {
    const values = [...Array(20).fill(300), 270, 3390];
    const axis = buildPaceAxisConfig(values);
    expect(axis.min).toBeLessThan(270);
    expect(axis.max).toBeGreaterThan(3390);
    expect(values.at(-1)).toBe(3390);
  });

  it('provides a finite positive fallback for absent or nonfinite pace ranges', () => {
    const axis = buildPaceAxisConfig([NaN, Infinity, 0, -1]);
    expect(Number.isFinite(axis.min)).toBe(true);
    expect(Number.isFinite(axis.max)).toBe(true);
    expect(axis.min).toBeGreaterThan(0);
    expect(axis.max).toBeGreaterThan(axis.min);
  });

  it('should clamp axis when low outliers significantly stretch pace range', () => {
    const scaling = computePaceAxisScaling([
      25,
      295,
      300,
      305,
      310,
      315,
      320,
      325,
      330,
      335,
      340,
      345,
      350,
      355,
      360,
    ], 0.1);

    expect(scaling.strictMinMax).toBe(true);
    expect(scaling.min).toBeDefined();
    expect(scaling.max).toBeDefined();
    expect(scaling.min!).toBeGreaterThan(25);
    expect(scaling.min!).toBeLessThan(300);
    expect(scaling.max!).toBeLessThan(400);
    expect(scaling.extraMax).toBe(0);
  });

  it('should keep auto range when pace distribution has no strong outliers', () => {
    const scaling = computePaceAxisScaling([
      300,
      304,
      307,
      311,
      315,
      318,
      322,
      326,
      330,
      334,
      337,
      341,
    ], 0.1);

    expect(scaling.strictMinMax).toBe(false);
    expect(scaling.min).toBeUndefined();
    expect(scaling.max).toBeUndefined();
    expect(scaling.extraMax).toBe(0.1);
  });

  it('should cover a modest slow-end tail with a small cushion', () => {
    const scaling = computePaceAxisScaling([
      25,
      300,
      305,
      310,
      315,
      320,
      325,
      330,
      335,
      340,
      345,
      350,
      355,
      360,
      380,
    ], 0.1);

    expect(scaling.strictMinMax).toBe(true);
    expect(scaling.max).toBeDefined();
    expect(scaling.max!).toBeGreaterThan(380);
  });

  it('should keep extreme slow-end outliers bounded', () => {
    const scaling = computePaceAxisScaling([
      25,
      300,
      305,
      310,
      315,
      320,
      325,
      330,
      335,
      340,
      345,
      350,
      355,
      360,
      1200,
    ], 0);

    expect(scaling.strictMinMax).toBe(true);
    expect(scaling.max).toBeDefined();
    expect(scaling.max!).toBeLessThan(1250);
  });
});
