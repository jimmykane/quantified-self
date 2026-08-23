import {
  type ActivityInterface,
  ActivityTypes,
  DataActivityTypes,
  DataAltitudeAvg,
  DataAltitudeMax,
  DataAltitudeMin,
  DataAscent,
  DataCadence,
  DataCadenceAvg,
  DataDescent,
  DataDistance,
  DataDuration,
  DataGradeAvg,
  DataGradeMax,
  DataGradeMin,
  DataPause,
  DataStrokeRate,
  DataStrokeRateAvg,
  EventImporterJSON,
  EventUtilities,
  FileType,
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

  it('regenerates terrain summaries only from non-Diving activities', () => {
    [
      [ActivityTypes.ScubaDiving],
      [ActivityTypes.ScubaDiving, ActivityTypes.FreeDiving],
    ].forEach((activityTypes) => {
      const allDiving = EventImporterJSON.getEventFromJSON(eventWithActivities(activityTypes));
      allDiving.getActivities().forEach((activity, index) => addRawTerrainSummaryStats(activity, index + 1));

      EventUtilities.reGenerateStatsForEvent(allDiving);

      terrainSummaryTypes.forEach(type => {
        expect(allDiving.getStat(type)).toBeUndefined();
      });
    });

    const mixed = EventImporterJSON.getEventFromJSON(eventWithActivities([
      ActivityTypes.ScubaDiving,
      ActivityTypes.Running,
    ]));
    addRawTerrainSummaryStats(mixed.getActivities()[0], 1);
    addRawTerrainSummaryStats(mixed.getActivities()[1], 5);

    EventUtilities.reGenerateStatsForEvent(mixed);

    expect(mixed.getStat(DataAscent.type)?.getValue()).toBe(100);
    expect(mixed.getStat(DataDescent.type)?.getValue()).toBe(75);
    expect(mixed.getStat(DataAltitudeMin.type)?.getValue()).toBe(-25);
    expect(mixed.getStat(DataAltitudeMax.type)?.getValue()).toBe(25);
    expect(mixed.getStat(DataAltitudeAvg.type)?.getValue()).toBe(5);
    expect(mixed.getStat(DataGradeMin.type)?.getValue()).toBe(-50);
    expect(mixed.getStat(DataGradeMax.type)?.getValue()).toBe(50);
    expect(mixed.getStat(DataGradeAvg.type)?.getValue()).toBe(5);
  });

  it('hides legacy all-Diving terrain summaries when restoring a split persisted event', () => {
    const event = normalizePersistedEventMetricSemantics(
      EventImporterJSON.getEventFromJSON(eventJSON({
        [DataActivityTypes.type]: [ActivityTypes.ScubaDiving],
        [DataAscent.type]: 20,
        [DataDescent.type]: 15,
        [DataAltitudeMin.type]: -5,
        [DataAltitudeMax.type]: 5,
        [DataAltitudeAvg.type]: 1,
        [DataGradeMin.type]: -10,
        [DataGradeMax.type]: 10,
        [DataGradeAvg.type]: 1,
      })),
    );

    terrainSummaryTypes.forEach(type => {
      expect(event.getStat(type)).toBeUndefined();
    });
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

const terrainSummaryTypes = [
  DataAscent.type,
  DataDescent.type,
  DataAltitudeMin.type,
  DataAltitudeMax.type,
  DataAltitudeAvg.type,
  DataGradeMin.type,
  DataGradeMax.type,
  DataGradeAvg.type,
];

function eventWithActivities(activityTypes: ActivityTypes[]): EventJSONInterface {
  return {
    name: 'Re-generated event',
    startDate: 0,
    endDate: activityTypes.length * 60_000,
    srcFileType: FileType.FIT,
    description: null,
    isMerge: activityTypes.length > 1,
    privacy: 0,
    stats: {},
    activities: activityTypes.map((type, index) => ({
      name: `${type} activity`,
      startDate: index * 60_000,
      endDate: (index + 1) * 60_000,
      type,
      powerMeter: false,
      trainer: false,
      stats: {
        [DataDuration.type]: 60,
        [DataPause.type]: 0,
        [DataDistance.type]: 25,
      },
      streams: [],
      laps: [],
      creator: { name: 'test', devices: [] },
      intensityZones: [],
      events: [],
    })),
  } as unknown as EventJSONInterface;
}

function addRawTerrainSummaryStats(activity: ActivityInterface, scale: number): void {
  [
    new DataAscent(20 * scale),
    new DataDescent(15 * scale),
    new DataAltitudeMin(-5 * scale),
    new DataAltitudeMax(5 * scale),
    new DataAltitudeAvg(scale),
    new DataGradeMin(-10 * scale),
    new DataGradeMax(10 * scale),
    new DataGradeAvg(scale),
  ].forEach(stat => activity.addStat(stat));
}
