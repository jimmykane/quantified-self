import { describe, expect, it } from 'vitest';
import {
  ActivityInterface, DataActiveLap, DataDistance, DataDuration, SwimPaceUnits,
} from '@sports-alliance/sports-lib';
import { createSwimDistanceDisplayStat, getDefaultUserUnitSettings, resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';
import { getActivitySwimLengths } from './event-swim-length.helper';
import { getNormalizedSwolf, getSwimLapAnalytics } from './event-swim-analytics.helper';
import { getNominalSwimDistanceDisplayContext, getNominalSwimLengthsDisplayMeters } from './event-swim-distance-display.helper';
import { createNominalYardPoolFixture as fixture } from './event-swim-distance-display.test-fixtures';

const yards = { ...getDefaultUserUnitSettings(), swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] };
const meters = getDefaultUserUnitSettings();

function display(activity: ActivityInterface, units = yards) {
  const context = getNominalSwimDistanceDisplayContext(activity);
  const lengths = getActivitySwimLengths(activity);
  const rawTotal = lengths.reduce((sum, length) => sum + (length.distance?.getValue() ?? 0), 0);
  return resolveUnitAwareDisplayStat(createSwimDistanceDisplayStat(rawTotal, units,
    getNominalSwimLengthsDisplayMeters(context, lengths)), units)?.text;
}

