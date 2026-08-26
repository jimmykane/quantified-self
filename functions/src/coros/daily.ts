import { COROS_DAILY_MAX_HRV_POINTS } from './constants';

type ExternalRecord = Record<string, unknown>;

const EXPLICIT_TIME_ZONE_PATTERN = /(?:z|[+-]\d{2}:?\d{2})$/i;
const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const COROS_HAPPEN_DAY_PATTERN = /^(\d{4})(\d{2})(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export class COROSDailyValidationError extends Error {
    public readonly name = 'COROSDailyValidationError';
    public readonly code = 'coros_daily_invalid_response';

    constructor(message: string) {
        super(message);
    }
}

export interface COROSDailyHrvPoint {
    timestampMs: number;
    hrvMs: number | null;
    meanHeartRateBpm: number | null;
}

export interface COROSDailyRecord {
    happenDay: string | null;
    calendarDate: string | null;
    rawSleepStartTime: string | null;
    rawSleepEndTime: string | null;
    rawStartTimezone: string | number | null;
    rawEndTimezone: string | number | null;
    startTimezoneOffsetSeconds: number | null;
    endTimezoneOffsetSeconds: number | null;
    timezoneOffsetSeconds: number | null;
    sleepStartTimeMs: number | null;
    sleepEndTimeMs: number | null;
    step: number | null;
    calorie: number | null;
    restingHeartRateBpm: number | null;
    overnightHrvMs: number | null;
    averageSleepHeartRateBpm: number | null;
    hrvPoints: COROSDailyHrvPoint[];
}

export interface COROSDailyBounds {
    startTimeMs: number;
    endTimeMs: number;
}

function asRecord(value: unknown): ExternalRecord {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as ExternalRecord
        : {};
}

function asNumber(value: unknown): number | null {
    if ((typeof value !== 'number' && typeof value !== 'string')
        || (typeof value === 'string' && value.trim().length === 0)) {
        return null;
    }
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : null;
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : null;
}

function boundedString(value: unknown, maximumLength: number): string | null {
    const stringValue = asString(value);
    return stringValue && stringValue.length <= maximumLength ? stringValue : null;
}

function asScalarString(value: unknown): string | null {
    if (typeof value === 'string') return asString(value);
    return typeof value === 'number' && Number.isFinite(value) ? `${value}` : null;
}

function boundedProviderScalar(value: unknown): string | number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    return boundedString(value, 64);
}

function nonNegativeNumber(value: unknown): number | null {
    const normalized = asNumber(value);
    return normalized !== null && normalized >= 0 ? normalized : null;
}

function nonNegativeSafeInteger(value: unknown): number | null {
    const normalized = asNumber(value);
    return normalized !== null && Number.isSafeInteger(normalized) && normalized >= 0
        ? normalized
        : null;
}

function positiveNumber(value: unknown): number | null {
    const normalized = asNumber(value);
    return normalized !== null && normalized > 0 ? normalized : null;
}

function parseTimezoneOffsetLabelSeconds(value: unknown): number | null {
    const stringValue = asString(value);
    if (!stringValue) return null;
    const match = /^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(stringValue.toUpperCase());
    if (!match) return null;
    const [, sign, hours, minutes = '0'] = match;
    const numericHours = Number(hours);
    const numericMinutes = Number(minutes);
    if (!Number.isInteger(numericHours)
        || !Number.isInteger(numericMinutes)
        || numericHours > 18
        || numericMinutes > 59
        || (numericHours === 18 && numericMinutes !== 0)) {
        return null;
    }
    const totalSeconds = ((numericHours * 60) + numericMinutes) * 60;
    return sign === '-' ? -totalSeconds : totalSeconds;
}

function parseTimezoneUnitOffsetSeconds(value: unknown): number | null {
    const numericValue = asNumber(value);
    if (numericValue === null) return parseTimezoneOffsetLabelSeconds(value);
    const seconds = numericValue * 15 * 60;
    return Number.isInteger(numericValue)
        && Number.isSafeInteger(seconds)
        && Math.abs(seconds) <= 18 * 60 * 60
        ? seconds
        : null;
}

