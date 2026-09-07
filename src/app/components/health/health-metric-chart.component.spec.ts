import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import {
  HEALTH_METRIC_IDS,
  HEALTH_PROVIDERS,
  HEALTH_RECORDING_METHODS,
  HEALTH_VALUE_ORIGINS,
  HEALTH_VALUE_TYPES,
} from '@shared/health';
import { describe, expect, it } from 'vitest';
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

  async function render(deviceLabel: string | null): Promise<HTMLElement> {
    await TestBed.configureTestingModule({ imports: [HealthMetricChartComponent] })
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
  });

  it('does not render an empty device label when attribution is unavailable', async () => {
    const host = await render(null);

    expect(host.textContent).not.toContain('Device:');
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
