export type AdminHistoryScale = 'auto' | 'zero';

/** Fit visible, unstacked series; count ticks stay integral and percentage bounds stay inside 0–100. */
export function buildAdminHistoryAxisBounds(
    series: ReadonlyArray<ReadonlyArray<number | null>>,
    scale: AdminHistoryScale,
    mode: 'count' | 'percentage' = 'count',
): { min: number; max: number; interval: number } {
    const percentage = mode === 'percentage';
    if (percentage && scale === 'zero') {
        return { min: 0, max: 100, interval: 20 };
    }
    let min = Infinity;
    let max = -Infinity;
    for (const values of series) {
        for (const value of values) {
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (percentage && value > 100)) {
                continue;
            }
            min = Math.min(min, value);
            max = Math.max(max, value);
        }
    }
    if (!Number.isFinite(min)) {
        return percentage ? { min: 0, max: 100, interval: 20 } : { min: 0, max: 1, interval: 1 };
    }

    const lower = scale === 'zero' ? 0 : min;
    const smallestStep = percentage ? 0.1 : 1;
    const padding = Math.max(smallestStep, (max - lower) * 0.1);
    const targetInterval = Math.max(smallestStep, (max - lower + 2 * padding) / 5);
    const magnitude = 10 ** Math.floor(Math.log10(targetInterval));
    const step = [1, 2, 5, 10].find(value => value * magnitude >= targetInterval) ?? 10;
    const interval = step * magnitude;

    return {
        min: scale === 'zero' ? 0 : Math.max(0, Math.floor((min - padding) / interval) * interval),
        max: Math.min(percentage ? 100 : Infinity, Math.ceil((max + padding) / interval) * interval),
        interval,
    };
}
