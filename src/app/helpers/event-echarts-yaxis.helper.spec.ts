import { DataCadence, DataEffortPace, DataPace, DataPower } from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  buildEventPanelYAxisConfig,
} from './event-echarts-yaxis.helper';

function buildPanel(streamType: string, values: number[]) {
  return {
    dataType: streamType,
    displayName: streamType,
    unit: '',
    colorGroupKey: streamType,
    minX: 0,
    maxX: Math.max(1, values.length - 1),
    series: [
      {
        id: `a1::${streamType}`,
        activityID: 'a1',
        activityName: 'Activity',
        color: '#000000',
        streamType,
        displayName: streamType,
        unit: '',
        points: values.map((value, index) => ({
          x: index,
          y: value,
          time: index,
        })),
      }
    ]
  } as any;
}

describe('event-echarts-yaxis.helper', () => {
  it('builds padded y-range for non-pace panels', () => {
    const config = buildEventPanelYAxisConfig({
      panel: buildPanel(DataPower.type, [100, 200]),
      visibleRange: null,
      extraMaxForPower: 0.2,
      extraMaxForPace: -0.25,
    });

    expect(config.inverse).toBe(false);
    expect(config.min).toBeLessThanOrEqual(100);
    expect(config.max).toBeGreaterThan(200);
    expect(config.interval).toBeDefined();
  });

  it('handles single-point ranges safely', () => {
    const config = buildEventPanelYAxisConfig({
      panel: buildPanel('speed', [42]),
      visibleRange: null,
      extraMaxForPower: 0,
      extraMaxForPace: -0.25,
    });

    expect(config.min).toBeLessThan(42);
    expect(config.max).toBeGreaterThan(42);
  });

  it('returns inverted config for pace streams', () => {
    const config = buildEventPanelYAxisConfig({
      panel: buildPanel(DataPace.type, [300, 305, 310, 315]),
      visibleRange: null,
      extraMaxForPower: 0,
      extraMaxForPace: -0.25,
    });

    expect(config.inverse).toBe(true);
    expect(config.min).toBeDefined();
    expect(config.max).toBeDefined();
    expect(config.min).toBe(300);
    expect(config.max).toBe(315);
  });

  it('treats effort pace streams like pace for y-axis scaling', () => {
    const config = buildEventPanelYAxisConfig({
      panel: buildPanel(DataEffortPace.type, [280, 290, 300, 310]),
      visibleRange: null,
      extraMaxForPower: 0,
      extraMaxForPace: -0.25,
    });

    expect(config.inverse).toBe(true);
    expect(config.min).toBeDefined();
    expect(config.max).toBeDefined();
  });

  it('uses visible range when computing scale', () => {
    const config = buildEventPanelYAxisConfig({
      panel: buildPanel('speed', [10, 20, 200]),
      visibleRange: { start: 0, end: 1 },
      extraMaxForPower: 0,
      extraMaxForPace: -0.25,
    });

    expect((config.max as number)).toBeLessThan(200);
  });

  it('handles very large series without spreading values into Math.min/Math.max', () => {
    const values = Array.from({ length: 200000 }, (_, index) => index % 500);
    const config = buildEventPanelYAxisConfig({
      panel: buildPanel('speed', values),
      visibleRange: null,
      extraMaxForPower: 0,
      extraMaxForPace: -0.25,
    });

    expect(config.inverse).toBe(false);
    expect(config.min).toBeLessThanOrEqual(0);
    expect(config.max).toBeGreaterThan(499);
  });

  it('snaps non-pace axes to a logical interval instead of keeping an odd raw max label', () => {
    const config = buildEventPanelYAxisConfig({
      panel: buildPanel(DataCadence.type, [30, 60, 90, 117]),
      visibleRange: null,
      extraMaxForPower: 0,
      extraMaxForPace: -0.25,
    });

    expect(config.inverse).toBe(false);
    expect(config.interval).toBe(15);
    expect(config.max).toBe(120);
    expect(config.max).not.toBe(140);
  });
});
