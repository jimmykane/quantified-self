import { describe, expect, it } from 'vitest';
import { DataDistance, DataLatitudeDegrees, DataLongitudeDegrees } from '@sports-alliance/sports-lib';
import { shouldPreserveParsedDistance } from './regeneration-distance';

const source = (streams: Record<string, unknown[]> = {}) => ({
    hasStreamData: (type: string) => Object.hasOwn(streams, type),
    getStreamData: (type: string) => streams[type],
});
const gps = (latitudes: unknown[], longitudes: unknown[]) => ({
    [DataLatitudeDegrees.type]: latitudes,
    [DataLongitudeDegrees.type]: longitudes,
});

describe('shouldPreserveParsedDistance', () => {
    it.each([undefined, null, 0, -1, NaN, Infinity, '100'])('does not protect a missing, zero or invalid summary: %s', value => {
        expect(shouldPreserveParsedDistance(source(), value)).toBe(false);
    });

    it('preserves a positive source summary without measurements or optional stream methods', () => {
        expect(shouldPreserveParsedDistance(source(), 100)).toBe(true);
        expect(shouldPreserveParsedDistance({}, 100)).toBe(true);
    });

    it.each([
        [], [null, null], [0], [0, 0, 0], [12, 12], [0, 100, 0], [100, 200, 50],
        [0, NaN, 100], [0, Infinity], [-10, 100],
    ].map(values => ({ values })))('preserves source distance when a counter cannot support recalculation: $values', ({ values }) => {
        expect(shouldPreserveParsedDistance(source({ [DataDistance.type]: values }), 1000)).toBe(true);
    });

    it.each([[0, 100], [10, null, 110], [10, 100, 20]].map(values => ({ values })))('allows positive finite last-minus-first counter regeneration: $values', ({ values }) => {
        expect(shouldPreserveParsedDistance(source({ [DataDistance.type]: values }), 1000)).toBe(false);
    });

    it.each([
        gps([60], [24]), gps([60, 60], [24, 24]), gps([0, 0], [0, 0]),
        gps([60, null, 61, null], [null, 24, null, 25]),
        gps([60, NaN, Infinity, 91], [24, 25, 26, 27]), gps([60, 61], [24, 181]),
        gps([60, NaN, 61], [24, 25, 26]), gps([60, 91, 61], [24, 25, 26]),
        gps([0, 0.000000001], [0, 0]),
        { [DataLatitudeDegrees.type]: [60, 61] },
    ])('preserves source distance without two distinct valid aligned positions: %j', streams => {
        expect(shouldPreserveParsedDistance(source(streams), 1000)).toBe(true);
    });

    it.each([gps([60, 60.001], [24, 24]), gps([0, 0], [0, 0.001]), gps([60, null, 61], [24, null, 25])])(
        'allows GPS regeneration from distinct paired coordinates: %j', streams => {
            expect(shouldPreserveParsedDistance(source(streams), 1000)).toBe(false);
        });

    it('honors library counter precedence when GPS moves but its existing counter has no displacement', () => {
        expect(shouldPreserveParsedDistance(source({ ...gps([60, 61], [24, 25]), [DataDistance.type]: [0, 0] }), 1000)).toBe(true);
    });
});
