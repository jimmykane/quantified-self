import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
    ActivityTypeGroups,
    DataDuration,
    DataActivityTypes,
    DataCriticalPower,
    DataFTP,
    DataHeartRateAvg,
    DataHeartRateZoneFiveDuration,
    DataHeartRateZoneFourDuration,
    DataHeartRateZoneOneDuration,
    DataHeartRateZoneSevenDuration,
    DataHeartRateZoneSixDuration,
    DataHeartRateZoneThreeDuration,
    DataHeartRateZoneTwoDuration,
    DataPowerAvg,
    DataPowerZoneFiveDuration,
    DataPowerZoneFourDuration,
    DataPowerZoneOneDuration,
    DataPowerZoneSevenDuration,
    DataPowerZoneSixDuration,
    DataPowerZoneThreeDuration,
    DataPowerZoneTwoDuration,
    DataRecoveryTime,
    DataVO2Max,
} from '@sports-alliance/sports-lib';
import { getActivityTypesForGroup } from '../../../shared/activity-type-group.metadata';
import {
    buildPowerCurveEnvelope,
    filterPowerCurvePointsByMaxDuration,
    normalizePowerCurvePoints,
    POWER_CURVE_STAT_TYPE,
    type PowerCurvePoint,
} from '../../../shared/power-curve';
import {
    buildDerivedFormDailyLoads,
    DERIVED_METRIC_KINDS,
    DERIVED_METRIC_SCHEMA_VERSION,
    DERIVED_METRICS_COLLECTION_ID,
    DERIVED_METRICS_COORDINATOR_DOC_ID,
    DERIVED_METRICS_ENTRY_TYPES,
    DERIVED_RECOVERY_LOOKBACK_WINDOW_SECONDS,
    DERIVED_RECOVERY_MAX_SUPPORTED_SECONDS,
    DEFAULT_DERIVED_METRIC_KINDS,
    PROJECTION_SENSITIVE_DERIVED_METRIC_KINDS,
    type DerivedAcwrMetricPayload,
    type DerivedFormDailyLoadEntry,
    type DerivedEasyPercentMetricPayload,
    type DerivedEfficiencyDelta4wMetricPayload,
    type DerivedEfficiencyTrendMetricPayload,
    type DerivedFreshnessForecastMetricPayload,
    type DerivedIntensityDistributionMetricPayload,
    type DerivedFormMetricPayload,
    type DerivedFormNowMetricPayload,
    type DerivedFormPlus7dMetricPayload,
    type DerivedHardPercentMetricPayload,
    type DerivedKpiTrendPoint,
    type DerivedMetricKind,
    type DerivedMetricsCoordinator,
    type DerivedMonotonyStrainMetricPayload,
    type DerivedPowerCurveMetricPayload,
    type DerivedPowerCurvePointSeries,
    type DerivedPowerCurveRange,
    type DerivedPowerCurveRangeSnapshot,
    type DerivedPowerCurveScope,
    type DerivedRampRateMetricPayload,
    type DerivedRecoveryNowMetricPayload,
    type DerivedTrainingCapacityMetric,
    type DerivedTrainingDiscipline,
    type DerivedTrainingDisciplineSummary,
    type DerivedTrainingSummaryMetricPayload,
    getDerivedMetricDocId,
    normalizeDerivedMetricKinds,
    normalizeDerivedMetricKindsStrict,
    normalizeDerivedFormDailyLoads,
    type EnsureDerivedMetricsResponse,
} from '../../../shared/derived-metrics';
import { isBenchmarkEventForTrainingMetrics } from '../../../shared/event-classification';
import { enqueueDerivedMetricsTask } from '../shared/cloud-tasks';
import {
    getUserDeletionGuardState,
    getUserDeletionGuardStateInTransaction,
} from '../shared/user-deletion-guard';
import { getDerivedMetricsUidAllowlist, isDerivedMetricsUidAllowed } from './derived-metrics-uid-gate';

const FORM_STAT_TYPE = 'Training Stress Score';
const LEGACY_FORM_STAT_TYPE = 'Power Training Stress Score';
const DERIVED_METRICS_EVENT_FIELDS = ['startDate', 'endDate', 'stats', 'isMerge', 'mergeType', 'creator', 'serviceName', 'sourceServiceName'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const CTL_TIME_CONSTANT_DAYS = 42;
const ATL_TIME_CONSTANT_DAYS = 7;
const HISTORY_TREND_WEEKS = 8;
const FORECAST_DAYS = 7;
const TRAINING_SUMMARY_CURRENT_WINDOW_DAYS = 28;
const TRAINING_SUMMARY_BASELINE_WINDOW_DAYS = 84;
const POWER_CURVE_MAX_STORED_POINTS = 128;
const POWER_CURVE_BENCHMARK_DURATIONS_SECONDS = [5, 60, 300, 1200, 3600] as const;
type PowerCurveDurationRange = Exclude<DerivedPowerCurveRange, 'thisWeek' | 'thisMonth' | 'all'>;
const POWER_CURVE_RANGE_DAYS: Record<PowerCurveDurationRange, number> = {
    '14d': 14,
    '30d': 30,
    '90d': 90,
    '1y': 365,
    '2y': 365 * 2,
    '3y': 365 * 3,
    '4y': 365 * 4,
};
const TRAINING_DISCIPLINE_ACTIVITY_TYPES: Record<DerivedTrainingDiscipline, ReadonlySet<string>> = {
    cycling: new Set([
        ...getActivityTypesForGroup(ActivityTypeGroups.CyclingGroup),
        ...getActivityTypesForGroup(ActivityTypeGroups.MountainBikingGroup),
    ].map(activityType => `${activityType}`.trim())),
    running: new Set([
        ...getActivityTypesForGroup(ActivityTypeGroups.RunningGroup),
        ...getActivityTypesForGroup(ActivityTypeGroups.TrailRunningGroup),
    ].map(activityType => `${activityType}`.trim())),
};
const DERIVED_METRICS_STUCK_QUEUED_THRESHOLD_MS = 10 * 60 * 1000;
const DERIVED_METRICS_STUCK_PROCESSING_THRESHOLD_MS = 15 * 60 * 1000;
const POWER_ZONE_STAT_TYPES = [
    DataPowerZoneOneDuration.type,
    DataPowerZoneTwoDuration.type,
    DataPowerZoneThreeDuration.type,
    DataPowerZoneFourDuration.type,
    DataPowerZoneFiveDuration.type,
    DataPowerZoneSixDuration.type,
    DataPowerZoneSevenDuration.type,
] as const;

type AbandonRequeueAttemptState = 'noop' | 'blocked' | 'requeued' | 'cleared-empty';
const HEART_RATE_ZONE_STAT_TYPES = [
    DataHeartRateZoneOneDuration.type,
    DataHeartRateZoneTwoDuration.type,
    DataHeartRateZoneThreeDuration.type,
    DataHeartRateZoneFourDuration.type,
    DataHeartRateZoneFiveDuration.type,
    DataHeartRateZoneSixDuration.type,
    DataHeartRateZoneSevenDuration.type,
] as const;

type FirestoreQueryDocumentSnapshot = FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>;

interface DerivedMetricBuildResult<TPayload> {
    sourceEventCount: number;
    payload: TPayload;
}

type DerivedMetricBuildSourceDependency = 'formDocs' | 'recoveryNowDocs';

interface DerivedLoadPoint {
    dayMs: number;
    load: number;
    ctl: number;
    atl: number;
    formSameDay: number;
    formPriorDay: number | null;
}

export interface StartDerivedMetricsProcessingResult {
    dirtyMetricKinds: DerivedMetricKind[];
    startedAtMs: number;
    eventMutationVersion: number;
}

export interface CompleteDerivedMetricsProcessingResult {
    requeued: boolean;
    nextGeneration: number | null;
    dirtyMetricKinds: DerivedMetricKind[];
}

export interface AbandonDerivedMetricsProcessingAfterWriteBlockResult {
    cleaned: boolean;
    requeued: boolean;
    nextGeneration: number | null;
    dirtyMetricKinds: DerivedMetricKind[];
}

interface DerivedMetricBuildExecutionContext {
    nowMs: number;
    formDocs: readonly FirestoreQueryDocumentSnapshot[];
    recoveryNowDocs: readonly FirestoreQueryDocumentSnapshot[];
    getDailyLoadContext: () => ReturnType<typeof buildDailyLoadContext>;
    getDerivedLoadPoints: () => DerivedLoadPoint[];
    getKpiDerivedLoadPoints: () => DerivedLoadPoint[];
    getIntensityDistributionBuildResult: () => DerivedMetricBuildResult<DerivedIntensityDistributionMetricPayload>;
    getEfficiencyTrendBuildResult: () => DerivedMetricBuildResult<DerivedEfficiencyTrendMetricPayload>;
    getTrainingSummaryBuildResult: () => DerivedMetricBuildResult<DerivedTrainingSummaryMetricPayload>;
    getPowerCurveBuildResult: () => DerivedMetricBuildResult<DerivedPowerCurveMetricPayload>;
}

interface DerivedMetricBuildDefinition {
    sourceDependencies: readonly DerivedMetricBuildSourceDependency[];
    build: (context: DerivedMetricBuildExecutionContext) => DerivedMetricBuildResult<unknown>;
}

function toSafeString(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    return `${value}`;
}

function toFiniteNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const numericValue = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numericValue)) {
        return null;
    }
    return numericValue;
}

function toFinitePositiveNumber(value: unknown): number | null {
    const numericValue = toFiniteNumber(value);
    if (numericValue === null || numericValue <= 0) {
        return null;
    }
    return numericValue;
}

function toMillis(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isFinite(time) ? time : null;
    }
    if (typeof (value as { toMillis?: unknown } | null | undefined)?.toMillis === 'function') {
        const time = Number((value as { toMillis: () => unknown }).toMillis());
        return Number.isFinite(time) ? time : null;
    }
    if (typeof (value as { toDate?: unknown } | null | undefined)?.toDate === 'function') {
        const date = (value as { toDate: () => Date }).toDate();
        return toMillis(date);
    }
    if (typeof value === 'object' && value !== null && 'seconds' in (value as Record<string, unknown>)) {
        const seconds = Number((value as Record<string, unknown>).seconds);
        const nanos = Number((value as Record<string, unknown>).nanoseconds || 0);
        if (!Number.isFinite(seconds) || !Number.isFinite(nanos)) {
            return null;
        }
        return Math.floor((seconds * 1000) + (nanos / 1_000_000));
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsedDate = new Date(value);
        const parsedTime = parsedDate.getTime();
        return Number.isFinite(parsedTime) ? parsedTime : null;
    }
    return null;
}

function resolveUtcDayStartMs(timeMs: number): number {
    const date = new Date(timeMs);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function resolveUtcWeekStartMs(timeMs: number): number {
    const date = new Date(timeMs);
    const dayIndexMondayFirst = (date.getUTCDay() + 6) % 7;
    return Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate() - dayIndexMondayFirst,
    );
}

function isProjectionSensitiveMetricKind(metricKind: DerivedMetricKind): boolean {
    return PROJECTION_SENSITIVE_DERIVED_METRIC_KINDS.includes(metricKind);
}

function toRoundedNumber(value: number, precision = 4): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
}

function parseCoordinator(data: unknown): DerivedMetricsCoordinator {
    const normalizedData = (data && typeof data === 'object') ? data as Record<string, unknown> : {};
    const status = toSafeString(normalizedData.status) as DerivedMetricsCoordinator['status'];
    const generationRaw = toFiniteNumber(normalizedData.generation);
    const eventMutationVersionRaw = toFiniteNumber(normalizedData.eventMutationVersion);
    const requestedAtMs = toFiniteNumber(normalizedData.requestedAtMs);
    const startedAtMs = toFiniteNumber(normalizedData.startedAtMs);
    const completedAtMs = toFiniteNumber(normalizedData.completedAtMs);
    const updatedAtMs = toFiniteNumber(normalizedData.updatedAtMs);
    const dirtyMetricKinds = normalizeDerivedMetricKindsStrict(normalizedData.dirtyMetricKinds as unknown[]);

    return {
        entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
        status: status === 'queued' || status === 'processing' || status === 'failed' ? status : 'idle',
        generation: generationRaw === null ? 0 : Math.max(0, Math.floor(generationRaw)),
        eventMutationVersion: eventMutationVersionRaw === null
            ? 0
            : Math.max(0, Math.floor(eventMutationVersionRaw)),
        dirtyMetricKinds,
        requestedAtMs,
        startedAtMs,
        completedAtMs,
        updatedAtMs: updatedAtMs === null ? 0 : Math.max(0, Math.floor(updatedAtMs)),
        lastError: toSafeString(normalizedData.lastError) || null,
    };
}

function mergeDerivedMetricKinds(
    existingMetricKinds: readonly DerivedMetricKind[],
    metricKindsToMerge: readonly DerivedMetricKind[],
): DerivedMetricKind[] {
    return Array.from(new Set([...existingMetricKinds, ...metricKindsToMerge]));
}

function hasSameDerivedMetricKinds(
    leftMetricKinds: readonly DerivedMetricKind[],
    rightMetricKinds: readonly DerivedMetricKind[],
): boolean {
    if (leftMetricKinds.length !== rightMetricKinds.length) {
        return false;
    }

    const leftSet = new Set(leftMetricKinds);
    if (leftSet.size !== rightMetricKinds.length) {
        return false;
    }

    return rightMetricKinds.every((metricKind) => leftSet.has(metricKind));
}

