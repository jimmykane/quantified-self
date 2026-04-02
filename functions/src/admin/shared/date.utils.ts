const DEFAULT_SUBSCRIPTION_HISTORY_MONTHS = 12;
const MAX_SUBSCRIPTION_HISTORY_MONTHS = 24;
const DEFAULT_LIST_USERS_PAGE_SIZE = 10;
const MAX_LIST_USERS_PAGE_SIZE = 50;

export function toSafeNumber(value: unknown, fallback: number = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function clampSubscriptionHistoryMonths(rawMonths: unknown): number {
    const parsed = Number(rawMonths);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_SUBSCRIPTION_HISTORY_MONTHS;
    }
    const normalized = Math.floor(parsed);
    if (normalized < 1) {
        return 1;
    }
    if (normalized > MAX_SUBSCRIPTION_HISTORY_MONTHS) {
        return MAX_SUBSCRIPTION_HISTORY_MONTHS;
    }
    return normalized;
}

export function clampListUsersPageSize(rawPageSize: unknown): number {
    if (rawPageSize === null || rawPageSize === undefined || rawPageSize === '') {
        return DEFAULT_LIST_USERS_PAGE_SIZE;
    }

    const parsed = Number.parseInt(String(rawPageSize), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return DEFAULT_LIST_USERS_PAGE_SIZE;
    }

    return Math.min(parsed, MAX_LIST_USERS_PAGE_SIZE);
}

function normalizeEpochNumberToMillis(value: number): number | null {
    if (!Number.isFinite(value) || value <= 0) {
        return null;
    }

    if (value > 1e12) {
        return Math.trunc(value);
    }

    if (value > 1e9) {
        return Math.trunc(value * 1000);
    }

    return null;
}

export function toEpochMillis(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === 'number') {
        return normalizeEpochNumberToMillis(value);
    }

    if (typeof value === 'string') {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return normalizeEpochNumberToMillis(numeric);
        }
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
    }

    if (value instanceof Date) {
        const parsed = value.getTime();
        return Number.isNaN(parsed) ? null : parsed;
    }

    if (typeof value === 'object') {
        const timestamp = value as {
            toMillis?: () => number;
            toDate?: () => Date;
            seconds?: unknown;
            _seconds?: unknown;
            nanoseconds?: unknown;
            _nanoseconds?: unknown;
        };

        if (typeof timestamp.toMillis === 'function') {
            const millis = timestamp.toMillis();
            return Number.isFinite(millis) ? millis : null;
        }

        if (typeof timestamp.toDate === 'function') {
            const date = timestamp.toDate();
            const millis = date.getTime();
            return Number.isFinite(millis) ? millis : null;
        }

        const rawSeconds = timestamp.seconds ?? timestamp._seconds;
        if (rawSeconds !== undefined && rawSeconds !== null) {
            const seconds = Number(rawSeconds);
            if (!Number.isFinite(seconds)) {
                return null;
            }
            const rawNanos = timestamp.nanoseconds ?? timestamp._nanoseconds;
            const nanos = Number(rawNanos);
            const extraMillis = Number.isFinite(nanos) ? Math.floor(nanos / 1_000_000) : 0;
            return (seconds * 1000) + extraMillis;
        }
    }

    return null;
}

export function toUtcMonthKey(epochMillis: number): string {
    const date = new Date(epochMillis);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function formatUtcMonthLabel(epochMillis: number): string {
    return new Date(epochMillis).toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC'
    });
}

export function buildMonthlyBucketWindows(months: number, now: Date): Array<{ key: string; label: string; startMs: number; endMs: number }> {
    const currentMonthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
    const firstMonthStartDate = new Date(currentMonthStartMs);
    firstMonthStartDate.setUTCMonth(firstMonthStartDate.getUTCMonth() - (months - 1));

    const windows: Array<{ key: string; label: string; startMs: number; endMs: number }> = [];

    for (let index = 0; index < months; index++) {
        const monthStartDate = new Date(Date.UTC(
            firstMonthStartDate.getUTCFullYear(),
            firstMonthStartDate.getUTCMonth() + index,
            1
        ));
        const nextMonthStartDate = new Date(Date.UTC(
            firstMonthStartDate.getUTCFullYear(),
            firstMonthStartDate.getUTCMonth() + index + 1,
            1
        ));
        const startMs = monthStartDate.getTime();
        windows.push({
            key: toUtcMonthKey(startMs),
            label: formatUtcMonthLabel(startMs),
            startMs,
            endMs: nextMonthStartDate.getTime()
        });
    }

    return windows;
}
