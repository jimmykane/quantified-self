import { describe, expect, it } from 'vitest';
import {
  buildEventEChartsVisualTokens,
  calculateEventEChartsAxisRange,
  toFiniteEventEChartsNumber
} from './event-echarts-common.helper';

describe('event-echarts-common.helper', () => {
  it('should build mobile dark visual tokens', () => {
    const tokens = buildEventEChartsVisualTokens(true, true);

    expect(tokens.darkTheme).toBe(true);
    expect(tokens.axisLabelFontSize).toBe(11);
    expect(tokens.textColor).toBe('rgba(223,223,225,1)');
    expect(tokens.axisColor).toBe('#B9B8CE');
    expect(tokens.tooltipExtraCssText.length).toBeGreaterThan(0);
    expect(tokens.tooltipBackgroundColor).toBe('rgba(58,62,68,1)');
  });

  it('should build light visual tokens from official theme colors', () => {
    const tokens = buildEventEChartsVisualTokens(false, false);
    expect(tokens.darkTheme).toBe(false);
    expect(tokens.axisLabelFontSize).toBe(12);
    expect(tokens.textColor).toBe('#3c3c41');
    expect(tokens.tooltipBackgroundColor).toBe('#ffffff');
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
