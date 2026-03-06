const DASHBOARD_AXIS_TARGET_TICK_COUNT = 6;
const DASHBOARD_AXIS_PADDING_RATIO = 0.1;
const DASHBOARD_NICE_INTERVAL_FACTORS = [1, 1.5, 2, 2.5, 3, 5, 7.5, 10];

export interface DashboardValueAxisConfig {
  min: number;
  max: number;
  interval: number;
}

export function buildDashboardValueAxisConfig(values: number[]): DashboardValueAxisConfig {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) {
    return { min: 0, max: 1, interval: 1 };
  }

  const valueMin = Math.min(...finiteValues);
  const valueMax = Math.max(...finiteValues);

  if (valueMin === valueMax) {
    const delta = Math.max(Math.abs(valueMax) * 0.1, 1);
    const singleMin = valueMin >= 0 ? Math.max(0, valueMin - delta) : valueMin - delta;
    const singleMax = valueMax + delta;
    return buildNiceAxisRange(singleMin, singleMax);
  }

  const span = valueMax - valueMin;
  const padding = span * DASHBOARD_AXIS_PADDING_RATIO;
  const paddedMin = valueMin >= 0 ? 0 : valueMin - padding;
  const paddedMax = valueMax + padding;

  return buildNiceAxisRange(paddedMin, paddedMax);
}

function buildNiceAxisRange(min: number, max: number): DashboardValueAxisConfig {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { min, max, interval: 1 };
  }

  const rawInterval = (max - min) / DASHBOARD_AXIS_TARGET_TICK_COUNT;
  const interval = getNiceInterval(rawInterval);
  const snappedMin = Math.floor(min / interval) * interval;
  const snappedMax = Math.ceil(max / interval) * interval;

  return {
    min: sanitizeSnappedAxisNumber(snappedMin),
    max: sanitizeSnappedAxisNumber(Math.max(snappedMin + interval, snappedMax)),
    interval: sanitizeSnappedAxisNumber(interval),
  };
}

function getNiceInterval(rawInterval: number): number {
  if (!Number.isFinite(rawInterval) || rawInterval <= 0) {
    return 1;
  }

  const magnitude = 10 ** Math.floor(Math.log10(rawInterval));
  const normalized = rawInterval / magnitude;

  for (let index = 0; index < DASHBOARD_NICE_INTERVAL_FACTORS.length; index += 1) {
    const factor = DASHBOARD_NICE_INTERVAL_FACTORS[index];
    if (normalized <= factor) {
      return factor * magnitude;
    }
  }

  return 10 * magnitude;
}

function sanitizeSnappedAxisNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }

  if (Object.is(value, -0)) {
    return 0;
  }

  return Number(value.toFixed(6));
}
