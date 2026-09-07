import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { AppThemes, DataWeight, DistanceUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { describe, expect, it, vi } from 'vitest';
import { AppThemeService } from '../../services/app.theme.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { HealthMetricSeriesChartComponent } from '../health/health-metric-series-chart.component';
import { HealthSleepStageSummaryComponent } from '../health/health-sleep-stage-summary.component';
import { ChartsSleepTrendComponent } from '../charts/sleep-trend/charts.sleep-trend.component';
import { HealthPreviewComponent } from './health-preview.component';
import { buildHealthPreviewSeries, HEALTH_PREVIEW_SLEEP } from './health-preview.data';

describe('HealthPreviewComponent', () => {
  async function render(kind: 'sleep' | 'hrv' | 'weight') {
    const chart = { isDisposed: () => false, dispatchAction: vi.fn(), on: vi.fn(), off: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [HealthPreviewComponent],
      providers: [
        { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Dark) } },
        { provide: LoggerService, useValue: { error: vi.fn() } },
        { provide: EChartsLoaderService, useValue: {
          init: vi.fn().mockResolvedValue(chart), setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
          subscribeToViewportResize: () => () => undefined, attachMobileSeriesTapFeedback: () => () => undefined,
        } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(HealthPreviewComponent);
    fixture.componentRef.setInput('kind', kind);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  it('renders HRV through the real Health chart with the real personal-range calculation', async () => {
    const fixture = await render('hrv');
    const chart = fixture.debugElement.query(By.directive(HealthMetricSeriesChartComponent)).componentInstance;
    expect(chart.model.displayedPoints).toHaveLength(14);
    expect(chart.darkTheme).toBe(true);
    expect(chart.statusOverlay.normalRange).not.toBeNull();
    expect(chart.statusOverlay.pointStatuses).toHaveLength(14);
    expect(fixture.nativeElement.textContent).toContain('Sample data');
  });

  it('reuses the Health sleep stage summary and keeps the sample night consistent with the trend', async () => {
    const fixture = await render('sleep');
    expect(fixture.debugElement.query(By.directive(HealthSleepStageSummaryComponent))).toBeTruthy();
    const chart = fixture.debugElement.query(By.directive(ChartsSleepTrendComponent)).componentInstance;
    expect(chart.sleepTrend.points).toHaveLength(14);
    expect(chart.sleepTrend.latestPoint).toBe(fixture.componentInstance.sleepPoint);
    expect(fixture.debugElement.query(By.directive(HealthMetricSeriesChartComponent))).toBeNull();
    for (const point of chart.sleepTrend.points) {
      expect(point.deepSeconds + point.lightSeconds + point.remSeconds + point.unknownSeconds).toBe(point.totalSeconds);
      expect(point.endTimeMs - point.startTimeMs).toBe((point.totalSeconds + point.awakeSeconds) * 1000);
    }
    expect(HEALTH_PREVIEW_SLEEP.deepSeconds + HEALTH_PREVIEW_SLEEP.lightSeconds + HEALTH_PREVIEW_SLEEP.remSeconds)
      .toBe(HEALTH_PREVIEW_SLEEP.totalSeconds);
    expect(buildHealthPreviewSeries('sleep').points.at(-1)?.value).toBe(HEALTH_PREVIEW_SLEEP.totalSeconds);
  });

  it('uses Sports Lib weight display with default and non-default unit preferences', async () => {
    const fixture = await render('weight');
    for (const settings of [null, normalizeUserUnitSettings({ distanceUnits: DistanceUnits.Miles })]) {
      fixture.componentRef.setInput('unitSettings', settings);
      fixture.detectChanges();
      const model = fixture.componentInstance.model();
      const value = new DataWeight(Number(model.displayedPoints.at(-1)?.value));
      expect(model.displayUnit).toBe(value.getDisplayUnit());
      expect(model.ariaLabel).toContain(String(value.getDisplayValue()));
    }
  });
});
