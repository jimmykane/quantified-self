import {
  DataAirPower,
  DataAltitude,
  DataCadence,
  DataDepth,
  DataEffortPace,
  DataHeartRate,
  DataNextStopDepth,
  DataNextStopDepthFeet,
  DataPace,
  DataPotentialStamina,
  DataPower,
  DataPowerLeft,
  DataPowerRight,
  DataStamina,
  DataStrokeRate,
} from '@sports-alliance/sports-lib';
import { describe, expect, it } from 'vitest';
import {
  buildEventPanelYAxisConfig,
  canShareEventPanelYAxis,
  resolveEventPanelYAxisCompatibilityFamily,
  selectPreferredAxisInterval,
} from './event-echarts-yaxis.helper';

function buildPanel(streamType: string, values: number[], unit = '') {
  return {
    dataType: streamType,
    displayName: streamType,
    unit,
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
        unit,
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
  it('does not share percentage and sustainable-distance axes', () => {
    expect(canShareEventPanelYAxis(buildPanel(DataStamina.type, [0, 80], '%'),
      buildPanel('Estimated Sustainable Distance', [0, 10000], 'm'))).toBe(false);
    expect(canShareEventPanelYAxis(buildPanel(DataStamina.type, [0, 80], '%'),
      buildPanel('Estimated Sustainable Distance in miles', [0, 6], 'mi'))).toBe(false);
  });

  it('shares y-axis families for stamina and potential stamina panels', () => {
    const staminaPanel = buildPanel(DataStamina.type, [65, 78], '%');
    const potentialStaminaPanel = buildPanel(DataPotentialStamina.type, [80, 95], '%');

    expect(resolveEventPanelYAxisCompatibilityFamily(staminaPanel)).toBe('stamina-percent');
    expect(resolveEventPanelYAxisCompatibilityFamily(potentialStaminaPanel)).toBe('stamina-percent');
    expect(canShareEventPanelYAxis(staminaPanel, potentialStaminaPanel)).toBe(true);
  });

  it('shares y-axis families for explicit power variants', () => {
    const powerPanel = buildPanel(DataPower.type, [100, 200], 'W');
    const compatiblePowerPanels = [
      buildPanel(DataAirPower.type, [95, 190], 'W'),
      buildPanel(DataPowerLeft.type, [50, 110], 'W'),
      buildPanel(DataPowerRight.type, [50, 110], 'W'),
    ];

    expect(resolveEventPanelYAxisCompatibilityFamily(powerPanel)).toBe('power-watts');
    compatiblePowerPanels.forEach((panel) => {
      expect(resolveEventPanelYAxisCompatibilityFamily(panel)).toBe('power-watts');
      expect(canShareEventPanelYAxis(powerPanel, panel)).toBe(true);
    });
  });

  it('does not share axes for mixed families or unrelated same-unit metrics', () => {
    expect(canShareEventPanelYAxis(
      buildPanel(DataStamina.type, [65, 78], '%'),
      buildPanel('Battery Charge', [70, 90], '%')
    )).toBe(false);
    expect(canShareEventPanelYAxis(
      buildPanel(DataStamina.type, [65, 78], '%'),
      buildPanel(DataAltitude.type, [20, 25], 'm')
    )).toBe(false);
    expect(canShareEventPanelYAxis(
      buildPanel(DataStamina.type, [65, 78], '%'),
      buildPanel(DataPower.type, [100, 200], 'W')
    )).toBe(false);
  });

  it('builds padded y-range for non-pace panels', () => {
    const config = buildEventPanelYAxisConfig({
      panel: buildPanel(DataPower.type, [100, 200]),
      visibleRange: null,
    });

    expect(config.inverse).toBe(false);
    expect(config.min).toBeLessThanOrEqual(100);
    expect(config.max).toBeGreaterThanOrEqual(200);
    expect(config.interval).toBeDefined();
  });

  it('handles single-point ranges safely', () => {
    const config = buildEventPanelYAxisConfig({
      panel: buildPanel('speed', [42]),
      visibleRange: null,
    });

    expect(config.min).toBeLessThan(42);
    expect(config.max).toBeGreaterThan(42);
  });

  it('keeps pace streams inverted while using the shared default numeric scale', () => {
    const config = buildEventPanelYAxisConfig({
      panel: buildPanel(DataPace.type, [300, 305, 310, 315]),
      visibleRange: null,
    });

    expect(config.inverse).toBe(true);
    expect(config.min).toBeDefined();
    expect(config.max).toBeDefined();
    expect(config.min).toBeLessThanOrEqual(300);
    expect(config.max).toBeGreaterThanOrEqual(315);
    expect(config.interval).toBeDefined();
  });

  it.each([DataDepth.type, DataNextStopDepth.type, DataNextStopDepthFeet.type])(
    'keeps %s zero at the top and increases downward',
    (dataType) => {
      const config = buildEventPanelYAxisConfig({
        panel: buildPanel(dataType, [0, 1.2, 3.86]),
        visibleRange: null,
      });

      expect(config.inverse).toBe(true);
      expect(config.min).toBe(0);
      expect(config.max).toBeGreaterThanOrEqual(3.86);
      expect(config.interval).toBeDefined();
    },
  );

  it('keeps effort pace streams inverted while using the shared default numeric scale', () => {
    const config = buildEventPanelYAxisConfig({
      panel: buildPanel(DataEffortPace.type, [280, 290, 300, 310]),
      visibleRange: null,
    });

    expect(config.inverse).toBe(true);
    expect(config.min).toBeDefined();
    expect(config.max).toBeDefined();
    expect(config.interval).toBeDefined();
  });

  it('uses visible range when computing scale', () => {
    const config = buildEventPanelYAxisConfig({
      panel: buildPanel('speed', [10, 20, 200]),
      visibleRange: { start: 0, end: 1 },
    });

    expect((config.max as number)).toBeLessThan(200);
  });

  it.each([
    ['legacy', 1, 0], ['packed', 1, 0], // Duration
    ['legacy', 1000, 1700000000000], ['packed', 1000, 1700000000000], // Time
    ['legacy', 0.1, 500], ['packed', 0.1, 500], // Distance
  ] as const)('includes only connected HR boundary endpoints without changing samples (%s, scale=%s, offset=%s)', (format, scale, offset) => {
    const panel = buildPanel(DataHeartRate.type, [100, NaN, 120, NaN, NaN, NaN, 80, NaN, 100]);
    panel.series[0].lineContinuity = { mode: 'custom', maxGapSeconds: 2 };
    const x = (value: number) => offset + value * scale;
    panel.series[0].points.forEach(point => {
      point.time = point.x * 1000;
      point.x = x(point.x);
    });
    if (format === 'packed') {
      const series = panel.series[0];
      series.lineValues = Float64Array.from(series.points.flatMap(point => [point.x, point.y]));
      series.timeValues = Float64Array.from(series.points.map(point => point.time));
      series.pointCount = series.points.length;
      delete series.points;
    }
    const before = structuredClone(panel);
    for (const range of [{ start: x(0), end: x(1.5) }, { start: x(0.5), end: x(1.5) }]) {
      const config = buildEventPanelYAxisConfig({ panel, visibleRange: range });
      expect(config.min).toBeLessThanOrEqual(100);
      expect(config.max).toBeGreaterThanOrEqual(120);
      expect(config.min).toBeGreaterThan(80); // Other side of the real gap stays excluded.
    }
    const right = buildEventPanelYAxisConfig({ panel, visibleRange: { start: x(6.5), end: x(8) } });
    expect(right.min).toBeLessThanOrEqual(80);
    expect(right.max).toBeGreaterThanOrEqual(100);
    expect(right.max).toBeLessThan(120);
    expect(buildEventPanelYAxisConfig({ panel, visibleRange: { start: x(2.5), end: x(5.5) } }))
      .toEqual({ inverse: false });
    expect(panel).toEqual(before);
  });

  it.each([2001, 0, -1000, NaN, Infinity])('excludes boundary readings across an invalid HR interval (%s)', time => {
    const panel = buildPanel(DataHeartRate.type, [100, 999]);
    panel.series[0].lineContinuity = { mode: 'custom', maxGapSeconds: 2 };
    panel.series[0].points[1].time = time;
    const config = buildEventPanelYAxisConfig({ panel, visibleRange: { start: 0, end: 0.5 } });
    expect(config.min).toBeLessThanOrEqual(100);
    expect(config.max).toBeLessThan(999);
  });

  it('includes connected boundary context for other metric scales', () => {
    const panel = buildPanel(DataPower.type, [100, 999]);
    panel.series[0].points[1].time = 2000;
    const config = buildEventPanelYAxisConfig({ panel, visibleRange: { start: 0, end: 0.5 } });
    expect(config.max).toBeGreaterThanOrEqual(999);
  });

  it.each(['Altitude', 'Power'])('retains adjacent-only gaps for routes and derived windows (%s)', type => {
    const panel = buildPanel(type, [100, NaN, 120]);
    panel.series[0].lineGapPolicy = 'adjacent';
    panel.series[0].points.forEach(point => { point.time = point.x * 1000; });
    expect(buildEventPanelYAxisConfig({ panel, visibleRange: { start: 0.5, end: 1.5 } }))
      .toEqual({ inverse: false });
    panel.series[0].points[1].y = 110;
    const scale = buildEventPanelYAxisConfig({ panel, visibleRange: { start: 0.5, end: 1.5 } });
    expect(scale.min).toBeLessThanOrEqual(100);
    expect(scale.max).toBeGreaterThanOrEqual(120);
  });

  it('includes connected battery endpoints in a narrow zoom despite sparse timestamps', () => {
    const panel = buildPanel('Battery Charge', [100, NaN, 90]);
    panel.series[0].points.forEach(point => { point.time = point.x * 10000; });
    const scale = buildEventPanelYAxisConfig({ panel, visibleRange: { start: 0.5, end: 1.5 } });
    expect(scale.min).toBeLessThanOrEqual(90);
    expect(scale.max).toBeGreaterThanOrEqual(100);
  });

  it('does not use offscreen raw whisker readings as line context', () => {
    const panel = buildPanel(DataPower.type, [100, 999]);
    panel.series[0].lineGapPolicy = 'none';
    const scale = buildEventPanelYAxisConfig({ panel, visibleRange: { start: 0, end: 0.5 } });
    expect(scale.max).toBeLessThan(999);
  });

  it('handles very large series without spreading values into Math.min/Math.max', () => {
    const values = Array.from({ length: 200000 }, (_, index) => index % 500);
    const config = buildEventPanelYAxisConfig({
      panel: buildPanel('speed', values),
      visibleRange: null,
    });

    expect(config.inverse).toBe(false);
    expect(config.min).toBeLessThanOrEqual(0);
    expect(config.max).toBeGreaterThan(499);
  });

  it('snaps non-pace axes to a logical interval instead of keeping an odd raw max label', () => {
    const config = buildEventPanelYAxisConfig({
      panel: buildPanel(DataCadence.type, [30, 60, 90, 117]),
      visibleRange: null,
    });

    expect(config.inverse).toBe(false);
    expect(config.interval).toBe(15);
    expect(config.max).toBe(120);
    expect(config.max).not.toBe(140);
  });

  it('uses cadence-style logical steps for Stroke Rate', () => {
    const config = buildEventPanelYAxisConfig({
      panel: buildPanel(DataStrokeRate.type, [18, 22, 27, 31]),
      visibleRange: null,
    });

    expect(config.inverse).toBe(false);
    expect(config.interval).toBe(5);
    expect(config.max).toBe(35);
  });

  it('uses coarser logical steps for heart-rate axes', () => {
    const config = buildEventPanelYAxisConfig({
      panel: buildPanel(DataHeartRate.type, [98, 111, 126, 143, 151, 164]),
      visibleRange: null,
    });

    expect(config.inverse).toBe(false);
    expect(config.interval).toBeGreaterThanOrEqual(15);
    expect(config.max).toBeGreaterThanOrEqual(170);
  });

  it('accepts floating-point divisible ranges when selecting a preferred interval', () => {
    const interval = selectPreferredAxisInterval(
      0.3,
      [0.05, 0.1, 0.15],
      3,
      1,
    );

    expect(interval).toBe(0.1);
  });

  it('caps stamina axes at 100 percent instead of snapping to 105 percent', () => {
    const config = buildEventPanelYAxisConfig({
      panel: buildPanel(DataStamina.type, [65, 78, 92, 100]),
      visibleRange: null,
    });

    expect(config.inverse).toBe(false);
    expect(config.max).toBe(100);
    expect(config.min).toBeGreaterThanOrEqual(0);
    expect(config.interval).toBeDefined();
  });

  it('applies the same 100 percent cap to potential stamina axes', () => {
    const config = buildEventPanelYAxisConfig({
      panel: buildPanel(DataPotentialStamina.type, [67, 83, 96, 99]),
      visibleRange: null,
    });

    expect(config.inverse).toBe(false);
    expect(config.max).toBe(100);
    expect(config.min).toBeGreaterThanOrEqual(0);
  });
});
