import { ActivityTypes, DistanceUnits, PaceUnits, SpeedUnits, SwimPaceUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { isSwimmingWorkoutSportV1, isRowingWorkoutSportV1, type WorkoutStructureV1 } from '@shared/planned-workout';
import { buildWorkoutProfile } from './workout-profile.helper';
import { buildWorkoutProfileChartOption } from './workout-profile-chart.helper';

function recipe(sport = ActivityTypes.Running, fastest = 270, slowest = 330): WorkoutStructureV1 {
  const distance = isSwimmingWorkoutSportV1(sport) ? 100 : isRowingWorkoutSportV1(sport) ? 500 : 1000;
  return { version: 1, sport, nodes: [{ kind: 'step', id: 'target', purpose: 'recovery',
    ending: { kind: 'time', seconds: 60 }, targets: [{ kind: 'speed', mode: 'absolute', presentation: 'pace',
      minimumMetersPerSecond: distance / slowest, maximumMetersPerSecond: distance / fastest }] }] };
}
type ProfileOption = {
  yAxis: Array<{ inverse: boolean; min: number; max: number; interval?: number;
    axisTick: { customValues?: number[] }; axisLabel: { customValues?: number[]; formatter: (value: number) => string } }>;
  series: Array<{ data: Array<{ value: number[]; occurrenceKey: string }>; renderItem: (params: { dataIndex: number }, api: unknown) => {
    type: string; shape: { y: number; height: number };
  } }>;
};
const imperial = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles, paceUnits: [PaceUnits.MinutesPerMile],
  speedUnits: [SpeedUnits.MilesPerHour], swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] });

