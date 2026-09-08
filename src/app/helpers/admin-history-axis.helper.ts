export type AdminHistoryScale = 'auto' | 'zero';

/** Fit the visible, unstacked user counts, retaining whole-user ticks and a little breathing room. */
export function buildAdminHistoryAxisBounds(
    series: ReadonlyArray<ReadonlyArray<number | null>>,
    scale: AdminHistoryScale,
): { min: number; max: number; interval: number } {
    let min = Infinity;
    let max = -Infinity;
    for (const values of series) {
        for (const value of values) {
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
                continue;
            }
            min = Math.min(min, value);
            max = Math.max(max, value);
        }
    }
    if (!Number.isFinite(min)) {
        return { min: 0, max: 1, interval: 1 };
    }

    const lower = scale === 'zero' ? 0 : min;
    const padding = Math.max(1, (max - lower) * 0.1);
    const targetInterval = Math.max(1, (max - lower + 2 * padding) / 5);
    const magnitude = 10 ** Math.floor(Math.log10(targetInterval));
    const step = [1, 2, 5, 10].find(value => value * magnitude >= targetInterval) ?? 10;
    const interval = step * magnitude;

    return {
        min: scale === 'zero' ? 0 : Math.max(0, Math.floor((min - padding) / interval) * interval),
        max: Math.ceil((max + padding) / interval) * interval,
        interval,
    };
}
