import { DataDistance, DataEnergy, EventInterface } from '@sports-alliance/sports-lib';

const finiteNonnegative = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * Capture distinct parent observations immediately after parsing one original file.
 * Never call this on a stored/hydrated event or a merged event. A value identical to
 * the child sum is not independent evidence and must remain free to regenerate.
 * The returned closure restores only to the same event and unchanged source legs;
 * it never copies parent totals into legs or preserves an old Firestore summary.
 */
export function preserveFreshSourceEventSummary(
    event: EventInterface,
    parsedEvents: EventInterface[],
    wasMerged: boolean,
): () => void {
    if (wasMerged || event.isMerge || parsedEvents.length !== 1 || parsedEvents[0] !== event) return () => {};
    const activities = event.getActivities().map(activity => ({
        activity, start: activity.startDate?.getTime(), end: activity.endDate?.getTime(), type: activity.type,
    }));
    if (!activities.length || activities.some(item => !Number.isFinite(item.start) || !Number.isFinite(item.end))) return () => {};
    const observations = [DataDistance, DataEnergy].flatMap(DataClass => {
        const value = event.getStat?.(DataClass.type)?.getValue();
        if (!finiteNonnegative(value)) return [];
        const childValues = activities.map(({ activity }) => activity.getStat(DataClass.type)?.getValue());
        if (childValues.every(finiteNonnegative) && childValues.reduce((sum, child) => sum + child, 0) === value) return [];
        return [new DataClass(value)];
    });
    return () => {
        const current = event.getActivities();
        if (event.isMerge || current.length !== activities.length || activities.some((source, index) =>
            current[index] !== source.activity || current[index].startDate.getTime() !== source.start
            || current[index].endDate.getTime() !== source.end || current[index].type !== source.type)) return;
        observations.forEach(stat => event.addStat(stat));
    };
}
