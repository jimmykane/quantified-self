import { AppBreakpoints } from '../constants/breakpoints';

export type EChartsTooltipTriggerOn = 'none' | 'click' | 'mousemove|click';

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

