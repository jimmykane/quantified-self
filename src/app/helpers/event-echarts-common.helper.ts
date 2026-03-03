export interface EventEChartsVisualTokenOverrides {
  textColorDark?: string;
  textColorLight?: string;
  axisColorDark?: string;
  axisColorLight?: string;
  tooltipBackgroundColorDark?: string;
  tooltipBackgroundColorLight?: string;
  tooltipBorderColorDark?: string;
  tooltipBorderColorLight?: string;
  tooltipTextColorDark?: string;
  tooltipTextColorLight?: string;
}

export interface EventEChartsVisualTokens {
  darkTheme: boolean;
  textColor: string;
  axisColor: string;
  axisLabelFontSize: number;
  tooltipExtraCssText: string;
  tooltipBackgroundColor: string;
  tooltipBorderColor: string;
  tooltipTextColor: string;
}

export interface EventEChartsAxisRangeOptions {
  minFloor?: number;
  fallbackMin: number;
  fallbackMax: number;
  paddingRatio?: number;
  minPadding?: number;
}

const MOBILE_TOOLTIP_EXTRA_CSS_TEXT = 'max-width: min(80vw, 280px); white-space: normal; overflow-wrap: anywhere; word-break: break-word;';

export function buildEventEChartsVisualTokens(
  darkTheme: boolean,
  isMobile: boolean,
  overrides: EventEChartsVisualTokenOverrides = {}
): EventEChartsVisualTokens {
  return {
    darkTheme,
    textColor: darkTheme
      ? (overrides.textColorDark || '#f5f5f5')
      : (overrides.textColorLight || '#1f1f1f'),
    axisColor: darkTheme
      ? (overrides.axisColorDark || 'rgba(255,255,255,0.24)')
      : (overrides.axisColorLight || 'rgba(0,0,0,0.24)'),
    axisLabelFontSize: isMobile ? 11 : 12,
    tooltipExtraCssText: isMobile ? MOBILE_TOOLTIP_EXTRA_CSS_TEXT : '',
    tooltipBackgroundColor: darkTheme
      ? (overrides.tooltipBackgroundColorDark || '#222222')
      : (overrides.tooltipBackgroundColorLight || '#ffffff'),
    tooltipBorderColor: darkTheme
      ? (overrides.tooltipBorderColorDark || '#555555')
      : (overrides.tooltipBorderColorLight || '#d6d6d6'),
    tooltipTextColor: darkTheme
      ? (overrides.tooltipTextColorDark || '#ffffff')
      : (overrides.tooltipTextColorLight || '#2a2a2a')
  };
}

export function calculateEventEChartsAxisRange(
  values: number[],
  options: EventEChartsAxisRangeOptions
): [number, number] {
  const validValues = values.filter((value) => Number.isFinite(value));
  if (!validValues.length) {
    return [options.fallbackMin, options.fallbackMax];
  }

  const minRaw = Math.min(...validValues);
  const maxRaw = Math.max(...validValues);
  const range = Math.max(1, maxRaw - minRaw);
  const paddingRatio = Number.isFinite(options.paddingRatio) ? Number(options.paddingRatio) : 0.12;
  const minPadding = Number.isFinite(options.minPadding) ? Number(options.minPadding) : 0.05;
  const padding = Math.max(minPadding, range * paddingRatio);

  let min = minRaw - padding;
  let max = maxRaw + padding;

  if (Number.isFinite(options.minFloor)) {
    min = Math.max(options.minFloor as number, min);
  }

  if (max <= min) {
    max = min + 1;
  }

  return [min, max];
}

export function toFiniteEventEChartsNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}
