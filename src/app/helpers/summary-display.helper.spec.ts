import { ActivityTypes, DataDistance, DistanceUnits, SwimPaceUnits } from '@sports-alliance/sports-lib';
import { createSwimDistanceDisplayStat, normalizeUserUnitSettings, resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';
import { buildHeroMetric, resolvePrimaryUnitAwareDisplayStat } from './summary-display.helper';

describe('recorded swim distance display', () => {
  it('defaults to meters even when general distances use miles', () => {
    const settings = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles });
    expect(resolvePrimaryUnitAwareDisplayStat(new DataDistance(1500), settings, DataDistance.type, [ActivityTypes.Swimming]))
      .toMatchObject({ value: '1.500', unit: 'm' });
  });

  it.each([ActivityTypes.Swimming, ActivityTypes.OpenWaterSwimming])('uses yards for %s summaries and hero metrics', (sport) => {
    const settings = normalizeUserUnitSettings({ swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] });
    const distance = new DataDistance(91.44);
    expect(resolvePrimaryUnitAwareDisplayStat(distance, settings, DataDistance.type, [sport]))
      .toMatchObject({ type: DataDistance.type, value: '100', unit: 'yd', text: '100 yd' });
    expect(buildHeroMetric(DataDistance.type, distance, settings, [sport])).toEqual({ value: '100', label: 'yd' });
    expect(distance.getValue()).toBe(91.44);
    expect(distance.toJSON()).toEqual({ Distance: 91.44 });
  });

  it('uses the first swim preference, with safe defaults for empty and invalid settings', () => {
    for (const swimPaceUnits of [undefined, [], ['invalid'], [SwimPaceUnits.MinutesPer100Meter, SwimPaceUnits.MinutesPer100Yard]]) {
      const settings = normalizeUserUnitSettings({ swimPaceUnits });
      expect(resolveUnitAwareDisplayStat(createSwimDistanceDisplayStat(91.44, settings), settings)?.unit).toBe('m');
    }
    const settings = normalizeUserUnitSettings({ swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard, SwimPaceUnits.MinutesPer100Meter] });
    expect(resolveUnitAwareDisplayStat(createSwimDistanceDisplayStat(91.44, settings), settings)?.text).toBe('100 yd');
  });

  it('keeps general distance units for running and mixed-sport summaries', () => {
    const settings = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles, swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] });
    for (const sports of [[ActivityTypes.Running], [ActivityTypes.Swimming, ActivityTypes.Running]]) {
      expect(resolvePrimaryUnitAwareDisplayStat(new DataDistance(1609.344), settings, DataDistance.type, sports))
        .toMatchObject({ value: '1.00', unit: 'mi' });
    }
  });
});
