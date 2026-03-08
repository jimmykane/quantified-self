import { describe, expect, it } from 'vitest';
import { resolveEChartsTooltipTriggerOn } from './echarts-tooltip-interaction.helper';

describe('echarts-tooltip-interaction.helper', () => {
  it('returns none when disabled regardless of viewport', () => {
    expect(resolveEChartsTooltipTriggerOn(false, true)).toBe('none');
    expect(resolveEChartsTooltipTriggerOn(false, false)).toBe('none');
  });

  it('returns click trigger for mobile viewport', () => {
    expect(resolveEChartsTooltipTriggerOn(true, true)).toBe('click');
  });

  it('returns mousemove plus click trigger for non-mobile viewport', () => {
    expect(resolveEChartsTooltipTriggerOn(true, false)).toBe('mousemove|click');
  });
});

