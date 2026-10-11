import { DataDistance, DataLatitudeDegrees, DataLongitudeDegrees, GeoLibAdapter } from '@sports-alliance/sports-lib';

const geoLibAdapter = new GeoLibAdapter();

interface DistanceSource {
    hasStreamData?: (type: string) => boolean;
    getStreamData?: (type: string) => unknown[];
}

/** Whether regeneration needs the freshly parsed summary rather than an unsupported zero. */
export function shouldPreserveParsedDistance(activity: DistanceSource, distance: unknown): boolean {
    if (typeof distance !== 'number' || !Number.isFinite(distance) || distance <= 0) return false;
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