function resolveInFlightMetricKinds(
    rawCoordinatorData: unknown,
    dirtyMetricKinds: readonly DerivedMetricKind[],
): DerivedMetricKind[] {
    const normalizedData = (rawCoordinatorData && typeof rawCoordinatorData === 'object')
        ? rawCoordinatorData as Record<string, unknown>
        : {};
    const persistedInFlightMetricKinds = normalizeDerivedMetricKindsStrict(
        normalizedData.processingMetricKinds as unknown[],
    );
    if (persistedInFlightMetricKinds.length) {
        return persistedInFlightMetricKinds;
    }

    const fallbackDirtyMetricKinds = normalizeDerivedMetricKindsStrict(dirtyMetricKinds);
    if (fallbackDirtyMetricKinds.length) {
        return fallbackDirtyMetricKinds;
    }

    // Legacy coordinator docs can still be recovered when a processing worker
    // becomes stuck and persisted processing metric kinds are missing.
    return [...DEFAULT_DERIVED_METRIC_KINDS];
}

function isDerivedMetricsCoordinatorStuck(
    coordinator: DerivedMetricsCoordinator,
    nowMs: number,
): boolean {
    if (coordinator.status === 'queued') {
        const queuedSinceMs = coordinator.requestedAtMs ?? coordinator.updatedAtMs;
        return Number.isFinite(queuedSinceMs)
            && (nowMs - (queuedSinceMs as number)) >= DERIVED_METRICS_STUCK_QUEUED_THRESHOLD_MS;
    }

    if (coordinator.status === 'processing') {
        const processingSinceMs = coordinator.startedAtMs ?? coordinator.updatedAtMs;
        return Number.isFinite(processingSinceMs)
            && (nowMs - (processingSinceMs as number)) >= DERIVED_METRICS_STUCK_PROCESSING_THRESHOLD_MS;
    }

    return false;
}

function isMergedEvent(eventData: Record<string, unknown>): boolean {
    return isBenchmarkEventForTrainingMetrics(eventData);
}

function resolveRawStats(eventData: Record<string, unknown>): Record<string, unknown> {
    const stats = eventData.stats;
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
        return {};
    }
    return stats as Record<string, unknown>;
}

function resolveRawStatValue(
    eventData: Record<string, unknown>,
    statType: string,
): unknown {
    const stats = resolveRawStats(eventData);
    if (!Object.prototype.hasOwnProperty.call(stats, statType)) {
        return null;
    }

    const rawStat = stats[statType];
    if (!rawStat || typeof rawStat !== 'object' || Array.isArray(rawStat)) {
        return rawStat;
    }

    const statObject = rawStat as Record<string, unknown>;
    return statObject.value
        ?? statObject.rawValue
        ?? statObject._value
        ?? rawStat;
}

function resolveRawStatNumericValue(
    eventData: Record<string, unknown>,
    statType: string,
): number | null {
    const rawStat = resolveRawStatValue(eventData, statType);
    const directValue = toFiniteNumber(rawStat);
    if (directValue !== null) {
        return directValue;
    }

    if (!rawStat || typeof rawStat !== 'object' || Array.isArray(rawStat)) {
        return null;
    }

    const statObject = rawStat as Record<string, unknown>;
    return toFiniteNumber(statObject.value)
        ?? toFiniteNumber(statObject.rawValue)
        ?? toFiniteNumber(statObject._value)
        ?? null;
}

function resolveTrainingStressScore(eventData: Record<string, unknown>): number | null {
    const preferred = resolveRawStatNumericValue(eventData, FORM_STAT_TYPE);
    if (preferred !== null && preferred >= 0) {
        return preferred;
    }

    const legacy = resolveRawStatNumericValue(eventData, LEGACY_FORM_STAT_TYPE);
    if (legacy !== null && legacy >= 0) {
        return legacy;
    }

    return null;
}

function resolveRecoveryEventEndTimeMs(eventData: Record<string, unknown>): number | null {
    const endTimeMs = toMillis(eventData.endDate);
    if (endTimeMs !== null) {
        return endTimeMs;
    }

    const startTimeMs = toMillis(eventData.startDate);
    if (startTimeMs === null) {
        return null;
    }

    const durationSeconds = toFinitePositiveNumber(resolveRawStatNumericValue(eventData, DataDuration.type));
    if (durationSeconds === null) {
        return null;
    }

    return startTimeMs + (durationSeconds * 1000);
}

function resolveSupportedRecoverySeconds(
    eventData: Record<string, unknown>,
): number | null {
    // Guard against provider/parser outliers (for example malformed multi-day recovery values).
    const recoverySeconds = toFinitePositiveNumber(resolveRawStatNumericValue(eventData, DataRecoveryTime.type));
    if (recoverySeconds === null || recoverySeconds > DERIVED_RECOVERY_MAX_SUPPORTED_SECONDS) {
        return null;
    }
    return recoverySeconds;
}

function resolveRecoveryEventLookbackStartMs(nowMs = Date.now()): number {
    return nowMs - (DERIVED_RECOVERY_LOOKBACK_WINDOW_SECONDS * 1000);
}

export function getDerivedRecoveryLookbackWindowSeconds(): number {
    return DERIVED_RECOVERY_LOOKBACK_WINDOW_SECONDS;
}

function buildDailyLoadContext(
    docs: readonly FirestoreQueryDocumentSnapshot[],
): {
    dailyLoadsByUtcDay: Map<number, number>;
    sourceEventCount: number;
} {
    const dailyLoadsByUtcDay = new Map<number, number>();
    let sourceEventCount = 0;

    docs.forEach((doc) => {
        const eventData = (doc.data() || {}) as Record<string, unknown>;
        if (isMergedEvent(eventData)) {
            return;
        }

        const startTimeMs = toMillis(eventData.startDate);
        if (startTimeMs === null) {
            return;
        }

        const stressScore = resolveTrainingStressScore(eventData);
        if (stressScore === null || stressScore < 0) {
            return;
        }

        const dayMs = resolveUtcDayStartMs(startTimeMs);
        dailyLoadsByUtcDay.set(dayMs, (dailyLoadsByUtcDay.get(dayMs) || 0) + stressScore);
        sourceEventCount += 1;
    });

    return {
        dailyLoadsByUtcDay,
        sourceEventCount,
    };
}

function buildDailyLoadContextFromDailyLoads(
    dailyLoads: readonly DerivedFormDailyLoadEntry[],
    sourceEventCount: number,
): {
    dailyLoadsByUtcDay: Map<number, number>;
    sourceEventCount: number;
} {
    const dailyLoadsByUtcDay = dailyLoads.reduce((accumulator, dailyLoad) => {
        accumulator.set(dailyLoad.dayMs, (accumulator.get(dailyLoad.dayMs) || 0) + dailyLoad.load);
        return accumulator;
    }, new Map<number, number>());
    return {
        dailyLoadsByUtcDay,
        sourceEventCount: Math.max(0, Math.floor(sourceEventCount)),
    };
}

function buildDerivedLoadPoints(
    dailyLoadsByUtcDay: ReadonlyMap<number, number>,
    options?: {
        endDayMs?: number | null;
    },
): DerivedLoadPoint[] {
    if (!dailyLoadsByUtcDay.size) {
        return [];
    }

    const sortedDays = [...dailyLoadsByUtcDay.keys()].sort((left, right) => left - right);
    const startDay = sortedDays[0];
    const latestDayWithSourceLoad = sortedDays[sortedDays.length - 1];
    const requestedEndDay = toFiniteNumber(options?.endDayMs);
    const normalizedRequestedEndDay = requestedEndDay === null
        ? null
        : resolveUtcDayStartMs(requestedEndDay);
    const endDay = normalizedRequestedEndDay === null
        ? latestDayWithSourceLoad
        : Math.max(latestDayWithSourceLoad, normalizedRequestedEndDay);
    if (!Number.isFinite(startDay) || !Number.isFinite(endDay)) {
        return [];
    }

    const points: DerivedLoadPoint[] = [];
    let previousCtl = 0;
    let previousAtl = 0;

    for (let dayMs = startDay; dayMs <= endDay; dayMs += DAY_MS) {
        const load = dailyLoadsByUtcDay.get(dayMs) || 0;
        const ctl = previousCtl + ((load - previousCtl) / CTL_TIME_CONSTANT_DAYS);
        const atl = previousAtl + ((load - previousAtl) / ATL_TIME_CONSTANT_DAYS);
        points.push({
            dayMs,
            load,
            ctl,
            atl,
            formSameDay: ctl - atl,
            formPriorDay: points.length ? previousCtl - previousAtl : null,
        });
        previousCtl = ctl;
        previousAtl = atl;
    }

    return points;
}

function resolveRollingLoad(points: readonly DerivedLoadPoint[], index: number, days: number): number {
    let sum = 0;
    const startIndex = Math.max(0, index - (days - 1));
    for (let currentIndex = startIndex; currentIndex <= index; currentIndex += 1) {
        sum += points[currentIndex]?.load || 0;
    }
    return sum;
}

function takeLatestTrendWeeks<T extends { weekStartMs: number }>(points: readonly T[]): T[] {
    if (!points.length) {
        return [];
    }
    return points.slice(Math.max(0, points.length - HISTORY_TREND_WEEKS));
}

function buildWeeklyKpiTrendFromDailyPoints(
    points: readonly DerivedLoadPoint[],
    valueSelector: (point: DerivedLoadPoint) => number | null,
): DerivedKpiTrendPoint[] {
    if (!points.length) {
        return [];
    }

    const trendByWeek = new Map<number, DerivedKpiTrendPoint>();
    points.forEach((point) => {
        const rawValue = valueSelector(point);
        trendByWeek.set(resolveUtcWeekStartMs(point.dayMs), {
            weekStartMs: resolveUtcWeekStartMs(point.dayMs),
            value: rawValue === null ? null : toRoundedNumber(rawValue, 4),
        });
    });

    return takeLatestTrendWeeks(
        [...trendByWeek.values()].sort((left, right) => left.weekStartMs - right.weekStartMs),
    );
}

function projectSameDayFormWithZeroLoad(
    ctl: number,
    atl: number,
    projectionDays: number,
): number {
    if (!Number.isFinite(ctl) || !Number.isFinite(atl) || projectionDays <= 0) {
        return ctl - atl;
    }

    let previousCtl = ctl;
    let previousAtl = atl;
    let projectedSameDayForm = previousCtl - previousAtl;
    for (let dayOffset = 1; dayOffset <= projectionDays; dayOffset += 1) {
        const nextCtl = previousCtl + ((0 - previousCtl) / CTL_TIME_CONSTANT_DAYS);
        const nextAtl = previousAtl + ((0 - previousAtl) / ATL_TIME_CONSTANT_DAYS);
        projectedSameDayForm = nextCtl - nextAtl;
        previousCtl = nextCtl;
        previousAtl = nextAtl;
    }

    return projectedSameDayForm;
}

function buildFormMetricPayload(
    dailyLoadContext: ReturnType<typeof buildDailyLoadContext>,
): DerivedMetricBuildResult<DerivedFormMetricPayload> {
    // Firestore rejects nested arrays, so we persist day/load objects instead of tuple arrays.
    const sortedDailyLoads = buildDerivedFormDailyLoads(dailyLoadContext.dailyLoadsByUtcDay);

    return {
        sourceEventCount: dailyLoadContext.sourceEventCount,
        payload: {
            dayBoundary: 'UTC',
            rangeStartDayMs: sortedDailyLoads.length ? sortedDailyLoads[0].dayMs : null,
            rangeEndDayMs: sortedDailyLoads.length ? sortedDailyLoads[sortedDailyLoads.length - 1].dayMs : null,
            dailyLoads: sortedDailyLoads,
            excludesMergedEvents: true,
        },
    };
}

function buildAcwrMetricPayload(
    points: readonly DerivedLoadPoint[],
    sourceEventCount: number,
    asOfDayMs: number | null,
): DerivedMetricBuildResult<DerivedAcwrMetricPayload> {
    if (!points.length) {
        return {
            sourceEventCount,
            payload: {
                dayBoundary: 'UTC',
                asOfDayMs,
                latestDayMs: null,
                acuteLoad7: 0,
                chronicLoad28: 0,
                ratio: null,
                trend8Weeks: [],
            },
        };
    }

    const trendByWeek = new Map<number, { weekStartMs: number; ratio: number | null }>();
    const acwrByDay = points.map((point, index) => {
        const acuteLoad7 = resolveRollingLoad(points, index, 7);
        const chronicLoad28 = resolveRollingLoad(points, index, 28) / 4;
        const ratio = chronicLoad28 > 0 ? acuteLoad7 / chronicLoad28 : null;
        trendByWeek.set(resolveUtcWeekStartMs(point.dayMs), {
            weekStartMs: resolveUtcWeekStartMs(point.dayMs),
            ratio: ratio === null ? null : toRoundedNumber(ratio, 4),
        });
        return {
            acuteLoad7,
            chronicLoad28,
            ratio,
        };
    });
    const latest = acwrByDay[acwrByDay.length - 1];
    const trend8Weeks = takeLatestTrendWeeks(
        [...trendByWeek.values()].sort((left, right) => left.weekStartMs - right.weekStartMs),
    );

    return {
        sourceEventCount,
        payload: {
            dayBoundary: 'UTC',
            asOfDayMs,
            latestDayMs: points[points.length - 1]?.dayMs ?? null,
            acuteLoad7: toRoundedNumber(latest?.acuteLoad7 || 0, 2),
            chronicLoad28: toRoundedNumber(latest?.chronicLoad28 || 0, 2),
            ratio: latest?.ratio === null ? null : toRoundedNumber(latest?.ratio || 0, 4),
            trend8Weeks,
        },
    };
}

