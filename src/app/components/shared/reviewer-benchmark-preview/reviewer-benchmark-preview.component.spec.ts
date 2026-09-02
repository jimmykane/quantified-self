import { signal } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppThemes } from '@sports-alliance/sports-lib';
import { of } from 'rxjs';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { EventCardChartPanelComponent } from '../../event/chart/panel/event.card.chart.panel.component';
import { AppShareService } from '../../../services/app.share.service';
import { AppThemeService } from '../../../services/app.theme.service';
import { EChartsLoaderService } from '../../../services/echarts-loader.service';
import { LoggerService } from '../../../services/logger.service';
import {
  REVIEWER_BENCHMARK_ALTITUDE_PANEL,
  REVIEWER_BENCHMARK_DURATION_SECONDS,
  REVIEWER_BENCHMARK_HEART_RATE_PANEL,
} from './reviewer-benchmark-chart-preview.data';
import { ReviewerBenchmarkPreviewComponent } from './reviewer-benchmark-preview.component';

describe('ReviewerBenchmarkPreviewComponent', () => {
  let fixture: ComponentFixture<ReviewerBenchmarkPreviewComponent>;
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
    await TestBed.configureTestingModule({
      imports: [ReviewerBenchmarkPreviewComponent, MatIconTestingModule, NoopAnimationsModule],
      providers: [
        { provide: AppThemeService, useValue: { appTheme: signal(AppThemes.Normal) } },
        { provide: EChartsLoaderService, useValue: loader },
        { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn() } },
        { provide: BreakpointObserver, useValue: { observe: vi.fn(() => of({ matches: false, breakpoints: {} })) } },
        { provide: AppShareService, useValue: { copyElementImageToClipboard: vi.fn() } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ReviewerBenchmarkPreviewComponent);
    fixture.detectChanges();
  });

  it('shares four compact benchmark rows and their evidence previews', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(fixture.nativeElement.querySelectorAll('app-compact-feature-row')).toHaveLength(4);
    expect(text).toContain('Benchmark Merge Workflow');
    expect(text).toContain('Three-Device Chart Comparison');
    expect(text).toContain('GNSS Trace Comparison');
    expect(text).toContain('Sensor Quality Reports');
    expect(text).toContain('Save / Share');
  });

  it('renders both production comparison charts with three labeled series', () => {
    const chartComponents = fixture.debugElement
      .queryAll(By.directive(EventCardChartPanelComponent))
      .map(debugElement => debugElement.componentInstance as EventCardChartPanelComponent);
    const text = fixture.nativeElement.textContent as string;

    expect(chartComponents).toHaveLength(2);
    expect(chartComponents.every(component => component.panel?.series.length === 3)).toBe(true);
    expect(chartComponents.every(component => component.showActivityNamesInTooltip)).toBe(true);
    expect(chartComponents.every(component => component.previewInteractions)).toBe(true);
    expect(text).toContain('Heart Rate');
    expect(text).toContain('Altitude');
    expect(text).toContain('Suunto Vertical 2');
    expect(text).toContain('COROS APEX 4');
    expect(text).toContain('Garmin Fenix 9');
  });

  it('keeps the anonymized comparison series aligned and complete', () => {
    const panels = [REVIEWER_BENCHMARK_HEART_RATE_PANEL, REVIEWER_BENCHMARK_ALTITUDE_PANEL];
    const expectedLabels = ['Suunto Vertical 2', 'COROS APEX 4', 'Garmin Fenix 9'];

    for (const panel of panels) {
      expect(panel.minX).toBe(0);
      expect(panel.maxX).toBe(REVIEWER_BENCHMARK_DURATION_SECONDS);
      expect(panel.series.map(series => series.activityName)).toEqual(expectedLabels);
      expect(panel.series.every(series => series.points?.length === 61)).toBe(true);
      expect(panel.series.every(series => series.points?.[0]?.x === 0)).toBe(true);
      expect(panel.series.every(series => (
        (series.points?.at(-1)?.x ?? Number.POSITIVE_INFINITY) <= REVIEWER_BENCHMARK_DURATION_SECONDS
      ))).toBe(true);
    }

    expect(REVIEWER_BENCHMARK_HEART_RATE_PANEL.series[0].points).not.toEqual(
      REVIEWER_BENCHMARK_HEART_RATE_PANEL.series[1].points,
    );
    expect(REVIEWER_BENCHMARK_ALTITUDE_PANEL.series[1].points).not.toEqual(
      REVIEWER_BENCHMARK_ALTITUDE_PANEL.series[2].points,
    );
  });
});
