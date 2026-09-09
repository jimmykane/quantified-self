export type AdminHistoryDisplayMode = 'count' | 'percentage';
export type AdminHistoryPlanBasis = 'withinPlan' | 'activeShare';

/** Undefined denominators are unavailable, including an empty population. */
export function adminHistoryPercentage(count: number | null | undefined, total: number | null | undefined): number | null {
    if (typeof count !== 'number' || typeof total !== 'number'
        || !Number.isFinite(count) || !Number.isFinite(total) || count < 0 || total <= 0 || count > total) {
        return null;
    }
    return count / total * 100;
}

const percentageFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const countFormat = new Intl.NumberFormat('en-US');

export function formatAdminHistoryPercentage(value: number): string {
    return `${percentageFormat.format(value)}%`;
}

export function formatAdminHistoryRatio(count: number, total: number | null | undefined, population: string): string {
    const percentage = adminHistoryPercentage(count, total);
    if (percentage === null) {
        return `${countFormat.format(count)} users · percentage unavailable${total === 0 ? ` (0 ${population})` : ''}`;
    }
    return `${formatAdminHistoryPercentage(percentage)} · ${countFormat.format(count)} of ${countFormat.format(total!)} ${population}`;
}