function buildRampRateMetricPayload(
    points: readonly DerivedLoadPoint[],
    sourceEventCount: number,
    asOfDayMs: number | null,
): DerivedMetricBuildResult<DerivedRampRateMetricPayload> {
    if (!points.length) {
        return {
            sourceEventCount,
            payload: {
                dayBoundary: 'UTC',
                asOfDayMs,
                latestDayMs: null,
                ctlToday: null,
                ctl7DaysAgo: null,
                rampRate: null,
                trend8Weeks: [],
            },
        };
    }

    const pointByDay = new Map<number, DerivedLoadPoint>(points.map(point => [point.dayMs, point]));
    const trendByWeek = new Map<number, { weekStartMs: number; rampRate: number | null }>();
    points.forEach((point) => {
        const previous = pointByDay.get(point.dayMs - (7 * DAY_MS));
        const rampRate = previous ? point.ctl - previous.ctl : null;
        trendByWeek.set(resolveUtcWeekStartMs(point.dayMs), {
            weekStartMs: resolveUtcWeekStartMs(point.dayMs),
            rampRate: rampRate === null ? null : toRoundedNumber(rampRate, 4),
        });
    });

    const latestPoint = points[points.length - 1];
    const point7DaysAgo = pointByDay.get(latestPoint.dayMs - (7 * DAY_MS)) || null;
    const rampRate = point7DaysAgo ? (latestPoint.ctl - point7DaysAgo.ctl) : null;

    return {
        sourceEventCount,
        payload: {
            dayBoundary: 'UTC',
            asOfDayMs,
            latestDayMs: latestPoint.dayMs,
            ctlToday: toRoundedNumber(latestPoint.ctl, 4),
            ctl7DaysAgo: point7DaysAgo ? toRoundedNumber(point7DaysAgo.ctl, 4) : null,
            rampRate: rampRate === null ? null : toRoundedNumber(rampRate, 4),
            trend8Weeks: takeLatestTrendWeeks(
                [...trendByWeek.values()].sort((left, right) => left.weekStartMs - right.weekStartMs),
            ),
        },
    };
}

function resolveMonotonyStrain(
    points: readonly DerivedLoadPoint[],
    index: number,
): { weeklyLoad7: number; monotony: number | null; strain: number | null } {
    const startIndex = Math.max(0, index - 6);
    const windowLoads = points.slice(startIndex, index + 1).map(point => point.load);
    const weeklyLoad7 = windowLoads.reduce((sum, value) => sum + value, 0);
    const mean = windowLoads.length ? (weeklyLoad7 / windowLoads.length) : 0;
    const variance = windowLoads.length
        ? windowLoads.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / windowLoads.length
        : 0;
    const stddev = Math.sqrt(variance);
    const monotony = stddev > 0 ? (mean / stddev) : null;
    const strain = monotony === null ? null : weeklyLoad7 * monotony;
    return {
        weeklyLoad7,
        monotony,
        strain,
    };
}

function buildMonotonyStrainMetricPayload(
    points: readonly DerivedLoadPoint[],
    sourceEventCount: number,
    asOfDayMs: number | null,
): DerivedMetricBuildResult<DerivedMonotonyStrainMetricPayload> {
    if (!points.length) {
        return {
            sourceEventCount,
            payload: {
                dayBoundary: 'UTC',
                asOfDayMs,
                latestDayMs: null,
                weeklyLoad7: 0,
                monotony: null,
                strain: null,
                trend8Weeks: [],
            },
        };
    }

    const trendByWeek = new Map<number, { weekStartMs: number; strain: number | null }>();
    const latestDerived = resolveMonotonyStrain(points, points.length - 1);
    points.forEach((point, index) => {
        const weeklyValue = resolveMonotonyStrain(points, index);
        trendByWeek.set(resolveUtcWeekStartMs(point.dayMs), {
            weekStartMs: resolveUtcWeekStartMs(point.dayMs),
            strain: weeklyValue.strain === null ? null : toRoundedNumber(weeklyValue.strain, 2),
        });
    });

    return {
        sourceEventCount,
        payload: {
            dayBoundary: 'UTC',
            asOfDayMs,
            latestDayMs: points[points.length - 1].dayMs,
            weeklyLoad7: toRoundedNumber(latestDerived.weeklyLoad7, 2),
            monotony: latestDerived.monotony === null ? null : toRoundedNumber(latestDerived.monotony, 4),
            strain: latestDerived.strain === null ? null : toRoundedNumber(latestDerived.strain, 2),
            trend8Weeks: takeLatestTrendWeeks(
                [...trendByWeek.values()].sort((left, right) => left.weekStartMs - right.weekStartMs),
            ),
        },
    };
}

function buildFormNowMetricPayload(
    points: readonly DerivedLoadPoint[],
    sourceEventCount: number,
    asOfDayMs: number | null,
): DerivedMetricBuildResult<DerivedFormNowMetricPayload> {
    if (!points.length) {
        return {
            sourceEventCount,
            payload: {
                dayBoundary: 'UTC',
                asOfDayMs,
                latestDayMs: null,
                value: null,
                trend8Weeks: [],
            },
        };
    }

    const latestPoint = points[points.length - 1];
    return {
        sourceEventCount,
        payload: {
            dayBoundary: 'UTC',
            asOfDayMs,
            latestDayMs: latestPoint.dayMs,
            value: toRoundedNumber(latestPoint.formSameDay, 4),
            trend8Weeks: buildWeeklyKpiTrendFromDailyPoints(points, (point) => point.formSameDay),
        },
    };
}

function buildFormPlus7dMetricPayload(
    points: readonly DerivedLoadPoint[],
    sourceEventCount: number,
    asOfDayMs: number | null,
): DerivedMetricBuildResult<DerivedFormPlus7dMetricPayload> {
    if (!points.length) {
        return {
            sourceEventCount,
            payload: {
                dayBoundary: 'UTC',
                asOfDayMs,
                latestDayMs: null,
                projectedDayMs: null,
                value: null,
                trend8Weeks: [],
            },
        };
    }

    const latestPoint = points[points.length - 1];
    // Form +7d uses the same-day TSB semantics as Form Now, projected 7 days
    // ahead by decaying CTL/ATL with zero load.
    const latestProjection = projectSameDayFormWithZeroLoad(latestPoint.ctl, latestPoint.atl, 7);
    return {
        sourceEventCount,
        payload: {
            dayBoundary: 'UTC',
            asOfDayMs,
            latestDayMs: latestPoint.dayMs,
            projectedDayMs: latestPoint.dayMs + (7 * DAY_MS),
            value: toRoundedNumber(latestProjection, 4),
            trend8Weeks: buildWeeklyKpiTrendFromDailyPoints(points, (point) => (
                projectSameDayFormWithZeroLoad(point.ctl, point.atl, 7)
            )),
        },
    };
}

function buildFreshnessForecastMetricPayload(
    points: readonly DerivedLoadPoint[],
    sourceEventCount: number,
    asOfDayMs: number | null,
): DerivedMetricBuildResult<DerivedFreshnessForecastMetricPayload> {
    if (!points.length) {
        return {
            sourceEventCount,
            payload: {
                dayBoundary: 'UTC',
                asOfDayMs,
                generatedAtMs: Date.now(),
                points: [],
            },
        };
    }

    const latestPoint = points[points.length - 1];
    const forecastPoints: DerivedFreshnessForecastMetricPayload['points'] = [
        {
            dayMs: latestPoint.dayMs,
            trainingStressScore: latestPoint.load,
            ctl: toRoundedNumber(latestPoint.ctl, 4),
            atl: toRoundedNumber(latestPoint.atl, 4),
            formSameDay: toRoundedNumber(latestPoint.formSameDay, 4),
            formPriorDay: latestPoint.formPriorDay === null ? null : toRoundedNumber(latestPoint.formPriorDay, 4),
            isForecast: false,
        },
    ];
    let previousCtl = latestPoint.ctl;
    let previousAtl = latestPoint.atl;

    for (let dayOffset = 1; dayOffset <= FORECAST_DAYS; dayOffset += 1) {
        const trainingStressScore = 0;
        const ctl = previousCtl + ((trainingStressScore - previousCtl) / CTL_TIME_CONSTANT_DAYS);
        const atl = previousAtl + ((trainingStressScore - previousAtl) / ATL_TIME_CONSTANT_DAYS);
        forecastPoints.push({
            dayMs: latestPoint.dayMs + (dayOffset * DAY_MS),
            trainingStressScore,
            ctl: toRoundedNumber(ctl, 4),
            atl: toRoundedNumber(atl, 4),
            formSameDay: toRoundedNumber(ctl - atl, 4),
            formPriorDay: toRoundedNumber(previousCtl - previousAtl, 4),
            isForecast: true,
        });
        previousCtl = ctl;
        previousAtl = atl;
    }

    return {
        sourceEventCount,
        payload: {
            dayBoundary: 'UTC',
            asOfDayMs,
            generatedAtMs: Date.now(),
            points: forecastPoints,
        },
    };
}

function resolveZoneDurations(
    eventData: Record<string, unknown>,
    zoneTypes: readonly string[],
): number[] {
    return zoneTypes.map((zoneType) => {
        const value = toFinitePositiveNumber(resolveRawStatNumericValue(eventData, zoneType));
        return value === null ? 0 : value;
    });
}

type TrainingCapacityKind = 'vo2Max' | 'ftp' | 'criticalPower';

interface TrainingCapacityObservation {
    sourceKey: string | null;
    timeMs: number;
    value: number;
}

interface TrainingSummaryWindowAccumulator {
    activityCount: number;
    durationSeconds: number;
    easySeconds: number;
    moderateSeconds: number;
    hardSeconds: number;
}

interface TrainingSummaryDisciplineAccumulator {
    current: TrainingSummaryWindowAccumulator;
    baseline: TrainingSummaryWindowAccumulator;
    capacities: Record<TrainingCapacityKind, TrainingCapacityObservation[]>;
}

function createTrainingSummaryWindowAccumulator(): TrainingSummaryWindowAccumulator {
    return {
        activityCount: 0,
        durationSeconds: 0,
        easySeconds: 0,
        moderateSeconds: 0,
        hardSeconds: 0,
    };
}

function createTrainingSummaryDisciplineAccumulator(): TrainingSummaryDisciplineAccumulator {
    return {
        current: createTrainingSummaryWindowAccumulator(),
        baseline: createTrainingSummaryWindowAccumulator(),
        capacities: {
            vo2Max: [],
            ftp: [],
            criticalPower: [],
        },
    };
}

function resolveTrainingDiscipline(eventData: Record<string, unknown>): DerivedTrainingDiscipline | null {
    const rawActivityTypes = resolveRawStatValue(eventData, DataActivityTypes.type);
    const values = Array.isArray(rawActivityTypes)
        ? rawActivityTypes
        : [rawActivityTypes];
    const activityTypes = values
        .map(value => `${value ?? ''}`.trim())
        .filter(Boolean);

    if (activityTypes.some(value => TRAINING_DISCIPLINE_ACTIVITY_TYPES.running.has(value))) {
        return 'running';
    }
    if (activityTypes.some(value => TRAINING_DISCIPLINE_ACTIVITY_TYPES.cycling.has(value))) {
        return 'cycling';
    }
    return null;
}

interface ResolvedPowerCurveEvent {
    eventId: string | null;
    startMs: number;
    points: PowerCurvePoint[];
}

function resolvePowerCurveDurationSeconds(eventData: Record<string, unknown>): number | null {
    const statDuration = toFinitePositiveNumber(resolveRawStatNumericValue(eventData, DataDuration.type));
    if (statDuration !== null) {
        return statDuration;
    }
    const startMs = toMillis(eventData.startDate);
    const endMs = toMillis(eventData.endDate);
    if (startMs === null || endMs === null || endMs <= startMs) {
        return null;
    }
    return (endMs - startMs) / 1000;
}

function resolvePowerCurveEvent(
    doc: FirestoreQueryDocumentSnapshot,
): { discipline: DerivedPowerCurveScope; source: ResolvedPowerCurveEvent | null; startMs: number } | null {
    const eventData = (doc.data() || {}) as Record<string, unknown>;
    if (isMergedEvent(eventData)) {
        return null;
    }
    const discipline = resolveTrainingDiscipline(eventData);
    const startMs = toMillis(eventData.startDate);
    if (discipline === null || startMs === null) {
        return null;
    }

    const points = filterPowerCurvePointsByMaxDuration(
        normalizePowerCurvePoints(resolveRawStatValue(eventData, POWER_CURVE_STAT_TYPE)).points,
        resolvePowerCurveDurationSeconds(eventData),
    );
    if (!points.length) {
        return { discipline, source: null, startMs };
    }

    return {
        discipline,
        startMs,
        source: {
            eventId: `${doc.id || ''}`.trim() || null,
            startMs,
            points,
        },
    };
}

function isPowerCurveEventInWindow(
    startMs: number,
    window: { startMs: number | null; endMs: number | null },
): boolean {
    return (window.startMs === null || startMs >= window.startMs)
        && (window.endMs === null || startMs <= window.endMs);
}

function resolvePowerCurveRangeWindow(
    range: DerivedPowerCurveRange,
    nowMs: number,
    weekStartDay: number | null = null,
): { startMs: number | null; endMs: number | null } {
    if (range === 'all') {
        return { startMs: null, endMs: null };
    }
    if (range === 'thisMonth') {
        const now = new Date(nowMs);
        return {
            startMs: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
            endMs: nowMs,
        };
    }
    if (range === 'thisWeek') {
        const now = new Date(nowMs);
        const normalizedWeekStartDay = Number.isFinite(weekStartDay)
            ? Math.max(0, Math.min(6, Math.floor(weekStartDay as number)))
            : 1;
        const daysSinceStart = (now.getUTCDay() - normalizedWeekStartDay + 7) % 7;
        return {
            startMs: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceStart),
            endMs: nowMs,
        };
    }

    const days = POWER_CURVE_RANGE_DAYS[range as keyof typeof POWER_CURVE_RANGE_DAYS];
    return {
        startMs: nowMs - (days * DAY_MS),
        endMs: nowMs,
    };
}

