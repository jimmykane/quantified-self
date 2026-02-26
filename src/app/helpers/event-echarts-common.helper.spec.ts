import { describe, expect, it } from 'vitest';
import { ChartThemes } from '@sports-alliance/sports-lib';
import {
  buildEventEChartsVisualTokens,
  calculateEventEChartsAxisRange,
  toFiniteEventEChartsNumber
} from './event-echarts-common.helper';

describe('event-echarts-common.helper', () => {
  it('should build mobile dark visual tokens', () => {
    const tokens = buildEventEChartsVisualTokens(ChartThemes.Dark, true);

    expect(tokens.darkTheme).toBe(true);
    expect(tokens.axisLabelFontSize).toBe(11);
    expect(tokens.textColor).toBe('#f5f5f5');
    expect(tokens.axisColor).toBe('rgba(255,255,255,0.24)');
    expect(tokens.tooltipExtraCssText.length).toBeGreaterThan(0);
    expect(tokens.tooltipBackgroundColor).toBe('#222222');
  });

  it('should honor visual token overrides', () => {
    const tokens = buildEventEChartsVisualTokens(ChartThemes.Material, false, {
      textColorLight: '#101010',
      tooltipBackgroundColorLight: '#efefef'
    });

    expect(tokens.darkTheme).toBe(false);
    expect(tokens.axisLabelFontSize).toBe(12);
    expect(tokens.textColor).toBe('#101010');
    expect(tokens.tooltipBackgroundColor).toBe('#efefef');
  });

  it('should compute padded axis ranges with min floor', () => {
    const [min, max] = calculateEventEChartsAxisRange([100, 140, 160], {
      minFloor: 0,
      fallbackMin: 0,
      fallbackMax: 1
    });

    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeGreaterThan(160);
  });

  it('should return fallback axis range when no finite values exist', () => {
    const [min, max] = calculateEventEChartsAxisRange([Number.NaN, Number.POSITIVE_INFINITY], {
      fallbackMin: 10,
      fallbackMax: 20
    });

    expect(min).toBe(10);
    expect(max).toBe(20);
  });

  it('should coerce finite chart numbers', () => {
    expect(toFiniteEventEChartsNumber(12.5)).toBe(12.5);
    expect(toFiniteEventEChartsNumber('42')).toBe(42);
    expect(toFiniteEventEChartsNumber('  ')).toBeNull();
    expect(toFiniteEventEChartsNumber('abc')).toBeNull();
  });
});
