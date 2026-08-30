import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  HEALTH_PROVIDERS,
  HEALTH_RECORDING_METHODS,
  HEALTH_VALUE_ORIGINS,
  HEALTH_VALUE_TYPES,
} from '@shared/health';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHealthChartModels } from '../../helpers/health-metric-chart.helper';
import { HealthWorkspaceSeries } from '../../helpers/health-workspace.helper';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { HealthMetricSeriesChartComponent } from './health-metric-series-chart.component';

const DAY_MS = 24 * 60 * 60 * 1000;

function series(): HealthWorkspaceSeries {
  return {
    id: 'garmin-resting-heart-rate',
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
  };
}

describe('HealthMetricSeriesChartComponent', () => {
  let fixture: ComponentFixture<HealthMetricSeriesChartComponent>;
  let eChartsLoader: {
    init: ReturnType<typeof vi.fn>;
    setOption: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    subscribeToViewportResize: ReturnType<typeof vi.fn>;
    attachMobileSeriesTapFeedback: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const chart = {
      isDisposed: vi.fn().mockReturnValue(false),
      dispatchAction: vi.fn(),
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
    const option = eChartsLoader.setOption.mock.calls[0][1] as { series: Array<{ type: string }> };
    expect(option.series[0].type).toBe('line');
  });
});
