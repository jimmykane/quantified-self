import {
  ActivityTypes,
  DataActivityTypes,
  DataCadence,
  DataCadenceAvg,
  DataStrokeRate,
  DataStrokeRateAvg,
  EventImporterJSON,
  LapTypes,
  type EventJSONInterface,
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  canonicalizePersistedSportsLibStats,
  getPersistedEventActivityTypes,
  getPersistedSportsLibMetricReadTypes,
  normalizePersistedEventMetricSemantics,
} from '@shared/sports-lib-metric-semantics';

describe('persisted Sports Lib metric semantics', () => {
  it('hydrates pre-19 activity streams and laps as canonical Stroke Rate', () => {
    const activity = EventImporterJSON.getActivityFromJSON({
      name: 'Stored open-water swim',
      startDate: 0,
      endDate: 2_000,
      type: ActivityTypes.OpenWaterSwimming,
      powerMeter: false,
      trainer: false,
      stats: { [DataCadenceAvg.type]: 32 },
      streams: [{ type: DataCadence.type, data: [30, 32, 34] }],
      laps: [{
        lapId: 1,
        startDate: 0,
        endDate: 2_000,
        startIndex: null,
        endIndex: null,
        type: LapTypes.Manual,
        stats: { [DataCadenceAvg.type]: 31 },
      }],
      creator: { name: 'test', devices: [] },
      intensityZones: [],
      events: [],
    });

    expect(activity.hasStreamData(DataCadence.type)).toBe(false);
    expect(activity.getStream(DataStrokeRate.type).getData()).toEqual([30, 32, 34]);
    expect(activity.getStat(DataStrokeRateAvg.type)?.getValue()).toBe(32);
    expect(activity.getLaps()[0].getStat(DataStrokeRateAvg.type)?.getValue()).toBe(31);
    expect(activity.toJSON().streams).toContainEqual({
      type: DataStrokeRate.type,
      data: [30, 32, 34],
    });
  });

  it('normalizes a split open-water event summary without requiring embedded activities', () => {
    const event = normalizePersistedEventMetricSemantics(
      EventImporterJSON.getEventFromJSON(eventJSON({
      [DataActivityTypes.type]: [ActivityTypes.OpenWaterSwimming],
      [DataCadence.type]: 31.4,
      [DataCadenceAvg.type]: 30.8,
      })).setID('event-1'),
    );

    expect(event.getID()).toBe('event-1');
    expect(event.getStat(DataStrokeRate.type)?.getValue()).toBe(31.4);
    expect(event.getStat(DataStrokeRateAvg.type)?.getValue()).toBe(30.8);
    expect(event.getStat(DataCadence.type)).toBeUndefined();
    expect(event.getStat(DataCadenceAvg.type)).toBeUndefined();
  });

  it('preserves cadence when a partial persisted event has no activity-type stat', () => {
    const event = normalizePersistedEventMetricSemantics(
      EventImporterJSON.getEventFromJSON(eventJSON({
        [DataCadenceAvg.type]: 30.8,
      })),
    );

    expect(event.getStat(DataCadenceAvg.type)?.getValue()).toBe(30.8);
    expect(event.getStat(DataStrokeRateAvg.type)).toBeUndefined();
  });

  it('prefers explicit stroke rate and preserves ambiguous mixed summaries', () => {
    const explicit = canonicalizePersistedSportsLibStats({
      [DataCadenceAvg.type]: 30,
      [DataStrokeRateAvg.type]: 32,
    }, [ActivityTypes.Rowing]);
    const mixed = canonicalizePersistedSportsLibStats({
      [DataCadenceAvg.type]: 82,
    }, [ActivityTypes.Rowing, ActivityTypes.Cycling]);

    expect(explicit).toEqual({ [DataStrokeRateAvg.type]: 32 });
    expect(mixed).toEqual({ [DataCadenceAvg.type]: 82 });
  });

  it('keeps unknown and empty activity families unchanged', () => {
    const stats = { [DataCadenceAvg.type]: 28 };

    expect(canonicalizePersistedSportsLibStats(stats, [])).toEqual(stats);
    expect(canonicalizePersistedSportsLibStats(stats, ['future-water-sport'])).toEqual(stats);
  });

  it('expands selective reads only for canonical stroke-rate metrics', () => {
    expect(getPersistedSportsLibMetricReadTypes([
      DataStrokeRate.type,
      DataStrokeRateAvg.type,
      'Distance',
    ])).toEqual([
      DataStrokeRate.type,
      DataCadence.type,
      DataStrokeRateAvg.type,
      DataCadenceAvg.type,
      'Distance',
    ]);
    expect(getPersistedSportsLibMetricReadTypes([DataCadence.type])).toEqual([
      DataCadence.type,
    ]);
  });

  it('reads activity types only from the canonical event stat', () => {
    expect(getPersistedEventActivityTypes({
      [DataActivityTypes.type]: [ActivityTypes.Kayaking],
    })).toEqual([ActivityTypes.Kayaking]);
    expect(getPersistedEventActivityTypes({ [DataActivityTypes.type]: 'Kayaking' })).toEqual([]);
  });
});

function eventJSON(stats: Record<string, unknown>): EventJSONInterface {
  return {
    name: 'Persisted event',
    startDate: '2026-08-01T08:00:00.000Z',
    endDate: '2026-08-01T09:00:00.000Z',
    stats,
    activities: [],
  } as unknown as EventJSONInterface;
}
