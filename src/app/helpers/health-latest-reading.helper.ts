import type { HealthRangeResult } from '@shared/health';
import {
  buildHealthMetricWorkspaceView,
  type HealthWorkspaceSeries,
} from './health-workspace.helper';
import { resolveHealthSourceKey } from './health-source-selection.helper';

/** Select one recorded source; provider accounts and cumulative daily values are never summed. */
export function selectLatestHealthReading(
  results: readonly HealthRangeResult[],
  preferred?: string | null
) {
  const byId = new Map<string, HealthWorkspaceSeries>();
  for (const result of results)
    for (const series of buildHealthMetricWorkspaceView(result).series) {
      if (series.nativeOnly) continue;
      const previous = byId.get(series.id);
      byId.set(series.id, {
        ...series,
        points: [...(previous?.points || []), ...series.points]
          .filter(
            (point) =>
              Number.isFinite(point.timestampMs) &&
              typeof point.value === 'number' &&
              Number.isFinite(point.value)
          )
          .sort((a, b) => a.timestampMs - b.timestampMs),
      });
    }
  const series = [...byId.values()];
  const selectedKey = resolveHealthSourceKey(
    series.map((value) => ({ ...value, key: value.id })),
    preferred
  );
  const selected = series.find((value) => value.id === selectedKey);
  const point = selected?.points.at(-1);
  return selected && point ? { series: selected, point } : null;
}
