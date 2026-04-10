import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
    DataDuration,
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
} from '@sports-alliance/sports-lib';
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
    type DerivedAcwrMetricPayload,
    type DerivedEfficiencyTrendMetricPayload,
    type DerivedFreshnessForecastMetricPayload,
    type DerivedIntensityDistributionMetricPayload,
    type DerivedFormMetricPayload,
    type DerivedMetricKind,
    type DerivedMetricsCoordinator,
    type DerivedMonotonyStrainMetricPayload,
    type DerivedRampRateMetricPayload,
    type DerivedRecoveryNowMetricPayload,
    getDerivedMetricDocId,
    normalizeDerivedMetricKinds,
    normalizeDerivedMetricKindsStrict,
    type EnsureDerivedMetricsResponse,
} from '../../../shared/derived-metrics';
import { enqueueDerivedMetricsTask } from '../shared/cloud-tasks';
import { getDerivedMetricsUidAllowlist, isDerivedMetricsUidAllowed } from './derived-metrics-uid-gate';

const FORM_STAT_TYPE = 'Training Stress Score';
const LEGACY_FORM_STAT_TYPE = 'Power Training Stress Score';
const DERIVED_METRICS_EVENT_FIELDS = ['startDate', 'endDate', 'stats', 'isMerge', 'mergeType', 'originalFiles'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const CTL_TIME_CONSTANT_DAYS = 42;
const ATL_TIME_CONSTANT_DAYS = 7;
const HISTORY_TREND_WEEKS = 8;
const FORECAST_DAYS = 7;
const POWER_ZONE_STAT_TYPES = [
    DataPowerZoneOneDuration.type,
    DataPowerZoneTwoDuration.type,
    DataPowerZoneThreeDuration.type,
    DataPowerZoneFourDuration.type,
    DataPowerZoneFiveDuration.type,
    DataPowerZoneSixDuration.type,
    DataPowerZoneSevenDuration.type,
] as const;
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
}

export interface CompleteDerivedMetricsProcessingResult {
    requeued: boolean;
    nextGeneration: number | null;
    dirtyMetricKinds: DerivedMetricKind[];
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
    const requestedAtMs = toFiniteNumber(normalizedData.requestedAtMs);
    const startedAtMs = toFiniteNumber(normalizedData.startedAtMs);
    const completedAtMs = toFiniteNumber(normalizedData.completedAtMs);
    const updatedAtMs = toFiniteNumber(normalizedData.updatedAtMs);
    const dirtyMetricKinds = normalizeDerivedMetricKindsStrict(normalizedData.dirtyMetricKinds as unknown[]);

    return {
        entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
        status: status === 'queued' || status === 'processing' || status === 'failed' ? status : 'idle',
        generation: generationRaw === null ? 0 : Math.max(0, Math.floor(generationRaw)),
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

    // Legacy coordinator docs written before processingMetricKinds existed can be
    // left in "processing" with an empty dirty set after task crashes/timeouts.
    return [...DEFAULT_DERIVED_METRIC_KINDS];
}

function isMergedEvent(eventData: Record<string, unknown>): boolean {
    if (eventData.isMerge === true) {
        return true;
    }

    const mergeType = toSafeString(eventData.mergeType).trim();
    if (mergeType.length > 0) {
        return true;
    }

    const originalFiles = eventData.originalFiles;
    if (Array.isArray(originalFiles) && originalFiles.length > 1) {
        return true;
    }

    return false;
}

function resolveRawStats(eventData: Record<string, unknown>): Record<string, unknown> {
    const stats = eventData.stats;
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
        return {};
    }
    return stats as Record<string, unknown>;
}

