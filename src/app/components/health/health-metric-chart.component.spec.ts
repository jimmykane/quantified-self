import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DistanceUnits, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import {
  HEALTH_METRIC_IDS,
  HEALTH_PROVIDERS,
  HEALTH_RECORDING_METHODS,
  HEALTH_VALUE_ORIGINS,
  HEALTH_VALUE_TYPES,
} from '@shared/health';
import { describe, expect, it, vi } from 'vitest';
import { AppHapticsService } from '../../services/app.haptics.service';
import {
  HealthChartSeriesModel,
  HealthChartStatusOverlay,
} from '../../helpers/health-metric-chart.helper';
import { HealthWorkspaceSeries } from '../../helpers/health-workspace.helper';
import { HealthMetricChartComponent } from './health-metric-chart.component';
import { HealthMetricSeriesChartComponent } from './health-metric-series-chart.component';

@Component({
  selector: 'app-health-metric-series-chart',
  standalone: true,
  template: '<div class="chart-stub"></div>',
})
class HealthMetricSeriesChartStubComponent {
  @Input() timelineNotes = null;
  @Input() model!: HealthChartSeriesModel;
  @Input() startTimeMs = 0;
  @Input() endTimeMs = 0;
  @Input() darkTheme = false;
  @Input() unitSettings: UserUnitSettingsInterface | null = null;
  @Input() statusOverlay: HealthChartStatusOverlay | null = null;
  @Input() statusDescription: string | null = null;
}

function series(deviceLabel: string | null): HealthWorkspaceSeries {
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
    points: [{ timestampMs: 0, calendarDate: '1970-01-01', value: 50, qualityCode: null }],
    deviceLabel,
    coverageText: '1/14 days',
    freshnessText: 'Fresh',
    hasConflict: false,
  };
}

