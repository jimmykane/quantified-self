import { describe, expect, it } from 'vitest';
import { resolveEventChartPanRange } from './event-chart-pan-range.helper';

describe('resolveEventChartPanRange', () => {
  const domain = { start: 0, end: 100 };
  const initialRange = { start: 20, end: 60 };

  it('moves the visible range opposite the finger movement without changing its width', () => {
    expect(resolveEventChartPanRange(domain, initialRange, 200, 50))
      .toEqual({ start: 10, end: 50 });
    expect(resolveEventChartPanRange(domain, initialRange, 200, -50))
      .toEqual({ start: 30, end: 70 });
  });

  it('stops at the event bounds and leaves an unzoomed chart in place', () => {
    expect(resolveEventChartPanRange(domain, initialRange, 200, 500))
      .toEqual({ start: 0, end: 40 });
    expect(resolveEventChartPanRange(domain, initialRange, 200, -500))
      .toEqual({ start: 60, end: 100 });
    expect(resolveEventChartPanRange(domain, domain, 200, 50)).toEqual(domain);
  });

  it('rejects invalid axis geometry and nonfinite movement', () => {
    expect(resolveEventChartPanRange(domain, initialRange, 0, 50)).toBeNull();
    expect(resolveEventChartPanRange(domain, initialRange, 200, Number.NaN)).toBeNull();
  });
});
