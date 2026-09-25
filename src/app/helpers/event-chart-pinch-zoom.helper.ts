import type { EventChartRange } from './event-chart-range.helper';

export interface EventChartPinchPoints {
  firstX: number;
  secondX: number;
}

/** Maps two tracked fingers back onto the original x-axis values. */
export function resolveEventChartPinchRange(
  domain: EventChartRange,
  initialRange: EventChartRange,
  axisPixels: EventChartRange,
  initial: EventChartPinchPoints,
  current: EventChartPinchPoints,
): EventChartRange | null {
  const domainSpan = domain.end - domain.start;
  const initialSpan = initialRange.end - initialRange.start;
  const pixelSpan = axisPixels.end - axisPixels.start;
  const initialDistance = initial.secondX - initial.firstX;
  const currentDistance = current.secondX - current.firstX;
  if (
    ![domainSpan, initialSpan, pixelSpan, initialDistance, currentDistance,
      initial.firstX, initial.secondX, current.firstX, current.secondX].every(Number.isFinite)
    || domainSpan <= 0 || initialSpan <= 0 || pixelSpan <= 0
    || Math.abs(initialDistance) < 1 || initialDistance * currentDistance <= 0
  ) {
    return null;
  }

  const span = Math.min(domainSpan, Math.max(domainSpan / 1000000,
    initialSpan * Math.abs(initialDistance / currentDistance)));
  if (span >= domainSpan) {
    return domain;
  }

  const initialCenter = (initial.firstX + initial.secondX) / 2;
  const currentCenter = (current.firstX + current.secondX) / 2;
  const anchorValue = initialRange.start
    + ((initialCenter - axisPixels.start) / pixelSpan) * initialSpan;
  const requestedStart = anchorValue - ((currentCenter - axisPixels.start) / pixelSpan) * span;
  const start = Math.max(domain.start, Math.min(domain.end - span, requestedStart));
  return { start, end: start + span };
}
