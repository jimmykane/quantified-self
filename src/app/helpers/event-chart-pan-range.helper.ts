import type { EventChartRange } from './event-chart-range.helper';

/** Moves a fixed-width x-axis window with a horizontal finger drag. */
export function resolveEventChartPanRange(
  domain: EventChartRange,
  initialRange: EventChartRange,
  axisPixelSpan: number,
  deltaX: number,
): EventChartRange | null {
  const domainSpan = domain.end - domain.start;
  const rangeSpan = initialRange.end - initialRange.start;
  if (
    ![domain.start, domain.end, initialRange.start, initialRange.end, axisPixelSpan, deltaX]
      .every(Number.isFinite)
    || domainSpan <= 0 || rangeSpan <= 0 || rangeSpan > domainSpan || axisPixelSpan <= 0
  ) {
    return null;
  }

  const requestedStart = initialRange.start - (deltaX / axisPixelSpan) * rangeSpan;
  const start = Math.max(domain.start, Math.min(domain.end - rangeSpan, requestedStart));
  return { start, end: start + rangeSpan };
}