function resolveTimezoneOffsetSeconds(daily: ExternalRecord, timezoneUnitField: string): number | null {
    const explicitOffsetSeconds = asNumber(daily.timezoneOffsetSeconds)
        ?? asNumber(daily.timeZoneOffsetSeconds);
    if (explicitOffsetSeconds !== null
        && Number.isSafeInteger(explicitOffsetSeconds)
        && Math.abs(explicitOffsetSeconds) <= 18 * 60 * 60) {
        return explicitOffsetSeconds;
    }
    return parseTimezoneUnitOffsetSeconds(daily[timezoneUnitField])
        ?? parseTimezoneOffsetLabelSeconds(daily.timezone)
        ?? parseTimezoneOffsetLabelSeconds(daily.timeZone);
}

function parseDateTimeOffsetSeconds(value: string | null): number | null {
    if (!value) return null;
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const match = EXPLICIT_TIME_ZONE_PATTERN.exec(normalized);
    if (!match) return null;
    return /^z$/i.test(match[0]) ? 0 : parseTimezoneOffsetLabelSeconds(match[0]);
}

function parseLocalDateTimeComponentsMs(value: string, timezoneOffsetSeconds: number): number | null {
    const match = LOCAL_DATE_TIME_PATTERN.exec(value);
    if (!match) return null;
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
    const date = new Date(wallClockUtcMs);
    if (!Number.isFinite(wallClockUtcMs)
        || date.getUTCFullYear() !== Number(year)
        || date.getUTCMonth() !== Number(month) - 1
        || date.getUTCDate() !== Number(day)
        || date.getUTCHours() !== Number(hour)
        || date.getUTCMinutes() !== Number(minute)
        || date.getUTCSeconds() !== Number(second)) {
        return null;
    }
    const timestampMs = wallClockUtcMs - (timezoneOffsetSeconds * 1000);
    return Number.isSafeInteger(timestampMs) ? timestampMs : null;
}

function parseDateMs(value: unknown, timezoneOffsetSeconds?: number | null): number | null {
    const stringValue = asString(value);
    if (!stringValue) return null;
    const normalized = stringValue.includes('T') ? stringValue : stringValue.replace(' ', 'T');
    const explicitTimezoneMatch = EXPLICIT_TIME_ZONE_PATTERN.exec(normalized);
    if (!explicitTimezoneMatch) {
        return parseLocalDateTimeComponentsMs(normalized, timezoneOffsetSeconds || 0);
    }
    if (!/^z$/i.test(explicitTimezoneMatch[0])
        && parseTimezoneOffsetLabelSeconds(explicitTimezoneMatch[0]) === null) {
        return null;
    }
    const wallClockValue = normalized.replace(EXPLICIT_TIME_ZONE_PATTERN, '');
    if (parseLocalDateTimeComponentsMs(wallClockValue, 0) === null) return null;
    const timestampMs = Date.parse(normalized);
    return Number.isSafeInteger(timestampMs) ? timestampMs : null;
}

export function normalizeCOROSHappenDay(value: unknown): { happenDay: string; calendarDate: string } | null {
    const happenDay = asScalarString(value);
    const match = happenDay ? COROS_HAPPEN_DAY_PATTERN.exec(happenDay) : null;
    if (!match) return null;
    const [, year, month, day] = match;
    const timestampMs = Date.UTC(Number(year), Number(month) - 1, Number(day));
    const date = new Date(timestampMs);
    if (date.getUTCFullYear() !== Number(year)
        || date.getUTCMonth() !== Number(month) - 1
        || date.getUTCDate() !== Number(day)) {
        return null;
    }
    return {
        happenDay: match[0],
        calendarDate: `${year}-${month}-${day}`,
    };
}

function parseHrvPoints(value: unknown): COROSDailyHrvPoint[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) return [];
    if (value.length > COROS_DAILY_MAX_HRV_POINTS) {
        throw new COROSDailyValidationError('COROS daily HRV series exceeds the bounded point limit.');
    }

    const pointsByTimestamp = new Map<number, COROSDailyHrvPoint>();
    for (const item of value) {
        const record = asRecord(item);
        const timestampSeconds = nonNegativeSafeInteger(record.timestamp);
        if (timestampSeconds === null || timestampSeconds > Math.floor(Number.MAX_SAFE_INTEGER / 1000)) continue;
        const timestampMs = timestampSeconds * 1000;
        const hrvMs = positiveNumber(record.hrv);
        const meanHeartRateBpm = positiveNumber(record.hr);
        if (hrvMs === null && meanHeartRateBpm === null) continue;
        // COROS does not define duplicate ordering. Last-in-list is deterministic
        // and keeps the final provider representation for the timestamp.
        pointsByTimestamp.set(timestampMs, { timestampMs, hrvMs, meanHeartRateBpm });
    }
    return [...pointsByTimestamp.values()].sort((left, right) => left.timestampMs - right.timestampMs);
}

