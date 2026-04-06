import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, SimpleChange } from '@angular/core';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  DataDuration,
  DataDistance,
  DataPaceAvg,
  DataRecoveryTime,
  PaceUnits,
  TimeIntervals
} from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartsColumnsComponent } from './charts.columns.component';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { LoggerService } from '../../../services/logger.service';
import { formatDashboardNumericValue } from '../../../helpers/dashboard-chart-data.helper';
import { getOrCreateEChartsTooltipHost } from '../../../helpers/echarts-tooltip-host.helper';
import { getViewportConstrainedTooltipPosition } from '../../../helpers/echarts-tooltip-position.helper';

type ResizeObserverRecord = {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

describe('ChartsColumnsComponent', () => {
  let fixture: ComponentFixture<ChartsColumnsComponent>;
  let component: ChartsColumnsComponent;
  let resizeObserverRecords: ResizeObserverRecord[];
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let originalRequestAnimationFrame: typeof requestAnimationFrame | undefined;
  let originalCancelAnimationFrame: typeof cancelAnimationFrame | undefined;

  const mockChart = {
    isDisposed: vi.fn().mockReturnValue(false),
    dispatchAction: vi.fn(),
  };

  let mockLoader: {
    init: ReturnType<typeof vi.fn>;
    setOption: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    subscribeToViewportResize: ReturnType<typeof vi.fn>;
    attachMobileSeriesTapFeedback: ReturnType<typeof vi.fn>;
  };

  let mockColorService: {
    getColorForActivityTypeByActivityTypeGroup: ReturnType<typeof vi.fn>;
  };

  const waitForChartStabilization = async (): Promise<void> => {
    await fixture.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };

  beforeEach(async () => {
    resizeObserverRecords = [];
    originalResizeObserver = globalThis.ResizeObserver;
    originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

    class ResizeObserverMock {
      public observe = vi.fn();
      public disconnect = vi.fn();

      constructor(_: ResizeObserverCallback) {
        resizeObserverRecords.push({
          observe: this.observe,
          disconnect: this.disconnect,
        });
      }
    }

    globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
    globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as unknown as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = vi.fn();

    mockLoader = {
      init: vi.fn().mockResolvedValue(mockChart),
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
      subscribeToViewportResize: vi.fn(() => () => { }),
      attachMobileSeriesTapFeedback: vi.fn(() => () => { }),
    };

    mockColorService = {
      getColorForActivityTypeByActivityTypeGroup: vi.fn().mockReturnValue('#16B4EA'),
    };

    await TestBed.configureTestingModule({
      declarations: [ChartsColumnsComponent],
      providers: [
        { provide: EChartsLoaderService, useValue: mockLoader },
        { provide: AppEventColorService, useValue: mockColorService },
        { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn() } }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(ChartsColumnsComponent);
    component = fixture.componentInstance;
    component.darkTheme = false;
    component.useAnimations = false;
    component.chartDataType = DataDistance.type;
    component.chartDataValueType = ChartDataValueTypes.Total;
    component.chartDataCategoryType = ChartDataCategoryTypes.ActivityType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.vertical = true;
    component.type = 'columns';
    component.data = [
      { type: 'Running', [ChartDataValueTypes.Total]: 30, count: 2 },
      { type: 'Cycling', [ChartDataValueTypes.Total]: 60, count: 1 },
    ];
  });

  afterEach(() => {
    if (originalResizeObserver) {
      globalThis.ResizeObserver = originalResizeObserver;
    } else {
      delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    }
    if (originalRequestAnimationFrame) {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    } else {
      delete (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame;
    }
    if (originalCancelAnimationFrame) {
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    } else {
      delete (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame;
    }
    document.body.classList.remove('dark-theme');
  });

  const getLastOption = (): Record<string, any> => {
    return mockLoader.setOption.mock.calls.at(-1)?.[1] as Record<string, any>;
  };

  it('should initialize ECharts and render vertical columns', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();

    expect(mockLoader.init).toHaveBeenCalledTimes(1);
    expect(resizeObserverRecords).toHaveLength(1);
    expect(option.tooltip.renderMode).toBe('html');
    expect(option.tooltip.appendTo).toBe(getOrCreateEChartsTooltipHost);
    expect(option.tooltip.confine).toBe(false);
    expect(option.tooltip.position).toBe(getViewportConstrainedTooltipPosition);
    expect(option.series[0].type).toBe('bar');
    expect(option.xAxis.type).toBe('category');
    expect(option.yAxis.type).toBe('value');
    expect(mockChart.dispatchAction).toHaveBeenCalledWith({ type: 'hideTip' });
    expect(mockLoader.setOption.mock.calls.at(-1)?.[2]).toEqual({
      notMerge: false,
      lazyUpdate: false,
      replaceMerge: ['series', 'xAxis', 'yAxis']
    });
  });

  it('should render horizontal axes when vertical is false', async () => {
    component.vertical = false;

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.xAxis.type).toBe('value');
    expect(option.yAxis.type).toBe('category');
    expect(option.yAxis.inverse).toBe(true);
    expect(option.yAxis.axisLine.show).toBe(false);
    expect(option.yAxis.axisLabel.hideOverlap).toBe(false);
    expect(option.grid.left).toBe(0);
    expect(option.grid.right).toBe(12);
  });

  it('should snap value axis max to a logical grid boundary', async () => {
    component.data = [
      { type: 'Running', [ChartDataValueTypes.Total]: 30, count: 2 },
      { type: 'Cycling', [ChartDataValueTypes.Total]: 100, count: 1 },
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.yAxis.max).toBe(120);
    expect(option.yAxis.interval).toBe(20);
    expect(option.yAxis.max).not.toBe(110);
  });

  it('should render pictorial bars for pyramids in vertical mode', async () => {
    component.type = 'pyramids';
    component.vertical = true;

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.series[0].type).toBe('pictorialBar');
    expect(option.series[0].symbol).toBe('path://M50,0 L100,100 L0,100 Z');
  });

  it('should include dashed regression line for date category in vertical mode', async () => {
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      { time: Date.UTC(2024, 0, 1), [ChartDataValueTypes.Total]: 10, count: 1 },
      { time: Date.UTC(2024, 0, 2), [ChartDataValueTypes.Total]: 20, count: 1 },
      { time: Date.UTC(2024, 0, 3), [ChartDataValueTypes.Total]: 30, count: 1 },
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const trendSeries = option.series.find((seriesEntry: { type?: string; name?: string }) => (
      seriesEntry.type === 'line' && seriesEntry.name === 'Trend'
    ));
    expect(trendSeries).toBeDefined();
    expect(trendSeries.lineStyle.type).toBe('dashed');
  });

  it('should render summary meta as "per activity type" for activity categories', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.graphic[0].children[2].style.text).toBe('Total per activity type');
  });

  it('should render summary meta as "per month" for monthly date categories', async () => {
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Monthly;
    component.data = [
      { time: Date.UTC(2024, 0, 1), [ChartDataValueTypes.Total]: 10, count: 1 },
      { time: Date.UTC(2024, 1, 1), [ChartDataValueTypes.Total]: 20, count: 1 },
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.graphic[0].children[2].style.text).toBe('Total per month');
  });

  it('should override summary with recovery left now, active total, and latest workout recovery metadata', async () => {
    const nowMs = Date.UTC(2024, 0, 3, 12, 0, 0);
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);
    component.chartDataType = DataRecoveryTime.type;
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      { time: Date.UTC(2024, 0, 3), [ChartDataValueTypes.Total]: 7200, count: 1 },
    ];
    component.recoveryNow = {
      totalSeconds: 7200,
      endTimeMs: nowMs - (30 * 60 * 1000),
    };

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const expectedRemaining = formatDashboardNumericValue(
      DataDuration.type,
      5400,
      undefined as any,
      component.userUnitSettings,
    );
    const expectedTotal = formatDashboardNumericValue(
      DataDuration.type,
      7200,
      undefined as any,
      component.userUnitSettings,
    );
    expect(option.graphic[0].children[0].style.text).toBe('Recovery Left Now');
    expect(option.graphic[0].children[1].style.text).toBe(expectedRemaining);
    expect(option.graphic[0].children[2].style.text).toBe(
      `Active total: ${expectedTotal} | Latest workout: ${expectedTotal}`,
    );

    dateNowSpy.mockRestore();
  });

  it('should format pace summary and axis labels using passed unit settings', async () => {
    component.chartDataType = DataPaceAvg.type;
    component.chartDataValueType = ChartDataValueTypes.Average;
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Monthly;
    component.userUnitSettings = normalizeUserUnitSettings({
      paceUnits: [PaceUnits.MinutesPerMile],
    });
    component.data = [
      { time: Date.UTC(2026, 2, 1), [ChartDataValueTypes.Average]: 422.3478623928474, count: 5 },
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const expectedValue = formatDashboardNumericValue(
      DataPaceAvg.type,
      422.3478623928474,
      undefined as any,
      component.userUnitSettings,
    );
    expect(option.graphic[0].children[1].style.text).toBe(expectedValue);
    expect(option.yAxis.axisLabel.formatter(422.3478623928474)).toBe(expectedValue);
  });

  it('should fill missing daily date buckets with zero-valued bars', async () => {
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      { time: Date.UTC(2024, 0, 1), [ChartDataValueTypes.Total]: 10, count: 1 },
      { time: Date.UTC(2024, 0, 3), [ChartDataValueTypes.Total]: 30, count: 1 },
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.xAxis.data).toHaveLength(3);
    expect(option.series[0].data).toEqual([10, 0, 30]);
  });

  it('should keep missing daily average buckets null and compute the summary from raw data only', async () => {
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.chartDataValueType = ChartDataValueTypes.Average;
    component.data = [
      { time: Date.UTC(2024, 0, 1), [ChartDataValueTypes.Average]: 10, count: 1 },
      { time: Date.UTC(2024, 0, 3), [ChartDataValueTypes.Average]: 30, count: 1 },
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.xAxis.data).toHaveLength(3);
    expect(option.series[0].data.map((entry: { value: number | null }) => entry.value)).toEqual([10, null, 30]);
    expect(option.graphic[0].children[1].style.text).toBe('20.0 m');
  });

  it('should pad a single daily point with adjacent zero buckets and skip trend line', async () => {
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      { time: Date.UTC(2024, 0, 2), [ChartDataValueTypes.Total]: 10, count: 1 }
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.xAxis.data).toHaveLength(3);
    expect(option.series[0].data).toEqual([0, 10, 0]);
    const trendSeries = option.series.find((seriesEntry: { type?: string; name?: string }) => (
      seriesEntry.type === 'line' && seriesEntry.name === 'Trend'
    ));
    expect(trendSeries).toBeUndefined();
  });

  it('should build stacked date activity series with proportional splits and end-value labels', async () => {
    const activityTypeAliases = Object.keys(ActivityTypes).filter((key) => (
      Number.isNaN(Number(key))
      && typeof (ActivityTypes as any)[key] === 'string'
      && `${(ActivityTypes as any)[key]}`.toLowerCase() !== 'unknown sport'
    ));
    const primaryAlias = activityTypeAliases[0];
    const secondaryAlias = activityTypeAliases[1] || activityTypeAliases[0];
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      {
        time: Date.UTC(2024, 0, 1),
        [ChartDataValueTypes.Total]: 100,
        count: 2,
        [primaryAlias]: 80,
        [`${primaryAlias}-Count`]: 1,
        [secondaryAlias]: 20,
        [`${secondaryAlias}-Count`]: 1,
      },
      {
        time: Date.UTC(2024, 0, 2),
        [ChartDataValueTypes.Total]: 50,
        count: 1,
        [primaryAlias]: 10,
        [secondaryAlias]: 40,
      },
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const stackedSeries = option.series.filter((seriesEntry: { stack?: string }) => (
      seriesEntry.stack === 'date-activity-stack'
    ));
    expect(stackedSeries.length).toBeGreaterThanOrEqual(2);
    expect(stackedSeries.every((seriesEntry: { type?: string; stack?: string; label?: { show?: boolean } }) => (
      seriesEntry.type === 'bar'
      && seriesEntry.stack === 'date-activity-stack'
      && seriesEntry.label?.show === false
    ))).toBe(true);
    const totalLabelSeries = option.series.find((seriesEntry: { name?: string }) => (
      seriesEntry.name === '__date_activity_totals__'
    ));
    expect(totalLabelSeries).toBeDefined();
    expect(totalLabelSeries.type).toBe('custom');
    expect(option.tooltip.trigger).toBe('axis');
  });

  it('should keep non-total date activity breakdown in tooltip without stacked rendering', async () => {
    const activityTypeAliases = Object.keys(ActivityTypes).filter((key) => (
      Number.isNaN(Number(key))
      && typeof (ActivityTypes as any)[key] === 'string'
      && `${(ActivityTypes as any)[key]}`.toLowerCase() !== 'unknown sport'
    ));
    const primaryAlias = activityTypeAliases[0];
    const secondaryAlias = activityTypeAliases[1] || activityTypeAliases[0];
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataValueType = ChartDataValueTypes.Maximum;
    component.chartDataTimeInterval = TimeIntervals.Monthly;
    component.data = [
      {
        time: Date.UTC(2024, 0, 1),
        [ChartDataValueTypes.Maximum]: 180,
        count: 19,
        [primaryAlias]: 185,
        [`${primaryAlias}-Count`]: 8,
        [secondaryAlias]: 170,
        [`${secondaryAlias}-Count`]: 5,
      },
      {
        time: Date.UTC(2024, 1, 1),
        [ChartDataValueTypes.Maximum]: 176,
        count: 14,
        [primaryAlias]: 176,
        [secondaryAlias]: 169,
      },
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const stackedSeries = option.series.filter((seriesEntry: { stack?: string }) => (
      seriesEntry.stack === 'date-activity-stack'
    ));
    expect(stackedSeries).toHaveLength(0);
    expect(option.tooltip.trigger).toBe('item');
    const tooltipFormatter = option.tooltip.formatter as (params: { dataIndex: number }) => string;
    const tooltipText = tooltipFormatter({ dataIndex: 0 });
    expect(tooltipText).toContain(primaryAlias);
    expect(tooltipText).toContain(secondaryAlias);
    expect(tooltipText).toContain('Activities');
  });

  it('should render segmented custom pyramids for date category', async () => {
    const activityTypeAliases = Object.keys(ActivityTypes).filter((key) => (
      Number.isNaN(Number(key))
      && typeof (ActivityTypes as any)[key] === 'string'
      && `${(ActivityTypes as any)[key]}`.toLowerCase() !== 'unknown sport'
    ));
    const primaryAlias = activityTypeAliases[0];
    const secondaryAlias = activityTypeAliases[1] || activityTypeAliases[0];
    component.type = 'pyramids';
    component.vertical = true;
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      {
        time: Date.UTC(2024, 0, 1),
        [ChartDataValueTypes.Total]: 100,
        count: 2,
        [primaryAlias]: 80,
        [secondaryAlias]: 20,
      },
      {
        time: Date.UTC(2024, 0, 2),
        [ChartDataValueTypes.Total]: 50,
        count: 1,
        [primaryAlias]: 10,
        [secondaryAlias]: 40,
      },
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const segmentSeries = option.series.filter((seriesEntry: { name?: string }) => (
      seriesEntry.name !== 'Trend' && seriesEntry.name !== '__date_activity_totals__'
    ));
    expect(segmentSeries.length).toBeGreaterThanOrEqual(2);
    expect(segmentSeries.every((seriesEntry: { type?: string; renderItem?: unknown }) => (
      seriesEntry.type === 'custom' && typeof seriesEntry.renderItem === 'function'
    ))).toBe(true);
    expect(segmentSeries.every((seriesEntry: { tooltip?: { show?: boolean } }) => (
      seriesEntry.tooltip?.show !== false
    ))).toBe(true);
    const totalLabelSeries = option.series.find((seriesEntry: { name?: string }) => (
      seriesEntry.name === '__date_activity_totals__'
    ));
    expect(totalLabelSeries).toBeDefined();
    expect(totalLabelSeries.type).toBe('custom');
  });

  it('should build segmented pyramid polygon styles from visual color without deprecated api.style helpers', () => {
    const apiMock = {
      value: vi.fn((dimension: number) => [0, 100, 20, 60][dimension]),
      coord: vi.fn((value: [number, number]) => [value[0] * 10, 200 - value[1]]),
      size: vi.fn(() => [40, 0]),
      visual: vi.fn((key: string) => key === 'color' ? '#16B4EA' : undefined),
      style: vi.fn(),
      styleEmphasis: vi.fn(),
    };

    const shape = (component as any).renderSegmentedPyramidItem({}, apiMock);

    expect(apiMock.visual).toHaveBeenCalledWith('color');
    expect(apiMock.style).not.toHaveBeenCalled();
    expect(apiMock.styleEmphasis).not.toHaveBeenCalled();
    expect(shape).toMatchObject({
      type: 'polygon',
      style: { fill: '#16B4EA' },
      emphasis: {
        style: { fill: '#16B4EA' }
      }
    });
  });

  it('should render stacked date series in horizontal mode', async () => {
    const activityTypeAliases = Object.keys(ActivityTypes).filter((key) => (
      Number.isNaN(Number(key))
      && typeof (ActivityTypes as any)[key] === 'string'
      && `${(ActivityTypes as any)[key]}`.toLowerCase() !== 'unknown sport'
    ));
    const primaryAlias = activityTypeAliases[0];
    const secondaryAlias = activityTypeAliases[1] || activityTypeAliases[0];
    component.vertical = false;
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      {
        time: Date.UTC(2024, 0, 1),
        [ChartDataValueTypes.Total]: 100,
        count: 2,
        [primaryAlias]: 80,
        [secondaryAlias]: 20,
      },
      {
        time: Date.UTC(2024, 0, 2),
        [ChartDataValueTypes.Total]: 50,
        count: 1,
        [primaryAlias]: 10,
        [secondaryAlias]: 40,
      },
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.xAxis.type).toBe('value');
    expect(option.yAxis.type).toBe('category');
    const trendSeries = option.series.find((seriesEntry: { name?: string }) => seriesEntry.name === 'Trend');
    expect(trendSeries).toBeUndefined();
    const stackedSeries = option.series.filter((seriesEntry: { stack?: string }) => (
      seriesEntry.stack === 'date-activity-stack'
    ));
    expect(stackedSeries.every((seriesEntry: { type?: string; stack?: string }) => (
      seriesEntry.type === 'bar' && seriesEntry.stack === 'date-activity-stack'
    ))).toBe(true);
    const totalLabelSeries = option.series.find((seriesEntry: { name?: string }) => (
      seriesEntry.name === '__date_activity_totals__'
    ));
    expect(totalLabelSeries).toBeDefined();
    expect(totalLabelSeries.type).toBe('custom');
  });

  it('should format segmented date tooltip with per-activity percentages', async () => {
    const activityTypeAliases = Object.keys(ActivityTypes).filter((key) => (
      Number.isNaN(Number(key))
      && typeof (ActivityTypes as any)[key] === 'string'
      && `${(ActivityTypes as any)[key]}`.toLowerCase() !== 'unknown sport'
    ));
    const primaryAlias = activityTypeAliases[0];
    const secondaryAlias = activityTypeAliases[1] || activityTypeAliases[0];
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      {
        time: Date.UTC(2024, 0, 1),
        [ChartDataValueTypes.Total]: 100,
        count: 2,
        [primaryAlias]: 80,
        [`${primaryAlias}-Count`]: 1,
        [secondaryAlias]: 20,
        [`${secondaryAlias}-Count`]: 1,
      }
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const formatter = option.tooltip.formatter as (params: Array<{ dataIndex: number }>) => string;
    const tooltipText = formatter([{ dataIndex: 1 }]);

    expect(tooltipText).toContain('100');
    expect(tooltipText).toContain('%');
    expect(tooltipText).toContain(primaryAlias);
  });

  it('should format non-total segmented tooltips using raw per-activity aggregates without percentages', () => {
    component.chartDataType = DataDistance.type;
    component.chartDataValueType = ChartDataValueTypes.Maximum;

    const tooltipText = (component as any).formatDateActivityTooltip(
      [
        {
          index: 0,
          label: 'Feb 2026',
          time: Date.UTC(2026, 1, 1),
          total: 180,
          count: 19,
          segments: [
            {
              activityKey: 'Cycling',
              activityType: ActivityTypes.Cycling,
              label: 'Cycling',
              colorKey: ActivityTypes.Cycling,
              rawValue: 170,
              value: 85,
              percent: 47.5,
              count: 8,
            },
            {
              activityKey: 'Running',
              activityType: ActivityTypes.Running,
              label: 'Running',
              colorKey: ActivityTypes.Running,
              rawValue: 160,
              value: 80,
              percent: 44.4,
              count: 7,
            },
          ],
          rawItem: null,
        },
      ],
      [{ dataIndex: 0 }],
      new Map<string, string>([
        ['Cycling', '#16B4EA'],
        ['Running', '#F48FB1'],
      ]),
    );

    expect(tooltipText).toContain('Cycling');
    expect(tooltipText).toContain('170');
    expect(tooltipText).not.toContain('47.5%');
    expect(tooltipText).toContain('Maximum');
  });

  it('should enable segmented stacked date rendering for non-total metrics only when explicitly preferred', async () => {
    const activityTypeAliases = Object.keys(ActivityTypes).filter((key) => (
      Number.isNaN(Number(key))
      && typeof (ActivityTypes as any)[key] === 'string'
      && `${(ActivityTypes as any)[key]}`.toLowerCase() !== 'unknown sport'
    ));
    const primaryAlias = activityTypeAliases[0];
    const secondaryAlias = activityTypeAliases[1] || activityTypeAliases[0];

    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataValueType = ChartDataValueTypes.Maximum;
    component.chartDataTimeInterval = TimeIntervals.Monthly;
    component.preferDateActivitySegmentation = true;
    component.data = [
      {
        time: Date.UTC(2026, 0, 1),
        [ChartDataValueTypes.Maximum]: 193,
        count: 19,
        [primaryAlias]: 180,
        [`${primaryAlias}-Count`]: 8,
        [secondaryAlias]: 160,
        [`${secondaryAlias}-Count`]: 7,
      },
      {
        time: Date.UTC(2026, 1, 1),
        [ChartDataValueTypes.Maximum]: 180,
        count: 12,
        [primaryAlias]: 176,
        [secondaryAlias]: 170,
      },
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const stackedSeries = option.series.filter((seriesEntry: { stack?: string }) => (
      seriesEntry.stack === 'date-activity-stack'
    ));
    expect(stackedSeries.length).toBeGreaterThan(0);
    expect(option.tooltip.trigger).toBe('axis');
  });

  it('should not include a trend line for non-date categories', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const trendSeries = option.series.find((seriesEntry: { type?: string; name?: string }) => (
      seriesEntry.type === 'line' && seriesEntry.name === 'Trend'
    ));
    expect(trendSeries).toBeUndefined();
  });

  it('should include label, value, and count in tooltip', async () => {
    component.data = [
      { type: 'Running', [ChartDataValueTypes.Total]: 10, count: 3 }
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    const formatter = option.tooltip.formatter as (params: { dataIndex: number }) => string;
    const tooltipText = formatter({ dataIndex: 0 });

    expect(tooltipText).toContain('Running');
    expect(tooltipText).toContain('<strong>');
    expect(tooltipText).toContain('Activities');
  });

  it('should resolve activity colors via AppEventColorService', async () => {
    const activityTypeAlias = Object.keys(ActivityTypes).find((key) => (
      Number.isNaN(Number(key))
      && typeof (ActivityTypes as any)[key] === 'string'
      && `${(ActivityTypes as any)[key]}`.toLowerCase() !== 'unknown sport'
    )) as string;
    const normalizedActivityType = (ActivityTypes as any)[activityTypeAlias] as ActivityTypes;
    component.data = [
      { type: activityTypeAlias, [ChartDataValueTypes.Total]: 10, count: 1 }
    ];

    fixture.detectChanges();
    await waitForChartStabilization();

    expect(mockColorService.getColorForActivityTypeByActivityTypeGroup).toHaveBeenCalledWith(normalizedActivityType);
  });

  it('should apply dark styles when chart theme is dark', async () => {
    component.darkTheme = true;

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.tooltip.backgroundColor).toBe('rgba(58,62,68,1)');
    expect(option.textStyle.color).toBe('rgba(223,223,225,1)');
  });

  it('should ignore ngOnChanges before chart initialization', () => {
    component.ngOnChanges({
      data: new SimpleChange([], [{ type: 'Running', [ChartDataValueTypes.Total]: 12 }], false)
    });

    expect(mockLoader.setOption).not.toHaveBeenCalled();
  });

  it('should start a one-minute refresh timer only for active recovery contexts and clear it on destroy', async () => {
    const nowMs = Date.UTC(2024, 0, 3, 12, 0, 0);
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 456 as any);
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);
    component.chartDataType = DataRecoveryTime.type;
    component.chartDataCategoryType = ChartDataCategoryTypes.DateType;
    component.chartDataTimeInterval = TimeIntervals.Daily;
    component.data = [
      { time: Date.UTC(2024, 0, 3), [ChartDataValueTypes.Total]: 3600, count: 1 },
    ];
    component.recoveryNow = {
      totalSeconds: 3600,
      endTimeMs: nowMs - (300 * 1000),
    };

    fixture.detectChanges();
    await waitForChartStabilization();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60 * 1000);
    fixture.destroy();
    expect(clearIntervalSpy).toHaveBeenCalledWith(456);

    clearIntervalSpy.mockRestore();
    setIntervalSpy.mockRestore();
    dateNowSpy.mockRestore();
  });

  it('should return empty series and axes for empty data', async () => {
    component.data = [];

    fixture.detectChanges();
    await waitForChartStabilization();

    const option = getLastOption();
    expect(option.series).toEqual([]);
    expect(option.xAxis).toEqual([]);
    expect(option.yAxis).toEqual([]);
  });

  it('should dispose chart on destroy', async () => {
    fixture.detectChanges();
    await waitForChartStabilization();

    fixture.destroy();

    expect(mockLoader.dispose).toHaveBeenCalledWith(mockChart);
  });
});
