import { AppBreakpoints } from '../constants/breakpoints';
import { getOrCreateEChartsTooltipHost } from './echarts-tooltip-host.helper';
import { getViewportConstrainedTooltipPosition } from './echarts-tooltip-position.helper';

export type EChartsTooltipTriggerOn = 'none' | 'click' | 'mousemove|click';
export interface EChartsTooltipSurfaceConfig {
  appendTo?: typeof getOrCreateEChartsTooltipHost;
  confine: boolean;
  position?: typeof getViewportConstrainedTooltipPosition;
}

export function isEChartsMobileTooltipViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia(AppBreakpoints.XSmall).matches;
}

export function resolveEChartsTooltipTriggerOn(
  enabled = true,
  isMobileViewport = isEChartsMobileTooltipViewport()
): EChartsTooltipTriggerOn {
  if (!enabled) {
    return 'none';
  }

  return isMobileViewport ? 'click' : 'mousemove|click';
}

export function resolveEChartsTooltipSurfaceConfig(
  isMobileViewport = isEChartsMobileTooltipViewport()
): EChartsTooltipSurfaceConfig {
  if (isMobileViewport) {
    return {
      confine: true,
    };
  }

  return {
    appendTo: getOrCreateEChartsTooltipHost,
    confine: false,
    position: getViewportConstrainedTooltipPosition,
  };
}