function samplePowerCurvePoints(points: readonly PowerCurvePoint[]): PowerCurvePoint[] {
    if (points.length <= POWER_CURVE_MAX_STORED_POINTS) {
        return points.map(point => ({ ...point }));
    }

    const selectedIndexes = new Set<number>([0, points.length - 1]);
    POWER_CURVE_BENCHMARK_DURATIONS_SECONDS.forEach((duration) => {
        const index = points.findIndex(point => point.duration === duration);
        if (index >= 0) {
            selectedIndexes.add(index);
        }
    });

    const firstDuration = points[0].duration;
    const lastDuration = points[points.length - 1].duration;
    const logStart = Math.log(firstDuration);
    const logSpan = Math.log(lastDuration) - logStart;
    const targetCount = POWER_CURVE_MAX_STORED_POINTS;
    for (let slot = 1; selectedIndexes.size < targetCount && slot < targetCount - 1; slot += 1) {
        const targetDuration = Math.exp(logStart + ((logSpan * slot) / (targetCount - 1)));
        let closestIndex = 0;
        let closestDistance = Number.POSITIVE_INFINITY;
        points.forEach((point, index) => {
            const distance = Math.abs(Math.log(point.duration) - Math.log(targetDuration));
            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = index;
            }
        });
        selectedIndexes.add(closestIndex);
    }

    for (let index = 0; selectedIndexes.size < targetCount && index < points.length; index += 1) {
        const evenlySpacedIndex = Math.round((index * (points.length - 1)) / (targetCount - 1));
        selectedIndexes.add(evenlySpacedIndex);
    }

    return [...selectedIndexes]
        .sort((left, right) => left - right)
        .slice(0, targetCount)
        .map(index => ({ ...points[index] }));
}

function serializePowerCurvePoints(points: readonly PowerCurvePoint[]): DerivedPowerCurvePointSeries {
    return samplePowerCurvePoints(points).flatMap(point => [
        point.duration,
        point.power,
        point.wattsPerKg ?? 0,
    ]);
}

function comparePowerCurveEvents(left: ResolvedPowerCurveEvent, right: ResolvedPowerCurveEvent): number {
    if (left.startMs !== right.startMs) {
        return left.startMs - right.startMs;
    }
    return `${left.eventId || ''}`.localeCompare(`${right.eventId || ''}`);
}

function buildPowerCurveRangeSnapshot(
    sourceEvents: readonly { startMs: number; source: ResolvedPowerCurveEvent | null }[],
    window: { startMs: number | null; endMs: number | null },
    nowMs: number,
): DerivedPowerCurveRangeSnapshot {
    const rangeSourceEvents = sourceEvents.filter(event => isPowerCurveEventInWindow(event.startMs, window));
    const matchedEvents = rangeSourceEvents
        .map(event => event.source)
        .filter((event): event is ResolvedPowerCurveEvent => event !== null)
        .sort(comparePowerCurveEvents);
    const latestActivity = matchedEvents[matchedEvents.length - 1] || null;
    const bestPoints = buildPowerCurveEnvelope(matchedEvents.map(event => event.points));
    // Preserve the prior dashboard behavior: recent-best comparisons are anchored
    // to the latest usable activity in the selected range, not wall-clock now.
    const comparisonAnchorMs = latestActivity?.startMs ?? nowMs;
    const buildRecentWindow = (days: number): ResolvedPowerCurveEvent[] => matchedEvents.filter(event => (
        event.startMs >= comparisonAnchorMs - (days * DAY_MS)
        && event.startMs <= comparisonAnchorMs
    ));
    const recent30d = buildRecentWindow(30);
    const recent90d = buildRecentWindow(90);

    return {
        sourceEventCount: rangeSourceEvents.length,
        matchedEventCount: matchedEvents.length,
        latestActivity: latestActivity
            ? {
                eventId: latestActivity.eventId,
                startMs: latestActivity.startMs,
                points: serializePowerCurvePoints(latestActivity.points),
            }
            : null,
        bestPoints: serializePowerCurvePoints(bestPoints),
        best30dPoints: serializePowerCurvePoints(buildPowerCurveEnvelope(recent30d.map(event => event.points))),
        best30dEventCount: recent30d.length,
        best90dPoints: serializePowerCurvePoints(buildPowerCurveEnvelope(recent90d.map(event => event.points))),
        best90dEventCount: recent90d.length,
    };
}

export function buildPowerCurveMetricPayload(
    docs: readonly FirestoreQueryDocumentSnapshot[],
    nowMs = Date.now(),
): DerivedMetricBuildResult<DerivedPowerCurveMetricPayload> {
    const eventsByScope: Record<DerivedPowerCurveScope, Array<{ startMs: number; source: ResolvedPowerCurveEvent | null }>> = {
        cycling: [],
        running: [],
    };

    docs.forEach((doc) => {
        const resolved = resolvePowerCurveEvent(doc);
        if (resolved) {
            eventsByScope[resolved.discipline].push({
                startMs: resolved.startMs,
                source: resolved.source,
            });
        }
    });

    const buildScope = (scope: DerivedPowerCurveScope) => {
        const events = eventsByScope[scope];
        const ranges = {
            thisMonth: buildPowerCurveRangeSnapshot(events, resolvePowerCurveRangeWindow('thisMonth', nowMs), nowMs),
            '14d': buildPowerCurveRangeSnapshot(events, resolvePowerCurveRangeWindow('14d', nowMs), nowMs),
            '30d': buildPowerCurveRangeSnapshot(events, resolvePowerCurveRangeWindow('30d', nowMs), nowMs),
            '90d': buildPowerCurveRangeSnapshot(events, resolvePowerCurveRangeWindow('90d', nowMs), nowMs),
            '1y': buildPowerCurveRangeSnapshot(events, resolvePowerCurveRangeWindow('1y', nowMs), nowMs),
            '2y': buildPowerCurveRangeSnapshot(events, resolvePowerCurveRangeWindow('2y', nowMs), nowMs),
            '3y': buildPowerCurveRangeSnapshot(events, resolvePowerCurveRangeWindow('3y', nowMs), nowMs),
            '4y': buildPowerCurveRangeSnapshot(events, resolvePowerCurveRangeWindow('4y', nowMs), nowMs),
            all: buildPowerCurveRangeSnapshot(events, resolvePowerCurveRangeWindow('all', nowMs), nowMs),
        };
        const thisWeekByStartDay = Array.from({ length: 7 }, (_, day) => [
            `${day}`,
            buildPowerCurveRangeSnapshot(events, resolvePowerCurveRangeWindow('thisWeek', nowMs, day), nowMs),
        ] as const).reduce<Record<string, DerivedPowerCurveRangeSnapshot>>((result, [day, snapshot]) => {
            result[day] = snapshot;
            return result;
        }, {});
        return { ranges, thisWeekByStartDay };
    };

    return {
        sourceEventCount: docs.length,
        payload: {
            asOfDayMs: resolveUtcDayStartMs(nowMs),
            excludesMergedEvents: true,
            pointSamplingVersion: 1,
            scopes: {
                cycling: buildScope('cycling'),
                running: buildScope('running'),
            },
        },
    };
}

function resolveTrainingSourceKey(eventData: Record<string, unknown>): string | null {
  const creator = eventData.creator && typeof eventData.creator === 'object' && !Array.isArray(eventData.creator)
    ? eventData.creator as Record<string, unknown>
    : {};
  const normalize = (value: unknown): string => toSafeString(value)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  const provider = [
    eventData.sourceServiceName,
    eventData.serviceName,
    creator.serviceName,
    creator.manufacturer,
  ]
    .map(normalize)
    .find(Boolean) || '';
  const device = [creator.name, creator.deviceName, creator.productName]
    .map(normalize)
    .find(Boolean) || '';

  // Provider-only values (for example, "Garmin") can combine more than one
  // device. Capacity trends need a device-level source to stay comparable.
  if (!device) {
    return null;
  }

  if (!provider || device === provider || device.startsWith(`${provider} `)) {
    return device;
  }
  return `${provider} / ${device}`;
}

function buildTrainingSummaryWindow(
    accumulator: TrainingSummaryWindowAccumulator,
    windowStartDayMs: number,
    windowEndDayMs: number,
    normalizationFactor = 1,
): DerivedTrainingSummaryMetricPayload['disciplines'][number]['current28d'] {
    return {
        periodDays: TRAINING_SUMMARY_CURRENT_WINDOW_DAYS,
        windowStartDayMs,
        windowEndDayMs,
        activityCount: toRoundedNumber(accumulator.activityCount * normalizationFactor, 2),
        durationSeconds: toRoundedNumber(accumulator.durationSeconds * normalizationFactor, 2),
        easySeconds: toRoundedNumber(accumulator.easySeconds * normalizationFactor, 2),
        moderateSeconds: toRoundedNumber(accumulator.moderateSeconds * normalizationFactor, 2),
        hardSeconds: toRoundedNumber(accumulator.hardSeconds * normalizationFactor, 2),
    };
}

