import {
  ActivityInterface,
  ActivityTypes,
  DataDistance,
  DataDistanceMiles,
  DataPowerAvg,
  DataSpeedAvg,
  DataSpeedAvgKilometersPerHour,
  DynamicDataLoader,
  DistanceUnits,
  SwimPaceUnits,
} from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDiffMapForStats, buildStatDisplayList, computeStatDiff } from './stats-diff.helper';

const createStat = (type: string, displayType: string, value = 0, unit = '') => ({
  getType: () => type,
  getDisplayType: () => displayType,
  getDisplayValue: () => String(value),
  getDisplayUnit: () => unit,
  getValue: () => value,
}) as any;

describe('stats-diff.helper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const distanceActivity = (type: ActivityTypes, meters: number): ActivityInterface => ({
    type,
    getStat: (statType: string) => statType === DataDistance.type ? new DataDistance(meters) : null,
  }) as ActivityInterface;

  it.each([DistanceUnits.Kilometers, DistanceUnits.Miles])('formats swim distance differences in yards with general %s units', (distanceUnits) => {
    const settings = normalizeUserUnitSettings({ distanceUnits, swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] });
    const result = computeStatDiff(distanceActivity(ActivityTypes.Swimming, 91.44), distanceActivity(ActivityTypes.OpenWaterSwimming, 68.58),
      DataDistance.type, DataDistance.type, settings);
    expect(result?.display).toBe('25 yd');
    expect(result?.percent).toBeCloseTo(28.5714);
  });

  it('keys swim comparison differences by the displayed canonical distance even when general distances use miles', () => {
    const settings = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles, swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] });
    const diffMap = buildDiffMapForStats([new DataDistance(160.02)], [DataDistance.type],
      [distanceActivity(ActivityTypes.Swimming, 91.44), distanceActivity(ActivityTypes.Swimming, 68.58)], settings);
    expect(diffMap.get(DataDistance.type)?.display).toBe('25 yd');
  });

  it('keeps comparison labels aligned with swim difference keys and preserves general units for other sports', () => {
    const settings = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles, swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] });
    const stats = [new DataDistance(160.02)];
    expect(buildStatDisplayList(stats, [DataDistance.type], settings, [ActivityTypes.Swimming]))
      .toEqual([{ type: DataDistance.type, label: 'Distance' }]);
    expect(buildStatDisplayList(stats, [DataDistance.type], settings, [ActivityTypes.Running]))
      .toEqual([{ type: DataDistanceMiles.type, label: 'Distance' }]);
    const mixed = computeStatDiff(distanceActivity(ActivityTypes.Swimming, 1609.344), distanceActivity(ActivityTypes.Running, 804.672),
      DataDistance.type, DataDistance.type, settings);
    expect(mixed?.display).toBe('0.50 mi');
    expect(mixed?.percent).toBeCloseTo(66.6667);
  });


  it('should normalize unit-derived labels in buildStatDisplayList', () => {
    const speedBaseStat = createStat(DataSpeedAvg.type, 'Average Speed');
    const speedKphStat = createStat(
      DataSpeedAvgKilometersPerHour.type,
      'Average speed in kilometers per hour',
      30,
      'km/h'
    );

    vi.spyOn(DynamicDataLoader, 'getUnitBasedDataFromDataInstance').mockReturnValue([speedKphStat] as any);

    const displayList = buildStatDisplayList(
      [speedBaseStat],
      [DataSpeedAvg.type],
      {} as any
    );

    expect(displayList).toEqual([
      {
        type: DataSpeedAvgKilometersPerHour.type,
        label: 'Average Speed',
      },
    ]);
  });

  it('should keep non-unit labels unchanged and dedupe by display type', () => {
    const powerStat = createStat(DataPowerAvg.type, 'Average Power', 250, 'W');
    vi.spyOn(DynamicDataLoader, 'getUnitBasedDataFromDataInstance').mockReturnValue([powerStat] as any);

    const displayList = buildStatDisplayList(
      [powerStat],
      [DataPowerAvg.type, DataPowerAvg.type],
      {} as any
    );

    expect(displayList.length).toBe(1);
    expect(displayList[0]).toEqual({
      type: DataPowerAvg.type,
      label: 'Average Power',
    });
  });

  it('should compute diff when display stat exists directly on activities', () => {
    const activityA = {
      getStat: (type: string) => {
        if (type === DataPowerAvg.type) {
          return { getValue: () => 200 };
        }
        return null;
      },
    } as any;

    const activityB = {
      getStat: (type: string) => {
        if (type === DataPowerAvg.type) {
          return { getValue: () => 100 };
        }
        return null;
      },
    } as any;

    const result = computeStatDiff(
      activityA,
      activityB,
      DataPowerAvg.type,
      DataPowerAvg.type,
      {} as any
    );

    expect(result).toBeTruthy();
    expect(result?.percent).toBeCloseTo(66.666, 2);
    expect((result?.display || '').toLowerCase()).toContain('watt');
  });

  it('should compute diff via base-stat unit expansion fallback when display stat is missing', () => {
    const baseStatA = { marker: 'a' };
    const baseStatB = { marker: 'b' };
    const speedKphA = { getType: () => DataSpeedAvgKilometersPerHour.type, getValue: () => 30 };
    const speedKphB = { getType: () => DataSpeedAvgKilometersPerHour.type, getValue: () => 20 };

    const unitSpy = vi.spyOn(DynamicDataLoader, 'getUnitBasedDataFromDataInstance')
      .mockImplementation((stat: any) => {
        if (stat?.marker === 'a') {
          return [speedKphA] as any;
        }
        if (stat?.marker === 'b') {
          return [speedKphB] as any;
        }
        return [];
      });

    const activityA = {
      getStat: (type: string) => {
        if (type === DataSpeedAvg.type) {
          return baseStatA;
        }
        return null;
      },
    } as any;

    const activityB = {
      getStat: (type: string) => {
        if (type === DataSpeedAvg.type) {
          return baseStatB;
        }
        return null;
      },
    } as any;

    const result = computeStatDiff(
      activityA,
      activityB,
      DataSpeedAvg.type,
      DataSpeedAvgKilometersPerHour.type,
      {} as any
    );

    expect(unitSpy).toHaveBeenCalled();
    expect(result).toBeTruthy();
    expect(result?.percent).toBeCloseTo(40, 2);
    expect(result?.display).toContain('km/h');
  });

  it('should build diff map with unit-based display types', () => {
    const speedBaseStat = createStat(DataSpeedAvg.type, 'Average Speed');
    const speedKphStat = createStat(
      DataSpeedAvgKilometersPerHour.type,
      'Average speed in kilometers per hour',
      30,
      'km/h'
    );

    vi.spyOn(DynamicDataLoader, 'getUnitBasedDataFromDataInstance').mockReturnValue([speedKphStat] as any);

    const activityA = {
      getStat: (type: string) => {
        if (type === DataSpeedAvgKilometersPerHour.type) {
          return { getValue: () => 30 };
        }
        return null;
      },
    } as any;

    const activityB = {
      getStat: (type: string) => {
        if (type === DataSpeedAvgKilometersPerHour.type) {
          return { getValue: () => 27 };
        }
        return null;
      },
    } as any;

    const diffMap = buildDiffMapForStats(
      [speedBaseStat],
      [DataSpeedAvg.type],
      [activityA, activityB],
      {} as any
    );

    expect(diffMap.has(DataSpeedAvgKilometersPerHour.type)).toBe(true);
    expect(diffMap.get(DataSpeedAvgKilometersPerHour.type)?.display).toContain('km/h');
  });
});
