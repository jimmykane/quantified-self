import {
  ActivityTypesHelper,
  THREE_DIMENSIONAL_CAPACITY_CRITICAL_POWER_ANCHORS_SECONDS,
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
  type DerivedTrainingPowerSystemsEvidenceCounts,
  type DerivedTrainingPowerSystemsHistoryPoint,
  type DerivedTrainingPowerSystemsMetricPayload,
  type DerivedTrainingPowerSystemsReason,
  type DerivedTrainingPowerSystemsSnapshot,
  type DerivedTrainingPowerSystemsStatus,
} from '@shared/derived-metrics';
import {
  createTrainingSportRecord,
  hasTrainingSportCapability,
  resolveTrainingDisciplineFromActivityType,
  type TrainingSportId,
} from '@shared/training-disciplines';

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
  'unstable-w-prime-fit',
  'poor-maximum-power-fit',
  'unstable-maximum-power-fit',
]);

export interface TrainingPowerSystemsCardViewModel {
  key: 'criticalPower' | 'wPrime' | 'maximumPower';
  label: string;
  description: string;
  valueText: string;
  statusText: string;
}

export interface TrainingPowerSystemsTrendPointViewModel {
  dayMs: number;
  value: number | null;
  statusText: string;
  isCurrent: boolean;
}

export interface TrainingPowerSystemsTrendViewModel {
  key: 'criticalPowerWatts' | 'wPrimeJoules' | 'maximumPowerWatts';
  label: string;
  unit: 'W' | 'kJ';
  rangeStartDayMs: number;
  rangeEndDayMs: number;
  points: TrainingPowerSystemsTrendPointViewModel[];
}

export interface TrainingPowerSystemsInterpretationViewModel {
  summary: string;
  details: string[];
}

export interface TrainingPowerSystemsActivityTypeViewModel {
  activityType: string;
  status: DerivedTrainingPowerSystemsStatus;
  statusText: string;
  reasonText: string;
  evidenceText: string;
  interpretation: TrainingPowerSystemsInterpretationViewModel | null;
  diagnostics: string[];
  cards: TrainingPowerSystemsCardViewModel[];
  trends: TrainingPowerSystemsTrendViewModel[];
}

export interface TrainingPowerSystemsActivityTypeGroups {
  bySport: Record<TrainingSportId, TrainingPowerSystemsActivityTypeViewModel[]>;
  other: TrainingPowerSystemsActivityTypeViewModel[];
}

