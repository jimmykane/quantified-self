import {
    SleepMapperResult,
    SleepProvider,
    SleepSamplePoint,
    SleepStage,
    SleepStageDurationsSeconds,
    SleepStageInterval,
    SleepVitals,
    SLEEP_PROVIDERS,
    SLEEP_STAGES,
    resolveSleepSessionEndTimeMs,
} from '../../../shared/sleep';

type ExternalRecord = Record<string, unknown>;

const UNKNOWN_SLEEP_DATE = 'unknown';
const EXPLICIT_TIME_ZONE_PATTERN = /(?:z|[+-]\d{2}:?\d{2})$/i;
const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

function asRecord(value: unknown): ExternalRecord {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as ExternalRecord
        : {};
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | null {
    const numberValue = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asScalarString(value: unknown): string | null {
    if (typeof value === 'string') {
        return asString(value);
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return `${value}`;
    }
    return null;
}

function positiveSeconds(value: unknown): number {
    const numberValue = asNumber(value);
    return numberValue !== null && numberValue > 0 ? Math.floor(numberValue) : 0;
}

function parseLocalDateTimeComponentsMs(value: string, timezoneOffsetSeconds: number): number | null {
    const match = LOCAL_DATE_TIME_PATTERN.exec(value);
    if (!match) {
        return null;
    }

    const [, year, month, day, hour, minute, second = '0', millisecond = '0'] = match;
    const wallClockUtcMs = Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        Number(millisecond.padEnd(3, '0').slice(0, 3)),
    );
    return Number.isFinite(wallClockUtcMs)
        ? wallClockUtcMs - (timezoneOffsetSeconds * 1000)
        : null;
}

function normalizeDateTimeSeparator(value: string): string {
    return value.includes('T') ? value : value.replace(' ', 'T');
}

function parseDateMs(value: unknown, timezoneOffsetSeconds?: number | null): number | null {
    const stringValue = asString(value);
    if (!stringValue) {
        return null;
    }
    const normalized = normalizeDateTimeSeparator(stringValue);
    if (!EXPLICIT_TIME_ZONE_PATTERN.test(normalized) && Number.isFinite(timezoneOffsetSeconds)) {
        const timestamp = parseLocalDateTimeComponentsMs(normalized, timezoneOffsetSeconds || 0);
        if (timestamp !== null) {
            return timestamp;
        }
    }
    const timestamp = Date.parse(normalized);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function parseTimezoneOffsetLabelSeconds(value: unknown): number | null {
    const stringValue = asString(value);
    if (!stringValue) {
        return null;
    }

    const match = /^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(stringValue.toUpperCase());
    if (!match) {
        return null;
    }

    const [, sign, hours, minutes = '0'] = match;
    const totalSeconds = ((Number(hours) * 60) + Number(minutes)) * 60;
    return Number.isFinite(totalSeconds) ? (sign === '-' ? -totalSeconds : totalSeconds) : null;
}

function parseCorosTimezoneUnitOffsetSeconds(value: unknown): number | null {
    const numericValue = asNumber(value);
    if (numericValue === null) {
        return parseTimezoneOffsetLabelSeconds(value);
    }

    // COROS documents timezone fields in 15-minute units: 32 means UTC+08:00.
    return Math.round(numericValue * 15 * 60);
}

function resolveCorosTimezoneOffsetSeconds(
    daily: ExternalRecord,
    timezoneUnitFields: readonly string[],
): number | null {
    const explicitOffsetSeconds = asNumber(daily.timezoneOffsetSeconds)
        ?? asNumber(daily.timeZoneOffsetSeconds);
    if (explicitOffsetSeconds !== null) {
        return explicitOffsetSeconds;
    }

    for (const field of timezoneUnitFields) {
        const offsetSeconds = parseCorosTimezoneUnitOffsetSeconds(daily[field]);
        if (offsetSeconds !== null) {
            return offsetSeconds;
        }
    }

    return parseTimezoneOffsetLabelSeconds(daily.timezone)
        ?? parseTimezoneOffsetLabelSeconds(daily.timeZone);
}

function localDateFromEpochSeconds(epochSeconds: number, offsetSeconds?: number | null): string {
    const localMs = (epochSeconds + (offsetSeconds || 0)) * 1000;
    const date = new Date(localMs);
    if (!Number.isFinite(date.getTime())) {
        return UNKNOWN_SLEEP_DATE;
    }
    return date.toISOString().slice(0, 10);
}

function isoDateFromMs(timestampMs: number | null): string {
    if (!timestampMs || !Number.isFinite(timestampMs)) {
        return UNKNOWN_SLEEP_DATE;
    }
    return new Date(timestampMs).toISOString().slice(0, 10);
}

function mapStageName(stageName: string): SleepStage {
    switch (stageName.toLowerCase()) {
        case 'deep':
            return SLEEP_STAGES.Deep;
        case 'light':
            return SLEEP_STAGES.Light;
        case 'rem':
            return SLEEP_STAGES.Rem;
        case 'awake':
            return SLEEP_STAGES.Awake;
        case 'unmeasurable':
        case 'unmeasurable_sleep':
            return SLEEP_STAGES.Unmeasurable;
        default:
            return SLEEP_STAGES.Unknown;
    }
}

function compactProviderFields(fields: ExternalRecord): ExternalRecord {
    const compacted: ExternalRecord = {};
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) {
            compacted[key] = value;
        }
    }
    return compacted;
}

