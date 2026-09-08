import { ComponentFixture, TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DistanceUnits } from '@sports-alliance/sports-lib';
import {
  HEALTH_METRIC_IDS,
  HEALTH_PROVIDERS,
  HEALTH_RECORDING_METHODS,
  HEALTH_VALUE_ORIGINS,
  HEALTH_VALUE_TYPES,
} from '@shared/health';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import type { TimelineNote } from '@shared/timeline-notes';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHealthChartModels } from '../../helpers/health-metric-chart.helper';
import { HealthWorkspaceSeries } from '../../helpers/health-workspace.helper';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { HealthMetricSeriesChartComponent } from './health-metric-series-chart.component';
import { DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS } from '../../helpers/echarts-tooltip-interaction.helper';

const DAY_MS = 24 * 60 * 60 * 1000;

function series(overrides: Partial<HealthWorkspaceSeries> = {}): HealthWorkspaceSeries {
  return {
    id: 'garmin-resting-heart-rate',
    metricId: HEALTH_METRIC_IDS.RestingHeartRate,
    provider: HEALTH_PROVIDERS.GarminAPI,
    providerLabel: 'Garmin',
    sourceLabel: 'Garmin',
    accountLabel: null,
    semanticLabel: 'Average · Daily resting',
    aggregation: 'average',
    semanticVariant: 'daily_resting',
    origin: HEALTH_VALUE_ORIGINS.ProviderSummary,
    recordingMethod: HEALTH_RECORDING_METHODS.ProviderCalculated,
    unit: 'bpm',
    normalizationStatus: 'canonical',
    nativeOnly: false,
    valueType: HEALTH_VALUE_TYPES.Number,
    chartKind: 'line',
    points: [
      { timestampMs: 0, calendarDate: '1970-01-01', value: 50, qualityCode: null },
      { timestampMs: DAY_MS, calendarDate: '1970-01-02', value: 52, qualityCode: null },
    ],
    deviceLabel: 'Garmin Test',
    coverageText: '2/14 days',
    freshnessText: 'Fresh',
    hasConflict: false,
    ...overrides,
  };
}