export function groupTrainingPowerSystemsActivityTypeViewModels(
  activityTypes: readonly TrainingPowerSystemsActivityTypeViewModel[],
): TrainingPowerSystemsActivityTypeGroups {
  const bySport = createTrainingSportRecord<TrainingPowerSystemsActivityTypeViewModel[]>(() => []);
  const other: TrainingPowerSystemsActivityTypeViewModel[] = [];
  activityTypes.forEach((activityType) => {
    const sport = resolveTrainingDisciplineFromActivityType(activityType.activityType);
    if (sport && hasTrainingSportCapability(sport, 'power-systems')) {
      bySport[sport].push(activityType);
    } else {
      other.push(activityType);
    }
  });
  return { bySport, other };
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

function nullablePositiveNumber(value: unknown): number | null | undefined {
  const numeric = nullableNonNegativeNumber(value);
  return numeric === null || numeric === undefined || numeric > 0
    ? numeric
    : undefined;
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
    if (reason === 'unstable-w-prime-fit') {
      return criticalPowerStatus === 'ready'
        && wPrimeStatus === 'unstable'
        && wPrime.reason === reason
        && maximumPowerStatus === 'insufficient-evidence'
        && maximumPower.reason === reason;
    }
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
    if (reason === 'unstable-w-prime-fit') {
      return criticalPowerStatus === 'ready'
        && wPrimeStatus === 'unstable'
        && maximumPowerStatus === 'insufficient-evidence';
    }
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
  const rejectedShortPowerSpikePointCount = nonNegativeInteger(
    raw.rejectedShortPowerSpikePointCount,
  );
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
  const criticalPowerSourceRemovalFitCount = nonNegativeInteger(
    raw.criticalPowerSourceRemovalFitCount,
  );
  const criticalPowerSourceRemovalFailureCount = nonNegativeInteger(
    raw.criticalPowerSourceRemovalFailureCount,
  );
  const wPrimeCandidateCount = nonNegativeInteger(raw.wPrimeCandidateCount);
  const wPrimeCandidateMinimumJoules = nullablePositiveNumber(
    raw.wPrimeCandidateMinimumJoules,
  );
  const wPrimeCandidateMaximumJoules = nullablePositiveNumber(
    raw.wPrimeCandidateMaximumJoules,
  );
  const optionalDiagnostics = [
    nullableNonNegativeNumber(raw.criticalPowerNormalizedRmse),
    nullableNonNegativeNumber(raw.criticalPowerSpreadRatio),
    nullableNonNegativeNumber(raw.wPrimeSpreadRatio),
    nullableNonNegativeNumber(raw.criticalPowerLeaveOneOutSpreadRatio),
    nullableNonNegativeNumber(raw.wPrimeLeaveOneOutSpreadRatio),
    nullableNonNegativeNumber(raw.criticalPowerSourceRemovalMaximumChangeRatio),
    nullableNonNegativeNumber(raw.wPrimeSourceRemovalMaximumChangeRatio),
    nullableNonNegativeNumber(raw.maximumPowerNormalizedRmse),
    nullableNonNegativeNumber(raw.maximumPowerLeaveOneOutSpreadRatio),
  ] as const;
  if (
    sourceCount === null ||
    historySpanDays === null ||
    rejectedPointCount === null ||
    rejectedShortPowerSpikePointCount === null ||
    criticalPowerAnchorCount === null ||
    criticalPowerAnchorCount >
      THREE_DIMENSIONAL_CAPACITY_CRITICAL_POWER_ANCHORS_SECONDS.length ||
    earlyCriticalPowerAnchorCount === null ||
    earlyCriticalPowerAnchorCount > criticalPowerAnchorCount ||
    longCriticalPowerAnchorCount === null ||
    longCriticalPowerAnchorCount > criticalPowerAnchorCount ||
    earlyCriticalPowerAnchorCount + longCriticalPowerAnchorCount >
      criticalPowerAnchorCount ||
    criticalPowerContributingSourceCount === null ||
    criticalPowerContributingSourceCount > sourceCount ||
    criticalPowerContributingSourceCount > criticalPowerAnchorCount ||
    (criticalPowerAnchorCount === 0) !==
      (criticalPowerContributingSourceCount === 0) ||
    maximumPowerAnchorCount === null ||
    maximumPowerAnchorCount >
      THREE_DIMENSIONAL_CAPACITY_MAXIMUM_POWER_ANCHORS_SECONDS.length ||
    maximumPowerContributingSourceCount === null ||
    maximumPowerContributingSourceCount > sourceCount ||
    maximumPowerContributingSourceCount > maximumPowerAnchorCount ||
    (maximumPowerAnchorCount === 0) !==
      (maximumPowerContributingSourceCount === 0) ||
    criticalPowerSourceRemovalFitCount === null ||
    criticalPowerSourceRemovalFailureCount === null ||
    wPrimeCandidateCount === null ||
    (wPrimeCandidateCount !== 0 && wPrimeCandidateCount !== 3) ||
    (wPrimeCandidateMinimumJoules === null) !==
      (wPrimeCandidateMaximumJoules === null) ||
    (wPrimeCandidateCount === 0 &&
      (wPrimeCandidateMinimumJoules !== null ||
        wPrimeCandidateMaximumJoules !== null)) ||
    (wPrimeCandidateCount > 0 &&
      (wPrimeCandidateMinimumJoules === null ||
        wPrimeCandidateMaximumJoules === null ||
        wPrimeCandidateMinimumJoules > wPrimeCandidateMaximumJoules)) ||
    criticalPowerSourceRemovalFitCount +
      criticalPowerSourceRemovalFailureCount >
      criticalPowerContributingSourceCount ||
    (criticalPowerSourceRemovalFitCount === 0 &&
      (optionalDiagnostics[5] !== null || optionalDiagnostics[6] !== null)) ||
    (criticalPowerSourceRemovalFitCount > 0 &&
      (optionalDiagnostics[5] === null || optionalDiagnostics[6] === null)) ||
    optionalDiagnostics.some((item) => item === undefined) ||
    (sourceCount === 0 &&
      (criticalPowerAnchorCount !== 0 ||
        earlyCriticalPowerAnchorCount !== 0 ||
        longCriticalPowerAnchorCount !== 0 ||
        criticalPowerContributingSourceCount !== 0 ||
        maximumPowerAnchorCount !== 0 ||
        maximumPowerContributingSourceCount !== 0 ||
        criticalPowerSourceRemovalFitCount !== 0 ||
        criticalPowerSourceRemovalFailureCount !== 0 ||
        wPrimeCandidateCount !== 0 ||
        wPrimeCandidateMinimumJoules !== null ||
        wPrimeCandidateMaximumJoules !== null ||
        optionalDiagnostics.some((item) => item !== null))) ||
    (historyStartDayMs === null) !== (historyEndDayMs === null) ||
    (historyStartDayMs !== null &&
      (!isUtcDayMs(historyStartDayMs) ||
        !isUtcDayMs(historyEndDayMs as number))) ||
    (historyStartDayMs !== null &&
      historyStartDayMs > (historyEndDayMs as number)) ||
    (historyStartDayMs === null) !== (sourceCount === 0) ||
    (historyStartDayMs === null && historySpanDays !== 0) ||
    (historyStartDayMs !== null &&
      historySpanDays !==
        Math.round(((historyEndDayMs as number) - historyStartDayMs) / DAY_MS))
  ) {
    return null;
  }
  return {
    sourceCount,
    historyStartDayMs,
    historyEndDayMs,
    historySpanDays,
    rejectedPointCount,
    rejectedShortPowerSpikePointCount,
    criticalPowerAnchorCount,
    earlyCriticalPowerAnchorCount,
    longCriticalPowerAnchorCount,
    criticalPowerContributingSourceCount,
    maximumPowerAnchorCount,
    maximumPowerContributingSourceCount,
    criticalPowerNormalizedRmse: optionalDiagnostics[0] as number | null,
    criticalPowerSpreadRatio: optionalDiagnostics[1] as number | null,
    wPrimeSpreadRatio: optionalDiagnostics[2] as number | null,
    wPrimeCandidateCount,
    wPrimeCandidateMinimumJoules,
    wPrimeCandidateMaximumJoules,
    criticalPowerLeaveOneOutSpreadRatio: optionalDiagnostics[3] as
      number | null,
    wPrimeLeaveOneOutSpreadRatio: optionalDiagnostics[4] as number | null,
    criticalPowerSourceRemovalFitCount,
    criticalPowerSourceRemovalFailureCount,
    criticalPowerSourceRemovalMaximumChangeRatio: optionalDiagnostics[5] as
      number | null,
    wPrimeSourceRemovalMaximumChangeRatio: optionalDiagnostics[6] as
      number | null,
    maximumPowerNormalizedRmse: optionalDiagnostics[7] as number | null,
    maximumPowerLeaveOneOutSpreadRatio: optionalDiagnostics[8] as number | null,
  };
}

function resolveSnapshot(
  value: unknown,
  activityType: string,
  asOfDayMs: number,
): DerivedTrainingPowerSystemsSnapshot | null {
  const raw = asRecord(value);
  const statusAndReason = raw
    ? resolveStatusAndReason(raw.status, raw.reason)
    : null;
  const effectiveDayMs = raw ? finiteNumber(raw.effectiveDayMs) : null;
  const criticalPower = raw ? resolveComponent(raw.criticalPower) : null;
  const wPrime = raw ? resolveComponent(raw.wPrime) : null;
  const maximumPower = raw ? resolveComponent(raw.maximumPower) : null;
  const diagnostics = raw ? resolveDiagnostics(raw.diagnostics) : null;
  const sourceFingerprint =
    raw?.sourceFingerprint === null
      ? null
      : typeof raw?.sourceFingerprint === 'string' &&
          /^three-dimensional-capacity:[0-9a-f]{16}$/.test(
            raw.sourceFingerprint,
          )
        ? raw.sourceFingerprint
        : undefined;
  if (
    !raw ||
    !statusAndReason ||
    effectiveDayMs !== asOfDayMs ||
    !isUtcDayMs(effectiveDayMs) ||
    raw.activityType !== activityType ||
    !criticalPower ||
    !wPrime ||
    !maximumPower ||
    !componentStatusesMatchOverall(
      statusAndReason.status,
      statusAndReason.reason,
      criticalPower,
      wPrime,
      maximumPower,
    ) ||
    !diagnostics ||
    sourceFingerprint === undefined ||
    (diagnostics.sourceCount === 0) !== (sourceFingerprint === null) ||
    (statusAndReason.reason === 'unstable-w-prime-fit' &&
      (diagnostics.wPrimeCandidateCount !== 3 ||
        diagnostics.wPrimeCandidateMinimumJoules === null ||
        diagnostics.wPrimeCandidateMaximumJoules === null)) ||
    (statusAndReason.reason !== 'unstable-w-prime-fit' &&
      (diagnostics.wPrimeCandidateCount !== 0 ||
        diagnostics.wPrimeCandidateMinimumJoules !== null ||
        diagnostics.wPrimeCandidateMaximumJoules !== null))
  ) {
    return null;
  }
  return {
    effectiveDayMs,
    status: statusAndReason.status,
    reason: statusAndReason.reason,
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
    'unstable-critical-power-fit': 'Critical-power fitting methods disagree, or CP is too sensitive to the available sustained anchors.',
    'unstable-w-prime-fit': 'Critical power is usable, but W′ changes too much across fitting methods or sustained anchors.',
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
  const statusKey = {
    criticalPowerWatts: 'criticalPowerStatus',
    wPrimeJoules: 'wPrimeStatus',
    maximumPowerWatts: 'maximumPowerStatus',
  }[key] as 'criticalPowerStatus' | 'wPrimeStatus' | 'maximumPowerStatus';
  const rangeEndDayMs = entry.current.effectiveDayMs;
  const rangeStartDayMs = rangeEndDayMs - (DERIVED_TRAINING_POWER_SYSTEMS_HISTORY_DAYS * DAY_MS);
  const points = entry.history.map(point => ({
    dayMs: point.effectiveDayMs,
    value: point[key] === null ? null : point[key] * valueScale,
    statusText: formatComponentStatus(point[statusKey]),
    isCurrent: point.effectiveDayMs === rangeEndDayMs,
  }));
  return {
    key,
    label,
    unit,
    rangeStartDayMs,
    rangeEndDayMs,
    points,
  };
}

function buildComponentCard(
  key: TrainingPowerSystemsCardViewModel['key'],
  label: string,
  description: string,
  component: DerivedTrainingPowerSystemsComponent,
  formatValue: (value: number) => string,
): TrainingPowerSystemsCardViewModel {
  return {
    key,
    label,
    description,
    valueText: component.status === 'ready' && component.value !== null
      ? formatValue(component.value)
      : 'Unavailable',
    statusText: formatComponentStatus(component.status),
  };
}

function formatEvidenceText(evidenceCounts: DerivedTrainingPowerSystemsEvidenceCounts): string {
  if (evidenceCounts.candidateActivityCount === 0) {
    return 'No workouts fall inside the preceding 42-day window.';
  }
  if (evidenceCounts.excludedActivityCount === 0) {
    return evidenceCounts.candidateActivityCount === 1
      ? 'The workout in the preceding 42 days supplied a usable power curve.'
      : `All ${evidenceCounts.candidateActivityCount} workouts in the preceding 42 days supplied usable power curves.`;
  }
  const workoutLabel = evidenceCounts.candidateActivityCount === 1 ? 'workout' : 'workouts';
  return [
    `${evidenceCounts.usableCurveActivityCount} of ${evidenceCounts.candidateActivityCount} ${workoutLabel}`,
    `in the preceding 42 days supplied usable power curves; ${evidenceCounts.excludedActivityCount} could not supply one.`,
  ].join(' ');
}

export function buildTrainingPowerSystemsInterpretation(
  snapshot: DerivedTrainingPowerSystemsSnapshot,
): TrainingPowerSystemsInterpretationViewModel | null {
  if (snapshot.reason !== 'unstable-w-prime-fit') {
    return null;
  }
  const { diagnostics } = snapshot;
  const allSustainedAnchorsComeFromOneWorkout =
    diagnostics.criticalPowerContributingSourceCount === 1;
  const hasFullSustainedRange =
    diagnostics.criticalPowerAnchorCount ===
    THREE_DIMENSIONAL_CAPACITY_CRITICAL_POWER_ANCHORS_SECONDS.length;
  const sustainedEvidence = allSustainedAnchorsComeFromOneWorkout
    ? hasFullSustainedRange
      ? 'All retained 2–20 minute bests came from one workout.'
      : `All ${diagnostics.criticalPowerAnchorCount} retained sustained-power anchors came from one workout.`
    : null;
  const sourceRemoval =
    allSustainedAnchorsComeFromOneWorkout &&
    diagnostics.criticalPowerSourceRemovalFailureCount > 0
      ? 'Removing that workout leaves no CP/W′ refit.'
      : null;
  const candidateRange =
    diagnostics.wPrimeCandidateMinimumJoules !== null &&
    diagnostics.wPrimeCandidateMaximumJoules !== null
      ? `${diagnostics.wPrimeCandidateCount} fitting methods produced W′ estimates from ${formatNumber(diagnostics.wPrimeCandidateMinimumJoules / 1000, 1)} to ${formatNumber(diagnostics.wPrimeCandidateMaximumJoules / 1000, 1)} kJ, so QS withholds one value.`
      : null;
  return {
    summary:
      'Critical power is usable, but this window cannot support one trustworthy W′ or Pmax value.',
    details: [
      sustainedEvidence,
      sourceRemoval,
      candidateRange,
      'Pmax is intentionally unavailable because the three-parameter model depends on a stable W′ value, not because it is zero.',
    ].filter((item): item is string => Boolean(item)),
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
    const sourceRemoval = [
      current.diagnostics.criticalPowerSourceRemovalMaximumChangeRatio === null
        ? null
        : `${formatNumber(current.diagnostics.criticalPowerSourceRemovalMaximumChangeRatio * 100, 1)}% CP worst whole-workout removal change`,
      current.diagnostics.wPrimeSourceRemovalMaximumChangeRatio === null
        ? null
        : `${formatNumber(current.diagnostics.wPrimeSourceRemovalMaximumChangeRatio * 100, 1)}% W′ worst whole-workout removal change`,
      current.diagnostics.criticalPowerSourceRemovalFailureCount > 0
        ? `${current.diagnostics.criticalPowerSourceRemovalFailureCount} whole-workout removal ${current.diagnostics.criticalPowerSourceRemovalFailureCount === 1 ? 'refit' : 'refits'} unavailable`
        : null,
    ];
    const rejectedShortSpikes = current.diagnostics.rejectedShortPowerSpikePointCount > 0
      ? `${current.diagnostics.rejectedShortPowerSpikePointCount} isolated short-power ${current.diagnostics.rejectedShortPowerSpikePointCount === 1 ? 'point' : 'points'} rejected`
      : null;
    const sourceLabel = (count: number): string => `${count} ${count === 1 ? 'workout' : 'workouts'}`;
    return {
      activityType,
      status: current.status,
      statusText: formatOverallStatus(current.status),
      reasonText: formatReason(current.reason),
      evidenceText: formatEvidenceText(evidenceCounts),
      interpretation: buildTrainingPowerSystemsInterpretation(current),
      diagnostics: [
        `${current.diagnostics.sourceCount} usable power curves over ${current.diagnostics.historySpanDays} days`,
        `${sourceLabel(current.diagnostics.criticalPowerContributingSourceCount)} supplied ${current.diagnostics.criticalPowerAnchorCount}/${THREE_DIMENSIONAL_CAPACITY_CRITICAL_POWER_ANCHORS_SECONDS.length} sustained anchors`,
        `${sourceLabel(current.diagnostics.maximumPowerContributingSourceCount)} supplied ${current.diagnostics.maximumPowerAnchorCount}/${THREE_DIMENSIONAL_CAPACITY_MAXIMUM_POWER_ANCHORS_SECONDS.length} short anchors`,
        fitError,
        ...methodSpread,
        stability,
        ...sourceRemoval,
        rejectedShortSpikes,
      ].filter((item): item is string => Boolean(item)),
      cards: [
        buildComponentCard(
          'criticalPower',
          'Critical power (CP)',
          'Modeled sustained-power boundary',
          current.criticalPower,
          value => `${formatNumber(value)} W`,
        ),
        buildComponentCard(
          'wPrime',
          'W′',
          'Modeled work capacity above CP',
          current.wPrime,
          value => `${formatNumber(value / 1000, 1)} kJ`,
        ),
        buildComponentCard(
          'maximumPower',
          'Maximum power (Pmax)',
          'Modeled short-duration power ceiling',
          current.maximumPower,
          value => `${formatNumber(value)} W`,
        ),
      ],
      trends: [
        buildTrend(entry, 'criticalPowerWatts', 'Critical power', 'W'),
        buildTrend(entry, 'wPrimeJoules', 'W′', 'kJ', 1 / 1000),
        buildTrend(entry, 'maximumPowerWatts', 'Maximum power', 'W'),
      ],
    };
  });
}
