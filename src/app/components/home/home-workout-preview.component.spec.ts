import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppThemes } from '@sports-alliance/sports-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventCardChartPanelComponent } from '../event/chart/panel/event.card.chart.panel.component';
import { AppShareService } from '../../services/app.share.service';
import { AppThemeService } from '../../services/app.theme.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
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

  it('reuses real workout chart panels in non-interactive preview mode', async () => {
    fixture.detectChanges();
    await vi.waitFor(() => expect(loader.setOption.mock.calls.length).toBeGreaterThanOrEqual(2));

    const panels = fixture.debugElement
      .queryAll(By.directive(EventCardChartPanelComponent))
      .map(debugElement => debugElement.componentInstance as EventCardChartPanelComponent);
    const text = fixture.nativeElement.textContent as string;
    const options = loader.setOption.mock.calls
      .map(call => call[1] as {
        tooltip?: { show: boolean };
        series?: Array<{ silent: boolean; lineStyle: { color: string } }>;
      })
      .filter(option => !!option.tooltip && !!option.series?.length) as Array<{
        tooltip: { show: boolean };
        series: Array<{ silent: boolean; lineStyle: { color: string } }>;
      }>;

    expect(panels).toHaveLength(2);
    expect(options).toHaveLength(2);
    expect(panels.every(panel => panel.previewMode)).toBe(true);
    expect(panels.map(panel => panel.panel?.displayName)).toEqual(['Heart Rate', 'Power']);
    expect(options.every(option => option.tooltip.show === false)).toBe(true);
    expect(options.map(option => option.series[0]?.lineStyle.color)).toEqual([
      AppDataColors['Heart Rate'],
      AppDataColors.Power,
    ]);
    expect(options.every(option => option.series.every(series => series.silent))).toBe(true);
    expect(chart.on).not.toHaveBeenCalled();
    expect(text).toContain('Morning Ride');
    expect(text).toContain('54:18');
    expect(text).toContain('7 chart types');
    expect(text).toContain('Gradient + speed overlays');
  });
});
