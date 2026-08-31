import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivityTypeGroups, AppThemes } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventCardChartPanelComponent } from '../event/chart/panel/event.card.chart.panel.component';
import { AppShareService } from '../../services/app.share.service';
import { AppThemeService } from '../../services/app.theme.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { AppActivityTypeGroupGradients } from '../../services/color/app.activity-type-group.gradients';
import { AppColors } from '../../services/color/app.colors';
import { AppDataColors } from '../../services/color/app.data.colors';
import { HomeWorkoutPreviewComponent } from './home-workout-preview.component';

describe('HomeWorkoutPreviewComponent', () => {
  let fixture: ComponentFixture<HomeWorkoutPreviewComponent>;
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
        { provide: AppShareService, useValue: { copyElementImageToClipboard: vi.fn() } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeWorkoutPreviewComponent);
  });

  it('renders real workout chart panels directly in non-interactive preview mode', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(loader.setOption.mock.calls.length).toBeGreaterThanOrEqual(2));

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
      .filter(option => !!option.tooltip && !!option.series?.length) as Array<{
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
    expect(panels.every(panel => panel.previewMode)).toBe(true);
    expect(panels.map(panel => panel.panel?.displayName)).toEqual(['Heart Rate', 'Altitude', 'Power', 'Depth']);
    expect(panels[0].zoneLegendItems.map(item => item.label)).toEqual([
      'Zone 1',
      'Zone 2',
      'Zone 3',
      'Zone 4',
      'Zone 5',
    ]);
    expect(panels.slice(1).every(panel => panel.zoneLegendItems.length === 0)).toBe(true);
    expect(options.every(option => option.tooltip.show === false)).toBe(true);
    expect(options.every(option => option.yAxis.axisLabel?.show === false)).toBe(true);
    expect(options.every(option => option.series.every(series => series.silent))).toBe(true);
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
    expect(chart.on).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.workout-preview')).toBeNull();
    expect(text).not.toContain('Illustrative analysis');
    expect(text).not.toContain('Workout charts');
    expect(text).toContain('Heart Rate');
    expect(text).toContain('Zone 1');
    expect(text).toContain('Zone 5');
    expect(text).toContain('Altitude');
    expect(text).toContain('Power');
    expect(text).toContain('Depth');
    expect(text).not.toContain('Recorded streams');
    expect(text).not.toContain('7 chart types');
  });
});
