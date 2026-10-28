import { describe, expect, it, vi } from 'vitest';
import { DataDistance, DataEnergy, EventImporterJSON, EventUtilities } from '@sports-alliance/sports-lib';
import { preserveFreshSourceEventSummary } from './source-event-summary';

function source(distance = 54900, energy: number | undefined = 200) {
    return EventImporterJSON.getEventFromJSON({ name: 'Synthetic source', startDate: 0, endDate: 10000,
        stats: { Distance: distance, ...(energy === undefined ? {} : { Energy: energy }) },
        activities: [{ startDate: 0, endDate: 10000, type: 'Running', creator: { name: 'Test' },
            // These tests exercise parent distance/energy preservation, with a
            // complete source clock supported by the published library too.
            stats: { Distance: 0, Duration: 10, 'Timer time': 10, 'Elapsed time': 10, 'Pause Time': 0 },
            laps: [], streams: [], intensityZones: [] }] } as any);
}

describe('fresh parent-only source summaries', () => {
    it('retains independent parent observations without distributing them to legs', () => {
        const event = source();
        const restore = preserveFreshSourceEventSummary(event, [event], false);
        EventUtilities.reGenerateStatsForEvent(event);
        restore();
        expect(event.getStat(DataDistance.type)?.getValue()).toBe(54900);
        expect(event.getStat(DataEnergy.type)?.getValue()).toBe(200);
        expect(event.getFirstActivity().getDistance()?.getValue()).toBe(0);
        expect(event.getFirstActivity().getStat(DataEnergy.type)).toBeUndefined();
    });

    it('retains a parent-only multisport total without assigning the remainder to either leg', () => {
        const event = source();
        event.getFirstActivity().addStat(new DataDistance(1000));
        const second = source().getFirstActivity();
        second.startDate = new Date(10000);
        second.endDate = new Date(20000);
        second.addStat(new DataDistance(2000));
        event.addActivity(second);
        const restore = preserveFreshSourceEventSummary(event, [event], false);
        EventUtilities.reGenerateStatsForEvent(event);
        restore();
        expect(event.getDistance()?.getValue()).toBe(54900);
        expect(event.getActivities().map(activity => activity.getDistance()?.getValue())).toEqual([1000, 2000]);
    });

    it('leaves a missing parent observation available for regeneration', () => {
        const event = source();
        event.removeStat(DataDistance.type);
        event.removeStat(DataEnergy.type);
        const restore = preserveFreshSourceEventSummary(event, [event], false);
        event.getFirstActivity().addStat(new DataDistance(100));
        event.getFirstActivity().addStat(new DataEnergy(50));
        EventUtilities.reGenerateStatsForEvent(event);
        restore();
        expect(event.getDistance()?.getValue()).toBe(100);
        expect(event.getStat(DataEnergy.type)?.getValue()).toBe(50);
    });

    it('keeps source zero but does not freeze a generated child sum', () => {
        const event = source(0, 0);
        event.getFirstActivity().addStat(new DataEnergy(50));
        const restore = preserveFreshSourceEventSummary(event, [event], false);
        event.getFirstActivity().addStat(new DataDistance(100));
        EventUtilities.reGenerateStatsForEvent(event);
        restore();
        expect(event.getDistance()?.getValue()).toBe(100);
        expect(event.getStat(DataEnergy.type)?.getValue()).toBe(0);
    });

    it.each([-1, NaN, Infinity])('does not retain invalid source values %p', value => {
        const event = source();
        vi.spyOn(event, 'getStat').mockReturnValue({ getValue: () => value } as any);
        const restore = preserveFreshSourceEventSummary(event, [event], false);
        vi.restoreAllMocks();
        EventUtilities.reGenerateStatsForEvent(event);
        restore();
        expect(event.getDistance()?.getValue()).toBe(0);
        expect(event.getStat(DataEnergy.type)).toBeUndefined();
    });

    it.each(['stored-merge', 'parsed-merge', 'multiple-sources', 'different-event', 'changed-leg', 'changed-window', 'changed-type'])('refuses preservation outside its source scope: %s', reason => {
            const event = source();
            if (reason === 'parsed-merge') event.isMerge = true;
            const parsed = reason === 'multiple-sources' ? [event, source()] : reason === 'different-event' ? [source()] : [event];
            const restore = preserveFreshSourceEventSummary(event, parsed, reason === 'stored-merge');
            if (reason === 'changed-leg') event.addActivity(source().getFirstActivity());
            if (reason === 'changed-window') event.getFirstActivity().endDate = new Date(5000);
            if (reason === 'changed-type') event.getFirstActivity().type = 'Cycling' as any;
            EventUtilities.reGenerateStatsForEvent(event);
            restore();
            expect(event.getDistance()?.getValue()).toBe(0);
        });
});
