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

export function formatAdminHistoryTooltipValue(
    count: number | undefined,
    total: number | null | undefined,
    population: string,
    mode: AdminHistoryDisplayMode,
): { value: string; detail?: string } {
    if (count === undefined) {
        return { value: 'Unavailable' };
    }
    const users = `${countFormat.format(count)} ${count === 1 ? 'user' : 'users'}`;
    const percentage = adminHistoryPercentage(count, total);
    if (percentage === null) {
        const reason = total === 0 ? `0 ${population}` : `${population} unavailable`;
        return {
            value: mode === 'count' ? users : 'Unavailable',
            detail: `${mode === 'percentage' ? `${users} · ` : ''}Percentage unavailable (${reason})`,
        };
    }
    const formattedPercentage = formatAdminHistoryPercentage(percentage);
    return {
        value: mode === 'percentage' ? formattedPercentage : users,
        detail: `${mode === 'percentage' ? countFormat.format(count) : formattedPercentage} of ${countFormat.format(total!)} ${population}`,
    };
}
