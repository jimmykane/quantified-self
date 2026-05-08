import { describe, expect, it } from 'vitest';
import { getOrCreateEChartsTooltipHost } from './echarts-tooltip-host.helper';
import { getViewportConstrainedTooltipPosition } from './echarts-tooltip-position.helper';
import {
  DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS,
  resolveEChartsTooltipSurfaceConfig,
  resolveEChartsTooltipTriggerOn
} from './echarts-tooltip-interaction.helper';

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

  it('enables dashboard data tap and drag haptics without blank-surface click feedback', () => {
    expect(DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS).toEqual({
      axisPointerFeedback: 'always',
      clickFeedback: true,
      surfaceClickFeedback: false,
      surfaceDragFeedback: true,
    });
  });

  it('returns confined tooltip surface for mobile viewport', () => {
    const surface = resolveEChartsTooltipSurfaceConfig(true);

    expect(surface.confine).toBe(true);
    expect(surface.appendTo).toBeUndefined();
    expect(surface.position).toBeUndefined();
  });

  it('returns viewport-hosted tooltip surface for non-mobile viewport', () => {
    const surface = resolveEChartsTooltipSurfaceConfig(false);

    expect(surface.confine).toBe(false);
    expect(surface.appendTo).toBe(getOrCreateEChartsTooltipHost);
    expect(surface.position).toBe(getViewportConstrainedTooltipPosition);
  });
});