function sampleMapToPoints(value: unknown): SleepSamplePoint[] {
    return Object.entries(asRecord(value))
        .map((entry): SleepSamplePoint | null => {
            const [offset, sampleValue] = entry;
            const numericValue = asNumber(sampleValue);
            const offsetSeconds = asNumber(offset);
            if (numericValue === null || offsetSeconds === null) {
                return null;
            }
            return {
                offsetSeconds,
                value: numericValue,
            };
        })
        .filter((point): point is SleepSamplePoint => point !== null)
        .sort((left, right) => (left.offsetSeconds || 0) - (right.offsetSeconds || 0));
}

function averageSampleValue(samples: readonly SleepSamplePoint[]): number | null {
    if (!samples.length) {
        return null;
    }
    const total = samples.reduce((sum, sample) => sum + sample.value, 0);
    return Math.round((total / samples.length) * 10) / 10;
}

function buildGarminStageIntervals(sleepLevelsMap: unknown): SleepStageInterval[] {
    const levels = asRecord(sleepLevelsMap);
    const intervals: SleepStageInterval[] = [];
    for (const [stageName, ranges] of Object.entries(levels)) {
        const stage = mapStageName(stageName);
        for (const rangeValue of asArray(ranges)) {
            const range = asRecord(rangeValue);
            const startSeconds = asNumber(range.startTimeInSeconds);
            const endSeconds = asNumber(range.endTimeInSeconds);
            if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds) {
                continue;
            }
            intervals.push({
                stage,
                startTimeMs: startSeconds * 1000,
                endTimeMs: endSeconds * 1000,
            });
        }
    }
    return intervals.sort((left, right) => left.startTimeMs - right.startTimeMs);
}

function buildStageDurations(input: SleepStageDurationsSeconds): SleepStageDurationsSeconds {
    const durations: SleepStageDurationsSeconds = {};
    for (const [stage, value] of Object.entries(input) as Array<[SleepStage, number | undefined]>) {
        if (Number.isFinite(value) && (value || 0) > 0) {
            durations[stage] = Math.floor(value || 0);
        }
    }
    return durations;
}

function buildSource(provider: SleepProvider, providerUserId: string, sourceSessionKey: string, receivedAtMs?: number | null, callbackURL?: string | null) {
    return {
        provider,
        providerUserId,
        sourceSessionKey,
        callbackURL: callbackURL || null,
        receivedAtMs: receivedAtMs || null,
    };
}