function resolveRawStatNumericValue(
    eventData: Record<string, unknown>,
    statType: string,
): number | null {
    const stats = resolveRawStats(eventData);
    if (!Object.prototype.hasOwnProperty.call(stats, statType)) {
        return null;
    }

    const rawStat = stats[statType];
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
): DerivedMetricBuildResult<DerivedAcwrMetricPayload> {
    if (!points.length) {
        return {
            sourceEventCount,
            payload: {
                dayBoundary: 'UTC',
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
): DerivedMetricBuildResult<DerivedRampRateMetricPayload> {
    if (!points.length) {
        return {
            sourceEventCount,
            payload: {
                dayBoundary: 'UTC',
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
): DerivedMetricBuildResult<DerivedMonotonyStrainMetricPayload> {
    if (!points.length) {
        return {
            sourceEventCount,
            payload: {
                dayBoundary: 'UTC',
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

function buildFreshnessForecastMetricPayload(
    points: readonly DerivedLoadPoint[],
    sourceEventCount: number,
): DerivedMetricBuildResult<DerivedFreshnessForecastMetricPayload> {
    if (!points.length) {
        return {
            sourceEventCount,
            payload: {
                dayBoundary: 'UTC',
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

function getCoordinatorDocRef(uid: string): FirebaseFirestore.DocumentReference {
    return admin.firestore().doc(`users/${uid}/${DERIVED_METRICS_COLLECTION_ID}/${DERIVED_METRICS_COORDINATOR_DOC_ID}`);
}

function getMetricDocRef(uid: string, metricKind: DerivedMetricKind): FirebaseFirestore.DocumentReference {
    return admin.firestore().doc(`users/${uid}/${DERIVED_METRICS_COLLECTION_ID}/${getDerivedMetricDocId(metricKind)}`);
}

async function queueDerivedMetricsTask(uid: string, generation: number): Promise<boolean> {
    const queued = await enqueueDerivedMetricsTask(uid, generation);
    return queued;
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

    const coordinatorRef = getCoordinatorDocRef(uid);
    const nowMs = Date.now();

    let shouldEnqueue = false;
    let generationToQueue: number | null = null;

    await admin.firestore().runTransaction(async (transaction) => {
        const coordinatorSnapshot = await transaction.get(coordinatorRef);
        const coordinator = parseCoordinator(coordinatorSnapshot.data());
        const nextDirtyMetricKinds = mergeDerivedMetricKinds(coordinator.dirtyMetricKinds, metricKinds);
        const isAlreadyQueuedOrProcessing = coordinator.status === 'queued' || coordinator.status === 'processing';
        const dirtyMetricKindsChanged = !hasSameDerivedMetricKinds(coordinator.dirtyMetricKinds, nextDirtyMetricKinds);

        // Coalesce repeated writes during bulk updates:
        // if a user is already queued/processing and the dirty set did not change,
        // avoid writing the coordinator doc again.
        if (isAlreadyQueuedOrProcessing && !dirtyMetricKindsChanged) {
            shouldEnqueue = false;
            generationToQueue = coordinator.generation;
            return;
        }

        const nextGeneration = isAlreadyQueuedOrProcessing ? coordinator.generation : coordinator.generation + 1;

        shouldEnqueue = !isAlreadyQueuedOrProcessing;
        generationToQueue = nextGeneration;

        transaction.set(coordinatorRef, {
            entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
            status: isAlreadyQueuedOrProcessing ? coordinator.status : 'queued',
            generation: nextGeneration,
            dirtyMetricKinds: nextDirtyMetricKinds,
            requestedAtMs: nowMs,
            updatedAtMs: nowMs,
            ...(isAlreadyQueuedOrProcessing ? {} : {
                startedAtMs: null,
                completedAtMs: null,
                lastError: null,
            }),
        }, { merge: true });
    });

    if (shouldEnqueue && generationToQueue !== null) {
        try {
            await queueDerivedMetricsTask(uid, generationToQueue);
        } catch (error) {
            logger.error('[derived-metrics] Failed to enqueue derived metrics task', {
                uid,
                generation: generationToQueue,
                error,
            });
            await coordinatorRef.set({
                entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
                status: 'failed',
                lastError: toSafeString((error as { message?: unknown } | null)?.message) || 'enqueue_failed',
                updatedAtMs: Date.now(),
            }, { merge: true });

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

        if (coordinator.status === 'processing') {
            const inFlightMetricKinds = resolveInFlightMetricKinds(rawCoordinatorData, coordinator.dirtyMetricKinds);
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
            await queueDerivedMetricsTask(uid, completion.nextGeneration);
        } catch (error) {
            logger.error('[derived-metrics] Failed to enqueue follow-up derived metrics task', {
                uid,
                generation,
                nextGeneration: completion.nextGeneration,
                error,
            });
            await coordinatorRef.set({
                entryType: DERIVED_METRICS_ENTRY_TYPES.Coordinator,
                status: 'failed',
                lastError: toSafeString((error as { message?: unknown } | null)?.message) || 'enqueue_follow_up_failed',
                updatedAtMs: Date.now(),
            }, { merge: true });
        }
    }

    return completion;
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
): Promise<void> {
    const nowMs = Date.now();
    const batch = admin.firestore().batch();
    const formDocs = sourceDocs.formDocs || [];
    const recoveryNowDocs = sourceDocs.recoveryNowDocs || [];
    const requiresDailyLoadContext = metricKinds.some((metricKind) => (
        metricKind === DERIVED_METRIC_KINDS.Form
        || metricKind === DERIVED_METRIC_KINDS.Acwr
        || metricKind === DERIVED_METRIC_KINDS.RampRate
        || metricKind === DERIVED_METRIC_KINDS.MonotonyStrain
        || metricKind === DERIVED_METRIC_KINDS.FreshnessForecast
    ));
    const dailyLoadContext = requiresDailyLoadContext
        ? buildDailyLoadContext(formDocs)
        : null;
    const derivedLoadPoints = dailyLoadContext
        ? buildDerivedLoadPoints(dailyLoadContext.dailyLoadsByUtcDay)
        : [];
    // KPI metrics should reflect the current training state, so we extend daily load
    // with zero-load days up to "today" while keeping source event counts untouched.
    const kpiDerivedLoadPoints = dailyLoadContext
        ? buildDerivedLoadPoints(dailyLoadContext.dailyLoadsByUtcDay, { endDayMs: resolveUtcDayStartMs(nowMs) })
        : [];

    const persistBuildResult = <TPayload>(
        metricKind: DerivedMetricKind,
        buildResult: DerivedMetricBuildResult<TPayload>,
    ): void => {
        batch.set(getMetricDocRef(uid, metricKind), {
            entryType: DERIVED_METRICS_ENTRY_TYPES.Snapshot,
            metricKind,
            schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
            status: 'ready',
            updatedAtMs: nowMs,
            sourceEventCount: buildResult.sourceEventCount,
            payload: buildResult.payload,
            lastError: null,
        }, { merge: true });
    };

    metricKinds.forEach((metricKind) => {
        if (metricKind === DERIVED_METRIC_KINDS.Form) {
            const buildResult = buildFormMetricPayload(dailyLoadContext || buildDailyLoadContext(formDocs));
            persistBuildResult(metricKind, buildResult);
            return;
        }

        if (metricKind === DERIVED_METRIC_KINDS.Acwr) {
            const buildResult = buildAcwrMetricPayload(kpiDerivedLoadPoints, dailyLoadContext?.sourceEventCount || 0);
            persistBuildResult(metricKind, buildResult);
            return;
        }

        if (metricKind === DERIVED_METRIC_KINDS.RampRate) {
            const buildResult = buildRampRateMetricPayload(kpiDerivedLoadPoints, dailyLoadContext?.sourceEventCount || 0);
            persistBuildResult(metricKind, buildResult);
            return;
        }

        if (metricKind === DERIVED_METRIC_KINDS.MonotonyStrain) {
            const buildResult = buildMonotonyStrainMetricPayload(kpiDerivedLoadPoints, dailyLoadContext?.sourceEventCount || 0);
            persistBuildResult(metricKind, buildResult);
            return;
        }

        if (metricKind === DERIVED_METRIC_KINDS.FreshnessForecast) {
            const buildResult = buildFreshnessForecastMetricPayload(derivedLoadPoints, dailyLoadContext?.sourceEventCount || 0);
            persistBuildResult(metricKind, buildResult);
            return;
        }

        if (metricKind === DERIVED_METRIC_KINDS.IntensityDistribution) {
            const buildResult = buildIntensityDistributionMetricPayload(formDocs);
            persistBuildResult(metricKind, buildResult);
            return;
        }

        if (metricKind === DERIVED_METRIC_KINDS.EfficiencyTrend) {
            const buildResult = buildEfficiencyTrendMetricPayload(formDocs);
            persistBuildResult(metricKind, buildResult);
            return;
        }

        if (metricKind === DERIVED_METRIC_KINDS.RecoveryNow) {
            const buildResult = buildRecoveryNowMetricPayload(recoveryNowDocs);
            persistBuildResult(metricKind, buildResult);
        }
    });

    await batch.commit();
}

export function getDefaultDerivedMetricKindsForDashboard(): DerivedMetricKind[] {
    return [...DEFAULT_DERIVED_METRIC_KINDS];
}
