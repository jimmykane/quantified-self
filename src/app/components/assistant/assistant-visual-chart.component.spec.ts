import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AppThemes,
  DataDistance,
  DistanceUnits,
} from '@sports-alliance/sports-lib';
import type { EChartsType } from 'echarts/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { AppThemeService } from '../../services/app.theme.service';
import { AppUserSettingsQueryService } from '../../services/app.user-settings-query.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { AssistantVisualChartComponent } from './assistant-visual-chart.component';

describe('AssistantVisualChartComponent', () => {
  let fixture: ComponentFixture<AssistantVisualChartComponent>;
  const unitSettings = signal(normalizeUserUnitSettings({}));
  const chart = {
    dispatchAction: vi.fn(),
    isDisposed: vi.fn(() => false),
  };
  const loader = {
    init: vi.fn().mockResolvedValue(chart),
    setOption: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    subscribeToViewportResize: vi.fn(() => vi.fn()),
    attachMobileSeriesTapFeedback: vi.fn(() => vi.fn()),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    unitSettings.set(normalizeUserUnitSettings({}));
    await TestBed.configureTestingModule({
      imports: [AssistantVisualChartComponent],
      providers: [
        { provide: EChartsLoaderService, useValue: loader },
        { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Normal) } },
        { provide: AppUserSettingsQueryService, useValue: { unitSettings } },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AssistantVisualChartComponent);
    fixture.componentInstance.visual = {
      kind: 'chart',
      title: 'Sleep trend',
      chartType: 'line',
      xAxis: {
        type: 'time',
        label: 'Date',
        unit: null,
        timeZone: 'Europe/Helsinki',
      },
      series: [{
        label: 'Overnight HRV',
        unit: 'ms',
        points: [
          { x: '2026-08-01T00:00:00.000Z', y: 52 },
          { x: '2026-08-02T00:00:00.000Z', y: null },
        ],
      }],
    };
  });

  it('renders through the shared ECharts host and keeps nulls as gaps', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    await fixture.componentInstance.ngAfterViewInit();
    expect(loader.setOption).toHaveBeenCalledOnce();

    expect(loader.init).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      'light',
      undefined,
    );
    const option = loader.setOption.mock.calls[0][1] as {
      series: Array<{ data: Array<[number, number | null]>; connectNulls: boolean }>;
      xAxis: { axisLabel: { formatter: (value: number) => string } };
    };
    expect(option.series[0].connectNulls).toBe(false);
    expect(option.series[0].data).toEqual([
      [Date.parse('2026-08-01T00:00:00.000Z'), 52],
      [Date.parse('2026-08-02T00:00:00.000Z'), null],
    ]);
    const localMidnight = Date.parse('2026-07-31T21:00:00.000Z');
    expect(option.xAxis.axisLabel.formatter(localMidnight)).toBe(
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeZone: 'Europe/Helsinki',
      }).format(localMidnight),
    );
  });

  it('disposes the shared chart host on teardown', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    await fixture.componentInstance.ngAfterViewInit();
    fixture.destroy();

    expect(loader.dispose).toHaveBeenCalledWith(chart);
  });

  it('formats canonical distance values using the current account unit setting', () => {
    fixture.componentInstance.visual = {
      kind: 'chart',
      title: 'Distance trend',
      chartType: 'line',
      xAxis: {
        type: 'time',
        label: 'Period',
        unit: null,
        timeZone: 'Europe/Helsinki',
      },
      series: [{
        label: 'Distance (Total)',
        unit: 'm',
        dataType: DataDistance.type,
        points: [{ x: '2026-08-03T00:00:00.000Z', y: 70_000 }],
      }],
    };
    const buildOption = () => (
      fixture.componentInstance as unknown as {
        buildOption: (darkTheme: boolean) => Parameters<EChartsType['setOption']>[0];
      }
    ).buildOption(false) as {
      yAxis: Array<{
        name: string;
        axisLabel: { formatter: (value: number) => string };
      }>;
      series: Array<{ data: Array<[number, number | null]> }>;
      tooltip: { formatter: (params: unknown) => string };
    };

    let option = buildOption();
    expect(option.yAxis[0].name).toBe('km');
    expect(option.yAxis[0].axisLabel.formatter(70_000)).toBe('70');
    expect(option.tooltip.formatter({
      seriesName: 'Distance (Total)',
      value: [Date.parse('2026-08-03T00:00:00.000Z'), 70_000],
    })).toContain('70.00 km');
    expect(option.series[0].data[0][1]).toBe(70_000);

    unitSettings.set(normalizeUserUnitSettings({
      distanceUnits: DistanceUnits.Miles,
    }));
    option = buildOption();
    expect(option.yAxis[0].name).toBe('mi');
    expect(option.yAxis[0].axisLabel.formatter(70_000)).toBe('43.5');
    expect(option.tooltip.formatter({
      seriesName: 'Distance (Total)',
      value: [Date.parse('2026-08-03T00:00:00.000Z'), 70_000],
    })).toContain('43.51 mi');
    expect(option.series[0].data[0][1]).toBe(70_000);

    unitSettings.set(normalizeUserUnitSettings({
      distanceUnits: DistanceUnits.Kilometers,
    }));
    fixture.componentInstance.visual.series[0].points[0].y = 700;
    option = buildOption();
    expect(option.yAxis[0].name).toBe('m');
    expect(option.yAxis[0].axisLabel.formatter(700)).toBe('700');
  });

  it('formats a canonical distance X axis and its tooltip title', () => {
    unitSettings.set(normalizeUserUnitSettings({
      distanceUnits: DistanceUnits.Miles,
    }));
    fixture.componentInstance.visual = {
      kind: 'chart',
      title: 'Heart rate by distance',
      chartType: 'line',
      xAxis: {
        type: 'linear',
        label: 'Distance',
        unit: 'm',
        dataType: DataDistance.type,
        timeZone: null,
      },
      series: [{
        label: 'Heart rate',
        unit: 'bpm',
        points: [{ x: 1_609.344, y: 145 }, { x: 16_093.44, y: 160 }],
      }],
    };

    const option = (
      fixture.componentInstance as unknown as {
        buildOption: (darkTheme: boolean) => Parameters<EChartsType['setOption']>[0];
      }
    ).buildOption(false) as {
      xAxis: {
        name: string;
        axisLabel: { formatter: (value: number) => string };
      };
      tooltip: { formatter: (params: unknown) => string };
    };

    expect(option.xAxis.name).toBe('Distance (mi)');
    expect(option.xAxis.axisLabel.formatter(1_609.344)).toBe('1');
    expect(option.tooltip.formatter({
      seriesName: 'Heart rate',
      value: [1_609.344, 145],
    })).toContain('Distance: 1.00 mi');
  });
});
