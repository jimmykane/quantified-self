import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { MatDialog } from '@angular/material/dialog';
import { AppHapticsService } from '../../services/app.haptics.service';
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
import { buildHealthPreviewSeries, HEALTH_PREVIEW_SLEEP, HEALTH_PREVIEW_NOTES } from './health-preview.data';

describe('HealthPreviewComponent', () => {
  async function render(kind: 'sleep' | 'hrv' | 'weight') {
    const chart = { isDisposed: () => false, dispatchAction: vi.fn(), on: vi.fn(), off: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [HealthPreviewComponent],
      providers: [
        { provide: AppHapticsService, useValue: { selection: vi.fn() } },
        { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Dark) } },
        { provide: LoggerService, useValue: { error: vi.fn() } },
        { provide: EChartsLoaderService, useValue: {
          init: vi.fn().mockResolvedValue(chart), setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
          subscribeToViewportResize: () => () => undefined, attachMobileSeriesTapFeedback: () => () => undefined,
        } },
      ],
    }).overrideProvider(MatDialog, { useValue: { open: vi.fn() } }).compileComponents();
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

  it('shares chart notes and opens only the selected fictional notes with one haptic', async () => {
    const fixture = await render('hrv');
    const chart = fixture.debugElement.query(By.directive(HealthMetricSeriesChartComponent)).componentInstance as HealthMetricSeriesChartComponent;
    const dialogs = TestBed.inject(MatDialog);
    const haptics = TestBed.inject(AppHapticsService);
    expect(chart.timelineNotes?.notes).toBe(HEALTH_PREVIEW_NOTES);
    chart.timelineNotes?.reportRange({}, { startDate: '2026-08-18', endDate: '2026-08-31' });
    chart.timelineNotes?.select([]);
    expect(dialogs.open).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
    chart.timelineNotes?.select([HEALTH_PREVIEW_NOTES[2]]);
    expect(dialogs.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      data: [expect.objectContaining({ categoryLabel: 'Sickness', title: 'Feeling unwell', dates: '2026-08-29 – 2026-08-30' })],
    }));
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    fixture.debugElement.query(By.css('button')).nativeElement.click();
    expect(dialogs.open).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ data: expect.arrayContaining([
      expect.objectContaining({ categoryLabel: 'Travel' }), expect.objectContaining({ categoryLabel: 'Stress' }), expect.objectContaining({ categoryLabel: 'Sickness' }),
    ]) }));
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it.each(['sleep', 'weight'] as const)('does not add notes or note controls to the %s preview', async kind => {
    const fixture = await render(kind);
    expect(fixture.componentInstance.timelineNotes()).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('View sample notes');
    fixture.componentInstance.openNotes();
    expect(TestBed.inject(MatDialog).open).not.toHaveBeenCalled();
    expect(TestBed.inject(AppHapticsService).selection).not.toHaveBeenCalled();
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
