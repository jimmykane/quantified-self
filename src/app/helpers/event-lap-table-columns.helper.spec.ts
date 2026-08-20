import {
  DataDistance,
  DataEnergy,
  DataPaceAvg,
  DataPaceMax,
  DataPaceMin,
  DataEHPE,
  DataEVPE,
  DataHeartRateAvg,
  DataHeartRateMax,
  DataHeartRateMin,
  DataNumberOfSatellites,
  DataSatellite5BestSNR,
  DataSpeedAvg,
  DataSpeedMax,
  DataSpeedMin,
  DataStrokeRateAvg,
  DataSwimPaceAvg,
  LapInterface,
  PaceUnits,
  SpeedUnits,
  SwimPaceUnits,
  type UserUnitSettingsInterface,
} from '@sports-alliance/sports-lib';
import {
  DataDuration,
} from '@sports-alliance/sports-lib';
import {
  EVENT_LAP_TABLE_FIXED_COLUMN,
  formatEventLapMetric,
  getAverageEventLapMetrics,
  getDefaultEventLapMetricTypes,
  getEventLapMetricOptionGroups,
  getSelectedEventLapMetricTypes,
  isEventLapSportFamily,
  normalizeEventDetailsSettings,
  normalizeEventLapMetricTypes,
  resolveEventLapSportFamily,
} from './event-lap-table-columns.helper';

const unitSettings: UserUnitSettingsInterface = {
  paceUnits: [PaceUnits.MinutesPerMile],
  speedUnits: [SpeedUnits.MilesPerHour],
  swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard],
} as UserUnitSettingsInterface;