describe('workout profile chart axes and bands', () => {
  it.each([
    { sport: ActivityTypes.Running, fastest: 270, slowest: 330, units: null, factor: 1, interval: 10, label: '04:20 min/km' },
    { sport: ActivityTypes.Running, fastest: 270, slowest: 330, units: imperial, factor: 1.609344, interval: 15, label: '07:00 min/m' },
    { sport: ActivityTypes.Swimming, fastest: 100, slowest: 120, units: imperial, factor: .9144, interval: 5, label: '01:30 min/100yd' },
    { sport: ActivityTypes.Swimming, fastest: 100, slowest: 120, units: null, factor: 1, interval: 5, label: '01:35 min/100m' },
    { sport: ActivityTypes.OpenWaterSwimming, fastest: 100, slowest: 120, units: imperial, factor: .9144, interval: 5, label: '01:30 min/100yd' },
    { sport: ActivityTypes.Rowing, fastest: 120, slowest: 135, units: imperial, factor: 1, interval: 2, label: '01:58 min/500m' },
    { sport: ActivityTypes.IndoorRowing, fastest: 120, slowest: 135, units: imperial, factor: 1, interval: 2, label: '01:58 min/500m' },
  ])('aligns $sport pace data, ticks and labels in the selected denominator', ({ sport, fastest, slowest, units, factor, interval, label }) => {
    const structure = recipe(sport, fastest, slowest);
    const before = JSON.stringify(structure);
    const model = buildWorkoutProfile(structure, units);
    const option = buildWorkoutProfileChartOption(model, 'pace', null, [], false, 320, true, units) as ProfileOption;
    const axis = option.yAxis[0];
    expect(axis.inverse).toBe(true);
    expect(axis.interval).toBe(interval);
    expect(axis.min).toBeGreaterThan(0);
    expect(axis.axisTick.customValues).toEqual(axis.axisLabel.customValues);
    expect(axis.min).toBeLessThan(fastest * factor);
    expect(axis.max).toBeGreaterThan(slowest * factor);
    expect(axis.axisLabel.formatter(axis.min)).toBe(label);
    expect(option.series[0].data[0].value[1]).toBeCloseTo(fastest * factor);
    expect(option.series[0].data[0].value[2]).toBeCloseTo(slowest * factor);
    if (isRowingWorkoutSportV1(sport)) expect(model.occurrences[0].targets[0].text).toBe('02m 00s–02m 15s / 500.0 m');
    expect(JSON.stringify(structure)).toBe(before);
  });

  it('preserves a broad authored recovery range and uses whole-minute ticks', () => {
    const model = buildWorkoutProfile(recipe(ActivityTypes.Running, 270, 3390));
    const option = buildWorkoutProfileChartOption(model, 'pace', null, [], false, 1400, false) as ProfileOption;
    const axis = option.yAxis[0];
    expect(axis.interval).toBe(600);
    expect(axis.max).toBeGreaterThan(3390);
    expect(axis.min).toBeGreaterThan(0);
    expect(axis.axisLabel.customValues).toEqual([180, 600, 1200, 1800, 2400, 3000, 3600]);
    expect(axis.axisTick.customValues).toEqual(axis.axisLabel.customValues);
    expect(option.series[0].data[0].value).toEqual([0, 270, 3390]);
    expect(axis.axisLabel.formatter(600)).toBe('10:00 min/km');
  });

  it('places each band edge exactly at its data coordinate and centers constant targets', () => {
    const option = buildWorkoutProfileChartOption(buildWorkoutProfile(recipe()), 'pace', null, [], false, 320, true) as ProfileOption;
    const series = option.series[0];
    const render = (low: number, high: number) => series.renderItem({ dataIndex: 0 }, {
      value: (dimension: number) => [0, 270, 330][dimension],
      coord: ([, value]: number[]) => [50, value === 270 ? low : high], size: () => [40, 0],
    });
    expect(render(100, 160).shape).toMatchObject({ y: 100, height: 60 });
    expect(render(100, 101).shape).toMatchObject({ y: 100, height: 1 });
    expect(render(100, 100).shape).toMatchObject({ y: 98, height: 4 });
  });

  it.each([
    { unit: SpeedUnits.KilometersPerHour, factor: 3.6, max: 40, interval: 10, label: '10 km/h' },
    { unit: SpeedUnits.MilesPerHour, factor: 2.237, max: 30, interval: 10, label: '10 mph' },
    { unit: SpeedUnits.MetersPerSecond, factor: 1, max: 15, interval: 5, label: '5 m/s' },
    { unit: null, factor: 1, max: 15, interval: 5, label: '5 m/s' },
    { unit: SpeedUnits.FeetPerSecond, factor: 3.28084, max: 40, interval: 10, label: '10 ft/s' },
    { unit: SpeedUnits.Knots, factor: 1.943844, max: 30, interval: 10, label: '10 kn' },
  ])('uses round numeric speed ticks in $unit without changing the saved recipe', ({ unit, factor, max, interval, label }) => {
    const structure = recipe(ActivityTypes.Cycling);
    const target = structure.nodes[0];
    if (target.kind === 'step') target.targets = [{ kind: 'speed', mode: 'absolute', presentation: 'speed',
      minimumMetersPerSecond: 5, maximumMetersPerSecond: 10 }];
    const before = JSON.stringify(structure);
    const units = unit === null ? null : normalizeUserUnitSettings({ speedUnits: [unit] });
    const model = buildWorkoutProfile(structure, units);
    const option = buildWorkoutProfileChartOption(model, 'speed', null, [], false, 320, true, units) as ProfileOption;
    expect(option.yAxis[0]).toMatchObject({ inverse: false, min: 0, max, interval });
    expect(option.series[0].data[0].value[1]).toBeCloseTo(5 * factor, 4);
    expect(option.series[0].data[0].value[2]).toBeCloseTo(10 * factor, 4);
    expect(option.yAxis[0].axisLabel.formatter(interval)).toBe(label);
    expect(model.occurrences[0].targets[0].text).toContain(label.split(' ').at(-1));
    expect(JSON.stringify(structure)).toBe(before);
  });
});
