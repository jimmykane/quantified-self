import {
  ActivityInterface,
  DataDistance,
  DataDepthAvg,
  DataDiveNumber,
  DataEnergy,
  DataPaceAvg,
  DataPaceMax,
  DataPaceMin,
  DataEHPE,
  DataEVPE,
  DataHeartRateAvg,
  DataHeartRateMax,
  DataHeartRateMin,
  DataJumpHangTimeMax,
  DataPowerAvg,
  DataPowerMax,
  DataCadenceAvg,
  DataAscent,
  DataMovingTime,
  DataTemperatureAvg,
  DataAvgRespirationRate,
  DataStrokeRateMax,
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
import { createNominalYardPoolFixture } from './event-swim-distance-display.test-fixtures';
import {
  DataDuration,
  DataEffortPaceAvg,
  DataGradeAdjustedPaceAvg,
  DataGradeAdjustedSpeedAvg,
} from '@sports-alliance/sports-lib';
import {
  EVENT_LAP_TABLE_FIXED_COLUMN,
  EVENT_LAP_STROKE_COLUMN,
  formatEventLapMetric,
  getAverageEventLapMetrics,
  getAvailableEventLapMetricTypes,
  getDefaultEventLapMetricTypes,
  getEventLapColumnPickerOptions,
  getEventLapMetricOptionGroups,
  getEventLapAdditionalMetricOptionGroups,
  getSelectedEventLapSummaryMetrics,
  getSelectedEventLapMetricTypes,
  isEventLapSportFamily,
  normalizeEventDetailsSettings,
  normalizeEventLapMetricTypes,
  moveEventLapMetricType,
  resolveEventLapSportFamily,
} from './event-lap-table-columns.helper';
import { EVENT_LAP_STROKES_COLUMN, EVENT_LAP_SWOLF_COLUMN } from './event-swim-analytics.helper';

const unitSettings: UserUnitSettingsInterface = {
  paceUnits: [PaceUnits.MinutesPerMile],
  speedUnits: [SpeedUnits.MilesPerHour],
  swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard],
} as UserUnitSettingsInterface;

