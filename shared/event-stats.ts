export const EVENT_STATS_COLLECTION_ID = 'stats';
export const EVENT_STATS_DOC_ID = 'events';
export const EVENT_STATS_KIND = 'events';
export const EVENT_STATS_SCHEMA_VERSION = 1;
export const EVENT_STATS_PROCESSED_WRITES_COLLECTION = 'eventStatsProcessedWrites';

export type EventStatsClassification = 'standard' | 'benchmark';

export interface EventStatsCounts {
    total: number;
    standard: number;
    benchmark: number;
}

export interface EventStatsDelta {
    total: number;
    standard: number;
    benchmark: number;
}

export interface EventStatsDocument extends EventStatsCounts {
    kind: typeof EVENT_STATS_KIND;
    schemaVersion: typeof EVENT_STATS_SCHEMA_VERSION;
    backfilledAt?: unknown;
    backfillCutoffAt?: unknown;
    updatedAt?: unknown;
}

function toNonNegativeInteger(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 0;
    }

    return Math.max(0, Math.floor(value));
}

function toInteger(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 0;
    }

    return Math.trunc(value);
}

export function classifyEventForStats(eventData: Record<string, unknown> | null | undefined): EventStatsClassification {
    if (!eventData) {
        return 'standard';
    }

    const mergeType = typeof eventData.mergeType === 'string'
        ? eventData.mergeType.trim().toLowerCase()
        : '';

    if (mergeType === 'benchmark') {
        return 'benchmark';
    }

    if (eventData.isMerge === true) {
        return 'benchmark';
    }

    return 'standard';
}

export function isBenchmarkEventForStats(eventData: Record<string, unknown> | null | undefined): boolean {
    return classifyEventForStats(eventData) === 'benchmark';
}

export function normalizeEventStatsCounts(value: Record<string, unknown> | null | undefined): EventStatsCounts {
    return {
        total: toNonNegativeInteger(value?.total),
        standard: toNonNegativeInteger(value?.standard),
        benchmark: toNonNegativeInteger(value?.benchmark),
    };
}

export function normalizeEventStatsDelta(value: Record<string, unknown> | null | undefined): EventStatsDelta {
    return {
        total: toInteger(value?.total),
        standard: toInteger(value?.standard),
        benchmark: toInteger(value?.benchmark),
    };
}

export function applyEventStatsDelta(current: EventStatsCounts, delta: EventStatsDelta): EventStatsCounts {
    return {
        total: Math.max(0, current.total + delta.total),
        standard: Math.max(0, current.standard + delta.standard),
        benchmark: Math.max(0, current.benchmark + delta.benchmark),
    };
}

export function hasExactEventStats(value: Record<string, unknown> | null | undefined): boolean {
    return value?.kind === EVENT_STATS_KIND
        && value?.schemaVersion === EVENT_STATS_SCHEMA_VERSION
        && !!value.backfilledAt;
}
