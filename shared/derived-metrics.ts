export const DERIVED_METRIC_KINDS = {
  Form: 'form',
  RecoveryNow: 'recovery_now',
} as const;

export type DerivedMetricKind = typeof DERIVED_METRIC_KINDS[keyof typeof DERIVED_METRIC_KINDS];

export const DEFAULT_DERIVED_METRIC_KINDS: DerivedMetricKind[] = [
  DERIVED_METRIC_KINDS.Form,
  DERIVED_METRIC_KINDS.RecoveryNow,
];

export const DERIVED_METRICS_COLLECTION_ID = 'derivedMetrics';
export const DERIVED_METRICS_COORDINATOR_DOC_ID = 'coordinator';
export const DERIVED_RECOVERY_MAX_SUPPORTED_SECONDS = 14 * 24 * 60 * 60;
export const DERIVED_RECOVERY_QUERY_DURATION_BUFFER_SECONDS = 2 * 24 * 60 * 60;
export const DERIVED_RECOVERY_LOOKBACK_WINDOW_SECONDS =
  DERIVED_RECOVERY_MAX_SUPPORTED_SECONDS + DERIVED_RECOVERY_QUERY_DURATION_BUFFER_SECONDS;

export const DERIVED_METRICS_ENTRY_TYPES = {
  Coordinator: 'coordinator',
  Snapshot: 'snapshot',
} as const;

export type DerivedMetricsEntryType = typeof DERIVED_METRICS_ENTRY_TYPES[keyof typeof DERIVED_METRICS_ENTRY_TYPES];

export type DerivedMetricsCoordinatorStatus =
  | 'idle'
  | 'queued'
  | 'processing'
  | 'failed';

export interface DerivedMetricsCoordinator {
  entryType: typeof DERIVED_METRICS_ENTRY_TYPES.Coordinator;
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

export interface DerivedFormDailyLoadEntry {
  dayMs: number;
  load: number;
}

export type LegacyDerivedFormDailyLoadEntry = readonly [number, number];

export interface DerivedMetricSnapshotBase<TPayload> {
  entryType: typeof DERIVED_METRICS_ENTRY_TYPES.Snapshot;
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
  dailyLoads: DerivedFormDailyLoadEntry[];
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
  latestWorkoutSeconds?: number | null;
  latestWorkoutEndTimeMs?: number | null;
  maxSupportedRecoverySeconds?: number;
  lookbackWindowSeconds?: number;
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
  return metricKind;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function normalizeDerivedFormDailyLoadEntry(
  candidate: unknown,
): DerivedFormDailyLoadEntry | null {
  if (Array.isArray(candidate)) {
    const dayMs = toFiniteNumber(candidate[0]);
    const load = toFiniteNumber(candidate[1]);
    if (dayMs === null || dayMs < 0 || load === null || load < 0) {
      return null;
    }
    return {
      dayMs: Math.floor(dayMs),
      load,
    };
  }

  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const entry = candidate as Record<string, unknown>;
  const dayMs = toFiniteNumber(entry.dayMs);
  const load = toFiniteNumber(entry.load);
  if (dayMs === null || dayMs < 0 || load === null || load < 0) {
    return null;
  }

  return {
    dayMs: Math.floor(dayMs),
    load,
  };
}

export function normalizeDerivedFormDailyLoads(
  dailyLoads: unknown,
): DerivedFormDailyLoadEntry[] {
  const entries = Array.isArray(dailyLoads) ? dailyLoads : [];
  const loadByDayMs = new Map<number, number>();

  entries.forEach((entry) => {
    const normalizedEntry = normalizeDerivedFormDailyLoadEntry(entry);
    if (!normalizedEntry) {
      return;
    }
    loadByDayMs.set(
      normalizedEntry.dayMs,
      (loadByDayMs.get(normalizedEntry.dayMs) || 0) + normalizedEntry.load,
    );
  });

  return [...loadByDayMs.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([dayMs, load]) => ({
      dayMs,
      load,
    }));
}

export function buildDerivedFormDailyLoads(
  loadByDayMs: ReadonlyMap<number, number>,
): DerivedFormDailyLoadEntry[] {
  return normalizeDerivedFormDailyLoads(
    [...loadByDayMs.entries()].map(([dayMs, load]) => ({ dayMs, load })),
  );
}
