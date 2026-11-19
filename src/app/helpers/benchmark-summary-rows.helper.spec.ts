import {
  type ActivityInterface, ActivityTypes, DataAltitudeAvg, DataAltitudeMax, DataAltitudeMin, DataCadenceAvg, DataCadenceMax, DataCadenceMin,
  DataDistance, DataDuration, DataFeeling, DataHeartRateAvg, DataJumpDistanceAvg, DataJumpDistanceMax, DataJumpDistanceMin,
  type DataInterface, DataPaceAvg, DataPaceMax, DataPaceMin, DataPower, DataPowerAvg, DistanceUnits, ElevationUnits, PaceUnits, SwimPaceUnits,
} from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { buildBenchmarkSummaryCards, buildBenchmarkSummaryPanels, getBenchmarkSummarySources } from './benchmark-summary-rows.helper';

function recording(id: string, stats: DataInterface[], name = id, type = ActivityTypes.Running) {
  const byType = new Map(stats.map(stat => [stat.getType(), stat]));
  return { type, creator: { name }, getID: () => id, getStat: (type: string) => byType.get(type) } as ActivityInterface;
}

const settings = normalizeUserUnitSettings({});
const sourcesFor = (all: ActivityInterface[], types: string[]) => getBenchmarkSummarySources(all, all, types, () => '#123456');