export function parseCOROSDailyRecord(value: unknown): COROSDailyRecord {
    const daily = asRecord(value);
    const normalizedDate = normalizeCOROSHappenDay(daily.happenDay);
    // These values participate in the Sleep source identity. Bound them before
    // parsing so a provider-controlled string cannot expand a Firestore write.
    const rawSleepStartTime = boundedString(daily.sleepStartTime, 64);
    const rawSleepEndTime = boundedString(daily.sleepEndTime, 64);
    // Preserve the provider's explicit daily timezone when supplied. A
    // timestamp suffix is a safe fallback for responses without those fields.
    const startTimezoneOffsetSeconds = resolveTimezoneOffsetSeconds(daily, 'startTimezone')
        ?? parseDateTimeOffsetSeconds(rawSleepStartTime);
    const endTimezoneOffsetSeconds = resolveTimezoneOffsetSeconds(daily, 'endTimezone')
        ?? parseDateTimeOffsetSeconds(rawSleepEndTime);
    const sleepStartTimeMs = parseDateMs(
        rawSleepStartTime,
        startTimezoneOffsetSeconds ?? endTimezoneOffsetSeconds,
    );
    const sleepEndTimeMs = parseDateMs(
        rawSleepEndTime,
        endTimezoneOffsetSeconds ?? startTimezoneOffsetSeconds,
    );

    return {
        happenDay: normalizedDate?.happenDay || null,
        calendarDate: normalizedDate?.calendarDate || null,
        rawSleepStartTime,
        rawSleepEndTime,
        rawStartTimezone: boundedProviderScalar(daily.startTimezone),
        rawEndTimezone: boundedProviderScalar(daily.endTimezone),
        startTimezoneOffsetSeconds,
        endTimezoneOffsetSeconds,
        timezoneOffsetSeconds: endTimezoneOffsetSeconds ?? startTimezoneOffsetSeconds,
        sleepStartTimeMs,
        sleepEndTimeMs,
        step: nonNegativeSafeInteger(daily.step),
        calorie: nonNegativeNumber(daily.calorie),
        restingHeartRateBpm: positiveNumber(daily.rhr),
        overnightHrvMs: positiveNumber(daily.ppgHrv),
        averageSleepHeartRateBpm: positiveNumber(daily.sleepAvgHr),
        hrvPoints: parseHrvPoints(daily.hrvList),
    };
}

export function hasValidCOROSSleep(record: COROSDailyRecord): boolean {
    return record.sleepStartTimeMs !== null
        && record.sleepEndTimeMs !== null
        && record.sleepEndTimeMs > record.sleepStartTimeMs
        && record.sleepEndTimeMs - record.sleepStartTimeMs <= DAY_MS;
}

export function getCOROSDailyBounds(record: COROSDailyRecord): COROSDailyBounds | null {
    if (!record.calendarDate) return null;
    const utcMidnightMs = Date.parse(`${record.calendarDate}T00:00:00.000Z`);
    const timezoneOffsetSeconds = record.timezoneOffsetSeconds ?? 0;
    const startTimeMs = utcMidnightMs - (timezoneOffsetSeconds * 1000);
    return Number.isSafeInteger(startTimeMs)
        ? { startTimeMs, endTimeMs: startTimeMs + DAY_MS }
        : null;
}

export function getCOROSDailySleepStartTimeMs(record: COROSDailyRecord): number | null {
    const bounds = getCOROSDailyBounds(record);
    if (!bounds
        || !hasValidCOROSSleep(record)
        || record.sleepStartTimeMs === null
        || record.sleepEndTimeMs === null
        || record.sleepStartTimeMs < bounds.startTimeMs - DAY_MS
        || record.sleepEndTimeMs < bounds.startTimeMs
        || record.sleepEndTimeMs > bounds.endTimeMs) {
        return null;
    }
    return record.sleepStartTimeMs;
}

export const corosDailyTestInternals = {
    parseDateMs,
    parseTimezoneUnitOffsetSeconds,
};
