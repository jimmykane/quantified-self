import { describe, expect, it } from 'vitest';
import {
  ActivityTypes,
  ActivityTypesHelper,
  DataAirPower,
  DataAltitude,
  DataCadence,
  DataDepth,
  DataDepthFeet,
  DataHeartRate,
  DataPace,
  DataPaceMinutesPerMile,
  DataPower,
  DataPowerLeft,
  DataPowerRight,
  DataSpeed,
  DataSpeedKnots,
  DataSwimPace,
  DataTemperature,
} from '@sports-alliance/sports-lib';
import {
  getEventChartMetricFamily,
  getEventChartSelectionKey,
  getUnclassifiedEventChartActivityTypes,
  resolveEventChartRecommendations,
  resolveEventChartSportProfile,
} from './event-chart-sport-profile.helper';

describe('event chart sport profiles', () => {
  it('classifies every canonical Sports Lib activity type explicitly', () => {
    expect(ActivityTypesHelper.getActivityTypesAsUniqueArray().length).toBeGreaterThan(100);
    expect(getUnclassifiedEventChartActivityTypes()).toEqual([]);
  });

  it.each([
    [ActivityTypes.Running, 'running', ['heart-rate', 'pace', 'power']],
    [ActivityTypes.TrailRunning, 'trail-running', ['pace', 'power', 'altitude']],
    [ActivityTypes.Cycling, 'cycling', ['heart-rate', 'power', 'speed']],
    [ActivityTypes.IndoorCycling, 'indoor-cycling', ['heart-rate', 'power', 'cadence']],
    [ActivityTypes.MountainBiking, 'mountain-biking', ['heart-rate', 'speed', 'altitude']],
    [ActivityTypes.Swimming, 'pool-swimming', ['heart-rate', 'swim-pace', 'stroke-rate']],
    [ActivityTypes.CrosscountrySkiing, 'cross-country-skiing', ['altitude', 'heart-rate', 'power']],
    [ActivityTypes.Transition, 'empty', []],
  ])('resolves %s to its required profile', (activityType, profileID, firstFamilies) => {
    const resolution = resolveEventChartSportProfile([activityType]);
    expect(resolution.profileID).toBe(profileID);
    expect(resolution.candidateFamilies.slice(0, firstFamilies.length)).toEqual(firstFamilies);
  });

  it('uses canonical unique types for signatures and shares only identical profiles', () => {
    const oneRun = resolveEventChartSportProfile([ActivityTypes.Running]);
    const repeatedRun = resolveEventChartSportProfile([ActivityTypes.Running, ActivityTypes.Running]);
    const cyclingAliases = resolveEventChartSportProfile([ActivityTypes.Cycling, ActivityTypes.EBiking]);
    const mixedCycling = resolveEventChartSportProfile([ActivityTypes.Cycling, ActivityTypes.IndoorCycling]);
    const mixedRunning = resolveEventChartSportProfile([ActivityTypes.Running, ActivityTypes.Treadmill]);

    expect(repeatedRun.signature).toBe(oneRun.signature);
    expect(cyclingAliases.profileID).toBe('cycling');
    expect(cyclingAliases.source).toBe('shared-profile');
    expect(mixedCycling.profileID).toBe('multisport');
    expect(mixedCycling.source).toBe('multisport');
    expect(mixedRunning.profileID).toBe('multisport');
  });

  it('applies the explicit Skating and Tactical decisions', () => {
    expect(resolveEventChartSportProfile([ActivityTypes.InlineSkating]).profileID).toBe('ice-skating');
    expect(resolveEventChartSportProfile([ActivityTypes.Skating]).profileID).toBe('ice-skating');
    expect(resolveEventChartSportProfile([ActivityTypes.Tactical]).profileID).toBe('fitness');
  });

  it('selects up to three available and globally allowed families without padding', () => {
    const profile = resolveEventChartSportProfile([ActivityTypes.Running]);
    const result = resolveEventChartRecommendations({
      profile,
      panels: [
        panel(DataHeartRate.type),
        panel(DataPace.type),
        panel(DataPower.type),
        panel(DataAltitude.type),
        panel(DataTemperature.type),
      ],
      globallyAllowedDataTypes: [DataHeartRate.type, DataPace.type, DataAltitude.type, DataTemperature.type],
    });

    expect(result.automaticDataTypes).toEqual([DataHeartRate.type, DataPace.type, DataAltitude.type]);
    expect(result.recommendedDataTypes).toEqual([
      DataHeartRate.type,
      DataPace.type,
      DataPower.type,
      DataAltitude.type,
      DataTemperature.type,
    ]);
    expect(result.otherDataTypes).toEqual([]);
  });

  it('keeps globally disabled recommendations grouped but unchecked', () => {
    const profile = resolveEventChartSportProfile([ActivityTypes.IndoorCycling]);
    const result = resolveEventChartRecommendations({
      profile,
      panels: [panel(DataHeartRate.type), panel(DataPower.type), panel(DataCadence.type)],
      globallyAllowedDataTypes: [DataHeartRate.type],
    });

    expect(result.recommendedDataTypes).toEqual([DataHeartRate.type, DataPower.type, DataCadence.type]);
    expect(result.automaticDataTypes).toEqual([DataHeartRate.type]);
  });

  it('uses only one preferred Power panel for an automatic family slot', () => {
    const profile = resolveEventChartSportProfile([ActivityTypes.IndoorCycling]);
    const result = resolveEventChartRecommendations({
      profile,
      panels: [
        panel(DataHeartRate.type),
        panel(DataPowerLeft.type),
        panel(DataPowerRight.type),
        panel(DataAirPower.type),
        panel(DataPower.type),
        panel(DataCadence.type),
      ],
      globallyAllowedDataTypes: [
        DataHeartRate.type,
        DataPower.type,
        DataPowerLeft.type,
        DataPowerRight.type,
        DataAirPower.type,
        DataCadence.type,
      ],
    });

    expect(result.automaticDataTypes).toEqual([DataHeartRate.type, DataPower.type, DataCadence.type]);
    expect(result.recommendedDataTypes).toEqual([
      DataHeartRate.type,
      DataPower.type,
      DataAirPower.type,
      DataPowerRight.type,
      DataPowerLeft.type,
      DataCadence.type,
    ]);
  });

  it('resolves unit variants to stable selection keys and logical families', () => {
    expect(getEventChartSelectionKey(DataPaceMinutesPerMile.type)).toBe(DataPace.type);
    expect(getEventChartSelectionKey(DataSpeedKnots.type)).toBe(DataSpeed.type);
    expect(getEventChartSelectionKey(DataDepthFeet.type)).toBe(DataDepth.type);
    expect(getEventChartMetricFamily(DataPaceMinutesPerMile.type)).toBe('pace');
    expect(getEventChartMetricFamily(DataSpeedKnots.type)).toBe('speed');
  });

  it('applies automatic specialized-surface exclusions without removing recommendations', () => {
    const profile = resolveEventChartSportProfile([ActivityTypes.Snorkeling]);
    const result = resolveEventChartRecommendations({
      profile,
      panels: [
        panel(DataDepth.type),
        panel(DataTemperature.type),
        panel(DataHeartRate.type),
        panel(DataSpeed.type),
        panel(DataSwimPace.type),
      ],
      globallyAllowedDataTypes: [
        DataDepth.type,
        DataTemperature.type,
        DataHeartRate.type,
        DataSpeed.type,
        DataSwimPace.type,
      ],
      automaticExcludedDataTypes: [DataDepthFeet.type, DataTemperature.type, DataHeartRate.type],
    });

    expect(result.recommendedDataTypes).toEqual([
      DataDepth.type,
      DataTemperature.type,
      DataHeartRate.type,
      DataSpeed.type,
      DataSwimPace.type,
    ]);
    expect(result.automaticDataTypes).toEqual([DataSpeed.type, DataSwimPace.type]);
  });

  it('uses the non-depth Diving fallback when a generic dive has no depth panel', () => {
    const profile = resolveEventChartSportProfile([ActivityTypes.Diving]);
    const result = resolveEventChartRecommendations({
      profile,
      panels: [panel(DataHeartRate.type), panel(DataTemperature.type), panel(DataSpeed.type)],
      globallyAllowedDataTypes: [DataHeartRate.type, DataTemperature.type, DataSpeed.type],
    });

    expect(result.automaticDataTypes).toEqual([DataHeartRate.type, DataTemperature.type]);
    expect(result.otherDataTypes).toEqual([DataSpeed.type]);
  });
});

function panel(dataType: string) {
  return { dataType, displayName: dataType };
}
