import {
  DataCadence,
  DataEffortPace,
  DataGradeAdjustedPace,
  DataPowerRight,
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { AppDataColors } from '../services/color/app.data.colors';
import {
  isEventPaceStreamType,
  resolveEventColorGroupKey,
  resolveEventSeriesColor,
} from './event-echarts-style.helper';

describe('event-echarts-style.helper', () => {
  it('maps stream types to legacy color groups', () => {
    expect(resolveEventColorGroupKey(DataPowerRight.type)).toBe('Power');
    expect(resolveEventColorGroupKey(DataGradeAdjustedPace.type)).toBe('Pace');
    expect(resolveEventColorGroupKey(DataEffortPace.type)).toBe('Pace');
    expect(resolveEventColorGroupKey(DataCadence.type)).toBe(DataCadence.type);
    expect(resolveEventColorGroupKey('Unknown Data Type')).toBe('Unknown Data Type');
  });

  it('treats effort pace as part of the canonical pace family', () => {
    expect(isEventPaceStreamType(DataEffortPace.type)).toBe(true);
    expect(isEventPaceStreamType(DataGradeAdjustedPace.type)).toBe(true);
    expect(isEventPaceStreamType(DataCadence.type)).toBe(false);
  });

  it('uses explicit AppDataColors variants when available', () => {
    expect(resolveEventSeriesColor('Power', 0, 3)).toBe((AppDataColors as any).Power_0);
    expect(resolveEventSeriesColor('Power', 1, 3)).toBe((AppDataColors as any).Power_1);
    expect(resolveEventSeriesColor(DataCadence.type, 0, 1)).toBe((AppDataColors as any).Cadence);
  });

  it('builds deterministic distinct palette variants when explicit variants are missing', () => {
    const base = resolveEventSeriesColor('Speed', 0, 3);
    const colorA = resolveEventSeriesColor('Speed', 1, 3);
    const colorB = resolveEventSeriesColor('Speed', 1, 3);

    expect(colorA).toBe(colorB);
    expect(colorA).not.toBe(base);
    expect(colorA).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('falls back to deterministic palette for unknown groups', () => {
    const colorA = resolveEventSeriesColor('totally-unknown', 0, 1);
    const colorB = resolveEventSeriesColor('totally-unknown', 0, 1);

    expect(colorA).toBe(colorB);
    expect(colorA).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
