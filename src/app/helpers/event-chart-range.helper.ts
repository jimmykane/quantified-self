export interface EventChartRange {
  start: number;
  end: number;
}

export function normalizeEventRange(range: EventChartRange | null | undefined): EventChartRange | null {
  if (!range) {
    return null;
  }

  const start = Number(range.start);
  const end = Number(range.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  return {
    start: Math.min(start, end),
    end: Math.max(start, end)
  };
}
