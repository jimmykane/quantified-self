import { describe, expect, it, vi } from 'vitest';
import { ActivityTypes, DataDistance, DataDuration, DataLatitudeDegrees, DataLongitudeDegrees,
    EventImporterJSON, LapTypes, SwimLength } from '@sports-alliance/sports-lib';
import { shouldPreserveParsedDistance } from './regeneration-distance';

vi.unmock('@sports-alliance/sports-lib');

const source = (streams: Record<string, unknown[]> = {}) => ({
    hasStreamData: (type: string) => Object.hasOwn(streams, type),
    getStreamData: (type: string) => streams[type],
});
const gps = (latitudes: unknown[], longitudes: unknown[]) => ({
    [DataLatitudeDegrees.type]: latitudes,
    [DataLongitudeDegrees.type]: longitudes,
});

const pool = (counter: number[] = [0, 100], poolLength = 25) => {
    const start = new Date('2026-01-01T10:00:00Z');
    const end = new Date(+start + 300000);
    const activity = EventImporterJSON.getActivityFromJSON({
        name: null, startDate: +start, endDate: +end, type: ActivityTypes.Swimming,
        creator: { name: 'Synthetic', devices: [] }, powerMeter: false, trainer: false,
        stats: {}, streams: { [DataDistance.type]: counter }, intensityZones: [], events: [],
        laps: [{ lapId: 1, startDate: +start, endDate: +end, startIndex: null, endIndex: null,
            type: LapTypes.Manual, stats: { [DataDistance.type]: poolLength * 10 } }],
    });
    for (let index = 0; index < 10; index++) activity.addSwimLength(new SwimLength({
        index: index + 1, lapIndex: 1, startDate: new Date(+start + index * 30000),
        endDate: new Date(+start + (index + 1) * 30000), type: 'active', stroke: null, strokes: null,
        elapsedTime: null, timerTime: null, distance: new DataDistance(poolLength),
        poolLength: new DataDistance(poolLength), avgSpeed: null, avgCadence: null, avgHeartRate: null,
        maxHeartRate: null, swolf: null, calories: null,
    }));
    return activity;
};

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

    it.each([{ counter: [0, 100], reason: 'ends early' }, { counter: [25, 250], reason: 'starts after the first length' }])(
        'preserves independently corroborated pool distance when its counter $reason', ({ counter }) => {
            expect(shouldPreserveParsedDistance(pool(counter), 250)).toBe(true);
        });

    it('accepts only floating-point summation noise in otherwise agreeing pool totals', () => {
        expect(shouldPreserveParsedDistance(pool([0, 100], 22.86), 228.6)).toBe(true);
        expect(shouldPreserveParsedDistance(pool([0, 100], 22.86), 228.61)).toBe(false);
    });

    it.each([null, 0])('allows an owned idle length with no added distance: %s', distance => {
        const activity = pool();
        const idle = new SwimLength({ ...activity.getSwimLengths()[0], index: 11, type: 'idle',
            distance: distance === null ? null : new DataDistance(distance) });
        activity.addSwimLength(idle);
        expect(shouldPreserveParsedDistance(activity, 250)).toBe(true);
    });

    it('uses the recorded active timer when a length timestamp includes later rest', () => {
        const activity = pool();
        const first = activity.getSwimLengths()[0];
        first.endDate = new Date(+first.startDate + 45000);
        first.timerTime = new DataDuration(30);
        expect(shouldPreserveParsedDistance(activity, 250)).toBe(true);
    });

    it('allows only recorded timer fractions within the next whole-second FIT boundary', () => {
        const activity = pool();
        const [first, second] = activity.getSwimLengths();
        first.endDate = new Date(+first.startDate + 30500);
        first.timerTime = new DataDuration(30.5);
        expect(shouldPreserveParsedDistance(activity, 250)).toBe(true);
        second.startDate = new Date(+second.startDate + 250);
        expect(shouldPreserveParsedDistance(activity, 250)).toBe(false);
        second.startDate = new Date(+second.startDate - 250);
        first.endDate = new Date(+first.startDate + 31000);
        first.timerTime = new DataDuration(31);
        expect(shouldPreserveParsedDistance(activity, 250)).toBe(false);
    });

    it.each([
        'different-sport', 'no-lengths', 'no-laps', 'missing-lap-distance', 'incomplete-lengths',
        'contradictory-lap-distance', 'contradictory-length-distance', 'missing-pool-length',
        'different-pool-length', 'unknown-length-type', 'ambiguous-lap', 'missing-lap',
        'duplicate-length', 'duplicate-lap', 'rest-distance', 'duplicate-active-interval',
        'invalid-active-start', 'invalid-active-end', 'zero-active-interval', 'reversed-active-interval',
        'shifted-active-overlap', 'same-active-start', 'zero-active-timer',
    ] as const)('does not protect a pool summary without complete independent evidence: %s', problem => {
        const activity = pool();
        const lengths = activity.getSwimLengths();
        const laps = activity.getLaps();
        if (problem === 'different-sport') activity.type = ActivityTypes.OpenWaterSwimming;
        if (problem === 'no-lengths') activity.getSwimLengths = () => [];
        if (problem === 'no-laps') activity.getLaps = () => [];
        if (problem === 'missing-lap-distance') laps[0].removeStat(DataDistance.type);
        if (problem === 'incomplete-lengths') activity.getSwimLengths = () => lengths.slice(1);
        if (problem === 'contradictory-lap-distance') laps[0].addStat(new DataDistance(225));
        if (problem === 'contradictory-length-distance') lengths[0].distance = new DataDistance(50);
        if (problem === 'missing-pool-length') lengths[0].poolLength = null;
        if (problem === 'different-pool-length') {
            lengths[0].poolLength = new DataDistance(50);
            lengths[0].distance = new DataDistance(50);
        }
        if (problem === 'unknown-length-type') lengths[0].type = 'unknown';
        if (problem === 'ambiguous-lap') lengths[0].lapIndex = null;
        if (problem === 'missing-lap') lengths[0].lapIndex = 2;
        if (problem === 'duplicate-length') lengths[0].index = lengths[1].index;
        if (problem === 'duplicate-active-interval') {
            lengths[0].startDate = lengths[1].startDate;
            lengths[0].endDate = lengths[1].endDate;
        }
        if (problem === 'invalid-active-start') lengths[0].startDate = new Date(NaN);
        if (problem === 'invalid-active-end') lengths[0].endDate = new Date(NaN);
        if (problem === 'zero-active-interval') lengths[0].endDate = lengths[0].startDate;
        if (problem === 'reversed-active-interval') lengths[0].endDate = new Date(+lengths[0].startDate - 1);
        if (problem === 'shifted-active-overlap') {
            lengths[1].startDate = new Date(+lengths[0].startDate + 15000);
            lengths[1].endDate = new Date(+lengths[0].startDate + 45000);
            lengths[0].timerTime = lengths[1].timerTime = new DataDuration(30);
        }
        if (problem === 'same-active-start') {
            lengths[1].startDate = lengths[0].startDate;
            lengths[0].timerTime = new DataDuration(0.5);
        }
        if (problem === 'zero-active-timer') lengths[0].timerTime = new DataDuration(0);
        if (problem === 'duplicate-lap') activity.getLaps = () => [laps[0], laps[0]];
        if (problem === 'rest-distance') lengths[0].type = 'idle';
        expect(shouldPreserveParsedDistance(activity, 250)).toBe(false);
    });

    it('requires each lap to agree, not just the whole-workout total', () => {
        const activity = pool();
        const first = activity.getLaps()[0];
        first.addStat(new DataDistance(100));
        const second = EventImporterJSON.getLapFromJSON({ ...first.toJSON(), stats: { [DataDistance.type]: 150 } }, 1);
        activity.addLap(second);
        activity.getSwimLengths().slice(5).forEach(length => length.lapIndex = 2);
        expect(shouldPreserveParsedDistance(activity, 250)).toBe(false);
        first.addStat(new DataDistance(125));
        second.addStat(new DataDistance(125));
        expect(shouldPreserveParsedDistance(activity, 250)).toBe(true);
    });
});
