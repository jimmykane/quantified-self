import { describe, expect, it } from 'vitest';
import { getOrCreateEChartsTooltipHost } from './echarts-tooltip-host.helper';
import { getViewportConstrainedTooltipPosition } from './echarts-tooltip-position.helper';
import {
  DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS,
  resolveEChartsMiniChartTooltipSurfaceConfig,
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

  it('arms dashboard tap haptics after first interaction while keeping drag haptics enabled', () => {
    expect(DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS).toEqual({
      axisPointerFeedback: 'afterFirstInteraction',
      clickFeedback: 'afterFirstInteraction',
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

  it('hosts mini-chart tooltips outside the plot and adapts chart-local coordinates to the viewport', () => {
    const chart = {
      ownerDocument: { documentElement: { clientWidth: 320, clientHeight: 800 } },
      getBoundingClientRect: () => ({ left: 172, top: 460 }),
    } as unknown as HTMLElement;
    const surface = resolveEChartsMiniChartTooltipSurfaceConfig(chart);
    expect(surface.confine).toBe(false);
    expect(surface.appendTo).toBe(getOrCreateEChartsTooltipHost);
    expect(surface.position?.([56, 19], undefined, {} as HTMLElement, undefined, { contentSize: [242, 86], viewSize: [106, 38] })).toEqual([-164, 31]);
  });
});