describe('event lap table columns helper', () => {
  it('focuses swimming choices while keeping the full catalog recoverable and other sports unchanged', () => {
    const normal = getEventLapMetricOptionGroups('swimming').flatMap(group => group.metrics.map(metric => metric.type));
    const additional = getEventLapAdditionalMetricOptionGroups('swimming').flatMap(group => group.metrics.map(metric => metric.type));
    const full = getEventLapMetricOptionGroups().flatMap(group => group.metrics.map(metric => metric.type));
    expect(normal).toEqual(expect.arrayContaining([
      DataDuration.type, DataDistance.type, DataMovingTime.type, DataSwimPaceAvg.type,
      EVENT_LAP_STROKE_COLUMN, EVENT_LAP_STROKES_COLUMN, EVENT_LAP_SWOLF_COLUMN,
      DataStrokeRateAvg.type, DataStrokeRateMax.type, DataHeartRateMin.type,
      DataEnergy.type, DataSpeedAvg.type, DataTemperatureAvg.type, DataAvgRespirationRate.type,
    ]));
    for (const type of [DataPowerAvg.type, DataJumpHangTimeMax.type, DataPaceAvg.type, DataAscent.type, DataCadenceAvg.type, DataDepthAvg.type]) {
      expect(normal).not.toContain(type);
      expect(additional).toContain(type);
    }
    expect(new Set([...normal, ...additional]).size).toBe(full.length);
    expect([...normal, ...additional].sort()).toEqual([...full].sort());
    for (const family of ['running', 'cycling', 'other'] as const) {
      expect(getEventLapAdditionalMetricOptionGroups(family)).toEqual([]);
      expect(getEventLapMetricOptionGroups(family).flatMap(group => group.metrics.map(metric => metric.type)))
        .toEqual(full.filter(type => ![EVENT_LAP_STROKE_COLUMN, EVENT_LAP_STROKES_COLUMN, EVENT_LAP_SWOLF_COLUMN].includes(type)));
    }
  });

  it('uses focused swimming defaults without rewriting saved additional choices or their order', () => {
    const defaults = getDefaultEventLapMetricTypes('swimming');
    const normal = getEventLapMetricOptionGroups('swimming').flatMap(group => group.metrics.map(metric => metric.type));
    expect(defaults.every(type => normal.includes(type))).toBe(true);
    expect(defaults).not.toContain(DataCadenceAvg.type);
    expect(defaults).not.toContain(DataPowerAvg.type);
    expect(defaults).not.toContain(DataAscent.type);
    const saved = [DataJumpHangTimeMax.type, DataDuration.type, DataPowerAvg.type];
    expect(getSelectedEventLapMetricTypes({ lapTableColumnsBySportFamily: { swimming: saved } }, 'swimming')).toEqual(saved);
    expect(normalizeEventLapMetricTypes(saved)).toEqual(saved);
  });

  it('discovers unselected valid lap metrics including zero without using activity summary values', () => {
    const lap = {
      getDuration: () => new DataDuration(30),
      getDistance: () => new DataDistance(25),
      getStat: (type: string) => type === DataPowerAvg.type ? new DataPowerAvg(0)
        : type === DataPowerMax.type ? new DataPowerMax(Number.NaN) : undefined,
    } as unknown as LapInterface;
    const activity = {
      type: 'Swimming', getLaps: () => [lap],
      getStat: () => new DataJumpHangTimeMax(2),
    } as unknown as ActivityInterface;
    const types = [DataDuration.type, DataDistance.type, DataPowerAvg.type, DataPowerMax.type, DataJumpHangTimeMax.type, 'unknown metric', DataEHPE.type];
    for (const units of [undefined, unitSettings]) {
      expect(getAvailableEventLapMetricTypes(activity, [lap], types, units))
        .toEqual(new Set([DataDuration.type, DataDistance.type, DataPowerAvg.type]));
    }
    expect(getAvailableEventLapMetricTypes(activity, [], types, unitSettings)).toEqual(new Set());
  });

  it('discovers calculated swim columns from active lengths and leaves rest-only performance unavailable', () => {
    const active = {
      lapId: 1, getDuration: () => new DataDuration(30), getDistance: () => new DataDistance(25), getStat: () => undefined,
    } as unknown as LapInterface;
    const rest = {
      lapId: 2, getDuration: () => new DataDuration(30), getDistance: () => new DataDistance(0), getStat: () => undefined,
    } as unknown as LapInterface;
    const activity = {
      type: 'Swimming', getLaps: () => [active, rest], getSwimLengths: () => [
        { index: 1, lapIndex: 1, type: 'active', stroke: 'freestyle', startDate: 0, endDate: 30_000, timerTime: 30, distance: 25, strokes: 12 },
        { index: 2, lapIndex: 2, type: 'idle', startDate: 30_000, endDate: 60_000, timerTime: 30, distance: 0 },
      ],
    } as unknown as ActivityInterface;
    const types = [EVENT_LAP_STROKE_COLUMN, EVENT_LAP_STROKES_COLUMN, EVENT_LAP_SWOLF_COLUMN, DataStrokeRateAvg.type, DataSwimPaceAvg.type];
    for (const units of [undefined, unitSettings]) {
      expect(getAvailableEventLapMetricTypes(activity, [active], types, units)).toEqual(new Set(types));
      expect(getAvailableEventLapMetricTypes(activity, [rest], types, units)).toEqual(new Set());
    }
  });

  it('presents selected columns in saved order with complete variant names and no duplicated options', () => {
    const groups = getEventLapMetricOptionGroups('swimming');
    const original = JSON.stringify(groups);
    const selected = [DataHeartRateMax.type, DataDuration.type, DataSwimPaceAvg.type];
    const picker = getEventLapColumnPickerOptions(groups, selected);
    expect(picker.selectedMetrics).toEqual(selected.map(type => ({ type, label: type })));
    const available = picker.availableMetricGroups.flatMap(group => group.metrics.map(metric => metric.type));
    selected.forEach(type => expect(available).not.toContain(type));
    expect(available).toContain(DataDistance.type);
    expect(JSON.stringify(groups)).toBe(original);
  });

  it('preserves selected columns missing from a narrowed catalog and keeps customized labels', () => {
    const picker = getEventLapColumnPickerOptions([
      { id: 'swim', label: 'Swimming', metrics: [{ type: 'Normalized SWOLF', label: 'SWOLF (25 yd)' }] },
    ], [DataDuration.type, 'Normalized SWOLF']);
    expect(picker.selectedMetrics).toEqual([
      { type: DataDuration.type, label: DataDuration.type },
      { type: 'Normalized SWOLF', label: 'SWOLF (25 yd)' },
    ]);
    expect(picker.availableMetricGroups).toEqual([]);
    expect(getEventLapColumnPickerOptions(getEventLapMetricOptionGroups(), []).selectedMetrics).toEqual([]);
  });

  it('moves a selected column without altering membership or the original saved layout', () => {
    const saved = [DataDuration.type, DataDistance.type, DataHeartRateMax.type, DataSwimPaceAvg.type];
    const moved = moveEventLapMetricType(saved, DataSwimPaceAvg.type, -1);
    expect(moved).toEqual([DataDuration.type, DataDistance.type, DataSwimPaceAvg.type, DataHeartRateMax.type]);
    expect(moveEventLapMetricType(moved, DataSwimPaceAvg.type, 1)).toEqual(saved);
    expect(saved).toEqual([DataDuration.type, DataDistance.type, DataHeartRateMax.type, DataSwimPaceAvg.type]);
    expect(moveEventLapMetricType(saved, DataDuration.type, -1)).toEqual(saved);
    expect(moveEventLapMetricType(saved, DataSwimPaceAvg.type, 1)).toEqual(saved);
    expect(moveEventLapMetricType(saved, 'missing', -1)).toEqual(saved);
    expect(moveEventLapMetricType([], DataDuration.type, 1)).toEqual([]);
  });

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
    expect(getDefaultEventLapMetricTypes('swimming')).toContain(EVENT_LAP_STROKE_COLUMN);
    expect(getDefaultEventLapMetricTypes('running')).not.toContain(EVENT_LAP_STROKE_COLUMN);
    expect(getDefaultEventLapMetricTypes('cycling')).not.toContain(EVENT_LAP_STROKE_COLUMN);
    expect(getDefaultEventLapMetricTypes('other')).not.toContain(EVENT_LAP_STROKE_COLUMN);
    expect(getDefaultEventLapMetricTypes('other')).toContain(DataSpeedAvg.type);
    expect(EVENT_LAP_TABLE_FIXED_COLUMN).toBe('#');
  });

  it('only accepts supported sport families for persisted layouts', () => {
    expect(isEventLapSportFamily('running')).toBe(true);
    expect(isEventLapSportFamily('rowing')).toBe(false);
    expect(isEventLapSportFamily(null)).toBe(false);
  });

  it.each(['Climbing', 'Rock Climbing', 'Indoor Climbing', 'Bouldering', 'Floor Climbing'])('hides default effort columns for %s while retaining explicit layouts', sport => {
      expect(getSelectedEventLapMetricTypes(null, 'other', [sport])).not.toContain(DataSpeedAvg.type);
      const custom = [DataSpeedAvg.type, DataPaceAvg.type, DataGradeAdjustedPaceAvg.type];
      expect(getSelectedEventLapMetricTypes({ lapTableColumnsBySportFamily: { other: custom } }, 'other', [sport])).toEqual(custom);
      expect(getSelectedEventLapMetricTypes({ lapTableColumnsBySportFamily: { other: [] } }, 'other', [sport])).toEqual([]);
    });

  it('retains default effort for another sport sharing the Other lap family', () => {
    expect(getDefaultEventLapMetricTypes('other', ['Climbing', 'Hiking'])).toContain(DataSpeedAvg.type);
    expect(getDefaultEventLapMetricTypes('other', ['Hiking'])).toContain(DataSpeedAvg.type);
    expect(getDefaultEventLapMetricTypes('running', ['Running'])).toContain(DataPaceAvg.type);
  });

  it('offers stroke as a selectable column while respecting existing saved swim layouts', () => {
    expect(getEventLapMetricOptionGroups().flatMap(group => group.metrics))
      .toContainEqual({ type: EVENT_LAP_STROKE_COLUMN, label: 'Stroke' });
    expect(normalizeEventLapMetricTypes([EVENT_LAP_STROKE_COLUMN, DataDuration.type]))
      .toEqual([EVENT_LAP_STROKE_COLUMN, DataDuration.type]);
    expect(getSelectedEventLapMetricTypes({ lapTableColumnsBySportFamily: { swimming: [DataDuration.type] } }, 'swimming'))
      .toEqual([DataDuration.type]);
    expect(getSelectedEventLapMetricTypes({ lapTableColumnsBySportFamily: { swimming: [] } }, 'swimming')).toEqual([]);
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
    expect(optionGroups.map((group) => group.id)).toContain('diving');
    expect(optionGroups.flatMap((group) => group.metrics).map((metric) => metric.type))
      .toContain(DataPaceAvg.type);
    expect(optionGroups.flatMap((group) => group.metrics).map((metric) => metric.type))
      .toEqual(expect.arrayContaining([DataDepthAvg.type, DataDiveNumber.type]));
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

  it('formats swimming lap distance in yards while retaining running distance preferences', () => {
    expect(formatEventLapMetric(new DataDistance(91.44), DataDistance.type, unitSettings, 'Swimming')).toBe('100 yd');
    expect(formatEventLapMetric(new DataDistance(1609.344), DataDistance.type, unitSettings, 'Running')).toBe('1.61 Km');
  });

  it('uses corroborated nominal lap distance only for display and selected distance summaries', () => {
    const { activity, lap } = createNominalYardPoolFixture();
    expect(formatEventLapMetric(lap.getDistance(), DataDistance.type, unitSettings, 'Swimming', 91.44)).toBe('100 yd');
    expect(lap.getDistance().getValue()).toBe(91.4);
    const summaries = getSelectedEventLapSummaryMetrics([lap], [DataDistance.type, DataDuration.type], unitSettings, 'Swimming', activity);
    expect(summaries.find(metric => metric.type === DataDistance.type)?.display).toBe('100 yd');
    expect(summaries.find(metric => metric.type === DataDuration.type)?.display).toBe('2:00.00');
  });

  it('keeps a selected nominal swim distance consistent when zero-distance rest laps also contribute', () => {
    const { activity, lap } = createNominalYardPoolFixture();
    const rest = { ...lap, getDistance: () => new DataDistance(0) } as LapInterface;
    activity.getLaps = () => [lap, rest];
    const summaries = getSelectedEventLapSummaryMetrics([lap, rest], [DataDistance.type], unitSettings, 'Swimming', activity);
    expect(summaries[0]).toEqual({ type: DataDistance.type, display: '50 yd', availableCount: 2, selectedCount: 2 });
    const meters = { ...unitSettings, swimPaceUnits: [SwimPaceUnits.MinutesPer100Meter] };
    expect(getSelectedEventLapSummaryMetrics([lap, rest], [DataDistance.type], meters, 'Swimming', activity)[0].display).toBe('45.7 m');
    expect(lap.getDistance().getValue()).toBe(91.4);
    expect(rest.getDistance().getValue()).toBe(0);
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

  it('summarizes selected accumulated and ordinary metrics with available coverage', () => {
    const laps = [
      { duration: 120, distance: 1000, energy: 300, heartRate: 160 },
      { duration: 180, distance: 1500, energy: undefined, heartRate: 180 },
    ].map(({ duration, distance, energy, heartRate }) => ({
      getDuration: () => new DataDuration(duration),
      getDistance: () => new DataDistance(distance),
      getStat: (type: string) => type === DataEnergy.type && energy !== undefined
        ? new DataEnergy(energy)
        : type === DataHeartRateMax.type
          ? new DataHeartRateMax(heartRate)
          : undefined,
    } as unknown as LapInterface));

    const summaries = getSelectedEventLapSummaryMetrics(
      laps,
      [DataDuration.type, DataDistance.type, DataEnergy.type, DataHeartRateMax.type],
      unitSettings,
      'Running',
    );

    expect(summaries).toEqual([
      {
        type: DataDuration.type,
        display: formatEventLapMetric(new DataDuration(150), DataDuration.type, unitSettings, 'Running'),
        availableCount: 2,
        selectedCount: 2,
      },
      {
        type: DataDistance.type,
        display: formatEventLapMetric(new DataDistance(1250), DataDistance.type, unitSettings, 'Running'),
        availableCount: 2,
        selectedCount: 2,
      },
      {
        type: DataEnergy.type,
        display: formatEventLapMetric(new DataEnergy(300), DataEnergy.type, unitSettings, 'Running'),
        availableCount: 1,
        selectedCount: 2,
      },
      {
        type: DataHeartRateMax.type,
        display: formatEventLapMetric(new DataHeartRateMax(170), DataHeartRateMax.type, unitSettings, 'Running'),
        availableCount: 2,
        selectedCount: 2,
      },
    ]);
  });

  it('weights every supported average pace and speed variant by its required metric', () => {
    const laps = [
      {
        duration: 120,
        distance: 1000,
        pace: 300,
        swimPace: 90,
        gradeAdjustedPace: 310,
        effortPace: 320,
        speed: 5,
        gradeAdjustedSpeed: 4,
      },
      {
        duration: 480,
        distance: 3000,
        pace: 400,
        swimPace: 150,
        gradeAdjustedPace: 430,
        effortPace: 440,
        speed: 10,
        gradeAdjustedSpeed: 8,
      },
    ].map((values) => ({
      getDuration: () => new DataDuration(values.duration),
      getDistance: () => new DataDistance(values.distance),
      getStat: (type: string) => {
        const stats = new Map<string, number>([
          [DataPaceAvg.type, values.pace],
          [DataSwimPaceAvg.type, values.swimPace],
          [DataGradeAdjustedPaceAvg.type, values.gradeAdjustedPace],
          [DataEffortPaceAvg.type, values.effortPace],
          [DataSpeedAvg.type, values.speed],
          [DataGradeAdjustedSpeedAvg.type, values.gradeAdjustedSpeed],
          [DataPaceMax.type, values.pace],
        ]);
        const value = stats.get(type);
        if (value === undefined) {
          return undefined;
        }
        if (type === DataPaceAvg.type) return new DataPaceAvg(value);
        if (type === DataSwimPaceAvg.type) return new DataSwimPaceAvg(value);
        if (type === DataGradeAdjustedPaceAvg.type) return new DataGradeAdjustedPaceAvg(value);
        if (type === DataEffortPaceAvg.type) return new DataEffortPaceAvg(value);
        if (type === DataSpeedAvg.type) return new DataSpeedAvg(value);
        if (type === DataGradeAdjustedSpeedAvg.type) return new DataGradeAdjustedSpeedAvg(value);
        return new DataPaceMax(value);
      },
    } as unknown as LapInterface));
    const metricTypes = [
      DataPaceAvg.type,
      DataSwimPaceAvg.type,
      DataGradeAdjustedPaceAvg.type,
      DataEffortPaceAvg.type,
      DataSpeedAvg.type,
      DataGradeAdjustedSpeedAvg.type,
      DataPaceMax.type,
    ];

    const summaries = getSelectedEventLapSummaryMetrics(laps, metricTypes, unitSettings, 'Running');

    expect(summaries).toEqual([
      {
        type: DataPaceAvg.type,
        display: formatEventLapMetric(new DataPaceAvg(375), DataPaceAvg.type, unitSettings, 'Running'),
        availableCount: 2,
        selectedCount: 2,
      },
      {
        type: DataSwimPaceAvg.type,
        display: formatEventLapMetric(new DataSwimPaceAvg(135), DataSwimPaceAvg.type, unitSettings, 'Running'),
        availableCount: 2,
        selectedCount: 2,
      },
      {
        type: DataGradeAdjustedPaceAvg.type,
        display: formatEventLapMetric(new DataGradeAdjustedPaceAvg(400), DataGradeAdjustedPaceAvg.type, unitSettings, 'Running'),
        availableCount: 2,
        selectedCount: 2,
      },
      {
        type: DataEffortPaceAvg.type,
        display: formatEventLapMetric(new DataEffortPaceAvg(410), DataEffortPaceAvg.type, unitSettings, 'Running'),
        availableCount: 2,
        selectedCount: 2,
      },
      {
        type: DataSpeedAvg.type,
        display: formatEventLapMetric(new DataSpeedAvg(9), DataSpeedAvg.type, unitSettings, 'Running'),
        availableCount: 2,
        selectedCount: 2,
      },
      {
        type: DataGradeAdjustedSpeedAvg.type,
        display: formatEventLapMetric(new DataGradeAdjustedSpeedAvg(7.2), DataGradeAdjustedSpeedAvg.type, unitSettings, 'Running'),
        availableCount: 2,
        selectedCount: 2,
      },
      {
        type: DataPaceMax.type,
        display: formatEventLapMetric(new DataPaceMax(350), DataPaceMax.type, unitSettings, 'Running'),
        availableCount: 2,
        selectedCount: 2,
      },
    ]);
  });

  it('skips invalid weighted contributions instead of treating unavailable weights as zero', () => {
    const laps = [
      { distance: 1000, duration: 120, pace: 300, speed: 5 },
      { distance: 0, duration: 0, pace: 600, speed: 10 },
      { distance: 1000, duration: 120, pace: Number.NaN, speed: Number.NaN },
    ].map((values) => ({
      getDuration: () => new DataDuration(values.duration),
      getDistance: () => new DataDistance(values.distance),
      getStat: (type: string) => type === DataPaceAvg.type
        ? new DataPaceAvg(values.pace)
        : type === DataSpeedAvg.type
          ? new DataSpeedAvg(values.speed)
          : undefined,
    } as unknown as LapInterface));

    expect(getSelectedEventLapSummaryMetrics(
      laps,
      [DataPaceAvg.type, DataSpeedAvg.type],
      unitSettings,
      'Running',
    )).toEqual([
      {
        type: DataPaceAvg.type,
        display: formatEventLapMetric(new DataPaceAvg(300), DataPaceAvg.type, unitSettings, 'Running'),
        availableCount: 1,
        selectedCount: 3,
      },
      {
        type: DataSpeedAvg.type,
        display: formatEventLapMetric(new DataSpeedAvg(5), DataSpeedAvg.type, unitSettings, 'Running'),
        availableCount: 1,
        selectedCount: 3,
      },
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
