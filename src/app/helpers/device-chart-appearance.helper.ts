import type { ActivityInterface } from '@sports-alliance/sports-lib';
import type { AppEventColorService } from '../services/color/app.event.color.service';
import type { TrackChartPanelModel, TrackChartPanelSeries } from './track-chart-panel.model';
import { normalizeDeviceColorValue } from './device-color-preferences.helper';

const LINE_STYLES: NonNullable<TrackChartPanelSeries['lineStyle']>[] = ['solid', 'dashed', 'dotted', 'dash-dot'];

function rgb(color: string): number[] {
  return [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16));
}

export function deviceColorContrast(color: string, background: string): number {
  const luminance = (value: string) => {
    const channels = rgb(value).map(channel => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(color);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function resolveDeviceChartColor(color: string, darkTheme: boolean): string {
  const normalized = normalizeDeviceColorValue(color);
  if (!normalized) {
    return color;
  }
  // Allow headroom above 3:1 for thin lines and the app's nearby surface tones.
  // The translucent dark workspace background can composite over white to
  // #4B4B4B; checking it also covers the darker card surfaces and exports.
  const background = darkTheme ? '#4B4B4B' : '#FAFAFA';
  if (deviceColorContrast(normalized, background) >= 3.5) {
    return color;
  }
  const channels = rgb(normalized);
  const target = darkTheme ? 255 : 0;
  for (let step = 1; step <= 100; step += 1) {
    const adjusted = '#' + channels.map(channel =>
      Math.round(channel + (target - channel) * step / 100).toString(16).padStart(2, '0'),
    ).join('').toUpperCase();
    if (deviceColorContrast(adjusted, background) >= 3.5) {
      return adjusted;
    }
  }
  return darkTheme ? '#FFFFFF' : '#000000';
}

// Presentation runs after either the synchronous or worker build. Full event
// order keeps patterns stable when devices are hidden or a metric is missing.
export function applyComparisonDeviceAppearance(
  panels: TrackChartPanelModel[],
  allActivities: ActivityInterface[],
  colorService: Pick<AppEventColorService, 'getActivityColor'>,
  darkTheme: boolean,
  useDistinctLinePatterns = false,
): TrackChartPanelModel[] {
  const appearanceByActivityID = new Map(allActivities.map((activity, index) => [activity.getID?.() || '', {
    color: resolveDeviceChartColor(colorService.getActivityColor(allActivities, activity), darkTheme),
    lineStyle: useDistinctLinePatterns ? LINE_STYLES[index % LINE_STYLES.length] : undefined,
  }]));
  return panels.map(panel => ({
    ...panel,
    series: panel.series.map(series => ({ ...series, ...appearanceByActivityID.get(series.activityID) })),
  }));
}

export function deviceChartLineType(style: TrackChartPanelSeries['lineStyle']): 'solid' | 'dashed' | 'dotted' | number[] {
  return style === 'dash-dot' ? [8, 3, 2, 3] : style || 'solid';
}
