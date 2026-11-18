import {
  type ActivityInterface, ActivityTypes, DataAltitudeAvg, DataDistance, DataDuration, DataFeeling, DataHeartRateAvg,
  type DataInterface, DataPaceAvg, DistanceUnits, ElevationUnits, PaceUnits, SwimPaceUnits,
} from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { buildBenchmarkSummaryCards, getBenchmarkSummarySources } from './benchmark-summary-rows.helper';

function recording(id: string, stats: DataInterface[], name = id, type = ActivityTypes.Running) {
  const byType = new Map(stats.map(stat => [stat.getType(), stat]));
  return { type, creator: { name }, getID: () => id, getStat: (type: string) => byType.get(type) } as ActivityInterface;
}

const settings = normalizeUserUnitSettings({});
const sourcesFor = (all: ActivityInterface[], types: string[]) => getBenchmarkSummarySources(all, all, types, () => '#123456');

describe('benchmark summary device rows', () => {
  it('compares four original readings, with signed differences, zeroes, ties and missing values', () => {
    const all = [
      recording('a', [new DataDistance(9270), new DataHeartRateAvg(0)]),
      recording('b', [new DataDistance(9250)]),
      recording('c', [new DataDistance(9900), new DataHeartRateAvg(120)]),
      recording('d', [new DataDistance(9270)]),
    ];
    const sources = sourcesFor(all, [DataDistance.type, DataHeartRateAvg.type, DataDuration.type]);
    const cards = buildBenchmarkSummaryCards(sources, 'id:a', settings);
    expect(cards.get(DataDistance.type)[0].rows.map(row => [row.value, row.delta])).toEqual([
      ['9.27 Km', 'Reference'], ['9.25 Km', '−20.0 m'], ['9.90 Km', '+630.0 m'], ['9.27 Km', 'Same'],
    ]);
    expect(cards.has(DataDuration.type)).toBe(false);
    expect(cards.get(DataHeartRateAvg.type)[0].rows.map(row => row.value)).toEqual(['0 bpm', null, '120 bpm', null]);
    const changed = buildBenchmarkSummaryCards(sources, 'id:b', settings);
    expect(changed.get(DataDistance.type)[0].rows[0].delta).toBe('+20.0 m');
    expect(changed.get(DataHeartRateAvg.type)[0].hasReferenceReading).toBe(false);
    expect(changed.get(DataHeartRateAvg.type)[0].rows.every(row => row.delta === '')).toBe(true);
  });

  it('uses selected units for both the readings and differences', () => {
    const units = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles, elevationUnits: ElevationUnits.Feet,
      paceUnits: [PaceUnits.MinutesPerMile] });
    const activities = [
      recording('a', [new DataDistance(1609.344), new DataAltitudeAvg(30.48), new DataPaceAvg(300)]),
      recording('b', [new DataDistance(3218.688), new DataAltitudeAvg(60.96), new DataPaceAvg(360)]),
    ];
    const cards = buildBenchmarkSummaryCards(sourcesFor(activities, [DataDistance.type, DataAltitudeAvg.type, DataPaceAvg.type]), 'id:a', units);
    expect(cards.get(DataDistance.type)[0].rows[1]).toMatchObject({ value: '2.00 mi', delta: '+1.00 mi' });
    expect(cards.get(DataAltitudeAvg.type)[0].rows[1]).toMatchObject({ value: '200 ft', delta: '+100 ft' });
    expect(cards.get(DataPaceAvg.type)[0].rows[1].delta).toMatch(/^\+01:36 /);
  });

  it('distinguishes a small difference rounded to zero from exactly matching readings', () => {
    const units = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles });
    const all = [recording('a', [new DataDistance(9000)]), recording('b', [new DataDistance(9001)])];
    const cards = buildBenchmarkSummaryCards(sourcesFor(all, [DataDistance.type]), 'id:a', units);
    expect(cards.get(DataDistance.type)[0].rows[1].delta).toBe('Slightly higher');
    const switched = buildBenchmarkSummaryCards(sourcesFor(all, [DataDistance.type]), 'id:b', units);
    expect(switched.get(DataDistance.type)[0].rows[0].delta).toBe('Slightly lower');
  });

  it('keeps the direction and fractional seconds for close pace readings in the selected unit', () => {
    const all = [recording('a', [new DataPaceAvg(300.8)]), recording('b', [new DataPaceAvg(300.5)])];
    const sources = sourcesFor(all, [DataPaceAvg.type]);
    expect(buildBenchmarkSummaryCards(sources, 'id:a', settings).get(DataPaceAvg.type)[0].rows[1].delta)
      .toBe('−0:00.30 min/km');
    const miles = normalizeUserUnitSettings({ paceUnits: [PaceUnits.MinutesPerMile] });
    expect(buildBenchmarkSummaryCards(sources, 'id:b', miles).get(DataPaceAvg.type)[0].rows[0].delta)
      .toBe('+0:00.48 min/m');
  });

  it('distinguishes pace cards when the user selects two display units', () => {
    const units = normalizeUserUnitSettings({ paceUnits: [PaceUnits.MinutesPerKilometer, PaceUnits.MinutesPerMile] });
    const sources = sourcesFor([recording('a', [new DataPaceAvg(300)])], [DataPaceAvg.type]);
    expect(buildBenchmarkSummaryCards(sources, 'id:a', units).get(DataPaceAvg.type).map(card => card.label))
      .toEqual(['Average Pace (min/km)', 'Average Pace (min/m)']);
  });

  it('keeps swim distance in yards and compares qualitative readings as labels', () => {
    const units = normalizeUserUnitSettings({ swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] });
    const selected = [recording('a', [new DataDistance(91.44), new DataFeeling(2)], 'A', ActivityTypes.Swimming),
      recording('b', [new DataDistance(182.88), new DataFeeling(4)], 'B', ActivityTypes.Swimming)];
    const cards = buildBenchmarkSummaryCards(sourcesFor(selected, [DataDistance.type, DataFeeling.type]), 'id:a', units);
    expect(cards.get(DataDistance.type)[0].rows[1]).toMatchObject({ value: '200 yd', delta: '+100 yd' });
    expect(cards.get(DataFeeling.type)[0].rows[1].delta).toBe('Different');
  });

  it('keeps original source order and disambiguates repeated names and IDs after filtering', () => {
    const all = [recording('x', [], 'Watch'), recording('x', [], 'Watch'), recording('z', [], '')];
    const selected = [recording('z', [], ''), all[1]];
    const sources = getBenchmarkSummarySources(all, selected, [], () => '');
    expect(sources.map(row => [row.value, row.label])).toEqual([['index:1', 'Watch (2)'], ['id:z', 'Recording 3']]);
  });
});