function median(values: readonly number[]): number | null {
    if (!values.length) {
        return null;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

function buildTrainingCapacityMetric(
    observations: readonly TrainingCapacityObservation[],
    currentStartDayMs: number,
    baselineStartDayMs: number,
    baselineEndDayMs: number,
): DerivedTrainingCapacityMetric | null {
    if (!observations.length) {
        return null;
    }

    const sourceKeys = new Set(observations.map(observation => observation.sourceKey));
    const latest = [...observations].sort((left, right) => right.timeMs - left.timeMs)[0];
    const current = observations.filter(observation => observation.timeMs >= currentStartDayMs);
    const baseline = observations.filter(observation => observation.timeMs >= baselineStartDayMs && observation.timeMs <= baselineEndDayMs);

    if (sourceKeys.size !== 1 || sourceKeys.has(null)) {
        return {
            sourceKey: null,
            latestAtMs: latest.timeMs,
            latestValue: latest.value,
            currentMedian: null,
            baselineMedian: null,
            currentSampleCount: current.length,
            baselineSampleCount: baseline.length,
            deltaPct: null,
            trend: null,
        };
    }

    const currentMedian = median(current.map(observation => observation.value));
    const baselineMedian = median(baseline.map(observation => observation.value));
    const deltaPct = currentMedian !== null && baselineMedian !== null && baselineMedian > 0
        ? toRoundedNumber(((currentMedian - baselineMedian) / baselineMedian) * 100, 2)
        : null;
    const hasComparison = currentMedian !== null && baselineMedian !== null && current.length >= 1 && baseline.length >= 2;
    const trend = hasComparison && deltaPct !== null
        ? (deltaPct > 2 ? 'improving' : (deltaPct < -2 ? 'declining' : 'stable'))
        : null;

    return {
        sourceKey: observations[0].sourceKey,
        latestAtMs: latest.timeMs,
        latestValue: latest.value,
        currentMedian,
        baselineMedian,
        currentSampleCount: current.length,
        baselineSampleCount: baseline.length,
        deltaPct,
        trend,
    };
}

export function buildTrainingSummaryMetricPayload(
    docs: readonly FirestoreQueryDocumentSnapshot[],
    nowMs = Date.now(),
): DerivedMetricBuildResult<DerivedTrainingSummaryMetricPayload> {
    const asOfDayMs = resolveUtcDayStartMs(nowMs);
    const currentStartDayMs = asOfDayMs - ((TRAINING_SUMMARY_CURRENT_WINDOW_DAYS - 1) * DAY_MS);
    const baselineEndDayMs = currentStartDayMs - DAY_MS;
    const baselineStartDayMs = baselineEndDayMs - ((TRAINING_SUMMARY_BASELINE_WINDOW_DAYS - 1) * DAY_MS);
    const accumulators: Record<DerivedTrainingDiscipline, TrainingSummaryDisciplineAccumulator> = {
        running: createTrainingSummaryDisciplineAccumulator(),
        cycling: createTrainingSummaryDisciplineAccumulator(),
    };
    let sourceEventCount = 0;

    docs.forEach((doc) => {
        const eventData = (doc.data() || {}) as Record<string, unknown>;
        if (isMergedEvent(eventData)) {
            return;
        }
        const startTimeMs = toMillis(eventData.startDate);
        const discipline = resolveTrainingDiscipline(eventData);
        if (startTimeMs === null || discipline === null) {
            return;
        }
        const eventDayMs = resolveUtcDayStartMs(startTimeMs);
        if (eventDayMs < baselineStartDayMs || eventDayMs > asOfDayMs) {
            return;
        }

        const accumulator = accumulators[discipline];
        const window = eventDayMs >= currentStartDayMs ? accumulator.current : accumulator.baseline;
        const powerZones = resolveZoneDurations(eventData, POWER_ZONE_STAT_TYPES);
        const heartRateZones = resolveZoneDurations(eventData, HEART_RATE_ZONE_STAT_TYPES);
        const zones = powerZones.reduce((sum, value) => sum + value, 0) > 0
            ? powerZones
            : heartRateZones;
        window.activityCount += 1;
        window.durationSeconds += toFinitePositiveNumber(resolveRawStatNumericValue(eventData, DataDuration.type)) || 0;
        window.easySeconds += (zones[0] || 0) + (zones[1] || 0);
        window.moderateSeconds += (zones[2] || 0) + (zones[3] || 0);
        window.hardSeconds += (zones[4] || 0) + (zones[5] || 0) + (zones[6] || 0);

        const sourceKey = resolveTrainingSourceKey(eventData);
        const capacities: Array<[TrainingCapacityKind, string]> = [
            ['vo2Max', DataVO2Max.type],
            ['ftp', DataFTP.type],
            ['criticalPower', DataCriticalPower.type],
        ];
        capacities.forEach(([kind, statType]) => {
            const value = toFinitePositiveNumber(resolveRawStatNumericValue(eventData, statType));
            if (value !== null) {
                accumulator.capacities[kind].push({ sourceKey, timeMs: startTimeMs, value });
            }
        });
        sourceEventCount += 1;
    });

    const disciplines: DerivedTrainingDisciplineSummary[] = (['running', 'cycling'] as const).map((discipline) => {
        const accumulator = accumulators[discipline];
        return {
            discipline,
            current28d: buildTrainingSummaryWindow(accumulator.current, currentStartDayMs, asOfDayMs),
            baseline28d: buildTrainingSummaryWindow(
                accumulator.baseline,
                baselineStartDayMs,
                baselineEndDayMs,
                TRAINING_SUMMARY_CURRENT_WINDOW_DAYS / TRAINING_SUMMARY_BASELINE_WINDOW_DAYS,
            ),
            vo2Max: buildTrainingCapacityMetric(accumulator.capacities.vo2Max, currentStartDayMs, baselineStartDayMs, baselineEndDayMs),
            ftp: buildTrainingCapacityMetric(accumulator.capacities.ftp, currentStartDayMs, baselineStartDayMs, baselineEndDayMs),
            criticalPower: buildTrainingCapacityMetric(accumulator.capacities.criticalPower, currentStartDayMs, baselineStartDayMs, baselineEndDayMs),
        };
    });

    return {
        sourceEventCount,
        payload: {
            dayBoundary: 'UTC',
            asOfDayMs,
            currentWindowDays: TRAINING_SUMMARY_CURRENT_WINDOW_DAYS,
            baselineWindowDays: TRAINING_SUMMARY_BASELINE_WINDOW_DAYS,
            disciplines,
            excludesMergedEvents: true,
        },
    };
}

function buildIntensityDistributionMetricPayload(
    docs: readonly FirestoreQueryDocumentSnapshot[],
): DerivedMetricBuildResult<DerivedIntensityDistributionMetricPayload> {
    const weeklyBuckets = new Map<number, {
        easySeconds: number;
        moderateSeconds: number;
        hardSeconds: number;
        powerEvents: number;
        heartRateEvents: number;
    }>();
    let sourceEventCount = 0;

    docs.forEach((doc) => {
        const eventData = (doc.data() || {}) as Record<string, unknown>;
        if (isMergedEvent(eventData)) {
            return;
        }
        const startTimeMs = toMillis(eventData.startDate);
        if (startTimeMs === null) {
            return;
        }

        const powerZones = resolveZoneDurations(eventData, POWER_ZONE_STAT_TYPES);
        const powerTotal = powerZones.reduce((sum, value) => sum + value, 0);
        const heartRateZones = resolveZoneDurations(eventData, HEART_RATE_ZONE_STAT_TYPES);
        const heartRateTotal = heartRateZones.reduce((sum, value) => sum + value, 0);
        const sourceZones = powerTotal > 0 ? powerZones : (heartRateTotal > 0 ? heartRateZones : null);
        if (!sourceZones) {
            return;
        }

        const weekStartMs = resolveUtcWeekStartMs(startTimeMs);
        const week = weeklyBuckets.get(weekStartMs) || {
            easySeconds: 0,
            moderateSeconds: 0,
            hardSeconds: 0,
            powerEvents: 0,
            heartRateEvents: 0,
        };
        week.easySeconds += (sourceZones[0] || 0) + (sourceZones[1] || 0);
        week.moderateSeconds += (sourceZones[2] || 0) + (sourceZones[3] || 0);
        week.hardSeconds += (sourceZones[4] || 0) + (sourceZones[5] || 0) + (sourceZones[6] || 0);
        if (powerTotal > 0) {
            week.powerEvents += 1;
        } else {
            week.heartRateEvents += 1;
        }
        weeklyBuckets.set(weekStartMs, week);
        sourceEventCount += 1;
    });

    const weeks: DerivedIntensityDistributionMetricPayload['weeks'] = [...weeklyBuckets.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([weekStartMs, bucket]) => ({
            weekStartMs,
            easySeconds: toRoundedNumber(bucket.easySeconds, 2),
            moderateSeconds: toRoundedNumber(bucket.moderateSeconds, 2),
            hardSeconds: toRoundedNumber(bucket.hardSeconds, 2),
            source: bucket.powerEvents >= bucket.heartRateEvents ? 'power' : 'heart-rate',
        }));
    const latestWeek = weeks[weeks.length - 1];
    const latestTotal = latestWeek
        ? latestWeek.easySeconds + latestWeek.moderateSeconds + latestWeek.hardSeconds
        : 0;

    return {
        sourceEventCount,
        payload: {
            dayBoundary: 'UTC',
            weeks,
            latestWeekStartMs: latestWeek?.weekStartMs ?? null,
            latestEasyPercent: latestTotal > 0 ? toRoundedNumber((latestWeek!.easySeconds / latestTotal) * 100, 2) : null,
            latestModeratePercent: latestTotal > 0 ? toRoundedNumber((latestWeek!.moderateSeconds / latestTotal) * 100, 2) : null,
            latestHardPercent: latestTotal > 0 ? toRoundedNumber((latestWeek!.hardSeconds / latestTotal) * 100, 2) : null,
        },
    };
}

function buildEasyPercentMetricPayload(
    intensityPayload: DerivedIntensityDistributionMetricPayload,
    sourceEventCount: number,
): DerivedMetricBuildResult<DerivedEasyPercentMetricPayload> {
    const trend8Weeks = takeLatestTrendWeeks(
        intensityPayload.weeks
            .map((week) => {
                const totalSeconds = week.easySeconds + week.moderateSeconds + week.hardSeconds;
                return {
                    weekStartMs: week.weekStartMs,
                    value: totalSeconds > 0 ? toRoundedNumber((week.easySeconds / totalSeconds) * 100, 2) : null,
                };
            })
            .sort((left, right) => left.weekStartMs - right.weekStartMs),
    );

    return {
        sourceEventCount,
        payload: {
            dayBoundary: 'UTC',
            latestWeekStartMs: intensityPayload.latestWeekStartMs,
            value: intensityPayload.latestEasyPercent === null
                ? null
                : toRoundedNumber(intensityPayload.latestEasyPercent, 2),
            trend8Weeks,
        },
    };
}

function buildHardPercentMetricPayload(
    intensityPayload: DerivedIntensityDistributionMetricPayload,
    sourceEventCount: number,
): DerivedMetricBuildResult<DerivedHardPercentMetricPayload> {
    const trend8Weeks = takeLatestTrendWeeks(
        intensityPayload.weeks
            .map((week) => {
                const totalSeconds = week.easySeconds + week.moderateSeconds + week.hardSeconds;
                return {
                    weekStartMs: week.weekStartMs,
                    value: totalSeconds > 0 ? toRoundedNumber((week.hardSeconds / totalSeconds) * 100, 2) : null,
                };
            })
            .sort((left, right) => left.weekStartMs - right.weekStartMs),
    );

    return {
        sourceEventCount,
        payload: {
            dayBoundary: 'UTC',
            latestWeekStartMs: intensityPayload.latestWeekStartMs,
            value: intensityPayload.latestHardPercent === null
                ? null
                : toRoundedNumber(intensityPayload.latestHardPercent, 2),
            trend8Weeks,
        },
    };
}

function buildEfficiencyTrendMetricPayload(
    docs: readonly FirestoreQueryDocumentSnapshot[],
): DerivedMetricBuildResult<DerivedEfficiencyTrendMetricPayload> {
    const weekly = new Map<number, {
        weightedValueSum: number;
        totalDurationSeconds: number;
        sampleCount: number;
    }>();
    let sourceEventCount = 0;

    docs.forEach((doc) => {
        const eventData = (doc.data() || {}) as Record<string, unknown>;
        if (isMergedEvent(eventData)) {
            return;
        }
        const startTimeMs = toMillis(eventData.startDate);
        if (startTimeMs === null) {
            return;
        }

        const avgPower = toFinitePositiveNumber(resolveRawStatNumericValue(eventData, DataPowerAvg.type));
        const avgHeartRate = toFinitePositiveNumber(resolveRawStatNumericValue(eventData, DataHeartRateAvg.type));
        const durationSeconds = toFinitePositiveNumber(resolveRawStatNumericValue(eventData, DataDuration.type));
        if (avgPower === null || avgHeartRate === null || durationSeconds === null) {
            return;
        }

        const ratio = avgPower / avgHeartRate;
        const weekStartMs = resolveUtcWeekStartMs(startTimeMs);
        const bucket = weekly.get(weekStartMs) || {
            weightedValueSum: 0,
            totalDurationSeconds: 0,
            sampleCount: 0,
        };
        bucket.weightedValueSum += ratio * durationSeconds;
        bucket.totalDurationSeconds += durationSeconds;
        bucket.sampleCount += 1;
        weekly.set(weekStartMs, bucket);
        sourceEventCount += 1;
    });

    const points = [...weekly.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([weekStartMs, bucket]) => ({
            weekStartMs,
            value: bucket.totalDurationSeconds > 0 ? toRoundedNumber(bucket.weightedValueSum / bucket.totalDurationSeconds, 4) : 0,
            sampleCount: bucket.sampleCount,
            totalDurationSeconds: toRoundedNumber(bucket.totalDurationSeconds, 2),
        }));
    const latestPoint = points[points.length - 1];

    return {
        sourceEventCount,
        payload: {
            dayBoundary: 'UTC',
            points,
            latestWeekStartMs: latestPoint?.weekStartMs ?? null,
            latestValue: latestPoint ? latestPoint.value : null,
        },
    };
}

function buildEfficiencyDelta4wMetricPayload(
    efficiencyPayload: DerivedEfficiencyTrendMetricPayload,
    sourceEventCount: number,
): DerivedMetricBuildResult<DerivedEfficiencyDelta4wMetricPayload> {
    const sortedPoints = [...(efficiencyPayload.points || [])]
        .sort((left, right) => left.weekStartMs - right.weekStartMs);
    const latestPoint = sortedPoints.length ? sortedPoints[sortedPoints.length - 1] : null;
    // Compare the latest weekly efficiency value against up to 4 previous weeks.
    const baselineWindow = latestPoint
        ? sortedPoints.slice(Math.max(0, sortedPoints.length - 5), sortedPoints.length - 1)
        : [];
    const baselineValues = baselineWindow
        .map((point) => toFinitePositiveNumber(point.value))
        .filter((value): value is number => value !== null);
    const baselineValue = baselineValues.length
        ? (baselineValues.reduce((sum, value) => sum + value, 0) / baselineValues.length)
        : null;
    const latestValue = latestPoint?.value ?? null;
    const deltaAbs = baselineValue !== null && latestValue !== null
        ? latestValue - baselineValue
        : null;
    const deltaPct = baselineValue !== null
        && baselineValue > 0
        && deltaAbs !== null
        ? (deltaAbs / baselineValue) * 100
        : null;

    return {
        sourceEventCount,
        payload: {
            dayBoundary: 'UTC',
            latestWeekStartMs: latestPoint?.weekStartMs ?? null,
            latestValue: latestValue === null ? null : toRoundedNumber(latestValue, 4),
            baselineValue: baselineValue === null ? null : toRoundedNumber(baselineValue, 4),
            baselineWeekCount: baselineValues.length,
            deltaAbs: deltaAbs === null ? null : toRoundedNumber(deltaAbs, 4),
            deltaPct: deltaPct === null ? null : toRoundedNumber(deltaPct, 2),
            trend8Weeks: takeLatestTrendWeeks(
                sortedPoints.map((point) => ({
                    weekStartMs: point.weekStartMs,
                    value: toRoundedNumber(point.value, 4),
                })),
            ),
        },
    };
}

function buildRecoveryNowMetricPayload(
    docs: readonly FirestoreQueryDocumentSnapshot[],
): DerivedMetricBuildResult<DerivedRecoveryNowMetricPayload> {
    const segments: Array<{ totalSeconds: number; endTimeMs: number }> = [];
    let latestEndTimeMs = Number.NEGATIVE_INFINITY;
    let latestWorkoutSeconds = Number.NaN;
    let ignoredOutlierCount = 0;
    let maxIgnoredRecoverySeconds = 0;

    docs.forEach((doc) => {
        const eventData = (doc.data() || {}) as Record<string, unknown>;
        if (isMergedEvent(eventData)) {
            return;
        }

        const rawRecoverySeconds = toFinitePositiveNumber(resolveRawStatNumericValue(eventData, DataRecoveryTime.type));
        if (rawRecoverySeconds !== null && rawRecoverySeconds > DERIVED_RECOVERY_MAX_SUPPORTED_SECONDS) {
            ignoredOutlierCount += 1;
            maxIgnoredRecoverySeconds = Math.max(maxIgnoredRecoverySeconds, rawRecoverySeconds);
            return;
        }

        const recoverySeconds = resolveSupportedRecoverySeconds(eventData);
        if (recoverySeconds === null) {
            return;
        }

        const endTimeMs = resolveRecoveryEventEndTimeMs(eventData);
        if (endTimeMs === null) {
            return;
        }

        if (endTimeMs >= latestEndTimeMs) {
            latestEndTimeMs = endTimeMs;
            latestWorkoutSeconds = recoverySeconds;
        }
        segments.push({
            totalSeconds: recoverySeconds,
            endTimeMs,
        });
    });

    if (ignoredOutlierCount > 0) {
        logger.warn('[derived-metrics] Ignored recovery outliers above supported maximum.', {
            ignoredOutlierCount,
            maxIgnoredRecoverySeconds,
            maxSupportedRecoverySeconds: DERIVED_RECOVERY_MAX_SUPPORTED_SECONDS,
        });
    }

    const totalSeconds = segments.reduce((sum, segment) => sum + segment.totalSeconds, 0);

    return {
        sourceEventCount: segments.length,
        payload: {
            totalSeconds,
            endTimeMs: Number.isFinite(latestEndTimeMs) ? latestEndTimeMs : 0,
            segments,
            excludesMergedEvents: true,
            latestWorkoutSeconds: Number.isFinite(latestWorkoutSeconds) ? latestWorkoutSeconds : null,
            latestWorkoutEndTimeMs: Number.isFinite(latestEndTimeMs) ? latestEndTimeMs : null,
            maxSupportedRecoverySeconds: DERIVED_RECOVERY_MAX_SUPPORTED_SECONDS,
            lookbackWindowSeconds: DERIVED_RECOVERY_LOOKBACK_WINDOW_SECONDS,
        },
    };
}

// Metric registry is the single extension point for derived builds:
// add a new kind here with source dependencies and a builder callback.
const DERIVED_METRIC_BUILD_REGISTRY: Record<DerivedMetricKind, DerivedMetricBuildDefinition> = {
    [DERIVED_METRIC_KINDS.Form]: {
        sourceDependencies: ['formDocs'],
        build: (context) => buildFormMetricPayload(context.getDailyLoadContext()),
    },
    [DERIVED_METRIC_KINDS.RecoveryNow]: {
        sourceDependencies: ['recoveryNowDocs'],
        build: (context) => buildRecoveryNowMetricPayload(context.recoveryNowDocs),
    },
    [DERIVED_METRIC_KINDS.Acwr]: {
        sourceDependencies: ['formDocs'],
        build: (context) => {
            const dailyLoadContext = context.getDailyLoadContext();
            return buildAcwrMetricPayload(
                context.getKpiDerivedLoadPoints(),
                dailyLoadContext.sourceEventCount,
                resolveUtcDayStartMs(context.nowMs),
            );
        },
    },
    [DERIVED_METRIC_KINDS.RampRate]: {
        sourceDependencies: ['formDocs'],
        build: (context) => {
            const dailyLoadContext = context.getDailyLoadContext();
            return buildRampRateMetricPayload(
                context.getKpiDerivedLoadPoints(),
                dailyLoadContext.sourceEventCount,
                resolveUtcDayStartMs(context.nowMs),
            );
        },
    },
    [DERIVED_METRIC_KINDS.MonotonyStrain]: {
        sourceDependencies: ['formDocs'],
        build: (context) => {
            const dailyLoadContext = context.getDailyLoadContext();
            return buildMonotonyStrainMetricPayload(
                context.getKpiDerivedLoadPoints(),
                dailyLoadContext.sourceEventCount,
                resolveUtcDayStartMs(context.nowMs),
            );
        },
    },
    [DERIVED_METRIC_KINDS.FormNow]: {
        sourceDependencies: ['formDocs'],
        build: (context) => {
            const dailyLoadContext = context.getDailyLoadContext();
            return buildFormNowMetricPayload(
                context.getKpiDerivedLoadPoints(),
                dailyLoadContext.sourceEventCount,
                resolveUtcDayStartMs(context.nowMs),
            );
        },
    },
    [DERIVED_METRIC_KINDS.FormPlus7d]: {
        sourceDependencies: ['formDocs'],
        build: (context) => {
            const dailyLoadContext = context.getDailyLoadContext();
            return buildFormPlus7dMetricPayload(
                context.getKpiDerivedLoadPoints(),
                dailyLoadContext.sourceEventCount,
                resolveUtcDayStartMs(context.nowMs),
            );
        },
    },
    [DERIVED_METRIC_KINDS.EasyPercent]: {
        sourceDependencies: ['formDocs'],
        build: (context) => {
            const distributionBuildResult = context.getIntensityDistributionBuildResult();
            return buildEasyPercentMetricPayload(distributionBuildResult.payload, distributionBuildResult.sourceEventCount);
        },
    },
    [DERIVED_METRIC_KINDS.HardPercent]: {
        sourceDependencies: ['formDocs'],
        build: (context) => {
            const distributionBuildResult = context.getIntensityDistributionBuildResult();
            return buildHardPercentMetricPayload(distributionBuildResult.payload, distributionBuildResult.sourceEventCount);
        },
    },
    [DERIVED_METRIC_KINDS.EfficiencyDelta4w]: {
        sourceDependencies: ['formDocs'],
        build: (context) => {
            const efficiencyTrendBuildResult = context.getEfficiencyTrendBuildResult();
            return buildEfficiencyDelta4wMetricPayload(
                efficiencyTrendBuildResult.payload,
                efficiencyTrendBuildResult.sourceEventCount,
            );
        },
    },
    [DERIVED_METRIC_KINDS.FreshnessForecast]: {
        sourceDependencies: ['formDocs'],
        build: (context) => {
            const dailyLoadContext = context.getDailyLoadContext();
            // Align "Now" semantics with Form Now KPI: forecast starts from current-day
            // decayed state (zero-load extension through today), then projects +7d.
            return buildFreshnessForecastMetricPayload(
                context.getKpiDerivedLoadPoints(),
                dailyLoadContext.sourceEventCount,
                resolveUtcDayStartMs(context.nowMs),
            );
        },
    },
    [DERIVED_METRIC_KINDS.IntensityDistribution]: {
        sourceDependencies: ['formDocs'],
        build: (context) => context.getIntensityDistributionBuildResult(),
    },
    [DERIVED_METRIC_KINDS.EfficiencyTrend]: {
        sourceDependencies: ['formDocs'],
        build: (context) => context.getEfficiencyTrendBuildResult(),
    },
    [DERIVED_METRIC_KINDS.TrainingSummary]: {
        sourceDependencies: ['formDocs'],
        build: (context) => context.getTrainingSummaryBuildResult(),
    },
    [DERIVED_METRIC_KINDS.PowerCurve]: {
        sourceDependencies: ['formDocs'],
        build: (context) => context.getPowerCurveBuildResult(),
    },
};

function createDerivedMetricBuildExecutionContext(
    sourceDocs: {
        formDocs?: readonly FirestoreQueryDocumentSnapshot[];
        recoveryNowDocs?: readonly FirestoreQueryDocumentSnapshot[];
    },
    nowMs: number,
    options?: {
        dailyLoadContextOverride?: ReturnType<typeof buildDailyLoadContext> | null;
    },
): DerivedMetricBuildExecutionContext {
    const formDocs = sourceDocs.formDocs || [];
    const recoveryNowDocs = sourceDocs.recoveryNowDocs || [];

    let dailyLoadContextCache: ReturnType<typeof buildDailyLoadContext> | null = null;
    let derivedLoadPointsCache: DerivedLoadPoint[] | null = null;
    let kpiDerivedLoadPointsCache: DerivedLoadPoint[] | null = null;
    let intensityDistributionBuildResultCache: DerivedMetricBuildResult<DerivedIntensityDistributionMetricPayload> | null = null;
    let efficiencyTrendBuildResultCache: DerivedMetricBuildResult<DerivedEfficiencyTrendMetricPayload> | null = null;
    let trainingSummaryBuildResultCache: DerivedMetricBuildResult<DerivedTrainingSummaryMetricPayload> | null = null;
    let powerCurveBuildResultCache: DerivedMetricBuildResult<DerivedPowerCurveMetricPayload> | null = null;

    const getDailyLoadContext = (): ReturnType<typeof buildDailyLoadContext> => {
        if (dailyLoadContextCache) {
            return dailyLoadContextCache;
        }
        if (options?.dailyLoadContextOverride) {
            dailyLoadContextCache = options.dailyLoadContextOverride;
            return dailyLoadContextCache;
        }
        dailyLoadContextCache = buildDailyLoadContext(formDocs);
        return dailyLoadContextCache;
    };

    const getDerivedLoadPoints = (): DerivedLoadPoint[] => {
        if (derivedLoadPointsCache) {
            return derivedLoadPointsCache;
        }
        const dailyLoadContext = getDailyLoadContext();
        derivedLoadPointsCache = buildDerivedLoadPoints(dailyLoadContext.dailyLoadsByUtcDay);
        return derivedLoadPointsCache;
    };

    const getKpiDerivedLoadPoints = (): DerivedLoadPoint[] => {
        if (kpiDerivedLoadPointsCache) {
            return kpiDerivedLoadPointsCache;
        }
        const dailyLoadContext = getDailyLoadContext();
        // KPI metrics should reflect the current training state, so we extend daily load
        // with zero-load days up to "today" while keeping source event counts untouched.
        kpiDerivedLoadPointsCache = buildDerivedLoadPoints(dailyLoadContext.dailyLoadsByUtcDay, {
            endDayMs: resolveUtcDayStartMs(nowMs),
        });
        return kpiDerivedLoadPointsCache;
    };

    const getIntensityDistributionBuildResult = (): DerivedMetricBuildResult<DerivedIntensityDistributionMetricPayload> => {
        if (intensityDistributionBuildResultCache) {
            return intensityDistributionBuildResultCache;
        }
        intensityDistributionBuildResultCache = buildIntensityDistributionMetricPayload(formDocs);
        return intensityDistributionBuildResultCache;
    };

    const getEfficiencyTrendBuildResult = (): DerivedMetricBuildResult<DerivedEfficiencyTrendMetricPayload> => {
        if (efficiencyTrendBuildResultCache) {
            return efficiencyTrendBuildResultCache;
        }
        efficiencyTrendBuildResultCache = buildEfficiencyTrendMetricPayload(formDocs);
        return efficiencyTrendBuildResultCache;
    };

    const getTrainingSummaryBuildResult = (): DerivedMetricBuildResult<DerivedTrainingSummaryMetricPayload> => {
        if (trainingSummaryBuildResultCache) {
            return trainingSummaryBuildResultCache;
        }
        trainingSummaryBuildResultCache = buildTrainingSummaryMetricPayload(formDocs, nowMs);
        return trainingSummaryBuildResultCache;
    };

    const getPowerCurveBuildResult = (): DerivedMetricBuildResult<DerivedPowerCurveMetricPayload> => {
        if (powerCurveBuildResultCache) {
            return powerCurveBuildResultCache;
        }
        powerCurveBuildResultCache = buildPowerCurveMetricPayload(formDocs, nowMs);
        return powerCurveBuildResultCache;
    };

    return {
        nowMs,
        formDocs,
        recoveryNowDocs,
        getDailyLoadContext,
        getDerivedLoadPoints,
        getKpiDerivedLoadPoints,
        getIntensityDistributionBuildResult,
        getEfficiencyTrendBuildResult,
        getTrainingSummaryBuildResult,
        getPowerCurveBuildResult,
    };
}

export function resolveDerivedMetricSourceRequirements(
    metricKinds: readonly DerivedMetricKind[],
): {
    needsFormDocs: boolean;
    needsRecoveryNowDocs: boolean;
} {
    let needsFormDocs = false;
    let needsRecoveryNowDocs = false;

    metricKinds.forEach((metricKind) => {
        const definition = DERIVED_METRIC_BUILD_REGISTRY[metricKind];
        if (!definition) {
            return;
        }
        if (definition.sourceDependencies.includes('formDocs')) {
            needsFormDocs = true;
        }
        if (definition.sourceDependencies.includes('recoveryNowDocs')) {
            needsRecoveryNowDocs = true;
        }
    });

    return {
        needsFormDocs,
        needsRecoveryNowDocs,
    };
}

export function areOnlyProjectionSensitiveMetricKinds(
    metricKinds: readonly DerivedMetricKind[],
): boolean {
    return metricKinds.length > 0
        && metricKinds.every(metricKind => isProjectionSensitiveMetricKind(metricKind));
}

function getCoordinatorDocRef(uid: string): FirebaseFirestore.DocumentReference {
    return admin.firestore().doc(`users/${uid}/${DERIVED_METRICS_COLLECTION_ID}/${DERIVED_METRICS_COORDINATOR_DOC_ID}`);
}

function getDerivedMetricsCollectionRef(
    db: admin.firestore.Firestore,
    uid: string,
): FirebaseFirestore.CollectionReference {
    return db
        .collection('users')
        .doc(uid)
        .collection(DERIVED_METRICS_COLLECTION_ID);
}

function getMetricDocRef(uid: string, metricKind: DerivedMetricKind): FirebaseFirestore.DocumentReference {
    return admin.firestore().doc(`users/${uid}/${DERIVED_METRICS_COLLECTION_ID}/${getDerivedMetricDocId(metricKind)}`);
}

async function queueDerivedMetricsTask(uid: string, generation: number): Promise<boolean> {
    const queued = await enqueueDerivedMetricsTask(uid, generation);
    return queued;
}

async function readDerivedMetricsWriteBlocked(
    uid: string,
    logContext: string,
    extraContext: Record<string, unknown> = {},
): Promise<boolean> {
    const deletionGuard = await getUserDeletionGuardState(admin.firestore(), uid);
    if (deletionGuard.shouldSkip) {
        logger.info(`[derived-metrics] Skipping ${logContext} because user deletion is in progress or user root is missing.`, {
            uid,
            userExists: deletionGuard.userExists,
            deletionInProgress: deletionGuard.deletionInProgress,
            ...extraContext,
        });
    }
    return deletionGuard.shouldSkip;
}

async function readDerivedMetricsWriteBlockedInTransaction(
    transaction: admin.firestore.Transaction,
    uid: string,
    logContext: string,
    extraContext: Record<string, unknown> = {},
): Promise<boolean> {
    const deletionGuard = await getUserDeletionGuardStateInTransaction(admin.firestore(), transaction, uid);
    if (deletionGuard.shouldSkip) {
        logger.info(`[derived-metrics] Skipping ${logContext} because user deletion is in progress or user root is missing.`, {
            uid,
            userExists: deletionGuard.userExists,
            deletionInProgress: deletionGuard.deletionInProgress,
            ...extraContext,
        });
    }
    return deletionGuard.shouldSkip;
}

async function cleanupDerivedMetricsAfterWriteBlock(
    db: admin.firestore.Firestore,
    uid: string,
    generation: number,
    metricKinds: readonly DerivedMetricKind[],
    logContext: string,
    deletionGuard: { userExists: boolean; deletionInProgress: boolean },
    message: string,
): Promise<AbandonDerivedMetricsProcessingAfterWriteBlockResult> {
    const normalizedMetricKinds = normalizeDerivedMetricKindsStrict(metricKinds);
    await db.recursiveDelete(getDerivedMetricsCollectionRef(db, uid));
    logger.info(message, {
        uid,
        generation,
        metricKinds: normalizedMetricKinds,
        logContext,
        userExists: deletionGuard.userExists,
        deletionInProgress: deletionGuard.deletionInProgress,
    });
    return {
        cleaned: true,
        requeued: false,
        nextGeneration: null,
        dirtyMetricKinds: normalizedMetricKinds,
    };
}

export async function isDerivedMetricsUserWriteBlocked(
    uid: string,
    logContext: string,
    extraContext: Record<string, unknown> = {},
): Promise<boolean> {
    return readDerivedMetricsWriteBlocked(uid, logContext, extraContext);
}

export async function fetchDerivedMetricsEventDocs(uid: string): Promise<FirestoreQueryDocumentSnapshot[]> {
    const snapshot = await admin.firestore()
        .collection('users')
        .doc(uid)
        .collection('events')
        .select(...DERIVED_METRICS_EVENT_FIELDS)
        .get();
    return snapshot.docs;
}

export interface DerivedFormSnapshotSeed {
    status: string | null;
    schemaVersion: number | null;
    builtFromEventMutationVersion: number | null;
    sourceEventCount: number;
    sourceDocCount: number;
    dailyLoads: DerivedFormDailyLoadEntry[];
}

export async function fetchDerivedFormSnapshotSeed(uid: string): Promise<DerivedFormSnapshotSeed | null> {
    const snapshot = await getMetricDocRef(uid, DERIVED_METRIC_KINDS.Form).get();
    const data = (snapshot.data() || {}) as Record<string, unknown>;
    const payload = (data.payload && typeof data.payload === 'object')
        ? data.payload as Record<string, unknown>
        : {};
    return {
        status: toSafeString(data.status) || null,
        schemaVersion: toFiniteNumber(data.schemaVersion),
        builtFromEventMutationVersion: toFiniteNumber(data.builtFromEventMutationVersion),
        sourceEventCount: Math.max(0, Math.floor(toFiniteNumber(data.sourceEventCount) || 0)),
        sourceDocCount: Math.max(0, Math.floor(toFiniteNumber(data.sourceDocCount) || 0)),
        dailyLoads: normalizeDerivedFormDailyLoads(payload.dailyLoads),
    };
}

export async function fetchRecoveryLookbackEventDocs(
    uid: string,
    nowMs = Date.now(),
): Promise<FirestoreQueryDocumentSnapshot[]> {
    const lookbackStartMs = resolveRecoveryEventLookbackStartMs(nowMs);
    // Recovery-now does not need full history; a bounded lookback tied to max supported
    // recovery horizon keeps queue processing predictable on large accounts.
    // EventWriter persists sports-lib event JSON with numeric startDate/endDate epoch
    // milliseconds, so this query must use numeric comparisons.
    const snapshot = await admin.firestore()
        .collection('users')
        .doc(uid)
        .collection('events')
        .where('startDate', '>=', lookbackStartMs)
        .select(...DERIVED_METRICS_EVENT_FIELDS)
        .get();
    if (!snapshot.docs.length) {
        logger.warn('[derived-metrics] Recovery lookback query returned no event docs.', {
            uid,
            lookbackStartMs,
            lookbackWindowSeconds: DERIVED_RECOVERY_LOOKBACK_WINDOW_SECONDS,
        });
    }
    return snapshot.docs;
}

export async function markDerivedMetricsDirtyAndMaybeQueue(
    uid: string,
    requestedMetricKinds: readonly unknown[] | null | undefined,
    options?: {
        incrementEventMutationVersion?: boolean;
    },
): Promise<EnsureDerivedMetricsResponse> {
    const metricKinds = normalizeDerivedMetricKinds(requestedMetricKinds);
    if (!isDerivedMetricsUidAllowed(uid)) {
        logger.info('[derived-metrics] Skipping dirty-mark enqueue due to UID allowlist gate.', {
            uid,
            allowlistSize: getDerivedMetricsUidAllowlist().size,
        });
        return {
            accepted: false,
            queued: false,
            generation: null,
            metricKinds,
        };
    }

    if (await readDerivedMetricsWriteBlocked(uid, 'dirty-mark enqueue', { metricKinds })) {
        return {
            accepted: false,
            queued: false,
            generation: null,
            metricKinds,
        };
    }

    const coordinatorRef = getCoordinatorDocRef(uid);
    const nowMs = Date.now();

    let shouldEnqueue = false;
    let generationToQueue: number | null = null;
    let blockedByDeletion = false;

    await admin.firestore().runTransaction(async (transaction) => {
        const coordinatorSnapshot = await transaction.get(coordinatorRef);
        if (await readDerivedMetricsWriteBlockedInTransaction(transaction, uid, 'dirty-mark transaction', { metricKinds })) {
            blockedByDeletion = true;
            shouldEnqueue = false;
            generationToQueue = null;
            return;
        }

        const coordinator = parseCoordinator(coordinatorSnapshot.data());
        const nextDirtyMetricKinds = mergeDerivedMetricKinds(coordinator.dirtyMetricKinds, metricKinds);
        const isAlreadyQueuedOrProcessing = coordinator.status === 'queued' || coordinator.status === 'processing';
        const dirtyMetricKindsChanged = !hasSameDerivedMetricKinds(coordinator.dirtyMetricKinds, nextDirtyMetricKinds);
        const coordinatorLikelyStuck = isAlreadyQueuedOrProcessing
            && isDerivedMetricsCoordinatorStuck(coordinator, nowMs);
        const shouldIncrementEventMutationVersion = options?.incrementEventMutationVersion === true;
        const nextEventMutationVersion = shouldIncrementEventMutationVersion
            ? coordinator.eventMutationVersion + 1
            : coordinator.eventMutationVersion;
        const eventMutationVersionChanged = nextEventMutationVersion !== coordinator.eventMutationVersion;

        // Coalesce repeated writes during bulk updates:
        // if a user is already queued/processing and the dirty set did not change,
        // avoid writing the coordinator doc again.
        // Exception: event-write triggers increment the mutation version so completion
        // freshness can be evaluated against an immutable source revision.
        if (isAlreadyQueuedOrProcessing
            && !dirtyMetricKindsChanged
            && !coordinatorLikelyStuck
            && !eventMutationVersionChanged) {
            shouldEnqueue = false;
            generationToQueue = coordinator.generation;
            return;
        }

        if (coordinatorLikelyStuck) {
            logger.warn('[derived-metrics] Coordinator appears stuck; forcing requeue.', {
                uid,
                status: coordinator.status,
                generation: coordinator.generation,
                requestedAtMs: coordinator.requestedAtMs,
                startedAtMs: coordinator.startedAtMs,
                updatedAtMs: coordinator.updatedAtMs,
            });
        }

        const nextGeneration = (isAlreadyQueuedOrProcessing && !coordinatorLikelyStuck)
            ? coordinator.generation
            : coordinator.generation + 1;
        const nextStatus = (isAlreadyQueuedOrProcessing && !coordinatorLikelyStuck)
            ? coordinator.status
            : 'queued';
        const shouldResetLifecycleFields = !isAlreadyQueuedOrProcessing || coordinatorLikelyStuck;

        shouldEnqueue = !isAlreadyQueuedOrProcessing || coordinatorLikelyStuck;
        generationToQueue = nextGeneration;

        const coordinatorUpdatePayload: Record<string, unknown> = {
            entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
            status: nextStatus,
            generation: nextGeneration,
            eventMutationVersion: nextEventMutationVersion,
            dirtyMetricKinds: nextDirtyMetricKinds,
            updatedAtMs: nowMs,
            ...(shouldResetLifecycleFields ? {
                startedAtMs: null,
                completedAtMs: null,
                lastError: null,
                processingMetricKinds: [],
            } : {}),
        };
        // Keep queued-age stable while coalescing metadata updates so stuck queued
        // coordinators can still be detected and force-requeued.
        if (nextStatus === 'queued' && shouldEnqueue) {
            coordinatorUpdatePayload.requestedAtMs = nowMs;
        }

        transaction.set(coordinatorRef, coordinatorUpdatePayload, { merge: true });
    });

    if (blockedByDeletion) {
        return {
            accepted: false,
            queued: false,
            generation: null,
            metricKinds,
        };
    }

    if (shouldEnqueue && generationToQueue !== null) {
        try {
            await queueDerivedMetricsTask(uid, generationToQueue);
        } catch (error) {
            logger.error('[derived-metrics] Failed to enqueue derived metrics task', {
                uid,
                generation: generationToQueue,
                error,
            });
            if (!await readDerivedMetricsWriteBlocked(uid, 'dirty-mark enqueue failure write', { generation: generationToQueue })) {
                await coordinatorRef.set({
                    entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
                    status: 'failed',
                    lastError: toSafeString((error as { message?: unknown } | null)?.message) || 'enqueue_failed',
                    updatedAtMs: Date.now(),
                }, { merge: true });
            }

            return {
                accepted: false,
                queued: false,
                generation: generationToQueue,
                metricKinds,
            };
        }
    }

    return {
        accepted: true,
        queued: shouldEnqueue,
        generation: generationToQueue,
        metricKinds,
    };
}

export async function startDerivedMetricsProcessing(
    uid: string,
    generation: number,
): Promise<StartDerivedMetricsProcessingResult | null> {
    const coordinatorRef = getCoordinatorDocRef(uid);
    const nowMs = Date.now();
    let startedResult: StartDerivedMetricsProcessingResult | null = null;

    await admin.firestore().runTransaction(async (transaction) => {
        const coordinatorSnapshot = await transaction.get(coordinatorRef);
        if (!coordinatorSnapshot.exists) {
            startedResult = null;
            return;
        }

        const rawCoordinatorData = coordinatorSnapshot.data();
        const coordinator = parseCoordinator(rawCoordinatorData);
        if (coordinator.generation !== generation) {
            startedResult = null;
            return;
        }

        if (await readDerivedMetricsWriteBlockedInTransaction(transaction, uid, 'processing claim', { generation })) {
            startedResult = null;
            return;
        }

        if (coordinator.status === 'processing') {
            // Keep healthy in-flight generations single-flight only.
            if (!isDerivedMetricsCoordinatorStuck(coordinator, nowMs)) {
                startedResult = null;
                return;
            }

            const inFlightMetricKinds = resolveInFlightMetricKinds(
                rawCoordinatorData,
                coordinator.dirtyMetricKinds,
            );
            transaction.set(coordinatorRef, {
                entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
                status: 'processing',
                processingMetricKinds: inFlightMetricKinds,
                startedAtMs: nowMs,
                updatedAtMs: nowMs,
                lastError: null,
            }, { merge: true });
            startedResult = {
                dirtyMetricKinds: inFlightMetricKinds,
                startedAtMs: nowMs,
                eventMutationVersion: coordinator.eventMutationVersion,
            };
            return;
        }

        // A generation can only be freshly claimed from queued state.
        if (coordinator.status !== 'queued') {
            startedResult = null;
            return;
        }

        const dirtyMetricKinds = normalizeDerivedMetricKindsStrict(coordinator.dirtyMetricKinds);
        if (!dirtyMetricKinds.length) {
            transaction.set(coordinatorRef, {
                entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
                status: 'idle',
                processingMetricKinds: [],
                updatedAtMs: nowMs,
                completedAtMs: nowMs,
                lastError: null,
            }, { merge: true });
            startedResult = null;
            return;
        }

        transaction.set(coordinatorRef, {
            entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
            status: 'processing',
            dirtyMetricKinds: [],
            processingMetricKinds: dirtyMetricKinds,
            startedAtMs: nowMs,
            updatedAtMs: nowMs,
            lastError: null,
        }, { merge: true });

        startedResult = {
            dirtyMetricKinds,
            startedAtMs: nowMs,
            eventMutationVersion: coordinator.eventMutationVersion,
        };
    });

    return startedResult;
}

export async function completeDerivedMetricsProcessing(
    uid: string,
    generation: number,
): Promise<CompleteDerivedMetricsProcessingResult> {
    const coordinatorRef = getCoordinatorDocRef(uid);
    const nowMs = Date.now();
    let completion: CompleteDerivedMetricsProcessingResult = {
        requeued: false,
        nextGeneration: null,
        dirtyMetricKinds: [],
    };

    await admin.firestore().runTransaction(async (transaction) => {
        const coordinatorSnapshot = await transaction.get(coordinatorRef);
        if (!coordinatorSnapshot.exists) {
            return;
        }

        const coordinator = parseCoordinator(coordinatorSnapshot.data());
        if (coordinator.generation !== generation) {
            return;
        }

        if (await readDerivedMetricsWriteBlockedInTransaction(transaction, uid, 'processing completion', { generation })) {
            return;
        }

        const pendingDirtyMetricKinds = normalizeDerivedMetricKindsStrict(coordinator.dirtyMetricKinds);
        if (pendingDirtyMetricKinds.length) {
            const nextGeneration = coordinator.generation + 1;
            transaction.set(coordinatorRef, {
                entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
                status: 'queued',
                generation: nextGeneration,
                dirtyMetricKinds: pendingDirtyMetricKinds,
                processingMetricKinds: [],
                requestedAtMs: nowMs,
                updatedAtMs: nowMs,
                completedAtMs: null,
            }, { merge: true });
            completion = {
                requeued: true,
                nextGeneration,
                dirtyMetricKinds: pendingDirtyMetricKinds,
            };
            return;
        }

        transaction.set(coordinatorRef, {
            entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
            status: 'idle',
            dirtyMetricKinds: [],
            processingMetricKinds: [],
            updatedAtMs: nowMs,
            completedAtMs: nowMs,
            lastError: null,
        }, { merge: true });
        completion = {
            requeued: false,
            nextGeneration: null,
            dirtyMetricKinds: [],
        };
    });

    if (completion.requeued && completion.nextGeneration !== null) {
        try {
            if (await readDerivedMetricsWriteBlocked(uid, 'follow-up task enqueue', {
                generation,
                nextGeneration: completion.nextGeneration,
            })) {
                return completion;
            }
            await queueDerivedMetricsTask(uid, completion.nextGeneration);
        } catch (error) {
            logger.error('[derived-metrics] Failed to enqueue follow-up derived metrics task', {
                uid,
                generation,
                nextGeneration: completion.nextGeneration,
                error,
            });
            if (!await readDerivedMetricsWriteBlocked(uid, 'follow-up enqueue failure write', {
                generation,
                nextGeneration: completion.nextGeneration,
            })) {
                await coordinatorRef.set({
                    entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
                    status: 'failed',
                    lastError: toSafeString((error as { message?: unknown } | null)?.message) || 'enqueue_follow_up_failed',
                    updatedAtMs: Date.now(),
                }, { merge: true });
            }
        }
    }

    return completion;
}

export async function abandonDerivedMetricsProcessingAfterWriteBlock(
    uid: string,
    generation: number,
    processedMetricKinds: readonly DerivedMetricKind[],
    logContext: string,
): Promise<AbandonDerivedMetricsProcessingAfterWriteBlockResult> {
    const db = admin.firestore();
    const normalizedMetricKinds = normalizeDerivedMetricKindsStrict(processedMetricKinds);
    const deletionGuard = await getUserDeletionGuardState(db, uid);
    if (deletionGuard.shouldSkip) {
        return cleanupDerivedMetricsAfterWriteBlock(
            db,
            uid,
            generation,
            normalizedMetricKinds,
            logContext,
            deletionGuard,
            '[derived-metrics] Cleaned up derived metrics after processing write block.',
        );
    }

    const coordinatorRef = getCoordinatorDocRef(uid);
    const nowMs = Date.now();
    let requeueResult: AbandonDerivedMetricsProcessingAfterWriteBlockResult = {
        cleaned: false,
        requeued: false,
        nextGeneration: null,
        dirtyMetricKinds: normalizedMetricKinds,
    };
    const tryRequeueClaimedWork = async (): Promise<AbandonRequeueAttemptState> => {
        let attemptState: AbandonRequeueAttemptState = 'noop';

        await db.runTransaction(async (transaction) => {
            const coordinatorSnapshot = await transaction.get(coordinatorRef);
            if (!coordinatorSnapshot.exists) {
                return;
            }

            const coordinator = parseCoordinator(coordinatorSnapshot.data());
            if (coordinator.generation !== generation || coordinator.status !== 'processing') {
                return;
            }

            if (await readDerivedMetricsWriteBlockedInTransaction(transaction, uid, 'processing write-block abandon', {
                generation,
                metricKinds: normalizedMetricKinds,
                logContext,
            })) {
                attemptState = 'blocked';
                return;
            }

            const retainedDirtyMetricKinds = mergeDerivedMetricKinds(
                normalizeDerivedMetricKindsStrict(coordinator.dirtyMetricKinds),
                normalizedMetricKinds,
            );
            if (!retainedDirtyMetricKinds.length) {
                transaction.set(coordinatorRef, {
                    entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
                    status: 'idle',
                    dirtyMetricKinds: [],
                    processingMetricKinds: [],
                    updatedAtMs: nowMs,
                    completedAtMs: nowMs,
                    lastError: null,
                }, { merge: true });
                requeueResult = {
                    cleaned: false,
                    requeued: false,
                    nextGeneration: null,
                    dirtyMetricKinds: [],
                };
                attemptState = 'cleared-empty';
                return;
            }

            const nextGeneration = coordinator.generation + 1;
            transaction.set(coordinatorRef, {
                entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
                status: 'queued',
                generation: nextGeneration,
                dirtyMetricKinds: retainedDirtyMetricKinds,
                processingMetricKinds: [],
                requestedAtMs: nowMs,
                startedAtMs: null,
                completedAtMs: null,
                updatedAtMs: nowMs,
                lastError: `write_blocked_after_claim:${logContext}`,
            }, { merge: true });
            requeueResult = {
                cleaned: false,
                requeued: true,
                nextGeneration,
                dirtyMetricKinds: retainedDirtyMetricKinds,
            };
            attemptState = 'requeued';
        });

        return attemptState;
    };

    let requeueAttemptState = await tryRequeueClaimedWork();
    if (requeueAttemptState === 'blocked') {
        const latestDeletionGuard = await getUserDeletionGuardState(db, uid);
        if (latestDeletionGuard.shouldSkip) {
            return cleanupDerivedMetricsAfterWriteBlock(
                db,
                uid,
                generation,
                normalizedMetricKinds,
                logContext,
                latestDeletionGuard,
                '[derived-metrics] Cleaned up derived metrics after transactional write block.',
            );
        }

        requeueAttemptState = await tryRequeueClaimedWork();
        if (requeueAttemptState === 'blocked') {
            throw new Error('derived_metrics_write_block_changed_during_abandon');
        }
    }

    if (requeueResult.requeued && requeueResult.nextGeneration !== null) {
        try {
            const enqueueDeletionGuard = await getUserDeletionGuardState(db, uid);
            if (enqueueDeletionGuard.shouldSkip) {
                return cleanupDerivedMetricsAfterWriteBlock(
                    db,
                    uid,
                    generation,
                    requeueResult.dirtyMetricKinds,
                    logContext,
                    enqueueDeletionGuard,
                    '[derived-metrics] Cleaned up derived metrics before write-block follow-up enqueue.',
                );
            }
            await queueDerivedMetricsTask(uid, requeueResult.nextGeneration);
        } catch (error) {
            logger.error('[derived-metrics] Failed to enqueue write-block follow-up derived metrics task', {
                uid,
                generation,
                nextGeneration: requeueResult.nextGeneration,
                metricKinds: requeueResult.dirtyMetricKinds,
                logContext,
                error,
            });
            const enqueueFailureDeletionGuard = await getUserDeletionGuardState(db, uid);
            if (enqueueFailureDeletionGuard.shouldSkip) {
                return cleanupDerivedMetricsAfterWriteBlock(
                    db,
                    uid,
                    generation,
                    requeueResult.dirtyMetricKinds,
                    logContext,
                    enqueueFailureDeletionGuard,
                    '[derived-metrics] Cleaned up derived metrics after write-block follow-up enqueue failure.',
                );
            }
            await coordinatorRef.set({
                entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
                status: 'failed',
                lastError: toSafeString((error as { message?: unknown } | null)?.message) || 'enqueue_write_block_follow_up_failed',
                updatedAtMs: Date.now(),
            }, { merge: true });
        }
    }

    return requeueResult;
}

export async function failDerivedMetricsProcessing(
    uid: string,
    generation: number,
    error: unknown,
    processedMetricKinds: readonly DerivedMetricKind[],
): Promise<void> {
    const coordinatorRef = getCoordinatorDocRef(uid);
    const nowMs = Date.now();
    const errorMessage = toSafeString((error as { message?: unknown } | null)?.message) || toSafeString(error) || 'unknown_error';

    await admin.firestore().runTransaction(async (transaction) => {
        const coordinatorSnapshot = await transaction.get(coordinatorRef);
        if (!coordinatorSnapshot.exists) {
            return;
        }

        const coordinator = parseCoordinator(coordinatorSnapshot.data());
        if (coordinator.generation !== generation) {
            return;
        }

        if (await readDerivedMetricsWriteBlockedInTransaction(transaction, uid, 'processing failure', { generation })) {
            return;
        }

        const retainedDirtyMetricKinds = mergeDerivedMetricKinds(
            normalizeDerivedMetricKindsStrict(coordinator.dirtyMetricKinds),
            normalizeDerivedMetricKindsStrict(processedMetricKinds),
        );
        transaction.set(coordinatorRef, {
            entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
            status: 'failed',
            dirtyMetricKinds: retainedDirtyMetricKinds,
            processingMetricKinds: [],
            lastError: errorMessage,
            updatedAtMs: nowMs,
        }, { merge: true });
    });
}

export async function markDerivedMetricSnapshotsBuilding(
    uid: string,
    metricKinds: readonly DerivedMetricKind[],
): Promise<void> {
    if (await readDerivedMetricsWriteBlocked(uid, 'snapshot building write', { metricKinds })) {
        return;
    }

    const nowMs = Date.now();
    const batch = admin.firestore().batch();
    metricKinds.forEach((metricKind) => {
        batch.set(getMetricDocRef(uid, metricKind), {
            entryType: DERIVED_METRICS_ENTRY_TYPES.Snapshot,
            metricKind,
            schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
            status: 'building',
            updatedAtMs: nowMs,
            lastError: null,
        }, { merge: true });
    });
    await batch.commit();
}

export async function markDerivedMetricSnapshotsFailed(
    uid: string,
    metricKinds: readonly DerivedMetricKind[],
    error: unknown,
): Promise<void> {
    if (await readDerivedMetricsWriteBlocked(uid, 'snapshot failure write', { metricKinds })) {
        return;
    }

    const nowMs = Date.now();
    const errorMessage = toSafeString((error as { message?: unknown } | null)?.message) || toSafeString(error) || 'unknown_error';
    const batch = admin.firestore().batch();
    metricKinds.forEach((metricKind) => {
        batch.set(getMetricDocRef(uid, metricKind), {
            entryType: DERIVED_METRICS_ENTRY_TYPES.Snapshot,
            metricKind,
            schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
            status: 'failed',
            updatedAtMs: nowMs,
            lastError: errorMessage,
        }, { merge: true });
    });
    await batch.commit();
}

export async function writeDerivedMetricSnapshotsReady(
    uid: string,
    metricKinds: readonly DerivedMetricKind[],
    sourceDocs: {
        formDocs?: readonly FirestoreQueryDocumentSnapshot[];
        recoveryNowDocs?: readonly FirestoreQueryDocumentSnapshot[];
    },
    options?: {
        builtFromEventMutationVersion?: number | null;
        formDailyLoads?: readonly DerivedFormDailyLoadEntry[] | null;
        formSourceEventCount?: number | null;
        formSourceDocCount?: number | null;
    },
): Promise<void> {
    if (await readDerivedMetricsWriteBlocked(uid, 'snapshot ready write', { metricKinds })) {
        return;
    }

    const nowMs = Date.now();
    const batch = admin.firestore().batch();
    const normalizedFormDailyLoads = normalizeDerivedFormDailyLoads(options?.formDailyLoads || []);
    const hasDailyLoadContextOverride = normalizedFormDailyLoads.length > 0
        || Number.isFinite(options?.formSourceEventCount)
        || Number.isFinite(options?.formSourceDocCount);
    const overrideFormSourceEventCount = Number.isFinite(options?.formSourceEventCount)
        ? Math.max(0, Math.floor(options?.formSourceEventCount as number))
        : 0;
    const dailyLoadContextOverride = hasDailyLoadContextOverride
        ? buildDailyLoadContextFromDailyLoads(normalizedFormDailyLoads, overrideFormSourceEventCount)
        : null;
    const formSourceDocCount = Number.isFinite(options?.formSourceDocCount)
        ? Math.max(0, Math.floor(options?.formSourceDocCount as number))
        : (sourceDocs.formDocs?.length || 0);
    const recoveryNowSourceDocCount = sourceDocs.recoveryNowDocs?.length || 0;
    const buildContext = createDerivedMetricBuildExecutionContext(sourceDocs, nowMs, {
        dailyLoadContextOverride,
    });
    const builtFromEventMutationVersion = Number.isFinite(options?.builtFromEventMutationVersion)
        ? Math.max(0, Math.floor(options?.builtFromEventMutationVersion as number))
        : null;

    const resolveSourceDocCountForDependencies = (
        sourceDependencies: readonly DerivedMetricBuildSourceDependency[],
    ): number => {
        let sourceDocCount = 0;
        if (sourceDependencies.includes('formDocs')) {
            sourceDocCount += formSourceDocCount;
        }
        if (sourceDependencies.includes('recoveryNowDocs')) {
            sourceDocCount += recoveryNowSourceDocCount;
        }
        return sourceDocCount;
    };

    const persistBuildResult = <TPayload>(
        metricKind: DerivedMetricKind,
        buildResult: DerivedMetricBuildResult<TPayload>,
        sourceDocCount: number,
    ): void => {
        batch.set(getMetricDocRef(uid, metricKind), {
            entryType: DERIVED_METRICS_ENTRY_TYPES.Snapshot,
            metricKind,
            schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
            status: 'ready',
            updatedAtMs: nowMs,
            builtFromEventMutationVersion,
            sourceEventCount: buildResult.sourceEventCount,
            sourceDocCount,
            payload: buildResult.payload,
            lastError: null,
        }, { merge: true });
    };

    metricKinds.forEach((metricKind) => {
        const definition = DERIVED_METRIC_BUILD_REGISTRY[metricKind];
        if (!definition) {
            return;
        }
        const buildResult = definition.build(buildContext);
        const sourceDocCount = resolveSourceDocCountForDependencies(definition.sourceDependencies);
        persistBuildResult(metricKind, buildResult, sourceDocCount);
    });

    await batch.commit();
}

export function getDefaultDerivedMetricKindsForDashboard(): DerivedMetricKind[] {
    return [...DEFAULT_DERIVED_METRIC_KINDS];
}
