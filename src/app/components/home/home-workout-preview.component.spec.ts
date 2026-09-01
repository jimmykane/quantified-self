import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivityTypeGroups, AppThemes } from '@sports-alliance/sports-lib';
import { BreakpointObserver } from '@angular/cdk/layout';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventCardChartPanelComponent } from '../event/chart/panel/event.card.chart.panel.component';
import { AppShareService } from '../../services/app.share.service';
import { AppThemeService } from '../../services/app.theme.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { AppActivityTypeGroupGradients } from '../../services/color/app.activity-type-group.gradients';
import { AppColors } from '../../services/color/app.colors';
import { AppDataColors } from '../../services/color/app.data.colors';
import { DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS } from '../../helpers/echarts-tooltip-interaction.helper';
import { HomeWorkoutPreviewComponent } from './home-workout-preview.component';
import { EventCadencePowerComponent } from '../event/cadence-power/event.cadence-power.component';
import { EventDurabilityCurveComponent } from '../event/durability-curve/event.durability-curve.component';
import { EventIntensityZonesComponent } from '../event/intensity-zones/event.intensity-zones.component';
import { AppEventColorService } from '../../services/color/app.event.color.service';

describe('HomeWorkoutPreviewComponent', () => {
  let fixture: ComponentFixture<HomeWorkoutPreviewComponent>;
  let viewportObserverCallback: IntersectionObserverCallback | undefined;
  const observeViewport = vi.fn();
  const disconnectViewport = vi.fn();
  const chart = {
    on: vi.fn(),
    off: vi.fn(),
    getZr: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
    dispatchAction: vi.fn(),
    getOption: vi.fn(() => ({ dataZoom: [] })),
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
    viewportObserverCallback = undefined;
    vi.stubGlobal('IntersectionObserver', vi.fn((callback: IntersectionObserverCallback, options?: IntersectionObserverInit) => {
      if (options?.threshold === 0.1) {
        viewportObserverCallback = callback;
      }
      return {
        observe: observeViewport,
        unobserve: vi.fn(),
        disconnect: disconnectViewport,
        takeRecords: vi.fn(() => []),
        root: null,
        rootMargin: '',
        thresholds: [0.1],
      } as IntersectionObserver;
    }));
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
      imports: [HomeWorkoutPreviewComponent, NoopAnimationsModule],
      providers: [
        { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Normal) } },
        { provide: EChartsLoaderService, useValue: loader },
        { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn() } },
        { provide: BreakpointObserver, useValue: { observe: vi.fn(() => of({ matches: false, breakpoints: {} })) } },
        {
          provide: AppEventColorService,
          useValue: {
            getActivityColor: vi.fn(() => AppColors.Blue),
            getColorForZoneHex: vi.fn(() => AppColors.Blue),
          },
        },
        { provide: AppShareService, useValue: { copyElementImageToClipboard: vi.fn() } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeWorkoutPreviewComponent);
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders compact workout charts with the production tooltip and haptic interactions', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(loader.setOption.mock.calls.length).toBeGreaterThanOrEqual(7));

    const panels = fixture.debugElement
      .queryAll(By.directive(EventCardChartPanelComponent))
      .map(debugElement => debugElement.componentInstance as EventCardChartPanelComponent);
    const text = fixture.nativeElement.textContent as string;
    const options = loader.setOption.mock.calls
      .map(call => call[1] as {
        tooltip?: { show: boolean };
        visualMap?: Array<{
          pieces: Array<{ color: string; label: string }>;
          outOfRange: { color: string };
        }>;
        yAxis?: { inverse?: boolean; axisLabel?: { show?: boolean } };
        series?: Array<{
          id: string;
          silent: boolean;
          lineStyle: { color?: string };
          areaStyle?: { color?: string; opacity?: number; origin?: string };
        }>;
      })
      .filter(option => option.series?.some(series => series.id?.includes('preview-ride::'))) as Array<{
        tooltip: { show: boolean };
        visualMap?: Array<{
          pieces: Array<{ color: string; label: string }>;
          outOfRange: { color: string };
        }>;
        yAxis: { inverse?: boolean; axisLabel?: { show?: boolean } };
        series: Array<{
          id: string;
          silent: boolean;
          lineStyle: { color?: string };
          areaStyle?: { color?: string; opacity?: number; origin?: string };
        }>;
      }>;
    const optionFor = (dataType: string) => options.find(option =>
      option.series.some(series => series.id.includes(`::${dataType}`))
    );
    const heartRateOption = optionFor('Heart Rate');
    const altitudeOption = optionFor('Altitude');
    const powerOption = optionFor('Power');
    const depthOption = optionFor('Depth');

    expect(panels).toHaveLength(4);
    expect(options).toHaveLength(4);
    const durability = fixture.debugElement.query(By.directive(EventDurabilityCurveComponent))
      .componentInstance as EventDurabilityCurveComponent;
    const intensityZones = fixture.debugElement.query(By.directive(EventIntensityZonesComponent))
      .componentInstance as EventIntensityZonesComponent;
    const cadencePower = fixture.debugElement.query(By.directive(EventCadencePowerComponent))
      .componentInstance as EventCadencePowerComponent;
    expect(durability.activities).toBe(fixture.componentInstance.performancePreviewActivities);
    expect(durability.previewMode).toBe(true);
    expect(intensityZones.activities).toBe(fixture.componentInstance.performancePreviewActivities);
    expect(cadencePower.activities).toBe(fixture.componentInstance.performancePreviewActivities);
    expect([
      durability.mobileTapFeedbackOptions,
      intensityZones.mobileTapFeedbackOptions,
      cadencePower.mobileTapFeedbackOptions,
    ].every(options => options === DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS)).toBe(true);
    expect(panels.every(panel => panel.previewMode)).toBe(true);
    expect(panels.every(panel => panel.previewInteractions)).toBe(true);
    expect(panels.every(panel => panel.mobileTapFeedbackOptions === DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS)).toBe(true);
    expect(panels.every(panel => panel.useAnimations)).toBe(true);
    expect(panels.map(panel => panel.panel?.displayName)).toEqual(['Heart Rate', 'Altitude', 'Power', 'Depth']);
    expect(panels.every(panel => panel.zoneLegendItems.length === 0)).toBe(true);
    expect(panels.every(panel => panel.gradeLegendItems.length === 0)).toBe(true);
    expect(options.every(option => option.tooltip.show === true)).toBe(true);
    expect(options.every(option => option.yAxis.axisLabel?.show === false)).toBe(true);
    expect(options.every(option => option.series.every(series => !series.silent))).toBe(true);
    expect(heartRateOption?.visualMap?.[0]?.pieces.map(piece => piece.color)).toEqual([
      AppColors.LightBlue,
      AppColors.Blue,
      AppColors.Green,
      AppColors.Yellow,
      AppColors.LightestRed,
    ]);
    expect(heartRateOption?.visualMap?.[0]?.outOfRange.color).toBe(AppDataColors['Heart Rate']);
    expect(powerOption?.visualMap?.[0]?.pieces.map(piece => piece.color)).toEqual([
      AppColors.LightBlue,
      AppColors.Blue,
      AppColors.Green,
      AppColors.Yellow,
      AppColors.LightestRed,
    ]);
    expect(powerOption?.visualMap?.[0]?.outOfRange.color).toBe(AppDataColors.Power);
    expect(altitudeOption?.series.map(series => series.lineStyle.color)).toEqual(expect.arrayContaining([
      '#1E88E5',
      '#43A047',
      '#F9A825',
      '#E64A19',
      '#B71C1C',
      '#7F1D1D',
    ]));
    expect(depthOption?.yAxis.inverse).toBe(true);
    expect(depthOption?.series[0]?.areaStyle).toEqual(expect.objectContaining({
      color: AppActivityTypeGroupGradients[ActivityTypeGroups.DivingGroup].end,
      opacity: 1,
      origin: 'start',
    }));
    expect(chart.on).toHaveBeenCalled();
    expect(loader.attachMobileSeriesTapFeedback.mock.calls.filter(
      call => call[1] === DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS,
    ).length).toBeGreaterThanOrEqual(4);
    expect(loader.attachMobileSeriesTapFeedback).toHaveBeenCalledWith(
      chart,
      DASHBOARD_ECHARTS_MOBILE_TAP_FEEDBACK_OPTIONS,
    );
    expect(getComputedStyle(fixture.nativeElement).pointerEvents).not.toBe('none');
    expect(fixture.nativeElement.querySelector('.workout-preview__charts')?.getAttribute('role')).toBe('group');
    expect(fixture.nativeElement.querySelector('.workout-preview')).toBeNull();
    expect(text).not.toContain('Illustrative analysis');
    expect(text).not.toContain('Workout charts');
    expect(text).toContain('Heart Rate');
    expect(text).not.toContain('Zone 1');
    expect(text).not.toContain('Zone 5');
    expect(text).not.toContain('Downhill');
    expect(text).not.toContain('0-3%');
    expect(text).toContain('Altitude');
    expect(text).toContain('Power');
    expect(text).toContain('Depth');
    expect(text).toContain('Durability');
    expect(text).toContain('Intensity Zones');
    expect(text).toContain('Cadence vs Power');
    expect(text).not.toContain('Recorded streams');
    expect(text).not.toContain('7 chart types');
  });

  it('uses dense whole-workout timelines for heart rate, altitude, and power', () => {
    const component = fixture.componentInstance;
    const heartRatePoints = component.heartRatePanel.series[0].points;
    const altitudePoints = component.altitudePanel.series[0].points;
    const powerPoints = component.powerPanel.series[0].points;
    const gradeValues = component.altitudePanel.series[0].gradeColorValues;

    expect(heartRatePoints.length).toBeGreaterThan(60);
    expect(altitudePoints).toHaveLength(heartRatePoints.length);
    expect(powerPoints).toHaveLength(heartRatePoints.length);
    expect(gradeValues).toHaveLength(heartRatePoints.length);
    expect(altitudePoints.map(point => point.x)).toEqual(heartRatePoints.map(point => point.x));
    expect(powerPoints.map(point => point.x)).toEqual(heartRatePoints.map(point => point.x));
    expect(heartRatePoints[0].y).toBe(86);
    expect(heartRatePoints.at(-1)?.y).toBe(124);
    expect(Math.max(...heartRatePoints.map(point => point.y))).toBe(169);
    expect(component.heartRatePanel.series[0].zoneColorPieces?.map(piece => piece.gte)).toEqual([
      undefined,
      107,
      125,
      142,
      160,
    ]);
    expect(Math.max(...powerPoints.map(point => point.y))).toBe(298);
    expect(Math.max(...altitudePoints.map(point => point.y))).toBe(597);
    expect(Math.min(...powerPoints.map(point => point.y))).toBe(55);
  });

  it('plays only the synchronized zoom once after entering the viewport without changing chart height', async () => {
    vi.useFakeTimers();
    fixture.detectChanges();
    const component = fixture.componentInstance;

    await vi.advanceTimersByTimeAsync(2_000);
    expect(component.sharedZoomRange()).toBeNull();

    viewportObserverCallback?.([
      { isIntersecting: true, target: fixture.nativeElement } as IntersectionObserverEntry,
    ], {} as IntersectionObserver);
    expect(disconnectViewport).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(900);
    fixture.detectChanges();

    expect(component.sharedZoomRange()).toBeNull();
    expect(fixture.nativeElement.querySelector('.event-chart-panel__stats')).toBeNull();

    await vi.advanceTimersByTimeAsync(500);
    fixture.detectChanges();

    const activeZoomRange = component.sharedZoomRange();
    expect(activeZoomRange?.start).toBeGreaterThan(0);
    expect(activeZoomRange?.end).toBeLessThan(component.xDomain.end);

    const panels = fixture.debugElement
      .queryAll(By.directive(EventCardChartPanelComponent))
      .map(debugElement => debugElement.componentInstance as EventCardChartPanelComponent);
    expect(panels.every(panel => panel.previewRange === null)).toBe(true);
    expect(panels.every(panel => panel.sharedZoomRange?.start === activeZoomRange?.start)).toBe(true);
    expect(panels.every(panel => panel.sharedZoomRange?.end === activeZoomRange?.end)).toBe(true);
    expect(fixture.nativeElement.querySelector('.event-chart-panel__stats')).toBeNull();

    await vi.advanceTimersByTimeAsync(2_000);
    fixture.detectChanges();

    expect(component.sharedZoomRange()).toBeNull();

    await vi.advanceTimersByTimeAsync(4_000);
    fixture.detectChanges();

    expect(component.sharedZoomRange()).toBeNull();
    expect(fixture.nativeElement.querySelector('.event-chart-panel__stats')).toBeNull();
  });
});
