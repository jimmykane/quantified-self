export type EventTrainingClassification = 'standard' | 'benchmark';

export function classifyEventForTrainingMetrics(
    eventData: Record<string, unknown> | null | undefined
): EventTrainingClassification {
    if (!eventData) {
        return 'standard';
    }

    const mergeType = typeof eventData.mergeType === 'string'
        ? eventData.mergeType.trim().toLowerCase()
        : '';

    if (mergeType === 'benchmark') {
        return 'benchmark';
    }

    if (mergeType === 'multi') {
        return 'standard';
    }

    if (eventData.isMerge === true) {
        return 'benchmark';
    }

    return 'standard';
}

export function isBenchmarkEventForTrainingMetrics(
    eventData: Record<string, unknown> | null | undefined
): boolean {
    return classifyEventForTrainingMetrics(eventData) === 'benchmark';
}
