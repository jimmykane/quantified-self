import type { EventChartRange } from './event-chart-range.helper';

export interface EventChartPinchGesture {
  first: { clientX: number; clientY: number };
  second: { clientX: number; clientY: number };
}

/** Maps two tracked fingers back onto the original x-axis values. */
export function resolveEventChartPinchRange(
  domain: EventChartRange,
  initialRange: EventChartRange,
  axisPixels: EventChartRange,
  initial: EventChartPinchGesture,
  current: EventChartPinchGesture,
): EventChartRange | null {
  const domainSpan = domain.end - domain.start;
  const initialSpan = initialRange.end - initialRange.start;
  const pixelSpan = axisPixels.end - axisPixels.start;
  const initialDistance = Math.hypot(
    initial.second.clientX - initial.first.clientX,
    initial.second.clientY - initial.first.clientY,
  );
  const currentDistance = Math.hypot(
    current.second.clientX - current.first.clientX,
    current.second.clientY - current.first.clientY,
  );
  if (
    ![domainSpan, initialSpan, pixelSpan, initialDistance, currentDistance,
      initial.first.clientX, initial.first.clientY, initial.second.clientX, initial.second.clientY,
      current.first.clientX, current.first.clientY, current.second.clientX, current.second.clientY].every(Number.isFinite)
    || domainSpan <= 0 || initialSpan <= 0 || pixelSpan <= 0
    || initialDistance < 1
  ) {
    return null;
  }

  const span = Math.min(domainSpan, Math.max(domainSpan / 1000000,
    currentDistance > 0 ? initialSpan * initialDistance / currentDistance : domainSpan));
  if (span >= domainSpan) {
    return domain;
  }

  const initialCenter = (initial.first.clientX + initial.second.clientX) / 2;
  const currentCenter = (current.first.clientX + current.second.clientX) / 2;
  const anchorValue = initialRange.start
    + ((initialCenter - axisPixels.start) / pixelSpan) * initialSpan;
  const requestedStart = anchorValue - ((currentCenter - axisPixels.start) / pixelSpan) * span;
  const start = Math.max(domain.start, Math.min(domain.end - span, requestedStart));
  return { start, end: start + span };
}