export function mapGarminSleepSummary(
    summaryInput: unknown,
    providerUserId: string,
    receivedAtMs = Date.now(),
    callbackURL?: string | null,
): SleepMapperResult | null {
    const summary = asRecord(summaryInput);
    const startSeconds = asNumber(summary.startTimeInSeconds);
    if (startSeconds === null) {
        return null;
    }

    const offsetSeconds = asNumber(summary.startTimeOffsetInSeconds);
    const sourceSessionKey = asString(summary.summaryId) || `${providerUserId}:${startSeconds}`;
    const respirationSamples = sampleMapToPoints(summary.timeOffsetSleepRespiration);
    const spo2Samples = sampleMapToPoints(summary.timeOffsetSleepSpo2);
    const sleepScores = asRecord(summary.sleepScores);
    const overallSleepScore = asRecord(summary.overallSleepScore);
    const durationSeconds = positiveSeconds(summary.durationInSeconds);
    const unmeasurableSeconds = positiveSeconds(summary.unmeasurableSleepInSeconds)
        || positiveSeconds(summary.unmeasurableSleepDurationInSeconds);
    const awakeSeconds = positiveSeconds(summary.awakeDurationInSeconds);
    const inBedDurationSeconds = durationSeconds + awakeSeconds + unmeasurableSeconds;
    const stageIntervals = buildGarminStageIntervals(summary.sleepLevelsMap);
    const intervalEndTimeMs = stageIntervals.reduce(
        (maxTimeMs, interval) => Math.max(maxTimeMs, interval.endTimeMs),
        0,
    );
    const endTimeMs = Math.max(
        resolveSleepSessionEndTimeMs(startSeconds * 1000, inBedDurationSeconds || durationSeconds),
        intervalEndTimeMs,
    );
    const stageDurationsSeconds = buildStageDurations({
        [SLEEP_STAGES.Deep]: positiveSeconds(summary.deepSleepDurationInSeconds),
        [SLEEP_STAGES.Light]: positiveSeconds(summary.lightSleepDurationInSeconds),
        [SLEEP_STAGES.Rem]: positiveSeconds(summary.remSleepInSeconds),
        [SLEEP_STAGES.Awake]: awakeSeconds,
        [SLEEP_STAGES.Unmeasurable]: unmeasurableSeconds,
    });

    return {
        sourceSessionKey,
        session: {
            source: buildSource(SLEEP_PROVIDERS.GarminAPI, providerUserId, sourceSessionKey, receivedAtMs, callbackURL),
            sleepDate: asString(summary.calendarDate) || localDateFromEpochSeconds(startSeconds, offsetSeconds),
            startTimeMs: startSeconds * 1000,
            endTimeMs,
            timezoneOffsetSeconds: offsetSeconds,
            durationSeconds,
            inBedDurationSeconds,
            isNap: false,
            validation: asString(summary.validation),
            stages: stageIntervals,
            stageDurationsSeconds,
            score: {
                value: asNumber(overallSleepScore.value),
                qualifier: asString(overallSleepScore.qualifierKey),
                components: Object.keys(sleepScores).length ? sleepScores as Record<string, unknown> : null,
            },
            vitals: {
                averageRespirationBrpm: averageSampleValue(respirationSamples),
            },
            respirationSamples,
            spo2Samples,
            providerFields: {
                garmin: compactProviderFields({
                    summaryId: summary.summaryId,
                    totalNapDurationInSeconds: summary.totalNapDurationInSeconds,
                    naps: summary.naps,
                    sleepScores: summary.sleepScores,
                }),
            },
        },
    };
}

export function mapSuuntoSleepSample(
    sampleInput: unknown,
    providerUserId: string,
    receivedAtMs = Date.now(),
): SleepMapperResult | null {
    const sample = asRecord(sampleInput);
    const entryData = asRecord(sample.entryData);
    const startTimeMs = parseDateMs(entryData.BedtimeStart) ?? parseDateMs(entryData.DateTime) ?? parseDateMs(sample.timestamp);
    const endTimeMs = parseDateMs(entryData.BedtimeEnd);
    const durationSeconds = positiveSeconds(entryData.Duration);
    if (!startTimeMs || (!endTimeMs && durationSeconds <= 0)) {
        return null;
    }

    const resolvedEndTimeMs = endTimeMs || resolveSleepSessionEndTimeMs(startTimeMs, durationSeconds);
    const sourceSessionKey = asScalarString(entryData.SleepId)
        || asString(entryData.DateTime)
        || asString(sample.timestamp)
        || `${providerUserId}:${startTimeMs}`;
    const deepSeconds = positiveSeconds(entryData.DeepSleepDuration);
    const lightSeconds = positiveSeconds(entryData.LightSleepDuration);
    const remSeconds = positiveSeconds(entryData.REMSleepDuration);
    const wakeAfterSleepOnsetSeconds = positiveSeconds(entryData.WakeAfterSleepOnsetDuration);
    const wakeBeforeOffBedSeconds = positiveSeconds(entryData.WakeBeforeOffBedDuration);
    const stagedSleepSeconds = deepSeconds + lightSeconds + remSeconds;
    const resolvedDurationSeconds = stagedSleepSeconds
        || durationSeconds
        || Math.max(0, Math.round((resolvedEndTimeMs - startTimeMs) / 1000));
    const resolvedInBedDurationSeconds = Math.max(
        durationSeconds,
        resolvedDurationSeconds + wakeAfterSleepOnsetSeconds + wakeBeforeOffBedSeconds,
    );
    const stageDurationsSeconds = buildStageDurations({
        [SLEEP_STAGES.Deep]: deepSeconds,
        [SLEEP_STAGES.Light]: lightSeconds,
        [SLEEP_STAGES.Rem]: remSeconds,
        [SLEEP_STAGES.Awake]: wakeAfterSleepOnsetSeconds + wakeBeforeOffBedSeconds,
    });
    const maxSpo2 = asNumber(entryData.MaxSpo2);
    const vitals: SleepVitals = {
        averageHeartRateBpm: asNumber(entryData.HRAvg),
        minimumHeartRateBpm: asNumber(entryData.HRMin),
        averageHrvMs: asNumber(entryData.AvgHRV),
        hrvSampleCount: asNumber(entryData.AvgHRVSampleCount),
        maxSpo2Percent: maxSpo2 === null ? null : (maxSpo2 <= 1 ? maxSpo2 * 100 : maxSpo2),
    };

    return {
        sourceSessionKey,
        session: {
            source: buildSource(SLEEP_PROVIDERS.SuuntoApp, providerUserId, sourceSessionKey, receivedAtMs),
            sleepDate: isoDateFromMs(startTimeMs),
            startTimeMs,
            endTimeMs: resolvedEndTimeMs,
            durationSeconds: resolvedDurationSeconds,
            inBedDurationSeconds: resolvedInBedDurationSeconds,
            isNap: entryData.IsNap === true,
            validation: null,
            stages: [],
            stageDurationsSeconds,
            score: {
                value: asNumber(entryData.SleepQualityScore),
                qualifier: null,
                components: null,
            },
            vitals,
            providerFields: {
                suunto: compactProviderFields({
                    Feeling: entryData.Feeling,
                    BodyResourcesInsightId: entryData.BodyResourcesInsightId,
                    SleepOnsetLatencyDuration: entryData.SleepOnsetLatencyDuration,
                    WakeAfterSleepOnsetDuration: entryData.WakeAfterSleepOnsetDuration,
                    WakeBeforeOffBedDuration: entryData.WakeBeforeOffBedDuration,
                    Altitude: entryData.Altitude,
                    timestamp: sample.timestamp,
                }),
            },
        },
    };
}

