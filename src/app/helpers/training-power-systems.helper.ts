import {
  ActivityTypesHelper,
  THREE_DIMENSIONAL_CAPACITY_CRITICAL_POWER_ANCHORS_SECONDS,
  THREE_DIMENSIONAL_CAPACITY_ESTIMATOR_VERSION,
  THREE_DIMENSIONAL_CAPACITY_MAXIMUM_POWER_ANCHORS_SECONDS,
} from '@sports-alliance/sports-lib';
import {
  DERIVED_TRAINING_POWER_SYSTEMS_HISTORY_DAYS,
  DERIVED_TRAINING_POWER_SYSTEMS_POLICY_VERSION,
  DERIVED_TRAINING_POWER_SYSTEMS_WINDOW_DAYS,
  isDerivedTrainingPowerSystemsStatusReasonPair,
  type DerivedTrainingPowerSystemsActivityType,
  type DerivedTrainingPowerSystemsComponent,
  type DerivedTrainingPowerSystemsComponentStatus,
  type DerivedTrainingPowerSystemsDiagnostics,
  type DerivedTrainingPowerSystemsHistoryPoint,
  type DerivedTrainingPowerSystemsMetricPayload,
  type DerivedTrainingPowerSystemsReason,
  type DerivedTrainingPowerSystemsSnapshot,
  type DerivedTrainingPowerSystemsStatus,
} from '@shared/derived-metrics';

const DAY_MS = 24 * 60 * 60 * 1000;
const OVERALL_STATUSES = new Set<DerivedTrainingPowerSystemsStatus>([
  'ready',
  'partial',
  'insufficient-evidence',
  'poor-fit',
  'unstable',
  'invalid-input',
]);
const COMPONENT_STATUSES = new Set<DerivedTrainingPowerSystemsComponentStatus>([
  'ready',
  'insufficient-evidence',
  'poor-fit',
  'unstable',
  'invalid-input',
]);
const REASONS = new Set<DerivedTrainingPowerSystemsReason>([
  'no-evidence',
  'invalid-effective-date',
  'invalid-source',
  'duplicate-source',
  'invalid-date',
  'future-evidence',
  'invalid-activity-type',
  'mixed-activity-types',
  'invalid-power-curve',
  'insufficient-history',
  'insufficient-critical-power-range',
  'insufficient-maximum-power-range',
  'poor-critical-power-fit',
  'unstable-critical-power-fit',
  'poor-maximum-power-fit',
  'unstable-maximum-power-fit',
]);

export interface TrainingPowerSystemsCardViewModel {
  key: 'criticalPower' | 'wPrime' | 'maximumPower';
  label: string;
  valueText: string;
  statusText: string;
}

export interface TrainingPowerSystemsTrendPointViewModel {
  dayMs: number;
  value: number;
  x: number;
  y: number;
  isCurrent: boolean;
}

export interface TrainingPowerSystemsTrendViewModel {
  key: 'criticalPowerWatts' | 'wPrimeJoules' | 'maximumPowerWatts';
  label: string;
  unit: 'W' | 'kJ';
  path: string | null;
  points: TrainingPowerSystemsTrendPointViewModel[];
}

export interface TrainingPowerSystemsActivityTypeViewModel {
  activityType: string;
  status: DerivedTrainingPowerSystemsStatus;
  statusText: string;
  reasonText: string;
  evidenceText: string;
  diagnosticsText: string;
  cards: TrainingPowerSystemsCardViewModel[];
  trends: TrainingPowerSystemsTrendViewModel[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric !== null && numeric >= 0 && Number.isInteger(numeric) ? numeric : null;
}

function nullableNonNegativeNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  const numeric = finiteNumber(value);
  return numeric !== null && numeric >= 0 ? numeric : undefined;
}

