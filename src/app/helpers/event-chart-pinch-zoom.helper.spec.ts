import { describe, expect, it } from 'vitest';
import { resolveEventChartPinchRange } from './event-chart-pinch-zoom.helper';

describe('resolveEventChartPinchRange', () => {
  const domain = { start: 0, end: 100 };
  const initialRange = { start: 20, end: 80 };
  const axisPixels = { start: 0, end: 300 };
  const initial = {
    first: { clientX: 100, clientY: 100 },
    second: { clientX: 200, clientY: 100 },
  };

  const horizontalGesture = (firstX: number, secondX: number) => ({
    first: { clientX: firstX, clientY: 100 },
    second: { clientX: secondX, clientY: 100 },
  });

  it('zooms only the x range around the two-finger center', () => {
    expect(resolveEventChartPinchRange(domain, initialRange, axisPixels, initial,
      horizontalGesture(50, 250))).toEqual({ start: 35, end: 65 });
  });

  it('zooms the x range for a vertical pinch', () => {
    expect(resolveEventChartPinchRange(domain, initialRange, axisPixels, {
      first: { clientX: 150, clientY: 100 }, second: { clientX: 150, clientY: 200 },
    }, {
      first: { clientX: 150, clientY: 50 }, second: { clientX: 150, clientY: 250 },
    })).toEqual({ start: 35, end: 65 });
  });

  it('moves the visible range when the two-finger center moves', () => {
    expect(resolveEventChartPinchRange(domain, initialRange, axisPixels, initial,
      horizontalGesture(100, 300))).toEqual({ start: 30, end: 60 });
  });

  it('clamps a zoom-out to the complete event domain', () => {
    expect(resolveEventChartPinchRange(domain, initialRange, axisPixels, initial,
      horizontalGesture(130, 170))).toEqual(domain);
  });

  it('ignores invalid chart geometry and coincident initial fingers', () => {
    expect(resolveEventChartPinchRange(domain, initialRange, axisPixels,
      horizontalGesture(150, 150), horizontalGesture(50, 250))).toBeNull();
    expect(resolveEventChartPinchRange(domain, initialRange, { start: 0, end: 0 }, initial,
      horizontalGesture(50, 250))).toBeNull();
  });
});
