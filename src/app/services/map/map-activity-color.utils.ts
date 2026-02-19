import { ActivityTypes, AppThemes } from '@sports-alliance/sports-lib';

interface ActivityColorSource {
  getColorForActivityTypeByActivityTypeGroup(activityType: ActivityTypes): string | undefined;
}

interface ThemeColorAdjuster {
  adjustColorForTheme(color: string, theme: AppThemes): string | undefined;
}

export interface ResolvedActivityColor {
  baseColor: string;
  adjustedColor: string;
}

export interface ReadableMarkerPaintConfig {
  colorExpression: any;
  strokeColor?: string;
  radiusExpression?: any;
  strokeWidthExpression?: any;
  opacity?: number;
  emissiveStrength?: number;
  strokeOpacity?: number;
  blur?: number;
}

const DEFAULT_FALLBACK_COLOR = '#2ca3ff';

function isHexColor(value: string | undefined): value is string {
  if (!value) return false;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

export function resolveThemedActivityColor(
  activityType: ActivityTypes,
  theme: AppThemes,
  colorSource: ActivityColorSource,
  colorAdjuster: ThemeColorAdjuster,
  fallbackColor: string = DEFAULT_FALLBACK_COLOR,
): ResolvedActivityColor {
  try {
    const rawBaseColor = colorSource.getColorForActivityTypeByActivityTypeGroup(activityType);
    const baseColor = isHexColor(rawBaseColor) ? rawBaseColor : fallbackColor;
    const rawAdjustedColor = colorAdjuster.adjustColorForTheme(baseColor, theme);
    const adjustedColor = isHexColor(rawAdjustedColor) ? rawAdjustedColor : fallbackColor;
    return { baseColor, adjustedColor };
  } catch {
    return { baseColor: fallbackColor, adjustedColor: fallbackColor };
  }
}

export function buildReadableActivityMarkerPaint(config: ReadableMarkerPaintConfig): Record<string, any> {
  return {
    'circle-color': config.colorExpression ?? ['coalesce', ['get', 'color'], DEFAULT_FALLBACK_COLOR],
    'circle-radius': config.radiusExpression ?? 6,
    'circle-stroke-color': config.strokeColor ?? '#f5f8ff',
    'circle-stroke-width': config.strokeWidthExpression ?? 2.2,
    'circle-opacity': config.opacity ?? 1,
    // Keep marker color readable in Mapbox Standard night lighting.
    'circle-emissive-strength': config.emissiveStrength ?? 1,
    'circle-stroke-opacity': config.strokeOpacity ?? 0.96,
    'circle-blur': config.blur ?? 0.03,
  };
}