function isUtcDayMs(value: number): boolean {
  if (!Number.isInteger(value) || value < 0) {
    return false;
  }
  const date = new Date(value);
  return value === Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function resolveReason(value: unknown): DerivedTrainingPowerSystemsReason | null | undefined {
  if (value === null) {
    return null;
  }
  return REASONS.has(value as DerivedTrainingPowerSystemsReason)
    ? value as DerivedTrainingPowerSystemsReason
    : undefined;
}

function resolveOverallStatus(value: unknown): DerivedTrainingPowerSystemsStatus | null {
  return OVERALL_STATUSES.has(value as DerivedTrainingPowerSystemsStatus)
    ? value as DerivedTrainingPowerSystemsStatus
    : null;
}

function resolveComponentStatus(value: unknown): DerivedTrainingPowerSystemsComponentStatus | null {
  return COMPONENT_STATUSES.has(value as DerivedTrainingPowerSystemsComponentStatus)
    ? value as DerivedTrainingPowerSystemsComponentStatus
    : null;
}

function resolveStatusAndReason(
  statusValue: unknown,
  reasonValue: unknown,
): { status: DerivedTrainingPowerSystemsStatus; reason: DerivedTrainingPowerSystemsReason | null } | null {
  const status = resolveOverallStatus(statusValue);
  const reason = resolveReason(reasonValue);
  if (
    !status
    || reason === undefined
    || !isDerivedTrainingPowerSystemsStatusReasonPair(status, reason)
  ) {
    return null;
  }
  return { status, reason };
}

function resolveComponent(value: unknown): DerivedTrainingPowerSystemsComponent | null {
  const raw = asRecord(value);
  if (!raw) {
    return null;
  }
  const status = resolveComponentStatus(raw.status);
  const reason = resolveReason(raw.reason);
  const numericValue = finiteNumber(raw.value);
  if (!status || reason === undefined) {
    return null;
  }
  if (status === 'ready') {
    return reason === null && numericValue !== null && numericValue > 0
      ? { status, reason, value: numericValue }
      : null;
  }
  return reason !== null && raw.value === null
    ? { status, reason, value: null }
    : null;
}

function componentStatusesMatchOverall(
  status: DerivedTrainingPowerSystemsStatus,
  reason: DerivedTrainingPowerSystemsReason | null,
  criticalPower: DerivedTrainingPowerSystemsComponent,
  wPrime: DerivedTrainingPowerSystemsComponent,
  maximumPower: DerivedTrainingPowerSystemsComponent,
): boolean {
  const criticalPowerStatus = criticalPower.status;
  const wPrimeStatus = wPrime.status;
  const maximumPowerStatus = maximumPower.status;
  if (status === 'ready') {
    return reason === null
      && criticalPowerStatus === 'ready'
      && wPrimeStatus === 'ready'
      && maximumPowerStatus === 'ready';
  }
  if (status === 'partial') {
    const expectedMaximumPowerStatus: DerivedTrainingPowerSystemsComponentStatus | null =
      reason === 'insufficient-maximum-power-range'
        ? 'insufficient-evidence'
        : reason === 'poor-maximum-power-fit'
          ? 'poor-fit'
          : reason === 'unstable-maximum-power-fit'
            ? 'unstable'
            : null;
    return reason !== null
      && criticalPowerStatus === 'ready'
      && wPrimeStatus === 'ready'
      && maximumPowerStatus === expectedMaximumPowerStatus
      && maximumPower.reason === reason;
  }
  const expectedComponentStatus: DerivedTrainingPowerSystemsComponentStatus = status;
  return reason !== null
    && criticalPowerStatus === expectedComponentStatus
    && wPrimeStatus === expectedComponentStatus
    && maximumPowerStatus === expectedComponentStatus
    && criticalPower.reason === reason
    && wPrime.reason === reason
    && maximumPower.reason === reason;
}

function historyComponentStatusesMatchOverall(
  status: DerivedTrainingPowerSystemsStatus,
  reason: DerivedTrainingPowerSystemsReason | null,
  criticalPowerStatus: DerivedTrainingPowerSystemsComponentStatus,
  wPrimeStatus: DerivedTrainingPowerSystemsComponentStatus,
  maximumPowerStatus: DerivedTrainingPowerSystemsComponentStatus,
): boolean {
  if (status === 'ready') {
    return criticalPowerStatus === 'ready'
      && wPrimeStatus === 'ready'
      && maximumPowerStatus === 'ready';
  }
  if (status === 'partial') {
    const expectedMaximumPowerStatus: DerivedTrainingPowerSystemsComponentStatus | null =
      reason === 'insufficient-maximum-power-range'
        ? 'insufficient-evidence'
        : reason === 'poor-maximum-power-fit'
          ? 'poor-fit'
          : reason === 'unstable-maximum-power-fit'
            ? 'unstable'
            : null;
    return criticalPowerStatus === 'ready'
      && wPrimeStatus === 'ready'
      && maximumPowerStatus === expectedMaximumPowerStatus;
  }
  const expectedComponentStatus: DerivedTrainingPowerSystemsComponentStatus = status;
  return criticalPowerStatus === expectedComponentStatus
    && wPrimeStatus === expectedComponentStatus
    && maximumPowerStatus === expectedComponentStatus;
}

function resolveDiagnostics(value: unknown): DerivedTrainingPowerSystemsDiagnostics | null {
  const raw = asRecord(value);
  if (!raw) {
    return null;
  }
  const sourceCount = nonNegativeInteger(raw.sourceCount);
  const historyStartDayMs = raw.historyStartDayMs === null ? null : finiteNumber(raw.historyStartDayMs);
  const historyEndDayMs = raw.historyEndDayMs === null ? null : finiteNumber(raw.historyEndDayMs);
  const historySpanDays = nonNegativeInteger(raw.historySpanDays);
  const rejectedPointCount = nonNegativeInteger(raw.rejectedPointCount);
  const criticalPowerAnchorCount = nonNegativeInteger(raw.criticalPowerAnchorCount);
  const earlyCriticalPowerAnchorCount = nonNegativeInteger(raw.earlyCriticalPowerAnchorCount);
  const longCriticalPowerAnchorCount = nonNegativeInteger(raw.longCriticalPowerAnchorCount);
  const criticalPowerContributingSourceCount = nonNegativeInteger(
    raw.criticalPowerContributingSourceCount,
  );
  const maximumPowerAnchorCount = nonNegativeInteger(raw.maximumPowerAnchorCount);
  const maximumPowerContributingSourceCount = nonNegativeInteger(
    raw.maximumPowerContributingSourceCount,
  );
  const optionalDiagnostics = [
    nullableNonNegativeNumber(raw.criticalPowerNormalizedRmse),
    nullableNonNegativeNumber(raw.criticalPowerSpreadRatio),
    nullableNonNegativeNumber(raw.wPrimeSpreadRatio),
    nullableNonNegativeNumber(raw.criticalPowerLeaveOneOutSpreadRatio),
    nullableNonNegativeNumber(raw.wPrimeLeaveOneOutSpreadRatio),
    nullableNonNegativeNumber(raw.maximumPowerNormalizedRmse),
    nullableNonNegativeNumber(raw.maximumPowerLeaveOneOutSpreadRatio),
  ] as const;
  if (
    sourceCount === null
    || historySpanDays === null
    || rejectedPointCount === null
    || criticalPowerAnchorCount === null
    || criticalPowerAnchorCount > THREE_DIMENSIONAL_CAPACITY_CRITICAL_POWER_ANCHORS_SECONDS.length
    || earlyCriticalPowerAnchorCount === null
    || earlyCriticalPowerAnchorCount > criticalPowerAnchorCount
    || longCriticalPowerAnchorCount === null
    || longCriticalPowerAnchorCount > criticalPowerAnchorCount
    || earlyCriticalPowerAnchorCount + longCriticalPowerAnchorCount > criticalPowerAnchorCount
    || criticalPowerContributingSourceCount === null
    || criticalPowerContributingSourceCount > sourceCount
    || criticalPowerContributingSourceCount > criticalPowerAnchorCount
    || ((criticalPowerAnchorCount === 0) !== (criticalPowerContributingSourceCount === 0))
    || maximumPowerAnchorCount === null
    || maximumPowerAnchorCount > THREE_DIMENSIONAL_CAPACITY_MAXIMUM_POWER_ANCHORS_SECONDS.length
    || maximumPowerContributingSourceCount === null
    || maximumPowerContributingSourceCount > sourceCount
    || maximumPowerContributingSourceCount > maximumPowerAnchorCount
    || ((maximumPowerAnchorCount === 0) !== (maximumPowerContributingSourceCount === 0))
    || optionalDiagnostics.some(item => item === undefined)
    || (
      sourceCount === 0
      && (
        criticalPowerAnchorCount !== 0
        || earlyCriticalPowerAnchorCount !== 0
        || longCriticalPowerAnchorCount !== 0
        || criticalPowerContributingSourceCount !== 0
        || maximumPowerAnchorCount !== 0
        || maximumPowerContributingSourceCount !== 0
        || optionalDiagnostics.some(item => item !== null)
      )
    )
    || ((historyStartDayMs === null) !== (historyEndDayMs === null))
    || (historyStartDayMs !== null && (!isUtcDayMs(historyStartDayMs) || !isUtcDayMs(historyEndDayMs as number)))
    || (historyStartDayMs !== null && historyStartDayMs > (historyEndDayMs as number))
    || ((historyStartDayMs === null) !== (sourceCount === 0))
    || (historyStartDayMs === null && historySpanDays !== 0)
    || (
      historyStartDayMs !== null
      && historySpanDays !== Math.round(((historyEndDayMs as number) - historyStartDayMs) / DAY_MS)
    )
  ) {
    return null;
  }
  return {
    sourceCount,
    historyStartDayMs,
    historyEndDayMs,
    historySpanDays,
    rejectedPointCount,
    criticalPowerAnchorCount,
    earlyCriticalPowerAnchorCount,
    longCriticalPowerAnchorCount,
    criticalPowerContributingSourceCount,
    maximumPowerAnchorCount,
    maximumPowerContributingSourceCount,
    criticalPowerNormalizedRmse: optionalDiagnostics[0] as number | null,
    criticalPowerSpreadRatio: optionalDiagnostics[1] as number | null,
    wPrimeSpreadRatio: optionalDiagnostics[2] as number | null,
    criticalPowerLeaveOneOutSpreadRatio: optionalDiagnostics[3] as number | null,
    wPrimeLeaveOneOutSpreadRatio: optionalDiagnostics[4] as number | null,
    maximumPowerNormalizedRmse: optionalDiagnostics[5] as number | null,
    maximumPowerLeaveOneOutSpreadRatio: optionalDiagnostics[6] as number | null,
  };
}

function resolveSnapshot(
  value: unknown,
  activityType: string,
  asOfDayMs: number,
): DerivedTrainingPowerSystemsSnapshot | null {
  const raw = asRecord(value);
  const statusAndReason = raw ? resolveStatusAndReason(raw.status, raw.reason) : null;
  const effectiveDayMs = raw ? finiteNumber(raw.effectiveDayMs) : null;
  const estimatorVersion = raw ? finiteNumber(raw.estimatorVersion) : null;
  const criticalPower = raw ? resolveComponent(raw.criticalPower) : null;
  const wPrime = raw ? resolveComponent(raw.wPrime) : null;
  const maximumPower = raw ? resolveComponent(raw.maximumPower) : null;
  const diagnostics = raw ? resolveDiagnostics(raw.diagnostics) : null;
  const sourceFingerprint = raw?.sourceFingerprint === null
    ? null
    : typeof raw?.sourceFingerprint === 'string' && raw.sourceFingerprint.trim()
      ? raw.sourceFingerprint
      : undefined;
  if (
    !raw
    || !statusAndReason
    || effectiveDayMs !== asOfDayMs
    || !isUtcDayMs(effectiveDayMs)
    || estimatorVersion !== THREE_DIMENSIONAL_CAPACITY_ESTIMATOR_VERSION
    || raw.activityType !== activityType
    || !criticalPower
    || !wPrime
    || !maximumPower
    || !componentStatusesMatchOverall(
      statusAndReason.status,
      statusAndReason.reason,
      criticalPower,
      wPrime,
      maximumPower,
    )
    || !diagnostics
    || sourceFingerprint === undefined
    || ((diagnostics.sourceCount === 0) !== (sourceFingerprint === null))
  ) {
    return null;
  }
  return {
    effectiveDayMs,
    status: statusAndReason.status,
    reason: statusAndReason.reason,
    estimatorVersion,
    activityType,
    sourceFingerprint,
    criticalPower,
    wPrime,
    maximumPower,
    diagnostics,
  };
}

function resolveHistoryPoint(value: unknown): DerivedTrainingPowerSystemsHistoryPoint | null {
  const raw = asRecord(value);
  const statusAndReason = raw ? resolveStatusAndReason(raw.status, raw.reason) : null;
  const effectiveDayMs = raw ? finiteNumber(raw.effectiveDayMs) : null;
  const criticalPower = raw ? resolveComponent({
    status: raw.criticalPowerStatus,
    reason: raw.criticalPowerStatus === 'ready' ? null : raw.reason,
    value: raw.criticalPowerWatts,
  }) : null;
  const wPrime = raw ? resolveComponent({
    status: raw.wPrimeStatus,
    reason: raw.wPrimeStatus === 'ready' ? null : raw.reason,
    value: raw.wPrimeJoules,
  }) : null;
  const maximumPower = raw ? resolveComponent({
    status: raw.maximumPowerStatus,
    reason: raw.maximumPowerStatus === 'ready' ? null : raw.reason,
    value: raw.maximumPowerWatts,
  }) : null;
  if (
    !statusAndReason
    || effectiveDayMs === null
    || !isUtcDayMs(effectiveDayMs)
    || !criticalPower
    || !wPrime
    || !maximumPower
    || !historyComponentStatusesMatchOverall(
      statusAndReason.status,
      statusAndReason.reason,
      criticalPower.status,
      wPrime.status,
      maximumPower.status,
    )
  ) {
    return null;
  }
  return {
    effectiveDayMs,
    status: statusAndReason.status,
    reason: statusAndReason.reason,
    criticalPowerStatus: criticalPower.status,
    criticalPowerWatts: criticalPower.value,
    wPrimeStatus: wPrime.status,
    wPrimeJoules: wPrime.value,
    maximumPowerStatus: maximumPower.status,
    maximumPowerWatts: maximumPower.value,
  };
}

function historyEndpointMatchesCurrent(
  point: DerivedTrainingPowerSystemsHistoryPoint,
  current: DerivedTrainingPowerSystemsSnapshot,
): boolean {
  return point.effectiveDayMs === current.effectiveDayMs
    && point.status === current.status
    && point.reason === current.reason
    && point.criticalPowerStatus === current.criticalPower.status
    && point.criticalPowerWatts === current.criticalPower.value
    && point.wPrimeStatus === current.wPrime.status
    && point.wPrimeJoules === current.wPrime.value
    && point.maximumPowerStatus === current.maximumPower.status
    && point.maximumPowerWatts === current.maximumPower.value;
}

function resolveActivityTypeEntry(
  value: unknown,
  asOfDayMs: number,
): DerivedTrainingPowerSystemsActivityType | null {
  const raw = asRecord(value);
  const activityType = typeof raw?.activityType === 'string' ? raw.activityType.trim() : '';
  const canonicalActivityType = activityType ? ActivityTypesHelper.resolveActivityType(activityType) : null;
  const current = raw ? resolveSnapshot(raw.current, activityType, asOfDayMs) : null;
  const rawCounts = asRecord(raw?.evidenceCounts);
  const candidateActivityCount = nonNegativeInteger(rawCounts?.candidateActivityCount);
  const usableCurveActivityCount = nonNegativeInteger(rawCounts?.usableCurveActivityCount);
  const excludedActivityCount = nonNegativeInteger(rawCounts?.excludedActivityCount);
  const history = Array.isArray(raw?.history)
    ? raw.history.map(resolveHistoryPoint)
    : [];
  if (
    !raw
    || !activityType
    || canonicalActivityType !== activityType
    || !current
    || candidateActivityCount === null
    || usableCurveActivityCount === null
    || excludedActivityCount === null
    || candidateActivityCount !== usableCurveActivityCount + excludedActivityCount
    || current.diagnostics.sourceCount !== usableCurveActivityCount
    || !Array.isArray(raw.history)
    || history.length !== raw.history.length
    || history.some(point => point === null)
    || history.length < 1
    || history.length > DERIVED_TRAINING_POWER_SYSTEMS_HISTORY_DAYS + 1
  ) {
    return null;
  }
  const resolvedHistory = history as DerivedTrainingPowerSystemsHistoryPoint[];
  for (let index = 0; index < resolvedHistory.length; index += 1) {
    const point = resolvedHistory[index];
    if (
      point.effectiveDayMs < asOfDayMs - (DERIVED_TRAINING_POWER_SYSTEMS_HISTORY_DAYS * DAY_MS)
      || point.effectiveDayMs > asOfDayMs
      || (index > 0 && point.effectiveDayMs <= resolvedHistory[index - 1].effectiveDayMs)
    ) {
      return null;
    }
  }
  if (!historyEndpointMatchesCurrent(resolvedHistory[resolvedHistory.length - 1], current)) {
    return null;
  }
  return {
    activityType,
    current,
    history: resolvedHistory,
    evidenceCounts: {
      candidateActivityCount,
      usableCurveActivityCount,
      excludedActivityCount,
    },
  };
}

export function resolveTrainingPowerSystemsMetricPayload(
  value: unknown,
): DerivedTrainingPowerSystemsMetricPayload | null {
  const raw = asRecord(value);
  const asOfDayMs = finiteNumber(raw?.asOfDayMs);
  if (
    !raw
    || raw.dayBoundary !== 'UTC'
    || asOfDayMs === null
    || !isUtcDayMs(asOfDayMs)
    || raw.policyVersion !== DERIVED_TRAINING_POWER_SYSTEMS_POLICY_VERSION
    || raw.windowDays !== DERIVED_TRAINING_POWER_SYSTEMS_WINDOW_DAYS
    || raw.historyDays !== DERIVED_TRAINING_POWER_SYSTEMS_HISTORY_DAYS
    || raw.cadence !== 'workout-date'
    || raw.excludesEffectiveDay !== true
    || raw.excludesMergedEvents !== true
    || !Array.isArray(raw.activityTypes)
  ) {
    return null;
  }
  const activityTypes = raw.activityTypes.map(entry => resolveActivityTypeEntry(entry, asOfDayMs));
  if (activityTypes.some(entry => entry === null)) {
    return null;
  }
  const sorted = (activityTypes as DerivedTrainingPowerSystemsActivityType[])
    .sort((left, right) => left.activityType.localeCompare(right.activityType));
  if (new Set(sorted.map(entry => entry.activityType)).size !== sorted.length) {
    return null;
  }
  return {
    dayBoundary: 'UTC',
    asOfDayMs,
    policyVersion: DERIVED_TRAINING_POWER_SYSTEMS_POLICY_VERSION,
    windowDays: DERIVED_TRAINING_POWER_SYSTEMS_WINDOW_DAYS,
    historyDays: DERIVED_TRAINING_POWER_SYSTEMS_HISTORY_DAYS,
    cadence: 'workout-date',
    excludesEffectiveDay: true,
    excludesMergedEvents: true,
    activityTypes: sorted,
  };
}

function formatNumber(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(value);
}

function formatComponentStatus(status: DerivedTrainingPowerSystemsComponentStatus): string {
  if (status === 'ready') {
    return 'Ready';
  }
  if (status === 'insufficient-evidence') {
    return 'Not enough evidence';
  }
  if (status === 'poor-fit') {
    return 'Poor fit';
  }
  if (status === 'unstable') {
    return 'Unstable';
  }
  return 'Invalid input';
}

function formatOverallStatus(status: DerivedTrainingPowerSystemsStatus): string {
  if (status === 'ready') {
    return 'Ready';
  }
  if (status === 'partial') {
    return 'Partial';
  }
  return formatComponentStatus(status);
}

function formatReason(reason: DerivedTrainingPowerSystemsReason | null): string {
  const messages: Record<DerivedTrainingPowerSystemsReason, string> = {
    'no-evidence': 'No preceding power-curve evidence is available.',
    'invalid-effective-date': 'The calculation date is invalid.',
    'invalid-source': 'One or more source records are invalid.',
    'duplicate-source': 'The same source workout was supplied more than once.',
    'invalid-date': 'One or more source dates are invalid.',
    'future-evidence': 'Same-day or future evidence was rejected.',
    'invalid-activity-type': 'The activity type is not canonical.',
    'mixed-activity-types': 'Power curves from different activity types were mixed.',
    'invalid-power-curve': 'The source power curve is invalid.',
    'insufficient-history': 'At least three power workouts spanning 14 days are required inside the 42-day window.',
    'insufficient-critical-power-range': 'The curve history does not cover enough sustained-power durations.',
    'insufficient-maximum-power-range': 'CP and W′ are usable, but short-duration evidence is not sufficient for Pmax.',
    'poor-critical-power-fit': 'The sustained-power curve does not fit the CP/W′ model closely enough.',
    'unstable-critical-power-fit': 'The CP/W′ fitting methods disagree, or the estimate is too sensitive to the available sustained anchors.',
    'poor-maximum-power-fit': 'The short-duration curve does not fit the Pmax model closely enough.',
    'unstable-maximum-power-fit': 'Pmax changes too much when short-duration anchors are removed.',
  };
  return reason ? messages[reason] : 'All three capacity components passed the Sports-lib evidence gates.';
}

function buildTrend(
  entry: DerivedTrainingPowerSystemsActivityType,
  key: TrainingPowerSystemsTrendViewModel['key'],
  label: string,
  unit: TrainingPowerSystemsTrendViewModel['unit'],
  valueScale = 1,
): TrainingPowerSystemsTrendViewModel {
  const rawPoints = entry.history.map(point => ({
    dayMs: point.effectiveDayMs,
    value: point[key] === null ? null : point[key] * valueScale,
  }));
  const values = rawPoints.flatMap(point => point.value === null ? [] : [point.value]);
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 0;
  const span = maximum - minimum;
  const historyStartDayMs = entry.current.effectiveDayMs - (DERIVED_TRAINING_POWER_SYSTEMS_HISTORY_DAYS * DAY_MS);
  const points = rawPoints.flatMap((point): TrainingPowerSystemsTrendPointViewModel[] => {
    if (point.value === null) {
      return [];
    }
    const x = ((point.dayMs - historyStartDayMs) / (DERIVED_TRAINING_POWER_SYSTEMS_HISTORY_DAYS * DAY_MS)) * 100;
    const y = span > 0 ? 28 - (((point.value - minimum) / span) * 24) : 16;
    return [{
      dayMs: point.dayMs,
      value: point.value,
      x,
      y,
      isCurrent: point.dayMs === entry.current.effectiveDayMs,
    }];
  });
  const pointByDay = new Map(points.map(point => [point.dayMs, point]));
  const pathSegments: string[] = [];
  let currentSegment: string[] = [];
  rawPoints.forEach((rawPoint) => {
    const point = pointByDay.get(rawPoint.dayMs);
    if (!point) {
      if (currentSegment.length) {
        pathSegments.push(currentSegment.join(' '));
        currentSegment = [];
      }
      return;
    }
    currentSegment.push(`${currentSegment.length ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`);
  });
  if (currentSegment.length) {
    pathSegments.push(currentSegment.join(' '));
  }
  return {
    key,
    label,
    unit,
    path: pathSegments.length ? pathSegments.join(' ') : null,
    points,
  };
}

function buildComponentCard(
  key: TrainingPowerSystemsCardViewModel['key'],
  label: string,
  component: DerivedTrainingPowerSystemsComponent,
  formatValue: (value: number) => string,
): TrainingPowerSystemsCardViewModel {
  return {
    key,
    label,
    valueText: component.status === 'ready' && component.value !== null
      ? formatValue(component.value)
      : 'Unavailable',
    statusText: formatComponentStatus(component.status),
  };
}

export function buildTrainingPowerSystemsActivityTypeViewModels(
  payload: DerivedTrainingPowerSystemsMetricPayload | null,
): TrainingPowerSystemsActivityTypeViewModel[] {
  return (payload?.activityTypes || []).map((entry) => {
    const { current, evidenceCounts, activityType } = entry;
    const fitError = current.diagnostics.criticalPowerNormalizedRmse === null
      ? null
      : `${formatNumber(current.diagnostics.criticalPowerNormalizedRmse * 100, 1)}% CP fit error`;
    const stabilityValues = [
      current.diagnostics.criticalPowerLeaveOneOutSpreadRatio,
      current.diagnostics.wPrimeLeaveOneOutSpreadRatio,
      current.diagnostics.maximumPowerLeaveOneOutSpreadRatio,
    ].filter((value): value is number => value !== null);
    const stability = stabilityValues.length
      ? `${formatNumber(Math.max(...stabilityValues) * 100, 1)}% worst anchor-removal change`
      : null;
    const methodSpread = [
      current.diagnostics.criticalPowerSpreadRatio === null
        ? null
        : `${formatNumber(current.diagnostics.criticalPowerSpreadRatio * 100, 1)}% CP method spread`,
      current.diagnostics.wPrimeSpreadRatio === null
        ? null
        : `${formatNumber(current.diagnostics.wPrimeSpreadRatio * 100, 1)}% W′ method spread`,
    ];
    const sourceLabel = (count: number): string => `${count} ${count === 1 ? 'activity' : 'activities'}`;
    return {
      activityType,
      status: current.status,
      statusText: formatOverallStatus(current.status),
      reasonText: formatReason(current.reason),
      evidenceText: `${evidenceCounts.usableCurveActivityCount} of ${evidenceCounts.candidateActivityCount} preceding 42-day workouts supplied usable power curves; ${evidenceCounts.excludedActivityCount} excluded.`,
      diagnosticsText: [
        `${current.diagnostics.sourceCount} usable power curves over ${current.diagnostics.historySpanDays} days`,
        `${sourceLabel(current.diagnostics.criticalPowerContributingSourceCount)} supplied ${current.diagnostics.criticalPowerAnchorCount}/${THREE_DIMENSIONAL_CAPACITY_CRITICAL_POWER_ANCHORS_SECONDS.length} sustained anchors`,
        `${sourceLabel(current.diagnostics.maximumPowerContributingSourceCount)} supplied ${current.diagnostics.maximumPowerAnchorCount}/${THREE_DIMENSIONAL_CAPACITY_MAXIMUM_POWER_ANCHORS_SECONDS.length} short anchors`,
        fitError,
        ...methodSpread,
        stability,
      ].filter(Boolean).join(' · '),
      cards: [
        buildComponentCard('criticalPower', 'Critical power', current.criticalPower, value => `${formatNumber(value)} W`),
        buildComponentCard('wPrime', 'W′', current.wPrime, value => `${formatNumber(value / 1000, 1)} kJ`),
        buildComponentCard('maximumPower', 'Maximum power', current.maximumPower, value => `${formatNumber(value)} W`),
      ],
      trends: [
        buildTrend(entry, 'criticalPowerWatts', 'Critical power', 'W'),
        buildTrend(entry, 'wPrimeJoules', 'W′', 'kJ', 1 / 1000),
        buildTrend(entry, 'maximumPowerWatts', 'Maximum power', 'W'),
      ],
    };
  });
}
