import { ActivityTypes, DataDistance, DataLatitudeDegrees, DataLongitudeDegrees, GeoLibAdapter,
    type ActivityInterface } from '@sports-alliance/sports-lib';

const geoLibAdapter = new GeoLibAdapter();

interface DistanceSource extends Partial<Pick<ActivityInterface, 'type' | 'getLaps' | 'getSwimLengths'>> {
    hasStreamData?: (type: string) => boolean;
    getStreamData?: (type: string) => unknown[];
}

/** Compare independent totals allowing only floating-point summation error. */
function sameDistance(left: number, right: number, terms: number): boolean {
    return Number.isFinite(left) && Number.isFinite(right)
        && Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * (terms + 1);
}

/** Complete, uniquely owned pool lengths and every lap must corroborate the file summary. */
function hasCorroboratedPoolDistance(activity: DistanceSource, distance: number): boolean {
    if (activity.type !== ActivityTypes.Swimming || !activity.getLaps || !activity.getSwimLengths) return false;
    const laps = activity.getLaps();
    const lengths = activity.getSwimLengths();
    if (!laps.length || !lengths.length || laps.some(lap => !Number.isSafeInteger(lap.lapId) || lap.lapId < 1)
        || new Set(laps.map(lap => lap.lapId)).size !== laps.length) return false;
    const totals = new Map(laps.map(lap => [lap.lapId, { distance: 0, count: 0 }]));
    const indexes = new Set<number>();
    const activeIntervals = new Set<string>();
    const timeline: { start: number; end: number; recordedTimer: boolean }[] = [];
    let poolLength: number | null = null;
    for (const length of lengths) {
        const total = typeof length.lapIndex === 'number' && Number.isSafeInteger(length.lapIndex)
            ? totals.get(length.lapIndex) : undefined;
        if (!Number.isSafeInteger(length.index) || length.index < 1 || indexes.has(length.index)
            || !total) return false;
        indexes.add(length.index);
        if (length.type === 'idle') {
            if (length.distance && length.distance.getValue() !== 0) return false;
            continue;
        }
        if (length.type !== 'active') return false;
        const start = length.startDate.getTime();
        const end = length.endDate.getTime();
        const interval = `${start}:${end}`;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || activeIntervals.has(interval)) return false;
        activeIntervals.add(interval);
        const timer = length.timerTime?.getValue();
        const recordedTimer = typeof timer === 'number' && Number.isFinite(timer) && timer >= 0;
        // Match the library's generated active exposure, not a timestamp that can
        // include later rest. A zero timer cannot corroborate a completed length.
        const activeEnd = recordedTimer ? Math.min(end, start + timer * 1000) : end;
        if (activeEnd <= start) return false;
        timeline.push({ start, end: activeEnd, recordedTimer });
        const metres = length.distance?.getValue();
        const pool = length.poolLength?.getValue();
        if (typeof metres !== 'number' || !Number.isFinite(metres) || metres <= 0
            || typeof pool !== 'number' || !Number.isFinite(pool) || pool <= 0
            || !sameDistance(metres, pool, 1) || (poolLength !== null && !sameDistance(pool, poolLength, 1))) return false;
        poolLength = pool;
        total.distance += metres;
        total.count++;
    }
    if (poolLength === null) return false;
    timeline.sort((left, right) => left.start - right.start);
    for (let index = 1; index < timeline.length; index++) {
        const previous = timeline[index - 1];
        const current = timeline[index];
        if (current.start >= previous.end) continue;
        // FIT start timestamps encode whole seconds while timer durations retain
        // milliseconds. Only a fractional endpoint in that same encoded second
        // can overlap; distinct fractional starts and shifted duplicates cannot.
        if (!previous.recordedTimer || current.start <= previous.start
            || previous.start % 1000 !== 0 || current.start % 1000 !== 0
            || Math.floor(previous.end / 1000) !== current.start / 1000) return false;
    }
    let lapTotal = 0;
    for (const lap of laps) {
        const metres = lap.getStat(DataDistance.type)?.getValue();
        const total = totals.get(lap.lapId)!;
        if (typeof metres !== 'number' || !Number.isFinite(metres) || metres < 0
            || !sameDistance(total.distance, metres, total.count)) return false;
        lapTotal += metres;
    }
    return sameDistance(lapTotal, distance, laps.length);
}

/** Whether regeneration needs the freshly parsed summary rather than unsupported or incomplete measurements. */
export function shouldPreserveParsedDistance(activity: DistanceSource, distance: unknown): boolean {
    if (typeof distance !== 'number' || !Number.isFinite(distance) || distance <= 0) return false;
    // A recorded pool counter may end early or begin after a completed length.
    // Its positive last-minus-first delta does not disprove a complete file total.
    if (hasCorroboratedPoolDistance(activity, distance)) return true;
    if (typeof activity.hasStreamData !== 'function' || typeof activity.getStreamData !== 'function') return true;

    // sports-lib prioritizes an existing counter over GPS, including an empty or
    // backfilled constant counter. Only a valid positive last-minus-first result
    // can replace the source summary. A reset ending at/below its start cannot.
    if (activity.hasStreamData(DataDistance.type)) {
        const values = activity.getStreamData(DataDistance.type).filter((value): value is number => typeof value === 'number');
        return values.length < 2
            || values.some(value => !Number.isFinite(value) || value < 0)
            || values[values.length - 1] <= values[0];
    }

    if (!activity.hasStreamData(DataLatitudeDegrees.type) || !activity.hasStreamData(DataLongitudeDegrees.type)) return true;
    const latitudes = activity.getStreamData(DataLatitudeDegrees.type);
    const longitudes = activity.getStreamData(DataLongitudeDegrees.type);
    const positions: { latitudeDegrees: number; longitudeDegrees: number }[] = [];
    let hasDistinctPositions = false;
    for (let index = 0; index < Math.min(latitudes.length, longitudes.length); index++) {
        const latitude = latitudes[index];
        const longitude = longitudes[index];
        if (typeof latitude !== 'number' || typeof longitude !== 'number') continue;
        if (!Number.isFinite(latitude) || Math.abs(latitude) > 90
            || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return true;
        const firstPosition = positions[0];
        if (firstPosition && (latitude !== firstPosition.latitudeDegrees || longitude !== firstPosition.longitudeDegrees)) {
            hasDistinctPositions = true;
        }
        positions.push({ latitudeDegrees: latitude, longitudeDegrees: longitude });
    }
    // One sample, stationary/default GPS, and constant counters (including a
    // single zero expanded by import backfill) cannot disprove a positive summary.
    if (!hasDistinctPositions) return true;
    // Match sports-lib's own segment precision: distinct points can still round
    // to zero. Do not invent a movement threshold or a different GPS formula.
    const calculatedDistance = geoLibAdapter.getDistance(positions);
    return !Number.isFinite(calculatedDistance) || calculatedDistance <= 0;
}
