import { describe, expect, it, vi } from 'vitest';
import { ActivityTypes, DataAscent, DataDistance, DataDuration, DistanceUnits, DynamicDataLoader } from '@sports-alliance/sports-lib/metrics';
import { FileType, Privacy } from '@sports-alliance/sports-lib';
import { AppEventSummary } from '@shared/event-summary';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { buildTrainingLogSportTotals, resolveTrainingLogWeek } from './activity-training-log.helper';

function event(id: string, types: string[], stats: Record<string, number> = {}) {
  return new AppEventSummary({ id, name: 'Synthetic activity', startDate: 0, endDate: 1,
    srcFileType: FileType.FIT, description: null, isMerge: false, privacy: Privacy.Private,
    stats: { 'Activity Types': types, ...stats } });
}

describe('Training log weeks', () => {
  it('honors the saved week start across year boundaries and rejects invalid anchors', () => {
    const now = new Date(2027, 0, 1);
    expect(resolveTrainingLogWeek(null, now, 1).dates).toEqual({ startDate: '2026-12-28', endDate: '2027-01-03' });
    expect(resolveTrainingLogWeek(null, now, 0).dates).toEqual({ startDate: '2026-12-27', endDate: '2027-01-02' });
    expect(resolveTrainingLogWeek('2026-02-30', now, 1).dates).toEqual(resolveTrainingLogWeek(null, now, 1).dates);
    expect(resolveTrainingLogWeek('2026-11-04', now, 1).dates).toEqual({ startDate: '2026-11-02', endDate: '2026-11-08' });
  });

  it('uses calendar weeks rather than fixed hours through both DST transitions', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'Europe/Helsinki';
    try {
      for (const [anchor, hours] of [['2026-03-29', 167], ['2026-10-25', 169]] as const) {
        const week = resolveTrainingLogWeek(anchor, new Date(), 1);
        expect((+week.end - +week.start) / 3_600_000).toBe(hours);
        expect(week.start.getDay()).toBe(1);
        expect(week.end.getDay()).toBe(1);
        expect(week.start.getHours()).toBe(0);
        expect(week.end.getHours()).toBe(0);
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});

describe('Training log sport totals', () => {
  it('retains recorded ascent for summaries with no sport metadata', () => {
    const summary = event('unknown', [], { Duration: 600, Distance: 1000, Ascent: 123 });
    const [total] = buildTrainingLogSportTotals([summary]);
    expect(total.sport).toBe(ActivityTypes.unknown);
    expect(total.ascent).toEqual({ value: '123 m', coverage: '' });
    expect(buildTrainingLogSportTotals([summary], null, { removeAscentForEventTypes: [ActivityTypes.unknown] })[0].ascent.value).toBe('--');
  });
  it('totals every matching recording per sport, keeping multisport together and comparisons out', () => {
    const stats = { [DataDuration.type]: 3600, [DataDistance.type]: 10_000, [DataAscent.type]: 100 };
    const runs = Array.from({ length: 26 }, (_, index) => event(`run-${index}`, [ActivityTypes.Running], stats));
    const merged = event('comparison', [ActivityTypes.Running], stats); merged.isMerge = true;
    const benchmark = event('benchmark', [ActivityTypes.Running], stats); benchmark.hasBenchmark = true;
    const totals = buildTrainingLogSportTotals([...runs, merged, benchmark,
      event('ride', [ActivityTypes.Cycling], stats), event('multi', [ActivityTypes.Running, ActivityTypes.Cycling], stats),
    ]);
    expect(totals.map(total => [total.sport, total.count])).toEqual([['Cycling', 1], ['Multisport', 1], ['Running', 26]]);
    expect(totals[2].distance.value).toBe('260.00 Km');
    expect(totals[2].ascent.value).toBe('2,600 m');
    expect(totals[2].duration.value).not.toBe('--');
  });

  it('distinguishes zero, missing and partial readings, with unit-aware display and exclusions', () => {
    const zero = event('zero', [ActivityTypes.Running], { Distance: 0, Duration: 0, Ascent: 0 });
    const missing = event('missing', [ActivityTypes.Running]);
    const [partial] = buildTrainingLogSportTotals([zero, missing]);
    expect(partial.distance).toEqual({ value: '0.0 m', coverage: '1/2 activities' });
    expect(partial.duration.coverage).toBe('1/2 activities');
    expect(buildTrainingLogSportTotals([missing])[0].distance.value).toBe('--');
    expect(buildTrainingLogSportTotals([])).toEqual([]);
    const run = event('run', [ActivityTypes.Running], { Distance: 10_000, Ascent: 100 });
    const [imperial] = buildTrainingLogSportTotals([run], normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles }));
    expect(imperial.distance.value).toBe('6.22 mi');
    expect(imperial.ascent.value).toBe('100 m');
    expect(buildTrainingLogSportTotals([run], null, { removeAscentForEventTypes: [ActivityTypes.Running] })[0].ascent.value).toBe('--');
    expect(buildTrainingLogSportTotals([event('ski', [ActivityTypes.AlpineSki], { Ascent: 100 })])[0].ascent.value).toBe('--');
  });

  it('reads only the required summary metrics and notices in-place changes', () => {
    const construct = vi.spyOn(DynamicDataLoader, 'getDataInstanceFromDataType');
    const run = event('run', [ActivityTypes.Running], { Distance: 1000, 'Average Cadence': 170 });
    const read = vi.spyOn(run, 'getStat');
    expect(buildTrainingLogSportTotals([run])[0].distance.value).toBe('1.00 Km');
    run.getStat<number>(DataDistance.type)!.setValue(2000);
    expect(buildTrainingLogSportTotals([run])[0].distance.value).toBe('2.00 Km');
    expect(new Set(read.mock.calls.map(([type]) => type))).toEqual(new Set(['Duration', 'Distance', 'Ascent']));
    expect(construct).not.toHaveBeenCalledWith('Average Cadence', expect.anything());
    construct.mockRestore();
  });
});
