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

function parseDateMs(value: unknown): number | null {
    const stringValue = asString(value);
    if (!stringValue) {
        return null;
    }
    const normalized = stringValue.includes('T')
        ? stringValue
        : stringValue.replace(' ', 'T') + 'Z';
    const timestamp = Date.parse(normalized);
    return Number.isFinite(timestamp) ? timestamp : null;
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
    const resolvedDurationSeconds = durationSeconds || Math.max(0, Math.round((resolvedEndTimeMs - startTimeMs) / 1000));
    const sourceSessionKey = asScalarString(entryData.SleepId)
        || asString(entryData.DateTime)
        || asString(sample.timestamp)
        || `${providerUserId}:${startTimeMs}`;
    const wakeAfterSleepOnsetSeconds = positiveSeconds(entryData.WakeAfterSleepOnsetDuration);
    const wakeBeforeOffBedSeconds = positiveSeconds(entryData.WakeBeforeOffBedDuration);
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
            inBedDurationSeconds: resolvedDurationSeconds + wakeBeforeOffBedSeconds,
            isNap: entryData.IsNap === true,
            validation: null,
            stages: [],
            stageDurationsSeconds: buildStageDurations({
                [SLEEP_STAGES.Deep]: positiveSeconds(entryData.DeepSleepDuration),
                [SLEEP_STAGES.Light]: positiveSeconds(entryData.LightSleepDuration),
                [SLEEP_STAGES.Rem]: positiveSeconds(entryData.REMSleepDuration),
                [SLEEP_STAGES.Awake]: wakeAfterSleepOnsetSeconds + wakeBeforeOffBedSeconds,
            }),
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
    const startTimeMs = parseDateMs(daily.sleepStartTime);
    const endTimeMs = parseDateMs(daily.sleepEndTime);
    if (!startTimeMs || !endTimeMs || endTimeMs <= startTimeMs) {
        return null;
    }

    const happenDay = asString(daily.happenDay) || isoDateFromMs(endTimeMs).replace(/-/g, '');
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
            sleepDate: isoDateFromMs(endTimeMs),
            startTimeMs,
            endTimeMs,
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
                }),
            },
        },
    };
}
