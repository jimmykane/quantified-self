import type { DerivedMetricSnapshotStatus } from '@shared/derived-metrics';

export type DashboardDerivedMetricStatus =
  | DerivedMetricSnapshotStatus
  | 'missing'
  | 'queued'
  | 'processing';

export function isDerivedMetricPendingStatus(
  status: DashboardDerivedMetricStatus | null | undefined,
): boolean {
  return status === 'building'
    || status === 'stale'
    || status === 'queued'
    || status === 'processing';
}