describe('HealthMetricSeriesChartComponent', () => {
  it('gives Highlights a readable plot height on both breakpoints without enlarging full charts', () => {
    const styles = readFileSync(resolve(process.cwd(),
      'src/app/components/health/health-metric-series-chart.component.scss'), 'utf8');
    expect(styles).toMatch(/\.health-metric-series-chart\s*\{\s*height:\s*190px/);
    expect(styles).toMatch(/@media[^}]+height:\s*210px/);
    expect(styles.match(/\.health-metric-series-chart-compact\s*\{/g)).toHaveLength(1);
    expect(styles).toMatch(/\.health-metric-series-chart-compact\s*\{\s*height:\s*112px/);
    expect(styles.indexOf('.health-metric-series-chart-compact')).toBeGreaterThan(styles.indexOf('@media'));
  });

  let fixture: ComponentFixture<HealthMetricSeriesChartComponent>;
  let chart: { isDisposed: ReturnType<typeof vi.fn>; dispatchAction: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn>; getWidth: ReturnType<typeof vi.fn> };
  let eChartsLoader: {
    init: ReturnType<typeof vi.fn>;
    setOption: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    subscribeToViewportResize: ReturnType<typeof vi.fn>;
    attachMobileSeriesTapFeedback: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    chart = {
      isDisposed: vi.fn().mockReturnValue(false),
      dispatchAction: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      getWidth: vi.fn().mockReturnValue(320),
    };
    eChartsLoader = {
      init: vi.fn().mockResolvedValue(chart),
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
      subscribeToViewportResize: vi.fn().mockReturnValue(() => undefined),
      attachMobileSeriesTapFeedback: vi.fn().mockReturnValue(() => undefined),
    };

    await TestBed.configureTestingModule({
      imports: [HealthMetricSeriesChartComponent],
      providers: [
        { provide: EChartsLoaderService, useValue: eChartsLoader },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HealthMetricSeriesChartComponent);
    fixture.componentRef.setInput('model', buildHealthChartModels([series()], 0, DAY_MS)[0]);
    fixture.componentRef.setInput('startTimeMs', 0);
    fixture.componentRef.setInput('endTimeMs', DAY_MS);
    fixture.componentRef.setInput('darkTheme', false);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('renders through the shared ECharts host instead of a custom SVG', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.health-metric-series-chart')).toBeTruthy();
    expect(host.querySelector('svg')).toBeNull();
    expect(eChartsLoader.init).toHaveBeenCalledWith(expect.any(HTMLDivElement), 'light', undefined);
    expect(eChartsLoader.setOption).toHaveBeenCalledTimes(1);
    expect(eChartsLoader.attachMobileSeriesTapFeedback).toHaveBeenCalledExactlyOnceWith(
      expect.anything(), DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS,
    );
    const option = eChartsLoader.setOption.mock.calls[0][1] as { series: Array<{ type: string }> };
    expect(option.series[0].type).toBe('line');
  });

  it('refreshes chart labels when the signed-in user changes display units', async () => {
    fixture.componentRef.setInput('model', buildHealthChartModels([series({
      metricId: HEALTH_METRIC_IDS.Distance,
      unit: 'meter',
      points: [{ timestampMs: 0, calendarDate: '1970-01-01', value: 10_000, qualityCode: null }],
    })], 0, DAY_MS)[0]);
    fixture.componentRef.setInput('unitSettings', normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles }));
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(eChartsLoader.setOption).toHaveBeenCalledTimes(2);
    });

    const option = eChartsLoader.setOption.mock.calls.at(-1)?.[1] as {
      tooltip: { formatter: (params: { value?: unknown }) => string };
      yAxis: { axisLabel: { formatter: (value: number) => string } };
    };
    expect(option.tooltip.formatter({ value: [0, 10_000] })).toContain('6.22 mi');
    expect(option.yAxis.axisLabel.formatter(10_000)).toBe('6.22');
  });

  it('renders an accessible personal-range overlay when the highlight provides one', async () => {
    fixture.componentRef.setInput('model', buildHealthChartModels([series({
      metricId: HEALTH_METRIC_IDS.HeartRateVariability, unit: 'millisecond',
    })], 0, DAY_MS)[0]);
    fixture.componentRef.setInput('statusOverlay', {
      normalRangeColor: '#00aa00',
      statusColor: '#ffaa00',
      pointStatuses: [0, DAY_MS].map(timestampMs => ({ timestampMs, color: '#ffaa00',
        label: 'Outside personal range', normalRange: { min: 45, max: 55 } })),
    });
    fixture.componentRef.setInput('statusDescription', 'Outside personal range. 7-day average 58 ms.');
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => {
      expect(eChartsLoader.setOption.mock.calls.some(call =>
        (call[1] as { series?: Array<{ id?: string }> })?.series?.some(item => item.id === 'hrv-personal-range-band'))).toBe(true);
    });

    const chart = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="img"]');
    expect(chart?.getAttribute('aria-label')).toContain('Outside personal range. 7-day average 58 ms.');
    const option = eChartsLoader.setOption.mock.calls
      .map(call => call[1] as { series: Array<{ id?: string; markPoint: unknown }> })
      .find(candidate => candidate.series.some(item => item.id === 'hrv-personal-range-band')) as {
      series: Array<{ id?: string; markPoint: unknown }>;
    };
    expect(option.series.some(item => item.id === 'hrv-personal-range-band')).toBe(true);
    expect(option.series[0].markPoint).toBeTruthy();
  });

  it('adds selectable notes to compact Highlights without changing values or the personal range', async () => {
    const note: TimelineNote = { id: 'a'.repeat(64), category: 'travel', title: 'Travel', startDate: '1970-01-01', endDate: '1970-01-02', timeZone: 'UTC', revision: 1, createdAtMs: 1, updatedAtMs: 1 };
    const context = { notes: [note], select: vi.fn(), reportRange: vi.fn() };
    fixture.componentRef.setInput('compact', true);
    fixture.componentRef.setInput('model', buildHealthChartModels([series({
      metricId: HEALTH_METRIC_IDS.HeartRateVariability, unit: 'millisecond',
    })], 0, DAY_MS)[0]);
    fixture.componentRef.setInput('statusOverlay', { normalRangeColor: '#00aa00', statusColor: '#ffaa00',
      pointStatuses: [0, DAY_MS].map(timestampMs => ({ timestampMs, color: '#ffaa00',
        label: 'Outside personal range', normalRange: { min: 45, max: 55 } })),
    });
    fixture.detectChanges(); await fixture.whenStable();
    await vi.waitFor(() => expect(eChartsLoader.setOption).toHaveBeenCalledTimes(2));
    type Axis = { type: string; min: number; max: number; show: boolean };
    type Option = { xAxis: Axis; yAxis: Axis; series: Array<{ id?: string; data: unknown[]; markArea?: unknown; markLine?: { data: Array<{ name: string }> } }> };
    const before = eChartsLoader.setOption.mock.calls.at(-1)?.[1] as Option;
    fixture.componentRef.setInput('timelineNotes', context);
    fixture.detectChanges(); await fixture.whenStable();
    await vi.waitFor(() => expect(eChartsLoader.setOption).toHaveBeenCalledTimes(3));
    const annotated = eChartsLoader.setOption.mock.calls.at(-1)?.[1] as Option;
    expect(annotated.series).toHaveLength(before.series.length + 1);
    expect(annotated.series[0]).toMatchObject({ ...before.series[0], itemStyle: { color: expect.any(Function) } });
    expect(annotated.series.find(item => item.id === 'hrv-personal-range-band'))
      .toEqual(before.series.find(item => item.id === 'hrv-personal-range-band'));
    expect(annotated.xAxis).toMatchObject({ type: 'time', min: 0, max: DAY_MS, show: false });
    expect(annotated.yAxis).toMatchObject({ min: before.yAxis.min, max: before.yAxis.max, show: false });
    expect(context.reportRange).toHaveBeenCalledWith(expect.anything(), { startDate: '1970-01-01', endDate: '1970-01-02' });
    const overlay = annotated.series.at(-1)!;
    expect(overlay.id).toBe('timeline-note-overlay-0');
    expect(overlay.data).toEqual([]);
    const marker = { componentType: 'markLine', name: overlay.markLine!.data[0].name };
    expect(chart.on).toHaveBeenCalledOnce();
    chart.on.mock.calls[0][1](marker);
    expect(context.select).toHaveBeenCalledExactlyOnceWith([note]);

    fixture.componentRef.setInput('timelineNotes', { ...context, notes: [] });
    fixture.detectChanges(); await fixture.whenStable();
    await vi.waitFor(() => expect(eChartsLoader.setOption).toHaveBeenCalledTimes(4));
    const hidden = eChartsLoader.setOption.mock.calls.at(-1)?.[1] as Option;
    expect(hidden.series).toHaveLength(before.series.length);
    expect(hidden.series[0]).toMatchObject({ ...before.series[0], itemStyle: { color: expect.any(Function) } });
    expect(hidden.series.slice(1)).toEqual(before.series.slice(1));
    chart.on.mock.calls[0][1](marker);
    expect(context.select).toHaveBeenCalledOnce();
    fixture.destroy();
    expect(chart.off).toHaveBeenCalledWith('click', chart.on.mock.calls[0][1]);
    expect(context.reportRange).toHaveBeenLastCalledWith(expect.anything(), null);
  });
});
