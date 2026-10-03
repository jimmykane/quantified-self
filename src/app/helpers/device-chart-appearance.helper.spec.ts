import { describe, expect, it, vi } from 'vitest';
import type { ActivityInterface } from '@sports-alliance/sports-lib';
import { applyComparisonDeviceAppearance, deviceChartLineType, deviceColorContrast, resolveDeviceChartColor } from './device-chart-appearance.helper';
import { OKABE_ITO_DEVICE_COLORS, STANDARD_DEVICE_COLORS } from './device-color-palette.helper';
import type { TrackChartPanelModel } from './track-chart-panel.model';

describe('device chart appearance', () => {
  it('meets line contrast in both themes for every offered swatch without changing neutral hue', () => {
    for (const { color } of [...OKABE_ITO_DEVICE_COLORS, ...STANDARD_DEVICE_COLORS]) {
      for (const darkTheme of [false, true]) {
        const rendered = resolveDeviceChartColor(color, darkTheme);
        expect(deviceColorContrast(rendered, darkTheme ? '#4B4B4B' : '#FAFAFA')).toBeGreaterThanOrEqual(3.5);
      }
    }
    for (const color of ['#000000', '#3D3D3D']) {
      const rendered = resolveDeviceChartColor(color, true);
      expect(rendered.slice(1, 3)).toBe(rendered.slice(3, 5));
      expect(rendered.slice(3, 5)).toBe(rendered.slice(5, 7));
    }
    expect(resolveDeviceChartColor('#D55E00', false)).toBe('#D55E00');
    expect(resolveDeviceChartColor('#0072B2', false)).toBe('#0072B2');
    expect(deviceColorContrast('#000000', '#FFFFFF')).toBe(21);
  });

  it('keeps patterns and device colors across metrics, selection changes and worker-shaped results', () => {
    const activities = ['a', 'b', 'c', 'd'].map(id => ({ getID: () => id })) as ActivityInterface[];
    const panel = {
      dataType: 'Power', series: activities.map(activity => ({ activityID: activity.getID(), color: '#FF0000' })),
    } as TrackChartPanelModel;
    const colorService = { getActivityColor: vi.fn((_all, activity) => OKABE_ITO_DEVICE_COLORS[activities.indexOf(activity)].color) };
    const result = applyComparisonDeviceAppearance([panel], activities, colorService, false)[0];
    expect(result.series.map(series => series.lineStyle)).toEqual(['solid', 'dashed', 'dotted', 'dash-dot']);
    expect(result.series.map(series => series.color).slice(0, 3)).toEqual(['#D55E00', '#0072B2', '#000000']);
    const selected = applyComparisonDeviceAppearance([{ ...panel, series: [panel.series[2]] }], activities, colorService, false)[0];
    expect(selected.series[0]).toEqual(result.series[2]);
    expect(panel.series[2].color).toBe('#FF0000');
    expect(deviceChartLineType('dash-dot')).toEqual([8, 3, 2, 3]);
    expect(deviceChartLineType('dotted')).toBe('dotted');
    expect(deviceChartLineType(undefined)).toBe('solid');
  });
});
