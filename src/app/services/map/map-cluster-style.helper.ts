import { AppThemes } from '@sports-alliance/sports-lib';

export interface MapClusterPaintTokens {
  circleColors: [string, string, string, string];
  strokeColor: string;
  textColor: string;
  textHaloColor: string;
  textHaloWidth: number;
  circleOpacity: number;
  circleBlur: number;
}

export function buildMapClusterStepExpression(
  values: [string, string, string, string] | [number, number, number, number],
): any[] {
  return [
    'step',
    ['get', 'point_count'],
    values[0],
    20,
    values[1],
    50,
    values[2],
    100,
    values[3],
  ];
}

export function resolveMapClusterPaintTokens(theme: AppThemes): MapClusterPaintTokens {
  if (theme === AppThemes.Dark) {
    return {
      circleColors: ['#9be1ff', '#67bbff', '#458fff', '#5c74ff'],
      strokeColor: 'rgba(244, 248, 255, 0.84)',
      textColor: '#f8fbff',
      textHaloColor: 'rgba(6, 12, 24, 0.58)',
      textHaloWidth: 1.15,
      circleOpacity: 0.94,
      circleBlur: 0.08,
    };
  }

  return {
    circleColors: ['#87d4ff', '#4faaff', '#2d7ef7', '#314fce'],
    strokeColor: 'rgba(244, 248, 255, 0.92)',
    textColor: '#f8fbff',
    textHaloColor: 'rgba(16, 37, 63, 0.28)',
    textHaloWidth: 0.9,
    circleOpacity: 0.92,
    circleBlur: 0.06,
  };
}

export function buildMapClusterCirclePaint(theme: AppThemes): Record<string, any> {
  const tokens = resolveMapClusterPaintTokens(theme);

  return {
    'circle-color': buildMapClusterStepExpression(tokens.circleColors),
    'circle-radius': buildMapClusterStepExpression([17, 21, 26, 31]),
    'circle-opacity': tokens.circleOpacity,
    'circle-emissive-strength': 1,
    'circle-stroke-color': tokens.strokeColor,
    'circle-stroke-width': buildMapClusterStepExpression([1.6, 2, 2.4, 2.8]),
    'circle-blur': tokens.circleBlur,
  };
}

export function buildMapClusterCountPaint(theme: AppThemes): Record<string, any> {
  const tokens = resolveMapClusterPaintTokens(theme);

  return {
    'text-color': tokens.textColor,
    'text-halo-color': tokens.textHaloColor,
    'text-halo-width': tokens.textHaloWidth,
    'text-halo-blur': 0.6,
  };
}
