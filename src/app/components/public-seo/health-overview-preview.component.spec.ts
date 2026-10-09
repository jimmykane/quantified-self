import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AppThemes, DataWeight, WeightUnits } from '@sports-alliance/sports-lib';
import { resolveUnitAwareDisplayStat, normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { HealthOverviewPreviewComponent } from './health-overview-preview.component';
import { HealthCategoryOverviewComponent } from '../health/health-category-overview.component';
import { DashboardHealthChartComponent } from '../charts/health/dashboard-health-chart.component';
import { HealthMetricSeriesChartComponent } from '../health/health-metric-series-chart.component';
import { ChartsSleepTrendComponent } from '../charts/sleep-trend/charts.sleep-trend.component';
import { DashboardHealthService } from '../../services/dashboard-health.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { AppThemeService } from '../../services/app.theme.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';

describe('public Health overview', () => {
  let fixture: ComponentFixture<HealthOverviewPreviewComponent>;
  const selection = vi.fn(), watch = vi.fn(), invalidate = vi.fn();
  beforeEach(async () => {
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [HealthOverviewPreviewComponent, NoopAnimationsModule],
      providers: [
        // Treat the fixture identity as an owner to prove explicit example isolation.
        { provide: DashboardHealthService, useValue: { isOwner: () => true, watch, invalidate } },
        { provide: AppHapticsService, useValue: { selection } },
        { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Dark) } },
        { provide: LoggerService, useValue: { error: vi.fn() } },
        { provide: EChartsLoaderService, useValue: {
          init: vi.fn().mockResolvedValue({ isDisposed: () => false, dispatchAction: vi.fn(), on: vi.fn(), off: vi.fn(), getWidth: () => 320 }),
          setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
          subscribeToViewportResize: () => () => undefined, attachMobileSeriesTapFeedback: () => () => undefined,
        } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HealthOverviewPreviewComponent);
    fixture.detectChanges(); await fixture.whenStable();
  });
  afterEach(() => fixture.destroy());

  it('renders the actual six-card overview with fixed examples and no account reads or initial feedback', () => {
    const overview = fixture.debugElement.query(By.directive(HealthCategoryOverviewComponent)).componentInstance;
    expect(overview.cards().map(card => card.id)).toEqual(['body_weight', 'heart_rate_variability', 'resting_heart_rate', 'steps', 'vo2_max', 'sleep']);
    const charts = fixture.debugElement.queryAll(By.directive(DashboardHealthChartComponent));
    expect(charts).toHaveLength(6);
    expect(charts.every(chart => chart.componentInstance.exampleOnly() && chart.componentInstance.overview()
      && chart.componentInstance.window().endDate === '2026-08-31' && chart.componentInstance.darkTheme())).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Nothing is saved');
    expect(watch).not.toHaveBeenCalled(); expect(selection).not.toHaveBeenCalled();
  });

  it('preserves category choice and restores focus when opening sample history and returning', async () => {
    const overview = fixture.debugElement.query(By.directive(HealthCategoryOverviewComponent)).componentInstance;
    overview.selectCategory('body'); fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button[aria-label="View Body weight history"]') as HTMLButtonElement;
    button.focus(); button.click(); fixture.detectChanges(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('app-health-category-overview').hidden).toBe(true);
    expect(document.activeElement?.id).toBe('health-sample-history-title');
    expect(fixture.debugElement.query(By.directive(HealthMetricSeriesChartComponent))).toBeTruthy();
    expect(selection).toHaveBeenCalledTimes(2);
    fixture.nativeElement.querySelector('.sample-history button').click(); fixture.detectChanges(); await fixture.whenStable();
    expect(overview.selectedCategory()).toBe('body');
    expect(document.activeElement).toBe(button);
    expect(selection).toHaveBeenCalledTimes(3);
    fixture.componentInstance.showOverview(); fixture.componentInstance.viewHistory('invalid' as never);
    expect(selection).toHaveBeenCalledTimes(3); expect(watch).not.toHaveBeenCalled();
  });

  it('uses the real Sleep renderer and keeps unchanged selections silent', () => {
    fixture.componentInstance.viewHistory('sleep'); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.sample-history app-sleep-trend-chart')).toBeTruthy();
    const sleep = fixture.debugElement.queryAll(By.directive(ChartsSleepTrendComponent)).at(-1)!.componentInstance;
    expect(sleep.sleepTrend.points).toHaveLength(30);
    fixture.componentInstance.viewHistory('sleep');
    expect(selection).toHaveBeenCalledOnce(); expect(watch).not.toHaveBeenCalled();
  });

  it('returns focus to the opened metric when a pointer click leaves focus on a category control', async () => {
    const category = fixture.nativeElement.querySelector('mat-chip-option button') as HTMLButtonElement;
    const historyButton = fixture.nativeElement.querySelector('button[aria-label="View Body weight history"]') as HTMLButtonElement;
    category.focus();
    // A click need not focus its button. Retained focus is not the navigation origin.
    historyButton.click(); fixture.detectChanges(); await fixture.whenStable();
    expect(document.activeElement?.id).toBe('health-sample-history-title');
    fixture.nativeElement.querySelector('.sample-history button').click(); fixture.detectChanges(); await fixture.whenStable();
    expect(document.activeElement).toBe(historyButton);
    expect(selection).toHaveBeenCalledTimes(2);
  });

  it('formats sample Weight in canonical default and pound units through Sports Lib', () => {
    const units = normalizeUserUnitSettings({ weightUnits: WeightUnits.Pounds });
    fixture.componentInstance.viewHistory('body_weight'); fixture.detectChanges();
    const original = fixture.componentInstance.history()!.selected!;
    const canonical = original.model.series.points.at(-1)!.value as number;
    for (const settings of [null, units]) {
      fixture.componentRef.setInput('unitSettings', settings); fixture.detectChanges();
      const chart = fixture.componentInstance.history()!.selected!;
      const expected = resolveUnitAwareDisplayStat(new DataWeight(canonical), settings)!;
      expect(chart.model.displayUnit).toBe(expected.unit);
      expect(chart.latestValueText).toContain(expected.value);
    }
    expect(fixture.componentInstance.history()!.selected!.model.displayUnit).not.toBe(original.model.displayUnit);
    expect(watch).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled();
  });
});
