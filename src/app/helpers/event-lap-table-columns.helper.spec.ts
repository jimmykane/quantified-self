import {
  DataPaceAvg,
  DataSpeedAvg,
  DataSwimPaceAvg,
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
  getDefaultEventLapMetricTypes,
  getEventLapMetricOptionGroups,
  getSelectedEventLapMetricTypes,
  isEventLapSportFamily,
  normalizeEventDetailsSettings,
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
    expect(optionGroups[0]?.metrics.map((metric) => metric.type)).toContain(DataPaceAvg.type);
    expect(optionGroups.flatMap((group) => group.metrics).filter((metric) => metric.type === DataSpeedAvg.type)).toHaveLength(1);
  });

  it('formats pace, speed, and swim pace with the saved unit preferences', () => {
    expect(formatEventLapMetric(new DataPaceAvg(300), DataPaceAvg.type, unitSettings, 'Running'))
      .toBe('08:02 min/m');
    expect(formatEventLapMetric(new DataSpeedAvg(5), DataSpeedAvg.type, unitSettings, 'Cycling'))
      .toBe('11.19 mph');
    expect(formatEventLapMetric(new DataSwimPaceAvg(90), DataSwimPaceAvg.type, unitSettings, 'Swimming'))
      .toBe('01:22 min/100yd');
  });

  it('retains stopwatch duration formatting and hides invalid values', () => {
    expect(formatEventLapMetric(new DataDuration(12.85), DataDuration.type, unitSettings, 'Running'))
      .toBe('0:12.85');
    expect(formatEventLapMetric({
      getValue: () => Number.NaN,
    } as unknown as DataSpeedAvg, DataSpeedAvg.type, unitSettings, 'Cycling')).toBe('');
  });
});