describe('HealthMetricChartComponent', () => {
  let fixture: ComponentFixture<HealthMetricChartComponent>;
  let haptics: { selection: ReturnType<typeof vi.fn> };

  async function render(deviceLabel: string | null): Promise<HTMLElement> {
    haptics = { selection: vi.fn() };
    await TestBed.configureTestingModule({ imports: [HealthMetricChartComponent], providers: [{ provide: AppHapticsService, useValue: haptics }] })
      .overrideComponent(HealthMetricChartComponent, {
        remove: { imports: [HealthMetricSeriesChartComponent] },
        add: { imports: [HealthMetricSeriesChartStubComponent] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(HealthMetricChartComponent);
    fixture.componentRef.setInput('series', [series(deviceLabel)]);
    fixture.componentRef.setInput('startTimeMs', 0);
    fixture.componentRef.setInput('endTimeMs', 1);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows reported device attribution beside the chart metadata', async () => {
    const host = await render('Garmin Test');

    expect(host.textContent).toContain('Device: Garmin Test');
    expect(host.textContent).toContain('bpm');
    expect(host.textContent).toContain('Daily resting HR');
    expect(host.textContent).toContain('Latest record:');
    expect(host.textContent).toContain('No trend inferred');
    expect(host.querySelector('.health-chart-unit')?.textContent?.trim()).toBe('bpm');
    expect(host.querySelector('.health-chart-unit')?.textContent).not.toContain('Latest record:');
  });

  it('does not render an empty device label when attribution is unavailable', async () => {
    const host = await render(null);

    expect(host.textContent).not.toContain('Device:');
  });

  it('shows a dated two-reading change per source without drawing a trend or comparing different sources', async () => {
    const host = await render(null);
    const first = series(null), last = { ...first.points[0], timestampMs: 30 * 86400000, calendarDate: '1970-01-31', value: 48 };
    fixture.componentRef.setInput('endTimeMs', 31 * 86400000);
    fixture.componentRef.setInput('series', [{ ...first, points: [...first.points, last] }, { ...first, id: 'another-source' }]);
    fixture.detectChanges();
    const charts = fixture.debugElement.queryAll(By.directive(HealthMetricSeriesChartStubComponent));
    const model = charts[0].componentInstance.model as HealthChartSeriesModel;
    expect(model.plotKind).toBe('point');
    expect(host.textContent).toContain(model.twoReadingComparisonText!);
    expect(host.textContent).toContain('No trend inferred');
    expect(charts[1].componentInstance.model.twoReadingComparisonText).toBeNull();
    expect(host.textContent?.match(/Recorded change:/g)).toHaveLength(1);
  });

  it('stretches chart rows only when the workspace opts in', async () => {
    const host = await render(null);
    expect(host.classList.contains('health-metric-chart-fill-height')).toBe(false);
    expect(host.querySelector('.compact-row-host--fill-height')).toBeNull();

    fixture.componentRef.setInput('fillHeight', true);
    fixture.componentRef.setInput('series', [series(null), { ...series(null), id: 'second-source' }]);
    fixture.detectChanges();
    expect(host.classList.contains('health-metric-chart-fill-height')).toBe(true);
    expect(host.querySelectorAll('.compact-row-host--fill-height')).toHaveLength(2);

    fixture.componentRef.setInput('fillHeight', false);
    fixture.detectChanges();
    expect(host.querySelector('.compact-row-host--fill-height')).toBeNull();
  });

  it('leads with the latest reading while keeping its provider in the compact picker', async () => {
    const host = await render(null);
    fixture.componentRef.setInput('series', [{ ...series(null), metricId: HEALTH_METRIC_IDS.HeartRate,
      semanticLabel: '7-day average · Provider reported', semanticVariant: 'rolling_7_day_average' }]);
    fixture.detectChanges();
    expect(host.querySelector('h3')?.textContent).toBe('Latest reading');
    expect(host.querySelector('app-chart-source-picker')?.textContent).toContain('Garmin');
    expect(host.querySelector('.health-chart-reading-value')?.textContent).toBe('50 bpm');
    expect(host.querySelector('.health-chart-recorded-date')?.textContent).toContain('1970');
    expect(host.querySelector('.health-reading-controls')?.textContent).toContain('7-day average HR');
  });
  it('keeps recording details behind an accessible, source-specific disclosure', async () => {
    const host = await render(null);
    fixture.componentRef.setInput('series', [{ ...series('Watch'), metricId: HEALTH_METRIC_IDS.HeartRate,
      semanticVariant: 'activity_interval_average', sourceLabel: 'Suunto' }]);
    fixture.detectChanges();
    const button = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    const details = host.querySelector<HTMLElement>('.health-chart-details')!;
    expect(button.getAttribute('aria-label')).toBe('Show Suunto recording details');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe(details.id);
    expect(details.hidden).toBe(true);
    expect(details.textContent).toContain('average heart rate for each short recording period');
    expect(host.querySelector('.health-chart-reading-header')?.textContent).not.toMatch(/interval|15-second|unknown|points shown/i);
    expect(host.querySelector('.health-chart-coverage')?.textContent).toContain('1/14 days');
    expect(haptics.selection).not.toHaveBeenCalled();
    button.click(); fixture.detectChanges();
    expect(details.hidden).toBe(false); expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(haptics.selection).toHaveBeenCalledOnce();
    fixture.componentInstance.toggleDetails('missing'); expect(haptics.selection).toHaveBeenCalledOnce();
    fixture.componentRef.setInput('series', []); fixture.detectChanges();
    expect(fixture.componentInstance.expandedDetails().size).toBe(0);
    expect(haptics.selection).toHaveBeenCalledOnce();
  });

  it('keeps the selected daytime source first and separates sleep and rolling measurements', async () => {
    const host = await render(null);
    const heart = { ...series(null), metricId: HEALTH_METRIC_IDS.HeartRate };
    const garmin = { ...heart, id: 'garmin-day', semanticVariant: 'daily_15_second' };
    const suunto = { ...heart, id: 'suunto-day', provider: HEALTH_PROVIDERS.SuuntoApp, sourceLabel: 'Suunto', semanticVariant: 'activity_interval_average' };
    fixture.componentRef.setInput('series', [
      { ...heart, id: 'rolling', semanticVariant: 'rolling_7_day_average' },
      { ...heart, id: 'sleep', semanticVariant: 'sleep_session_average_heart_rate' }, garmin, suunto,
    ]);
    fixture.componentRef.setInput('selectedSourceKey', 'suunto-day'); fixture.detectChanges();
    expect(fixture.componentInstance.renderedModels().map(chart => chart.model.series.id)).toEqual(['suunto-day']);
    expect(host.querySelectorAll('app-health-metric-series-chart')).toHaveLength(1);
    expect(haptics.selection).not.toHaveBeenCalled();
    const changedSource = vi.fn(); fixture.componentInstance.sourceSelected.subscribe(changedSource);
    const compare = host.querySelector<HTMLButtonElement>('button[aria-controls="health-source-charts"]')!;
    expect(compare.getAttribute('aria-expanded')).toBe('false');
    compare.click(); fixture.detectChanges();
    expect(fixture.componentInstance.renderedModels().map(chart => chart.model.series.id)).toEqual(['suunto-day', 'garmin-day']);
    expect(host.querySelectorAll('app-health-metric-series-chart')).toHaveLength(2);
    expect(compare.getAttribute('aria-expanded')).toBe('true');
    expect(haptics.selection).toHaveBeenCalledOnce();
    compare.click(); fixture.detectChanges();
    expect(host.querySelectorAll('app-health-metric-series-chart')).toHaveLength(1);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    expect(changedSource).not.toHaveBeenCalled();
    fixture.componentRef.setInput('selectedSourceKey', 'sleep'); fixture.detectChanges();
    expect(fixture.componentInstance.renderedModels().map(chart => chart.model.series.id)).toEqual(['sleep']);
    fixture.componentRef.setInput('selectedSourceKey', 'not-in-period'); fixture.detectChanges();
    expect(fixture.componentInstance.renderedModels()).toEqual([]);
    expect(host.textContent).toContain('no readings in this period');
  });

  it('keeps calculated attribution and recording explanations without hiding coverage', async () => {
    const host = await render(null);
    fixture.componentRef.setInput('series', [{ ...series(null), metricId: HEALTH_METRIC_IDS.HeartRate,
      semanticVariant: 'qs_sleep_session_average_heart_rate', origin: HEALTH_VALUE_ORIGINS.QuantifiedSelfDerived,
      recordingMethod: HEALTH_RECORDING_METHODS.QuantifiedSelfCalculated }]);
    fixture.componentRef.setInput('readingNotice', 'This explanation belongs to the selected measurement.');
    fixture.detectChanges();
    expect(host.querySelector('.health-chart-reading-header > div')?.firstElementChild?.textContent).toBe('Calculated by QS');
    expect(host.querySelector('.health-chart-coverage')?.textContent).toContain('1/14 days');
    const details = host.querySelector<HTMLElement>('.health-chart-details')!;
    expect(details.hidden).toBe(true);
    expect(details.textContent).toContain('This explanation belongs to the selected measurement.');
    expect(host.querySelector('button[aria-controls="health-source-charts"]')).toBeNull();
    fixture.componentInstance.toggleComparison();
    expect(fixture.componentInstance.comparingSources()).toBe(false);
    expect(haptics.selection).not.toHaveBeenCalled();
  });
  it('keeps the same source across detailed and daily-average views without saving another selection', async () => {
    const host = await render(null);
    const changed = vi.fn(); fixture.componentInstance.sourceSelected.subscribe(changed);
    const day = { ...series(null), id: 'day', metricId: HEALTH_METRIC_IDS.HeartRate, semanticVariant: 'activity_interval_average', alternateResolutionKey: 'daily' };
    const daily = { ...day, id: 'daily', semanticVariant: 'qs_daily_interval_mean', alternateResolutionKey: 'day',
      origin: HEALTH_VALUE_ORIGINS.QuantifiedSelfDerived, recordingMethod: HEALTH_RECORDING_METHODS.QuantifiedSelfCalculated };
    fixture.componentRef.setInput('selectedSourceKey', 'day'); fixture.componentRef.setInput('series', [daily]); fixture.detectChanges();
    expect(fixture.componentInstance.chosenKey()).toBe('daily');
    expect(host.querySelector('h3')?.textContent).toBe('Latest daily average');
    expect(host.querySelector('.health-chart-reading-header')?.textContent).toContain('Calculated by QS');
    expect(host.textContent).not.toContain('no readings in this period');
    fixture.componentRef.setInput('selectedSourceKey', 'daily'); fixture.componentRef.setInput('series', [day]); fixture.detectChanges();
    expect(fixture.componentInstance.chosenKey()).toBe('day');
    expect(changed).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('uses flat shared rows while preserving source separation and status labels', async () => {
    const host = await render('Garmin Test');
    const second = { ...series(null), id: 'suunto-native', provider: HEALTH_PROVIDERS.SuuntoApp,
      sourceLabel: 'Suunto', nativeOnly: true, hasConflict: true };
    fixture.componentRef.setInput('series', [series('Garmin Test'), second]);
    fixture.detectChanges();

    expect(host.querySelector('mat-card')).toBeNull();
    expect(host.querySelectorAll('app-compact-row .compact-row--stacked.compact-row--compact')).toHaveLength(2);
    expect(Array.from(host.querySelectorAll('h3')).map(heading => heading.textContent)).toEqual(['Garmin', 'Suunto']);
    expect(host.querySelector('.health-chart-panel-native')?.textContent).toContain('Original format');
    expect(host.querySelector('.health-chart-panel-native')?.textContent).toContain('Readings differ');
    expect(fixture.debugElement.queryAll(By.directive(HealthMetricSeriesChartStubComponent))).toHaveLength(2);
  });

  it('retains Sports Lib unit preferences in the compact row and its chart', async () => {
    const host = await render(null);
    const distance = { ...series(null), metricId: HEALTH_METRIC_IDS.Distance, unit: 'meter',
      points: [{ timestampMs: 0, calendarDate: '1970-01-01', value: 1609.344, qualityCode: null }] };
    const units = normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles });
    fixture.componentRef.setInput('series', [distance]);
    fixture.componentRef.setInput('unitSettings', units);
    fixture.detectChanges();

    const chart = fixture.debugElement.query(By.directive(HealthMetricSeriesChartStubComponent))
      .componentInstance as HealthMetricSeriesChartStubComponent;
    expect(host.querySelector('.health-chart-footer')?.textContent).toContain('mi');
    expect(host.querySelector('.health-chart-unit')?.textContent?.trim()).toBe('mi');
    expect(chart.unitSettings).toEqual(units);
    expect(chart.model.ariaLabel).toContain('1.00 mi');
  });

  it('passes HRV personal-range styling and accessible context to the series chart', async () => {
    await render(null);
    const source = series(null);
    source.id = 'suunto-sleep-hrv';
    source.metricId = HEALTH_METRIC_IDS.HeartRateVariability;
    source.semanticVariant = 'sleep_session_average_hrv';
    source.unit = 'millisecond';
    fixture.componentRef.setInput('series', [source]);
    fixture.componentRef.setInput('chartStatuses', {
      [source.id]: {
        tone: 'positive',
        label: 'Within personal range',
        detailText: '7-day average 42 ms · Range 35 ms–48 ms',
        observationDayCount: 20,
        currentAverage: 42,
        normalRange: { min: 35, max: 48 },
        pointStatuses: [{
          timestampMs: 0,
          tone: 'positive',
          label: 'Within personal range',
          normalRange: { min: 30, max: 45 },
        }],
      },
    });
    fixture.detectChanges();

    const chart = fixture.debugElement.query(By.directive(HealthMetricSeriesChartStubComponent))
      .componentInstance as HealthMetricSeriesChartStubComponent;
    expect(chart.statusOverlay).toMatchObject({
      pointStatuses: [{ timestampMs: 0, label: 'Within personal range', normalRange: { min: 30, max: 45 } }],
    });
    expect(chart.statusDescription).toContain('Within personal range');
  });
});