describe('event lap table columns helper', () => {
  it('resolves canonical and aliased activities into independent sport families', () => {
    expect(resolveEventLapSportFamily('Running')).toBe('running');
    expect(resolveEventLapSportFamily(' trail running ')).toBe('running');
    expect(resolveEventLapSportFamily('Mountain Biking')).toBe('cycling');
    expect(resolveEventLapSportFamily('Open Water Swimming')).toBe('swimming');
    expect(resolveEventLapSportFamily('Hiking')).toBe('other');
  });

  it('uses the preferred effort metric in each family default', () => {
    expect(getDefaultEventLapMetricTypes('running')).toContain(DataPaceAvg.type);
    expect(getDefaultEventLapMetricTypes('running')).not.toContain(DataSpeedAvg.type);
    expect(getDefaultEventLapMetricTypes('cycling')).toContain(DataSpeedAvg.type);
    expect(getDefaultEventLapMetricTypes('swimming')).toContain(DataSwimPaceAvg.type);
    expect(getDefaultEventLapMetricTypes('swimming')).toContain(DataStrokeRateAvg.type);
    expect(getDefaultEventLapMetricTypes('other')).toContain(DataSpeedAvg.type);
    expect(EVENT_LAP_TABLE_FIXED_COLUMN).toBe('#');
  });

  it('only accepts supported sport families for persisted layouts', () => {
    expect(isEventLapSportFamily('running')).toBe(true);
    expect(isEventLapSportFamily('rowing')).toBe(false);
    expect(isEventLapSportFamily(null)).toBe(false);
  });

  it('normalizes saved choices while preserving an intentional empty layout', () => {
    const settings = normalizeEventDetailsSettings({
      lapTableColumnsBySportFamily: {
        running: [DataPaceAvg.type, 'unknown metric', DataPaceAvg.type],
        cycling: [],
        swimming: ['unknown metric'],
      },
    });

    expect(settings.lapTableColumnsBySportFamily?.running).toEqual([DataPaceAvg.type]);
    expect(settings.lapTableColumnsBySportFamily?.cycling).toEqual([]);
    expect(settings.lapTableColumnsBySportFamily?.swimming).toBeUndefined();
    expect(getSelectedEventLapMetricTypes(settings, 'swimming')).toEqual(
      getDefaultEventLapMetricTypes('swimming'),
    );
  });

  it('exposes the event-summary catalog in stable grouped order', () => {
    const optionGroups = getEventLapMetricOptionGroups();

    expect(optionGroups.map((group) => group.id)).toContain('overall');
    expect(optionGroups.map((group) => group.id)).toContain('performance');
    expect(optionGroups.flatMap((group) => group.metrics).map((metric) => metric.type))
      .toContain(DataPaceAvg.type);
    expect(optionGroups.flatMap((group) => group.metrics).filter((metric) => metric.type === DataSpeedAvg.type)).toHaveLength(1);
  });

  it('excludes position diagnostics and groups average/minimum/maximum metric families', () => {
    const optionGroups = getEventLapMetricOptionGroups();
    const options = optionGroups.flatMap((group) => group.metrics);
    const heartRateGroup = optionGroups.find((group) => group.label === 'Heart Rate');
    const speedGroup = optionGroups.find((group) => group.label === 'Speed');
    const paceGroup = optionGroups.find((group) => group.label === 'Pace');

    expect(options.map((metric) => metric.type)).not.toEqual(expect.arrayContaining([
      DataEHPE.type,
      DataEVPE.type,
      DataNumberOfSatellites.type,
      DataSatellite5BestSNR.type,
    ]));
    expect(heartRateGroup?.metrics).toEqual(expect.arrayContaining([
      { type: DataHeartRateAvg.type, label: 'Average' },
      { type: DataHeartRateMax.type, label: 'Maximum' },
      { type: DataHeartRateMin.type, label: 'Minimum' },
    ]));
    expect(speedGroup?.metrics).toEqual([
      { type: DataSpeedAvg.type, label: 'Average' },
      { type: DataSpeedMin.type, label: 'Minimum' },
      { type: DataSpeedMax.type, label: 'Maximum' },
    ]);
    expect(paceGroup?.metrics).toEqual([
      { type: DataPaceAvg.type, label: 'Average' },
      { type: DataPaceMin.type, label: 'Minimum' },
      { type: DataPaceMax.type, label: 'Maximum' },
    ]);
    expect(normalizeEventLapMetricTypes([
      DataPaceAvg.type,
      DataSpeedMin.type,
      DataPaceMax.type,
      DataEVPE.type,
      DataNumberOfSatellites.type,
    ])).toEqual([DataPaceAvg.type, DataSpeedMin.type, DataPaceMax.type]);
  });

  it('formats pace, speed, and swim pace with the saved unit preferences', () => {
    expect(formatEventLapMetric(new DataPaceAvg(300), DataPaceAvg.type, unitSettings, 'Running'))
      .toBe('08:02 min/m');
    expect(formatEventLapMetric(new DataSpeedAvg(5), DataSpeedAvg.type, unitSettings, 'Cycling'))
      .toBe('11.19 mph');
    expect(formatEventLapMetric(new DataSwimPaceAvg(90), DataSwimPaceAvg.type, unitSettings, 'Swimming'))
      .toBe('01:22 min/100yd');
  });

  it('formats averages with saved units while excluding accumulated lap totals', () => {
    const laps = [
      { duration: 120, distance: 1000, energy: 300, pace: 300 },
      { duration: 180, distance: 1200, energy: 400, pace: 330 },
    ].map(({ duration, distance, energy, pace }) => ({
      getDuration: () => new DataDuration(duration),
      getDistance: () => new DataDistance(distance),
      getStat: (type: string) => type === DataPaceAvg.type
        ? new DataPaceAvg(pace)
        : type === DataEnergy.type
          ? new DataEnergy(energy)
          : undefined,
    } as unknown as LapInterface));

    expect(getAverageEventLapMetrics(
      laps,
      [DataDuration.type, DataDistance.type, DataEnergy.type, DataPaceAvg.type],
      unitSettings,
      'Running',
    )).toEqual([
      { type: DataPaceAvg.type, display: '08:26 min/m' },
    ]);
  });

  it('retains stopwatch duration formatting and hides invalid values', () => {
    expect(formatEventLapMetric(new DataDuration(12.85), DataDuration.type, unitSettings, 'Running'))
      .toBe('0:12.85');
    expect(formatEventLapMetric({
      getValue: () => Number.NaN,
    } as unknown as DataSpeedAvg, DataSpeedAvg.type, unitSettings, 'Cycling')).toBe('');
  });
});
