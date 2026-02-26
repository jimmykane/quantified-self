import {
  DataGradeAdjustedPace,
  DataPowerRight,
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import { AppDataColors } from '../services/color/app.data.colors';
import {
  resolveEventColorGroupKey,
  resolveEventSeriesColor,
} from './event-echarts-style.helper';

describe('event-echarts-style.helper', () => {
  it('maps stream types to legacy color groups', () => {
    expect(resolveEventColorGroupKey(DataPowerRight.type)).toBe('Power');
    expect(resolveEventColorGroupKey(DataGradeAdjustedPace.type)).toBe('Pace');
    expect(resolveEventColorGroupKey('Unknown Data Type')).toBe('Unknown Data Type');
  });

  it('uses explicit AppDataColors variants when available', () => {
    expect(resolveEventSeriesColor('Power', 0, 3)).toBe((AppDataColors as any).Power_0);
    expect(resolveEventSeriesColor('Power', 1, 3)).toBe((AppDataColors as any).Power_1);
  });

  it('builds deterministic shaded variants when explicit variants are missing', () => {
    const colorA = resolveEventSeriesColor('Speed', 5, 7);
    const colorB = resolveEventSeriesColor('Speed', 5, 7);

    expect(colorA).toBe(colorB);
    expect(colorA).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('falls back to deterministic palette for unknown groups', () => {
    const colorA = resolveEventSeriesColor('totally-unknown', 0, 1);
    const colorB = resolveEventSeriesColor('totally-unknown', 0, 1);

    expect(colorA).toBe(colorB);
    expect(colorA).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