export function mapCorosDailySleep(
    dailyInput: unknown,
    providerUserId: string,
    receivedAtMs = Date.now(),
): SleepMapperResult | null {
    const daily = asRecord(dailyInput);
    const startTimezoneOffsetSeconds = resolveCorosTimezoneOffsetSeconds(daily, ['startTimezone']);
    const endTimezoneOffsetSeconds = resolveCorosTimezoneOffsetSeconds(daily, ['endTimezone']);
    const timezoneOffsetSeconds = startTimezoneOffsetSeconds ?? endTimezoneOffsetSeconds;
    const startTimeMs = parseDateMs(daily.sleepStartTime, startTimezoneOffsetSeconds ?? endTimezoneOffsetSeconds);
    const endTimeMs = parseDateMs(daily.sleepEndTime, endTimezoneOffsetSeconds ?? startTimezoneOffsetSeconds);
    if (!startTimeMs || !endTimeMs || endTimeMs <= startTimeMs) {
        return null;
    }

    const happenDay = asScalarString(daily.happenDay) || isoDateFromMs(endTimeMs).replace(/-/g, '');
    const sourceSessionKey = `${happenDay}:${asString(daily.sleepStartTime) || startTimeMs}:${asString(daily.sleepEndTime) || endTimeMs}`;
    const hrvSamples = asArray(daily.hrvList)
        .map((value): SleepSamplePoint | null => {
            const record = asRecord(value);
            const timestampSeconds = asNumber(record.timestamp);
            const hrv = asNumber(record.hrv);
            if (timestampSeconds === null || hrv === null) {
                return null;
            }
            return {
                timestampMs: timestampSeconds * 1000,
                value: hrv,
            };
        })
        .filter((point): point is SleepSamplePoint => point !== null)
        .sort((left, right) => (left.timestampMs || 0) - (right.timestampMs || 0));

    return {
        sourceSessionKey,
        session: {
            source: buildSource(SLEEP_PROVIDERS.COROSAPI, providerUserId, sourceSessionKey, receivedAtMs),
            sleepDate: happenDay.length === 8
                ? `${happenDay.slice(0, 4)}-${happenDay.slice(4, 6)}-${happenDay.slice(6, 8)}`
                : isoDateFromMs(endTimeMs),
            startTimeMs,
            endTimeMs,
            timezoneOffsetSeconds,
            durationSeconds: Math.max(0, Math.round((endTimeMs - startTimeMs) / 1000)),
            inBedDurationSeconds: null,
            isNap: false,
            validation: null,
            stages: [],
            stageDurationsSeconds: {
                [SLEEP_STAGES.Unknown]: Math.max(0, Math.round((endTimeMs - startTimeMs) / 1000)),
            },
            vitals: {
                averageHeartRateBpm: asNumber(daily.sleepAvgHr),
                restingHeartRateBpm: asNumber(daily.rhr),
                overnightHrvMs: asNumber(daily.ppgHrv),
            },
            hrvSamples,
            providerFields: {
                coros: compactProviderFields({
                    happenDay: daily.happenDay,
                    calorie: daily.calorie,
                    step: daily.step,
                    rhr: daily.rhr,
                    ppgHrv: daily.ppgHrv,
                    sleepAvgHr: daily.sleepAvgHr,
                    startTimezone: daily.startTimezone,
                    endTimezone: daily.endTimezone,
                    timezoneOffsetSeconds,
                }),
            },
        },
    };
}
