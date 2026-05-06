import { AppBreakpoints } from '../constants/breakpoints';
import { getOrCreateEChartsTooltipHost } from './echarts-tooltip-host.helper';
import { getViewportConstrainedTooltipPosition } from './echarts-tooltip-position.helper';

export type EChartsTooltipTriggerOn = 'none' | 'click' | 'mousemove|click';
export type EChartsAxisPointerHapticFeedback = 'always' | 'afterFirstInteraction' | 'off';
export interface EChartsTooltipSurfaceConfig {
  appendTo?: typeof getOrCreateEChartsTooltipHost;
  confine: boolean;
  position?: typeof getViewportConstrainedTooltipPosition;
}
export interface EChartsMobileTapFeedbackOptions {
  axisPointerFeedback?: EChartsAxisPointerHapticFeedback;
  clickFeedback?: boolean;
}

export const DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS: EChartsMobileTapFeedbackOptions = {
  axisPointerFeedback: 'afterFirstInteraction',
  clickFeedback: false,
};

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
