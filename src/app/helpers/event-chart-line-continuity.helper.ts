export type EventLineContinuityMode = 'continuous' | 'detect' | 'custom';

export interface EventLineContinuitySettings {
  mode: EventLineContinuityMode;
  maxGapSeconds: number;
}

export const EVENT_LINE_CONTINUITY_OPTIONS: { value: EventLineContinuityMode; label: string }[] = [
  { value: 'continuous', label: 'Continuous' },
  { value: 'detect', label: 'Detect gaps' },
  { value: 'custom', label: 'Custom gap limit' },
];
export const DEFAULT_EVENT_LINE_GAP_SECONDS = 10;
export const MAX_EVENT_LINE_GAP_SECONDS = 86400;

export function isValidEventLineGapSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_EVENT_LINE_GAP_SECONDS;
}

export function resolveEventLineContinuity(value: unknown): EventLineContinuitySettings {
  const settings = value && typeof value === 'object'
    ? value as Partial<EventLineContinuitySettings>
    : {};
  const validLimit = isValidEventLineGapSeconds(settings.maxGapSeconds);
  const mode = settings.mode === 'detect' || (settings.mode === 'custom' && validLimit)
    ? settings.mode
    : 'continuous';
  return { mode, maxGapSeconds: validLimit ? settings.maxGapSeconds : DEFAULT_EVENT_LINE_GAP_SECONDS };
}

export function equalEventLineContinuity(left: EventLineContinuitySettings, right: EventLineContinuitySettings): boolean {
  return left.mode === right.mode && left.maxGapSeconds === right.maxGapSeconds;
}

/**
 * Display-only segment identities. Zero means no drawable reading. Equal nonzero IDs
 * permit a line connection, including viewport endpoints separated by empty grid rows.
 * Call on the full metric before coordinate filtering/downsampling, never on a zoom slice.
 */
export function buildEventLineSegments(
  times: ArrayLike<number>,
  values: ArrayLike<number>,
  preference: EventLineContinuitySettings,
): Uint32Array {
  const length = Math.min(times.length, values.length);
  const segments = new Uint32Array(length);
  const settings = resolveEventLineContinuity(preference);
  const indices: number[] = [];
  const intervals: number[] = [];
  const validInterval = (interval: number) => Number.isFinite(interval) && interval > 0;
  let segment = 0;
  let previousTime = Number.NaN;
  for (let index = 0; index < length; index++) {
    if (typeof values[index] !== 'number' || !Number.isFinite(values[index])) continue;
    const time = times[index];
    if (!Number.isFinite(time)) {
      previousTime = Number.NaN;
      continue;
    }
    const interval = time - previousTime;
    if (settings.mode === 'detect') {
      indices.push(index);
      intervals.push(interval);
    } else {
      // Continuous/Custom need no cadence windows or per-reading scratch arrays.
      if (!validInterval(interval) || (settings.mode === 'custom' && interval > settings.maxGapSeconds * 1000)) segment++;
      segments[index] = segment;
    }
    previousTime = time;
  }
  if (settings.mode !== 'detect') return segments;

  const left = new Map<number, number>();
  const right = new Map<number, number>();
  const update = (counts: Map<number, number>, interval: number, delta: number) => {
    if (!validInterval(interval)) return;
    const count = (counts.get(interval) ?? 0) + delta;
    if (count) counts.set(interval, count);
    else counts.delete(interval);
  };
  const window = 16;
  let leftCount = 0;
  let rightCount = 0;
  for (let index = 1; index <= window && index < intervals.length; index++) {
    update(right, intervals[index], 1);
    if (validInterval(intervals[index])) rightCount++;
  }
  intervals.forEach((interval, index) => {
    const valid = validInterval(interval);
    const connects = valid && (interval <= 2000
      || interval === dominantInterval(left, leftCount)
      || interval === dominantInterval(right, rightCount));
    if (!connects) segment++;
    segments[indices[index]] = segment;
    update(left, interval, 1);
    if (valid) leftCount++;
    if (index >= window) {
      update(left, intervals[index - window], -1);
      if (validInterval(intervals[index - window])) leftCount--;
    }
    if (index + 1 < intervals.length) {
      update(right, intervals[index + 1], -1);
      if (validInterval(intervals[index + 1])) rightCount--;
    }
    if (index + window + 1 < intervals.length) {
      update(right, intervals[index + window + 1], 1);
      if (validInterval(intervals[index + window + 1])) rightCount++;
    }
  });
  return segments;
}

function dominantInterval(counts: Map<number, number>, size: number): number {
  // Conservative, bounded local evidence, benchmarked with deliberately removed readings.
  // This is a display heuristic: a missing reading can still resemble normal sparse sampling.
  if (size < 8) return Number.NaN;
  let winner = Number.NaN;
  let highestCount = 0;
  counts.forEach((count, interval) => {
    if (count > highestCount || (count === highestCount && interval < winner)) {
      winner = interval;
      highestCount = count;
    }
  });
  return highestCount >= Math.ceil(size * 0.75) ? winner : Number.NaN;
}
