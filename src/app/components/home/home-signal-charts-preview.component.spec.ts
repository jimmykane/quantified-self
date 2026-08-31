import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { AppThemes } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartsEfficiencyTrendComponent } from '../charts/efficiency-trend/charts.efficiency-trend.component';
import { ChartsFormComponent } from '../charts/form/charts.form.component';
import { ChartsFreshnessForecastComponent } from '../charts/freshness-forecast/charts.freshness-forecast.component';
import { ChartsIntensityDistributionComponent } from '../charts/intensity-distribution/charts.intensity-distribution.component';
import { ChartsPowerCurveComponent } from '../charts/power-curve/charts.power-curve.component';
import { AppThemeService } from '../../services/app.theme.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { HomeSignalChartsPreviewComponent } from './home-signal-charts-preview.component';

describe('HomeSignalChartsPreviewComponent', () => {
  let fixture: ComponentFixture<HomeSignalChartsPreviewComponent>;
  const appTheme = signal(AppThemes.Normal);
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
    appTheme.set(AppThemes.Normal);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    await TestBed.configureTestingModule({
      imports: [HomeSignalChartsPreviewComponent],
      providers: [
        { provide: AppThemeService, useValue: { appTheme } },
        { provide: EChartsLoaderService, useValue: loader },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeSignalChartsPreviewComponent);
  });

  it('renders the production chart components with homepage preview data', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(5));

    const widgets = fixture.nativeElement.querySelectorAll('.signal-preview-widget');
    const text = fixture.nativeElement.textContent as string;
    const formComponent = fixture.debugElement.query(By.directive(ChartsFormComponent))
      .componentInstance as ChartsFormComponent;
    const freshnessComponent = fixture.debugElement.query(By.directive(ChartsFreshnessForecastComponent))
      .componentInstance as ChartsFreshnessForecastComponent;
    const intensityComponent = fixture.debugElement.query(By.directive(ChartsIntensityDistributionComponent))
      .componentInstance as ChartsIntensityDistributionComponent;
    const efficiencyComponent = fixture.debugElement.query(By.directive(ChartsEfficiencyTrendComponent))
      .componentInstance as ChartsEfficiencyTrendComponent;
    const powerCurveComponent = fixture.debugElement.query(By.directive(ChartsPowerCurveComponent))
      .componentInstance as ChartsPowerCurveComponent;

    expect(widgets.length).toBe(4);
    expect(fixture.nativeElement.querySelectorAll('.signal-preview-chart').length).toBe(0);
    expect(freshnessComponent.forecast?.points).toHaveLength(14);
    expect(intensityComponent.distribution?.weeks).toHaveLength(8);
    expect(efficiencyComponent.trend?.points).toHaveLength(8);
    expect(powerCurveComponent.title).toBe('Cycling Power Curve');
    expect(powerCurveComponent.powerCurve?.series).toHaveLength(2);
    expect(powerCurveComponent.primaryBenchmark?.durationLabel).toBe('20m');
    expect(formComponent.hasData()).toBe(true);
    expect(formComponent.useAnimations).toBe(true);
    expect(formComponent.headlineStats().tss.value).not.toBe('--');
    expect(text).not.toContain('Illustrative data');
    expect(text).toContain('Freshness Forecast');
    expect(text).toContain('Intensity Distribution');
    expect(text).toContain('Efficiency Trend');
    expect(text).toContain('Cycling Power Curve');
    expect(text).toContain('Form (TSS)');
    expect(text).toContain('Fitness, fatigue, and form from daily training stress');
    const options = loader.setOption.mock.calls
      .map(call => call[1] as { animation?: boolean });
    expect(options.some(option => option.animation === true)).toBe(true);
  });

  it('disables the homepage Form animation when reduced motion is requested', async () => {
    fixture.destroy();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    fixture = TestBed.createComponent(HomeSignalChartsPreviewComponent);

    fixture.detectChanges();
    await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(5));

    const formComponent = fixture.debugElement.query(By.directive(ChartsFormComponent))
      .componentInstance as ChartsFormComponent;
    expect(formComponent.useAnimations).toBe(false);
  });

  it('passes theme changes through every shared chart component', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(5));

    const sharedCharts = [
      ChartsFreshnessForecastComponent,
      ChartsIntensityDistributionComponent,
      ChartsEfficiencyTrendComponent,
      ChartsPowerCurveComponent,
      ChartsFormComponent,
    ].map(component => fixture.debugElement.query(By.directive(component)).componentInstance as { darkTheme: boolean });
    expect(sharedCharts.every(component => component.darkTheme === false)).toBe(true);

    appTheme.set(AppThemes.Dark);
    fixture.detectChanges();
    await vi.waitFor(() => expect(loader.setOption).toHaveBeenCalledTimes(10));

    expect(sharedCharts.every(component => component.darkTheme === true)).toBe(true);
  });
});