describe('nominal yard-pool distance display evidence', () => {
  it.each([25, 50])('corroborates %s yards with complete speed/elapsed evidence', nominal => {
    const { activity, lap } = fixture(4, nominal);
    const context = getNominalSwimDistanceDisplayContext(activity);
    expect(context?.poolMeters).toBe(nominal * 0.9144);
    expect(context?.lapMeters.get(lap)).toBe(4 * nominal * 0.9144);
    expect(display(activity)).toBe(`${4 * nominal} yd`);
  });

  it('uses nominal counts for long totals without changing canonical values or JSON', () => {
    const { activity } = fixture(120);
    const context = getNominalSwimDistanceDisplayContext(activity);
    const lengths = getActivitySwimLengths(activity);
    const raw = lengths.reduce((sum, length) => sum + length.distance.getValue(), 0);
    const stat = createSwimDistanceDisplayStat(raw, yards, getNominalSwimLengthsDisplayMeters(context, lengths));
    expect(resolveUnitAwareDisplayStat(stat, yards)?.text).toBe('3.000 yd');
    expect(stat.getValue()).toBe(raw);
    expect(stat.toJSON()).toEqual(createSwimDistanceDisplayStat(raw, yards).toJSON());
    expect(display(activity, meters)).toBe(resolveUnitAwareDisplayStat(createSwimDistanceDisplayStat(raw, meters), meters)?.text);
  });

  it('does not let a display override conceal zero, negative, or an invalid nominal amount', () => {
    expect(createSwimDistanceDisplayStat(0, yards, 22.86).getDisplayValue()).toBe('0');
    expect(createSwimDistanceDisplayStat(-22.86, yards, 22.86).getDisplayValue()).toBe('-25');
    for (const nominal of [0, -22.86, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(createSwimDistanceDisplayStat(22.896576, yards, nominal).getDisplayValue()).toBe('25.04');
    }
  });

  it('preserves pace, normalized SWOLF, and the original length records', () => {
    const { activity, rawLengths } = fixture();
    const before = JSON.stringify(rawLengths);
    const analytics = getSwimLapAnalytics(activity, yards).get(activity.getLaps()[0]);
    const swolf = getNormalizedSwolf(120, 4 * 25.04 * 0.9144, 40, yards)?.getValue();
    expect(display(activity)).toBe('100 yd');
    expect(getSwimLapAnalytics(activity, yards).get(activity.getLaps()[0])).toEqual(analytics);
    expect(getNormalizedSwolf(120, 4 * 25.04 * 0.9144, 40, yards)?.getValue()).toBe(swolf);
    expect(JSON.stringify(rawLengths)).toBe(before);
  });

  it('uses elapsed precision instead of the rounded timer for corroboration', () => {
    const { activity, rawLengths } = fixture();
    rawLengths.forEach(length => length.timerTime = 29.9);
    expect(getNominalSwimDistanceDisplayContext(activity)?.poolMeters).toBe(22.86);
  });

  it.each([25, 50])('retains a physical %s-metre pool under yard preferences', pool => {
    const { activity } = fixture(4, 25, { pool, speed: pool / 20, elapsed: 20, total: 4 * pool });
    expect(getNominalSwimDistanceDisplayContext(activity)).toBeNull();
    expect(display(activity)).toBe(pool === 25 ? '109.36 yd' : '218.72 yd');
  });

  it.each([22.896576, 23.1])('does not hide a genuinely recorded fractional pool of %s metres', pool => {
    const { activity } = fixture(4, 25, { pool, speed: Math.round(pool / 30 * 1000) / 1000, total: 4 * pool });
    expect(getNominalSwimDistanceDisplayContext(activity)).toBeNull();
  });

  it.each(['missing speed', 'missing elapsed', 'missing pool', 'missing distance', 'explicit zero', 'conflicting speed', 'non-FIT precision', 'unknown type', 'partial active count', 'duplicate index', 'duplicate start', 'rest distance'])('%s leaves fractional output unchanged', problem => {
    const { activity, rawLengths } = fixture();
    const row = rawLengths[0] as Record<string, unknown>;
    switch (problem) {
      case 'missing speed': row.avgSpeed = null; break;
      case 'missing elapsed': row.elapsedTime = null; break;
      case 'missing pool': row.poolLength = null; break;
      case 'missing distance': row.distance = null; break;
      case 'explicit zero': row.distance = 0; break;
      case 'conflicting speed': row.avgSpeed = 0.8; break;
      case 'non-FIT precision': row.avgSpeed = 0.7620001; break;
      case 'unknown type': row.type = 'unknown'; break;
      case 'partial active count': rawLengths.pop(); break;
      case 'duplicate index': rawLengths[1].index = 1; break;
      case 'duplicate start': rawLengths[1].startDate = 0; break;
      case 'rest distance': row.type = 'idle'; break;
    }
    expect(getNominalSwimDistanceDisplayContext(activity)).toBeNull();
  });

  it('rejects a contradictory activity total and declines unknown source context', () => {
    expect(getNominalSwimDistanceDisplayContext(fixture(4, 25, { total: 110 }).activity)).toBeNull();
    const { activity } = fixture();
    activity.creator.name = 'Unknown';
    expect(getNominalSwimDistanceDisplayContext(activity)).toBeNull();
    activity.creator.name = 'Suunto synthetic';
    activity.type = 'Open Water Swimming' as ActivityInterface['type'];
    expect(getNominalSwimDistanceDisplayContext(activity)).toBeNull();
  });

  it('declines malformed creator evidence without throwing', () => {
    const { activity } = fixture();
    Object.assign(activity.creator, { name: 123 });
    expect(getNominalSwimDistanceDisplayContext(activity)).toBeNull();
  });

  it('does not borrow nominal counts from malformed or mismatched lap ownership', () => {
    const { activity, lap, rawLengths } = fixture();
    rawLengths.forEach(length => length.lapIndex = 999);
    expect(getNominalSwimDistanceDisplayContext(activity)?.lapMeters.get(lap)).toBe(91.44);
    lap.getDuration = () => new DataDuration(150);
    expect(getNominalSwimDistanceDisplayContext(activity)?.lapMeters.size).toBe(0);
    expect(display(activity)).toBe('100 yd');
  });

  it('keeps recorded zero rests separate and never gives a rest a nominal distance', () => {
    const { activity, rawLengths } = fixture();
    rawLengths.push({ ...rawLengths[0], index: 5, type: 'idle', startDate: 120000, endDate: 125000,
      timerTime: 5, elapsedTime: 5, distance: 0, avgSpeed: 0, strokes: 0 });
    const context = getNominalSwimDistanceDisplayContext(activity);
    const lengths = getActivitySwimLengths(activity);
    expect(context?.poolMeters).toBe(22.86);
    expect(getNominalSwimLengthsDisplayMeters(context, [lengths[4]])).toBeUndefined();
    expect(display(activity)).toBe('100 yd');
    rawLengths[4].distance = 1;
    expect(getNominalSwimDistanceDisplayContext(activity)).toBeNull();
  });

  it('does not clean an incomplete group or a lap with contradictory recorded count/distance', () => {
    const { activity, lap } = fixture();
    const context = getNominalSwimDistanceDisplayContext(activity);
    const lengths = getActivitySwimLengths(activity);
    expect(getNominalSwimLengthsDisplayMeters(context, [{ ...lengths[0], distance: null }])).toBeUndefined();
    lap.getDistance = () => new DataDistance(120);
    expect(getNominalSwimDistanceDisplayContext(activity)?.lapMeters.size).toBe(0);
  });

  it('never cleans a lap explicitly recorded as rest, even with a contradictory positive distance', () => {
    const { activity, lap } = fixture();
    Object.assign(lap, { getStat: (type: string) => type === DataActiveLap.type ? new DataActiveLap(false) : undefined });
    const context = getNominalSwimDistanceDisplayContext(activity);
    expect(context?.poolMeters).toBe(22.86);
    expect(context?.lapMeters.size).toBe(0);
  });
});