describe('benchmark summary device rows', () => {
  it.each([
    {},
    { distanceUnits: DistanceUnits.Miles, elevationUnits: ElevationUnits.Feet },
  ])('groups cadence ranges and reference differences with unit settings %j', (unitSettings) => {
    const all = [
      recording('a', [new DataCadenceMin(0), new DataCadenceAvg(170)]),
      recording('b', [new DataCadenceMin(116), new DataCadenceAvg(169), new DataCadenceMax(185)]),
      recording('c', [new DataCadenceAvg(168), new DataCadenceMax(191)]),
    ];
    const units = normalizeUserUnitSettings(unitSettings);
    const sources = sourcesFor(all, [DataCadenceMin.type, DataCadenceAvg.type, DataCadenceMax.type]);
    const panels = buildBenchmarkSummaryPanels(sources, 'id:a', units);
    expect([...panels.keys()]).toEqual([DataCadenceAvg.type]);
    expect(panels.get(DataCadenceAvg.type)[0]).toMatchObject({
      kind: 'family',
      unit: 'rpm',
      columns: [{ label: 'Min', range: '0–116' }, { label: 'Avg', range: '168–170' }, { label: 'Max', range: '185–191' }],
      rows: [
        { color: '#123456', cells: [{ value: '0', delta: null }, { value: '170', delta: null }, { value: null, delta: null }] },
        { cells: [{ value: '116', delta: '+116' }, { value: '169', delta: '−1' }, { value: '185', delta: null }] },
        { cells: [{ value: null, delta: null }, { value: '168', delta: '−2' }, { value: '191', delta: null }] },
      ],
      missingReference: 'Max',
    });
    expect(buildBenchmarkSummaryPanels(sources, 'id:b', units).get(DataCadenceAvg.type)[0]).toMatchObject({
      missingReference: '',
      rows: [
        { cells: [{ value: '0', delta: '−116' }, { value: '170', delta: '+1' }, { value: null, delta: null }] },
        { cells: [{ value: '116', delta: null }, { value: '169', delta: null }, { value: '185', delta: null }] },
        { cells: [{ value: null, delta: null }, { value: '168', delta: '−1' }, { value: '191', delta: '+6' }] },
      ],
    });
    expect(buildBenchmarkSummaryPanels(sources.slice(0, 1), 'id:a', units).get(DataCadenceAvg.type)[0]).toMatchObject({
      columns: [{ range: '0' }, { range: '170' }, { range: null }],
      missingReference: '',
    });
  });

  it.each([
    { elevationUnits: ElevationUnits.Meters, unit: 'm', minRange: '30–61', maxDelta: '+30' },
    { elevationUnits: ElevationUnits.Feet, unit: 'ft', minRange: '100–200', maxDelta: '+100' },
  ])('groups altitude with $unit display units', ({ elevationUnits, unit, minRange, maxDelta }) => {
    const sources = sourcesFor([
      recording('a', [new DataAltitudeMin(30.48), new DataAltitudeAvg(60.96), new DataAltitudeMax(91.44)]),
      recording('b', [new DataAltitudeMin(60.96), new DataAltitudeAvg(91.44), new DataAltitudeMax(121.92)]),
    ], [DataAltitudeMin.type, DataAltitudeAvg.type, DataAltitudeMax.type]);
    const panels = buildBenchmarkSummaryPanels(sources, 'id:a', normalizeUserUnitSettings({ elevationUnits }));
    expect([...panels.keys()]).toEqual([DataAltitudeAvg.type]);
    expect(panels.get(DataAltitudeAvg.type)).toMatchObject([{
      label: 'Altitude',
      unit,
      columns: [{ range: minRange }, { label: 'Avg' }, { label: 'Max' }],
      rows: [{}, { cells: [{}, {}, { delta: maxDelta }] }],
    }]);
  });

  it('pairs pace columns in each selected unit', () => {
    const sources = sourcesFor([
      recording('a', [new DataPaceMin(240), new DataPaceAvg(300), new DataPaceMax(420)]),
      recording('b', [new DataPaceMin(250), new DataPaceAvg(310), new DataPaceMax(440)]),
    ], [DataPaceMin.type, DataPaceAvg.type, DataPaceMax.type]);
    const units = normalizeUserUnitSettings({ paceUnits: [PaceUnits.MinutesPerKilometer, PaceUnits.MinutesPerMile] });
    const panels = buildBenchmarkSummaryPanels(sources, 'id:a', units).get(DataPaceAvg.type);
    expect(panels).toHaveLength(2);
    expect(panels.map(panel => panel.unit)).toEqual(['min/km', 'min/m']);
    for (const panel of panels) {
      expect(panel.kind).toBe('family');
      if (panel.kind !== 'family') continue;
      expect(panel.columns.every(column => column.range && !column.range.includes(panel.unit))).toBe(true);
      expect(panel.rows[1].cells.every(cell => cell.value && cell.delta?.startsWith('+'))).toBe(true);
    }
  });

  it('keeps scaled distance readings in the same family and shows their actual units', () => {
    const sources = sourcesFor([
      recording('a', [new DataJumpDistanceMin(900), new DataJumpDistanceAvg(980), new DataJumpDistanceMax(1100)]),
      recording('b', [new DataJumpDistanceMin(950), new DataJumpDistanceAvg(1050), new DataJumpDistanceMax(1500)]),
    ], [DataJumpDistanceMin.type, DataJumpDistanceAvg.type, DataJumpDistanceMax.type]);
    expect(buildBenchmarkSummaryPanels(sources, 'id:a', settings).get(DataJumpDistanceAvg.type)).toMatchObject([{
      unit: '',
      columns: [{ range: '900.0–950.0 m' }, { range: '980.0 m–1.05 Km' }, { range: '1.10–1.50 Km' }],
      rows: [{}, { cells: [{ value: '950.0 m' }, { value: '1.05 Km' }, { value: '1.50 Km' }] }],
    }]);
    const imperial = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles });
    expect(buildBenchmarkSummaryPanels(sources, 'id:a', imperial).get(DataJumpDistanceAvg.type)).toMatchObject([{
      unit: 'ft',
    }]);
  });

  it('retains a separately stored value alongside its metric family', () => {
    const sources = sourcesFor([recording('a', [new DataPower(150), new DataPowerAvg(180)])],
      [DataPower.type, DataPowerAvg.type]);
    const panels = buildBenchmarkSummaryPanels(sources, 'id:a', settings);
    expect(panels.get(DataPower.type)[0]).toMatchObject({ kind: 'metric', label: 'Power (recorded value)', rows: [{ value: '150 watt' }] });
    expect(panels.get(DataPowerAvg.type)[0]).toMatchObject({ kind: 'family', label: 'Power', columns: [{ range: null }, { range: '180' }, { range: null }] });
  });

  it('compares four original readings, with signed differences, zeroes, ties and missing values', () => {
    const all = [
      recording('a', [new DataDistance(9270), new DataHeartRateAvg(0)]),
      recording('b', [new DataDistance(9250)]),
      recording('c', [new DataDistance(9900), new DataHeartRateAvg(120)]),
      recording('d', [new DataDistance(9270)]),
    ];
    const sources = sourcesFor(all, [DataDistance.type, DataHeartRateAvg.type, DataDuration.type]);
    const cards = buildBenchmarkSummaryCards(sources, 'id:a', settings);
    expect(cards.get(DataDistance.type)[0].range).toBe('9.25–9.90 Km');
    expect(cards.get(DataHeartRateAvg.type)[0].range).toBe('0–120 bpm');
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
    expect(cards.get(DataDistance.type)[0].range).toBe('1.00–2.00 mi');
    expect(cards.get(DataAltitudeAvg.type)[0].range).toBe('100–200 ft');
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
    expect(cards.get(DataFeeling.type)[0].range).toBeNull();
  });

  it('uses compact clock values and keeps both units when the distance scale changes', () => {
    const selected = [
      recording('a', [new DataDuration(4125), new DataDistance(1230)]),
      recording('b', [new DataDuration(4119), new DataDistance(950)]),
      recording('c', []),
    ];
    const sources = sourcesFor(selected, [DataDuration.type, DataDistance.type]);
    const cards = buildBenchmarkSummaryCards(sources, 'id:c', settings);
    expect(cards.get(DataDuration.type)[0].range).toBe('1:08:39–1:08:45');
    expect(cards.get(DataDistance.type)[0].range).toBe('950.0 m–1.23 Km');
    expect(buildBenchmarkSummaryCards(sources.slice(0, 1), 'id:a', settings).get(DataDuration.type)[0].range).toBe('1:08:45');
  });

  it('keeps original source order and disambiguates repeated names and IDs after filtering', () => {
    const all = [recording('x', [], 'Watch'), recording('x', [], 'Watch'), recording('z', [], '')];
    const selected = [recording('z', [], ''), all[1]];
    const sources = getBenchmarkSummarySources(all, selected, [], () => '');
    expect(sources.map(row => [row.value, row.label])).toEqual([['index:1', 'Watch (2)'], ['id:z', 'Recording 3']]);
  });
});
