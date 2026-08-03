import type { DerivedMetricSnapshotStatus } from '@shared/derived-metrics';

export type DashboardDerivedMetricStatus =
  | DerivedMetricSnapshotStatus
  | 'missing'
  | 'queued'
  | 'processing';

export type DerivedMetricsRefreshPhase = 'building' | 'refreshing' | 'failed' | null;

export function isDerivedMetricPendingStatus(
  status: DashboardDerivedMetricStatus | null | undefined,
): boolean {
  return status === 'building'
    || status === 'stale'
    || status === 'queued'
    || status === 'processing';
}

export function resolveDerivedMetricsRefreshPhase(
  statuses: ReadonlyArray<DashboardDerivedMetricStatus | null | undefined>,
): DerivedMetricsRefreshPhase {
  if (statuses.some(status => status === 'failed')) {
    return 'failed';
  }
  if (statuses.some(status => status === 'stale')) {
    return 'refreshing';
  }
  if (statuses.some(status => status === 'missing' || isDerivedMetricPendingStatus(status))) {
    return 'building';
  }
  return null;
}
