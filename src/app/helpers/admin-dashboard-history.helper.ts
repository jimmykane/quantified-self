import type {
    AdminDashboardHistoryDays,
    AdminDashboardHistoryPoint,
    AdminDashboardHistoryResponse,
} from '../services/admin.service';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
export const ADMIN_DASHBOARD_HISTORY_MINIMUM_POINTS = 8;
export const ADMIN_DASHBOARD_HISTORY_STALE_AFTER_HOURS = 36;

export interface AdminDashboardHistoryTimelinePoint {
    date: string;
    snapshot: AdminDashboardHistoryPoint | null;
}

export interface AdminDashboardHistoryView {
    observed: AdminDashboardHistoryPoint[];
    timeline: AdminDashboardHistoryTimelinePoint[];
    availablePoints: number;
    missingDays: number;
    latestSnapshot: AdminDashboardHistoryPoint | null;
    isStale: boolean;
    hasUnknownCadence: boolean;
}

export function buildAdminDashboardHistoryView(
    history: AdminDashboardHistoryResponse | null,
    days: AdminDashboardHistoryDays,
    nowMs: number = Date.now(),
): AdminDashboardHistoryView {
    if (!history) {
        return emptyHistoryView();
    }

    const endDateMs = parseUtcDateKey(history.endDate);
    if (endDateMs === null) {
        return emptyHistoryView();
    }

    const startDate = toUtcDateKey(endDateMs - ((days - 1) * MILLISECONDS_PER_DAY));
    const observed = history.snapshots
        .filter(snapshot => snapshot.date >= startDate && snapshot.date <= history.endDate)
        .slice()
        .sort((left, right) => left.date.localeCompare(right.date));
    const latestSnapshot = observed.at(-1) ?? null;

    if (!latestSnapshot) {
        return emptyHistoryView();
    }

    const firstDateMs = parseUtcDateKey(observed[0].date);
    const latestDateMs = parseUtcDateKey(latestSnapshot.date);
    if (firstDateMs === null || latestDateMs === null) {
        return emptyHistoryView();
    }

    const byDate = new Map(observed.map(snapshot => [snapshot.date, snapshot]));
    const timeline: AdminDashboardHistoryTimelinePoint[] = [];
    for (let dateMs = firstDateMs; dateMs <= latestDateMs; dateMs += MILLISECONDS_PER_DAY) {
        const date = toUtcDateKey(dateMs);
        timeline.push({ date, snapshot: byDate.get(date) ?? null });
    }

    const latestComputedAtMs = Date.parse(latestSnapshot.computedAt);
    const staleAfterMs = ADMIN_DASHBOARD_HISTORY_STALE_AFTER_HOURS * 60 * 60 * 1000;

    return {
        observed,
        timeline,
        availablePoints: observed.length,
        missingDays: timeline.length - observed.length,
        latestSnapshot,
        isStale: Number.isFinite(latestComputedAtMs) && nowMs - latestComputedAtMs > staleAfterMs,
        hasUnknownCadence: observed.some(snapshot => (
            snapshot.subscriptionCadence.pro.unknown > 0
            || snapshot.subscriptionCadence.basic.unknown > 0
        )),
    };
}

function emptyHistoryView(): AdminDashboardHistoryView {
    return {
        observed: [],
        timeline: [],
        availablePoints: 0,
        missingDays: 0,
        latestSnapshot: null,
        isStale: false,
        hasUnknownCadence: false,
    };
}

function parseUtcDateKey(value: string): number | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return null;
    }
    const parsed = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed) && toUtcDateKey(parsed) === value ? parsed : null;
}

function toUtcDateKey(value: number): string {
    return new Date(value).toISOString().slice(0, 10);
}
