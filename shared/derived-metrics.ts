export const DERIVED_METRIC_KINDS = {
  Form: 'form',
  RecoveryNow: 'recovery_now',
} as const;

export type DerivedMetricKind = typeof DERIVED_METRIC_KINDS[keyof typeof DERIVED_METRIC_KINDS];

export const DEFAULT_DERIVED_METRIC_KINDS: DerivedMetricKind[] = [
  DERIVED_METRIC_KINDS.Form,
  DERIVED_METRIC_KINDS.RecoveryNow,
];

export const DERIVED_METRICS_COORDINATOR_DOC_ID = 'derivedMetricsCoordinator';

export type DerivedMetricsCoordinatorStatus =
  | 'idle'
  | 'queued'
  | 'processing'
  | 'failed';

export interface DerivedMetricsCoordinator {
  status: DerivedMetricsCoordinatorStatus;
  generation: number;
  dirtyMetricKinds: DerivedMetricKind[];
  requestedAtMs: number | null;
  startedAtMs: number | null;
  completedAtMs: number | null;
  updatedAtMs: number;
  lastError?: string | null;
}

export type DerivedMetricSnapshotStatus =
  | 'ready'
  | 'building'
  | 'failed'
  | 'stale';

export interface DerivedMetricSnapshotBase<TPayload> {
  metricKind: DerivedMetricKind;
  schemaVersion: number;
  status: DerivedMetricSnapshotStatus;
  updatedAtMs: number;
  sourceEventCount: number;
  payload: TPayload | null;
  lastError?: string | null;
}

export interface DerivedFormMetricPayload {
  dayBoundary: 'UTC';
  rangeStartDayMs: number | null;
  rangeEndDayMs: number | null;
  dailyLoads: Array<[number, number]>;
  excludesMergedEvents: boolean;
}

export interface DerivedRecoveryNowSegment {
  totalSeconds: number;
  endTimeMs: number;
}

export interface DerivedRecoveryNowMetricPayload {
  totalSeconds: number;
  endTimeMs: number;
  segments: DerivedRecoveryNowSegment[];
  excludesMergedEvents: boolean;
}

export type DerivedFormMetricSnapshot = DerivedMetricSnapshotBase<DerivedFormMetricPayload>;
export type DerivedRecoveryNowMetricSnapshot = DerivedMetricSnapshotBase<DerivedRecoveryNowMetricPayload>;
export type DerivedMetricSnapshot =
  | DerivedFormMetricSnapshot
  | DerivedRecoveryNowMetricSnapshot;

export interface EnsureDerivedMetricsRequest {
  metricKinds?: DerivedMetricKind[];
}

export interface EnsureDerivedMetricsResponse {
  accepted: boolean;
  queued: boolean;
  generation: number | null;
  metricKinds: DerivedMetricKind[];
}

export function isDerivedMetricKind(value: unknown): value is DerivedMetricKind {
  return Object.values(DERIVED_METRIC_KINDS).includes(`${value}` as DerivedMetricKind);
}

export function normalizeDerivedMetricKindsStrict(metricKinds: readonly unknown[] | null | undefined): DerivedMetricKind[] {
  return Array.from(new Set(
    (metricKinds || [])
      .filter(isDerivedMetricKind)
      .map(metricKind => `${metricKind}` as DerivedMetricKind),
  ));
}

export function normalizeDerivedMetricKinds(metricKinds: readonly unknown[] | null | undefined): DerivedMetricKind[] {
  const normalizedKinds = normalizeDerivedMetricKindsStrict(metricKinds);

  return normalizedKinds.length ? normalizedKinds : [...DEFAULT_DERIVED_METRIC_KINDS];
}

export function getDerivedMetricDocId(metricKind: DerivedMetricKind): string {
  return `derivedMetrics_${metricKind}`;
}
