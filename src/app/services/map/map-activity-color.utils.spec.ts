import { describe, it, expect, vi } from 'vitest';
import { ActivityTypes, AppThemes } from '@sports-alliance/sports-lib';
import { buildReadableActivityMarkerPaint, resolveThemedActivityColor } from './map-activity-color.utils';

describe('resolveThemedActivityColor', () => {
  it('uses theme-adjusted color when base color is valid', () => {
    const colorSource = {
      getColorForActivityTypeByActivityTypeGroup: vi.fn().mockReturnValue('#112233'),
    };
    const colorAdjuster = {
      adjustColorForTheme: vi.fn().mockReturnValue('#ddeeff'),
    };

    const result = resolveThemedActivityColor(
      ActivityTypes.Running,
      AppThemes.Dark,
      colorSource as any,
      colorAdjuster as any,
    );

    expect(colorSource.getColorForActivityTypeByActivityTypeGroup).toHaveBeenCalledWith(ActivityTypes.Running);
    expect(colorAdjuster.adjustColorForTheme).toHaveBeenCalledWith('#112233', AppThemes.Dark);
    expect(result).toEqual({ baseColor: '#112233', adjustedColor: '#ddeeff' });
  });

  it('falls back when source/adjusted colors are invalid', () => {
    const colorSource = {
      getColorForActivityTypeByActivityTypeGroup: vi.fn().mockReturnValue('not-a-color'),
    };
    const colorAdjuster = {
      adjustColorForTheme: vi.fn().mockReturnValue(undefined),
    };

    const result = resolveThemedActivityColor(
      ActivityTypes.Cycling,
      AppThemes.Normal,
      colorSource as any,
      colorAdjuster as any,
      '#2ca3ff',
    );

    expect(result).toEqual({ baseColor: '#2ca3ff', adjustedColor: '#2ca3ff' });
  });

  it('builds readable marker paint with emissive defaults', () => {
    const paint = buildReadableActivityMarkerPaint({
      colorExpression: ['coalesce', ['get', 'color'], '#2ca3ff'],
      radiusExpression: 6,
      strokeWidthExpression: 2.2,
    });

    expect(paint).toEqual(expect.objectContaining({
      'circle-emissive-strength': 1,
      'circle-stroke-color': '#f5f8ff',
      'circle-blur': 0.03,
      'circle-opacity': 1,
    }));
  });
});
