import { signal } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppThemes } from '@sports-alliance/sports-lib';
import { of } from 'rxjs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { chartViewportQueue } from '../../../helpers/chart-viewport-queue';
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
  const createChart = () => ({
    on: vi.fn(),
    off: vi.fn(),
    getZr: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
    dispatchAction: vi.fn(),
    getOption: vi.fn(() => ({ dataZoom: [] })),
    isDisposed: vi.fn(() => false),
  });
  const theme = signal(AppThemes.Normal);
  const loader = {
    init: vi.fn().mockImplementation(async () => createChart()),
    setOption: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    subscribeToViewportResize: vi.fn(() => vi.fn()),
    attachMobileSeriesTapFeedback: vi.fn(() => vi.fn()),
    load: vi.fn().mockResolvedValue({}),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    loader.setOption.mockReset();
    loader.init.mockImplementation(async () => createChart());
    theme.set(AppThemes.Normal);
    await TestBed.configureTestingModule({
      imports: [ReviewerBenchmarkPreviewComponent, MatIconTestingModule, NoopAnimationsModule],
      providers: [
        { provide: AppThemeService, useValue: { appTheme: theme } },
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

  afterEach(() => vi.restoreAllMocks());

  it('shares five compact benchmark rows and their evidence previews', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(fixture.nativeElement.querySelectorAll('app-compact-row')).toHaveLength(5);
    expect(text).toContain('Benchmark Merge Workflow');
    expect(text).toContain('Multi-Device Chart Comparison');
    expect(text).toContain('GNSS Trace Comparison');
    expect(text).toContain('Sensor Quality Reports');
    expect(text).toContain('Save / Share');
    expect(text).toContain('R–R & HRV Comparison');
  });

  it('shows one real R–R excerpt with full-recording canonical values and no invented second source', () => {
    const region: HTMLElement = fixture.nativeElement.querySelector('.rr-preview');
    expect(region.textContent).toContain('Real recording · first 90 seconds · one R–R source');
    expect(region.textContent).toContain('Statistics cover the full recording');
    expect(region.textContent).toContain('Separate from the agreement grade');
    expect(Array.from(region.querySelectorAll('tbody td'), cell => cell.textContent?.trim()))
      .toEqual(['100.0 %', '1.5 %', '8.1 ms']);
    expect(region.querySelectorAll('[role="img"]')).toHaveLength(1);
    expect(region.querySelector('table')?.closest('[data-nosnippet]')).not.toBeNull();
    expect(region.querySelectorAll('button, select')).toHaveLength(0);
  });

  it('uses the shared host with only its render listener and releases it on teardown', async () => {
    await vi.waitFor(() => expect(loader.setOption.mock.calls.some(call => call[1].series?.[0]?.id === 'recorded-rr-sample:rr')).toBe(true));
    const [chart, option] = loader.setOption.mock.calls.find(call => call[1].series?.[0]?.id === 'recorded-rr-sample:rr')!;
    expect(chart.on.mock.calls.map(call => call[0])).toEqual(['finished']);
    expect(chart.getZr).not.toHaveBeenCalled();
    expect(option.tooltip.show).toBe(false);
    expect(option.aria.label.description).toBe(fixture.nativeElement.querySelector('.rr-preview__chart')?.getAttribute('aria-label'));
    expect(option.series.every(series => series.silent)).toBe(true);
    expect(loader.attachMobileSeriesTapFeedback.mock.calls.some(call => call[0] === chart)).toBe(false);
    fixture.destroy();
    expect(loader.dispose).toHaveBeenCalledWith(chart);
    expect(chart.off).toHaveBeenCalledWith('finished', expect.any(Function));
  });

  it('keeps summary values available when the R–R plot cannot initialize', async () => {
    await vi.waitFor(() => expect(loader.setOption.mock.calls.some(call => call[1].series?.[0]?.id === 'recorded-rr-sample:rr')).toBe(true));
    loader.init.mockImplementation(async (container: HTMLElement) => container.classList.contains('rr-preview__chart') ? null : createChart());
    theme.set(AppThemes.Dark); fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.rrChartUnavailable()).toBe(true));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.rr-preview [role="status"]')?.textContent).toContain('Recorded summary values remain available');
    expect(fixture.nativeElement.querySelector('.rr-preview table')?.textContent).toContain('8.1 ms');
  });

  it.each(['initialization', 'drawing'])('recovers after a transient %s failure without hiding the viewport target', async failure => {
    await vi.waitFor(() => expect(loader.setOption.mock.calls.some(call => call[1].series?.[0]?.id === 'recorded-rr-sample:rr')).toBe(true));
    const waitForViewport = chartViewportQueue.wait.bind(chartViewportQueue);
    vi.spyOn(chartViewportQueue, 'wait').mockImplementation((element, prepare) => {
      // display:none hosts never enter the viewport, so a retry must retain its target's layout box.
      if (element.classList.contains('rr-preview__chart') && element.hidden) {
        let finish: (ready: boolean) => void;
        return { ready: new Promise<boolean>(resolve => { finish = resolve; }), cancel: () => finish(false) };
      }
      return waitForViewport(element, prepare);
    });
    if (failure === 'initialization') {
      loader.init.mockImplementation(async (container: HTMLElement) => container.classList.contains('rr-preview__chart') ? null : createChart());
    } else {
      loader.setOption.mockImplementation((_chart, option) => {
        if (option.series?.[0]?.id === 'recorded-rr-sample:rr') throw new Error('Transient draw failure');
      });
    }
    theme.set(AppThemes.Dark); fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.rrChartUnavailable()).toBe(true));
    fixture.detectChanges();
    const container: HTMLElement = fixture.nativeElement.querySelector('.rr-preview__chart');
    expect(container.hidden).toBe(false);
    expect(container.getAttribute('aria-hidden')).toBe('true');
    expect(fixture.nativeElement.querySelector('.rr-preview table')?.textContent).toContain('8.1 ms');
    loader.init.mockImplementation(async () => createChart());
    loader.setOption.mockReset();
    theme.set(AppThemes.Normal); fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.rrChartUnavailable()).toBe(false));
    fixture.detectChanges();
    expect(container.hidden).toBe(false);
    expect(container.getAttribute('aria-hidden')).toBeNull();
    expect(fixture.nativeElement.querySelector('.rr-preview [role="status"]')).toBeNull();
    expect(loader.setOption.mock.calls.some(call => call[1].series?.[0]?.id === 'recorded-rr-sample:rr')).toBe(true);
  });

  it.each(['theme change', 'destruction'])('disposes a late R–R initialization after %s without drawing stale data', async action => {
    await vi.waitFor(() => expect(loader.setOption.mock.calls.some(call => call[1].series?.[0]?.id === 'recorded-rr-sample:rr')).toBe(true));
    const lateChart = createChart();
    let finish: ((chart: typeof lateChart) => void) | undefined;
    loader.init.mockImplementation(async (container: HTMLElement) => {
      if (container.classList.contains('rr-preview__chart') && !finish) {
        return new Promise<typeof lateChart>(resolve => { finish = resolve; });
      }
      return createChart();
    });
    theme.set(AppThemes.Dark); fixture.detectChanges();
    await vi.waitFor(() => expect(finish).toBeDefined());
    loader.setOption.mockClear();
    if (action === 'destruction') fixture.destroy();
    else { theme.set(AppThemes.Normal); fixture.detectChanges(); }
    finish!(lateChart);
    await vi.waitFor(() => expect(loader.dispose).toHaveBeenCalledWith(lateChart));
    expect(loader.setOption.mock.calls.some(call => call[0] === lateChart)).toBe(false);
    if (action === 'theme change') {
      await vi.waitFor(() => expect(loader.setOption.mock.calls.some(call => call[1].series?.[0]?.id === 'recorded-rr-sample:rr')).toBe(true));
      expect(fixture.componentInstance.rrChartUnavailable()).toBe(false);
    }
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

  it('leads with the chart comparison before explaining the merge workflow', () => {
    const titles = Array.from(fixture.nativeElement.querySelectorAll('.compact-row__title'))
      .map((title: Element) => title.textContent?.trim());

    expect(titles[0]).toBe('Multi-Device Chart Comparison');
    expect(titles[1]).toBe('Benchmark Merge Workflow');
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
