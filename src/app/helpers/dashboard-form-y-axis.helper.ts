import { buildDashboardValueAxisConfig } from './dashboard-echarts-yaxis.helper';

export interface DashboardFormAxisPoint {
  time: number;
  ctl: number;
  atl: number;
  form: number | null;
}

/** Scale the visible line segments, not offscreen history retained for tooltips. */
export function buildDashboardFormValueAxes(
  points: readonly DashboardFormAxisPoint[], minTime: number, maxTime: number,
) {
  const loadValues: number[] = [];
  // Form's neutral baseline remains meaningful even when all visible values have one sign.
  const formValues: number[] = [0];
  if (Number.isFinite(minTime) && Number.isFinite(maxTime) && minTime <= maxTime) {
    points.forEach((point, index) => {
      if (point.time >= minTime && point.time <= maxTime) {
        loadValues.push(point.ctl, point.atl);
        if (point.form !== null) formValues.push(point.form);
      }
      const next = points[index + 1];
      if (!next || !Number.isFinite(point.time) || !Number.isFinite(next.time) || next.time <= point.time) return;
      // An aggregated weekly/monthly segment may cross a window boundary. Include
      // its interpolated edge so the visible line cannot be clipped by the fitted axis.
      for (const boundary of [minTime, maxTime]) {
        if (boundary <= point.time || boundary >= next.time) continue;
        const ratio = (boundary - point.time) / (next.time - point.time);
        for (const key of ['ctl', 'atl', 'form'] as const) {
          const start = point[key];
          const end = next[key];
          if (start === null || end === null || !Number.isFinite(start) || !Number.isFinite(end)) continue;
          const value = start + (end - start) * ratio;
          (key === 'form' ? formValues : loadValues).push(value);
        }
      }
    });
  }
  return {
    load: buildDashboardValueAxisConfig(loadValues),
    form: buildDashboardValueAxisConfig(formValues),
  };
}
