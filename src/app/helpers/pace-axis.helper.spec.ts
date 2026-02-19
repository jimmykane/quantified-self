import { describe, expect, it } from 'vitest';
import { computePaceAxisScaling } from './pace-axis.helper';

describe('pace-axis.helper', () => {
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
});
