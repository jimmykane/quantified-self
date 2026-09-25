import { describe, expect, it } from 'vitest';
import { resolveEventChartPinchRange } from './event-chart-pinch-zoom.helper';

describe('resolveEventChartPinchRange', () => {
  const domain = { start: 0, end: 100 };
  const initialRange = { start: 20, end: 80 };
  const axisPixels = { start: 0, end: 300 };
  const initial = { firstX: 100, secondX: 200 };

  it('zooms only the x range around the two-finger center', () => {
    expect(resolveEventChartPinchRange(domain, initialRange, axisPixels, initial,
      { firstX: 50, secondX: 250 })).toEqual({ start: 35, end: 65 });
  });

  it('moves the visible range when the two-finger center moves', () => {
    expect(resolveEventChartPinchRange(domain, initialRange, axisPixels, initial,
      { firstX: 100, secondX: 300 })).toEqual({ start: 30, end: 60 });
  });

  it('clamps a zoom-out to the complete event domain', () => {
    expect(resolveEventChartPinchRange(domain, initialRange, axisPixels, initial,
      { firstX: 130, secondX: 170 })).toEqual(domain);
  });

  it('ignores crossed fingers and invalid chart geometry', () => {
    expect(resolveEventChartPinchRange(domain, initialRange, axisPixels, initial,
      { firstX: 210, secondX: 190 })).toBeNull();
    expect(resolveEventChartPinchRange(domain, initialRange, { start: 0, end: 0 }, initial,
      { firstX: 50, secondX: 250 })).toBeNull();
  });
});
