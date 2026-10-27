import { describe, expect, it } from 'vitest';
import {
  ActivityTypes, DataDistance, DataDuration, DataHeartRateMax, DataStrokeRate, EventImporterJSON, LapTypes, SwimPaceUnits,
} from '@sports-alliance/sports-lib';
import { getDefaultUserUnitSettings } from '@shared/unit-aware-display';
import { getSwimIntervalActivity } from './event-swim-interval.helper';
import { getSwimLapAnalytics } from './event-swim-analytics.helper';
import { getSwimLapStrokeLabels } from './event-swim-length.helper';
import { createSwimIntervalFixture as swimIntervalFixture } from './event-swim-interval.test-fixtures';

describe('swim interval display projection', () => {
  it('makes one chronological sequence with full strokes, stroke labels and separate grouped rests', () => {
    const source = swimIntervalFixture();
    const before = JSON.stringify(source.toJSON());
    const display = getSwimIntervalActivity(source)!;
    const laps = display.getLaps();
    const analytics = [...getSwimLapAnalytics(display).values()];
    expect(laps.map(lap => lap.getDistance()?.getValue())).toEqual([100, 0, 25, 0, 50]);
    expect(laps.map(lap => lap.getDuration()?.getValue())).toEqual([120, 60, 30, 30, 60]);
    expect(analytics.map(row => row.strokes?.getValue() ?? null)).toEqual([53, null, 8, null, 28]);
    expect([...getSwimLapStrokeLabels(display).values()]).toEqual(['Freestyle', '', 'Butterfly', '', 'Mixed']);
    expect(analytics.map(row => row.lengths.map(length => length.index))).toEqual([[1, 2, 3, 4], [5, 6], [7], [8], [9, 10]]);
    expect(display.getStat(DataHeartRateMax.type).getValue()).toBe(180);
    expect(JSON.stringify(source.toJSON())).toBe(before);
    expect(source.getSwimLengths().every(length => length.lapIndex === null)).toBe(true);
  });

  it('also replaces old arbitrary memberships when parallel lap schemes remain', () => {
    const source = swimIntervalFixture();
    source.getSwimLengths().forEach(length => length.lapIndex = 1);
    expect([...getSwimLapAnalytics(getSwimIntervalActivity(source)!).values()][0].strokes?.getValue()).toBe(53);
  });

  it('preserves the session peak from original laps, including rests, without importing cross-leg peaks', () => {
    const source = swimIntervalFixture();
    source.getLaps()[0].addStat(new DataHeartRateMax(190));
    source.getLaps()[1].startDate = new Date(-1000);
    source.getLaps()[1].addStat(new DataHeartRateMax(210));
    expect(getSwimIntervalActivity(source)!.getStat(DataHeartRateMax.type).getValue()).toBe(190);
  });

  it('keeps an already assigned single lap scheme native', () => {
    const source = getSwimIntervalActivity(swimIntervalFixture())!;
    expect(getSwimIntervalActivity(source)).toBeNull();
  });

  it('preserves native set boundaries when only rest lengths have no lap membership', () => {
    const source = getSwimIntervalActivity(swimIntervalFixture())!;
    source.getSwimLengths().filter(length => length.type === 'idle').forEach(length => length.lapIndex = null);
    expect(getSwimIntervalActivity(source)).toBeNull();
  });

  it('does not treat a session-end summary as a competing lap scheme', () => {
    const source = getSwimIntervalActivity(swimIntervalFixture())!;
    source.getLaps().push(EventImporterJSON.getLapFromJSON({
      startDate: 0, endDate: 300000, lapId: 6, type: LapTypes.session_end,
      stats: { [DataDistance.type]: 175, [DataDuration.type]: 300 }, startIndex: null, endIndex: null,
    }, 5));
    expect(getSwimIntervalActivity(source)).toBeNull();
  });

  it('uses recorded timer durations and native distance for pace, cadence and normalized SWOLF', () => {
    const source = swimIntervalFixture();
    source.getSwimLengths()[0].timerTime = new DataDuration(0);
    const display = getSwimIntervalActivity(source)!;
    const meters = [...getSwimLapAnalytics(display, getDefaultUserUnitSettings()).values()][0];
    const yards = [...getSwimLapAnalytics(display, { ...getDefaultUserUnitSettings(), swimPaceUnits: [SwimPaceUnits.MinutesPer100Yard] }).values()][0];
    expect(meters.activeDuration).toBe(90);
    expect(meters.pace?.getValue()).toBe(90);
    expect(meters.swolf?.getValue()).toBe(35.8);
    expect(yards.swolf?.getValue()).toBe(32.7);
  });

  it('does not invent totals or averages from missing length fields', () => {
    const source = swimIntervalFixture();
    source.getSwimLengths()[0].strokes = null;
    source.getSwimLengths()[0].timerTime = null;
    source.getSwimLengths()[0].elapsedTime = null;
    const analytics = [...getSwimLapAnalytics(getSwimIntervalActivity(source)!).values()][0];
    expect(analytics.strokes).toBeNull();
    expect(analytics.activeDuration).toBeNull();
    expect(analytics.pace).toBeNull();
  });

  it.each([1, 4].flatMap(coverage => [SwimPaceUnits.MinutesPer100Meter, SwimPaceUnits.MinutesPer100Yard]
    .map(unit => ({ coverage, unit }))))('requires complete strokes for derived SWOLF with $coverage rate samples in $unit', ({ coverage, unit }) => {
    const source = swimIntervalFixture();
    source.getSwimLengths()[0].strokes = null;
    source.getSwimLengths().slice(0, coverage).forEach(length => length.avgCadence = new DataStrokeRate(20));
    const analytics = [...getSwimLapAnalytics(getSwimIntervalActivity(source)!, {
      ...getDefaultUserUnitSettings(), swimPaceUnits: [unit],
    }).values()][0];
    expect(analytics.strokes).toBeNull();
    expect(analytics.swolf).toBeNull();
    expect(analytics.pace?.getValue()).toBe(120);
    expect(analytics.cadence?.getValue()).toBe(20);
    expect(analytics.cadenceDuration).toBe(30 * coverage);
  });

  it.each(['partial', 'unknown', 'duplicate', 'overlap', 'gap', 'outside', 'rest distance', 'non-pool'])('falls back to original laps for %s evidence', problem => {
    const source = swimIntervalFixture();
    const lengths = source.getSwimLengths();
    switch (problem) {
      case 'partial': lengths.pop(); break;
      case 'unknown': lengths[0].type = 'unknown'; break;
      case 'duplicate': lengths[0].index = 2; break;
      case 'overlap': lengths[1].startDate = new Date(10000); break;
      case 'gap': lengths[1].startDate = new Date(32000); break;
      case 'outside': lengths[0].startDate = new Date(-1000); break;
      case 'rest distance': lengths[4].distance = new DataDistance(25); break;
      case 'non-pool': source.type = ActivityTypes.OpenWaterSwimming; break;
    }
    expect(getSwimIntervalActivity(source)).toBeNull();
  });
});
