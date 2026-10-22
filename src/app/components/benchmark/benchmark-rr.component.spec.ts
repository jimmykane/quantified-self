import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { MatSelect } from '@angular/material/select';
import { MatCheckbox } from '@angular/material/checkbox';
import { describe, expect, it, vi } from 'vitest';
import { ActivityTypes, DataRRCoverage, EventImporterJSON, IBIStream, analyzeRRIntervals, type RRAnalysis } from '@sports-alliance/sports-lib';
import type { AppEventInterface } from '@shared/app-event.interface';
import { MaterialModule } from '../../modules/material.module';
import { AppChartSharedModule } from '../../modules/app-chart-shared.module';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { BenchmarkRRAnalysisService } from '../../services/benchmark-rr-analysis.service';
import { EChartsLoaderService } from '../../services/echarts-loader.service';
import { LoggerService } from '../../services/logger.service';
import { BenchmarkRRComponent } from './benchmark-rr.component';

function recording(name: string, raw = false) {
  const activity = EventImporterJSON.getActivityFromJSON({
    name: '', startDate: 0, endDate: 10000, powerMeter: false, trainer: false,
    type: ActivityTypes.Running, creator: { name, devices: [] }, stats: {}, streams: [], laps: [], events: [], intensityZones: [],
  });
  activity.setID(name);
  if (raw) {
    activity.addStream(new IBIStream([800, 800, 800], [800, 1600, 2400]));
    activity.addStat(new DataRRCoverage(0));
  }
  return activity;
}

function chartStub() {
  const listeners = new Map<string, (event?: unknown) => void>();
  let option: any;
  let disposed = false;
  return {
    listeners, getOption: vi.fn(() => option),
    on: vi.fn((name: string, listener: (event?: unknown) => void) => listeners.set(name, listener)),
    off: vi.fn((name: string) => listeners.delete(name)),
    isDisposed: () => disposed,
    dispose: vi.fn(() => { disposed = true; }),
    setOption: vi.fn((value: unknown) => { option = value; }),
    dispatchAction: vi.fn((value: any) => {
      if (value.type === 'dataZoom') {
        option.dataZoom = option.dataZoom.map((zoom: object) => ({ ...zoom, start: value.start, end: value.end }));
        listeners.get('datazoom')?.();
      }
    }),
  };
}

describe('benchmark R–R panel', () => {
  async function render(mergeType = 'benchmark') {
    const haptics = { selection: vi.fn(), success: vi.fn(), error: vi.fn() };
    const analysis = analyzeRRIntervals([{ time: 800, interval: 800 }, { time: 1600, interval: 800 }], 10000)!;
    const worker = { analyze: vi.fn().mockResolvedValue(analysis), cancel: vi.fn() };
    const charts: ReturnType<typeof chartStub>[] = [];
    const core = { connect: vi.fn(() => 'test-rr-group'), disconnect: vi.fn() };
    const loader = {
      init: vi.fn(() => { const chart = chartStub(); charts.push(chart); return Promise.resolve(chart); }),
      load: vi.fn().mockResolvedValue(core),
      setOption: vi.fn((chart, option) => chart.setOption(option)),
      dispose: vi.fn(chart => chart?.dispose()),
      subscribeToViewportResize: vi.fn(() => vi.fn()),
      attachMobileSeriesTapFeedback: vi.fn(() => vi.fn()),
    };
    const logger = { error: vi.fn() };
    await TestBed.configureTestingModule({ imports: [BenchmarkRRComponent, NoopAnimationsModule], providers: [
      { provide: AppEventColorService, useValue: { getActivityColor: (_all, activity) => activity.creator.name === 'Strap' ? '#123456' : '#654321' } },
      { provide: AppHapticsService, useValue: haptics }, { provide: EChartsLoaderService, useValue: loader },
      { provide: LoggerService, useValue: logger },
    ] }).overrideComponent(BenchmarkRRComponent, { set: {
      imports: [CommonModule, MaterialModule, AppChartSharedModule], schemas: [NO_ERRORS_SCHEMA],
      providers: [{ provide: BenchmarkRRAnalysisService, useValue: worker }],
    } }).compileComponents();
    const fixture = TestBed.createComponent(BenchmarkRRComponent);
    const activities = [recording('Strap', true), recording('Watch')];
    fixture.componentRef.setInput('event', { mergeType, isMerge: true, getActivities: () => activities } as unknown as AppEventInterface);
    fixture.componentRef.setInput('activities', activities);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const panel = fixture.componentInstance;
    const host = fixture.nativeElement as HTMLElement;
    async function openCharts() {
      const tabs = host.querySelectorAll<HTMLElement>('[role="tab"]');
      tabs[1].click(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
      await fixture.whenStable();
    }
    return { fixture, panel, host, activities, analysis, worker, haptics, loader, core, charts, logger, openCharts };
  }

  it('renders independent source summaries, including a recorded zero and missing values, without eager analysis or feedback', async () => {
    const { host, worker, haptics } = await render();
    expect(host.querySelector('table')?.textContent).toContain('0.0 %');
    expect(host.querySelector('table')?.textContent).toContain('No R–R summaries');
    expect(host.querySelectorAll('[aria-label="Unavailable"]').length).toBeGreaterThan(0);
    expect(host.querySelectorAll('.rr-device-dot')).toHaveLength(2);
    expect(host.querySelector('.rr-table-scroll')?.getAttribute('tabindex')).toBe('0');
    expect(host.textContent).toContain('Scroll horizontally to compare recordings');
    expect(worker.analyze).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('excludes explicit multi-sport events even with the legacy merge flag', async () => {
    const { host, panel, worker } = await render('multi');
    expect(panel.visible()).toBe(false); expect(host.querySelector('section')).toBeNull();
    expect(worker.analyze).not.toHaveBeenCalled();
  });

  it('binds the Material summary picker and ignores invalid or unchanged selections', async () => {
    const { fixture, panel, host, haptics } = await render();
    panel.onStatsChange([...panel.selectedStats(), 'not a metric']);
    expect(haptics.selection).not.toHaveBeenCalled();
    fixture.debugElement.query(By.directive(MatSelect)).triggerEventHandler('selectionChange', { value: [] });
    fixture.detectChanges();
    expect(host.textContent).toContain('Choose at least one summary statistic');
    expect(haptics.selection).toHaveBeenCalledOnce();
  });

  it('lazily creates both charts when getOption is initially undefined, with native linkage and shared feedback', async () => {
    const { openCharts, panel, worker, charts, core, loader, haptics, logger } = await render();
    await openCharts();
    expect(panel.status()).toBe('ready'); expect(worker.analyze).toHaveBeenCalledOnce();
    expect(charts).toHaveLength(2); expect(charts.every(chart => chart.setOption.mock.calls.length > 0)).toBe(true);
    expect(core.connect).toHaveBeenCalledWith(charts);
    expect(charts[0].on.mock.calls.map(call => call[0])).toEqual(['finished', 'datazoom']);
    expect(charts[1].on.mock.calls.map(call => call[0])).toEqual(['finished']);
    expect(loader.attachMobileSeriesTapFeedback).toHaveBeenCalledTimes(2);
    expect(haptics.selection).toHaveBeenCalledOnce(); expect(logger.error).not.toHaveBeenCalled();
  });

  it('changes plot visibility without recalculation or summary changes, retaining the current zoom', async () => {
    const { fixture, panel, openCharts, charts, worker, haptics } = await render();
    await openCharts();
    const summary = panel.summaryRows();
    charts[0].dispatchAction({ type: 'dataZoom', start: 20, end: 80 });
    fixture.detectChanges();
    fixture.debugElement.query(By.directive(MatCheckbox)).triggerEventHandler('change', { checked: true });
    fixture.detectChanges(); await fixture.whenStable();
    expect(panel.excludeFlagged()).toBe(true); expect(panel.summaryRows()).toBe(summary);
    expect(charts[0].getOption().dataZoom[0]).toMatchObject({ start: 20, end: 80 });
    await vi.waitFor(() => expect(charts[1].getOption().dataZoom[0]).toMatchObject({ start: 20, end: 80 }));
    expect(worker.analyze).toHaveBeenCalledOnce();
    panel.onExcludeFlagged(true); expect(haptics.selection).toHaveBeenCalledTimes(2);
    panel.resetZoom(); panel.resetZoom();
    expect(charts[0].dispatchAction).toHaveBeenLastCalledWith({ type: 'dataZoom', start: 0, end: 100, $from: 'benchmark-rr-reset-sync' });
    expect(panel.zoomed()).toBe(false); expect(haptics.selection).toHaveBeenCalledTimes(3);
  });

  it('disposes old plots when switching to a source without raw intervals', async () => {
    const { fixture, panel, host, openCharts, charts, core, worker, haptics } = await render();
    await openCharts();
    fixture.debugElement.queryAll(By.directive(MatSelect)).at(-1)!.triggerEventHandler('selectionChange', { value: panel.sources()[1].key });
    fixture.detectChanges(); await fixture.whenStable();
    expect(panel.status()).toBe('unavailable'); expect(panel.analysis()).toBeNull();
    expect(host.querySelector('.rr-chart')).toBeNull();
    expect(host.textContent).toContain('Original beat intervals are unavailable');
    expect(charts.every(chart => chart.dispose.mock.calls.length === 1)).toBe(true);
    expect(core.disconnect).toHaveBeenCalledWith('test-rr-group');
    panel.onSourceChange(panel.sources()[1].key); panel.onSourceChange('unknown');
    expect(worker.analyze).toHaveBeenCalledOnce(); expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('ignores a calculation that completes after the selected recordings change', async () => {
    const { fixture, panel, worker, openCharts, analysis } = await render();
    let resolve!: (value: RRAnalysis) => void;
    worker.analyze.mockImplementation(() => new Promise(done => { resolve = done; }));
    await openCharts();
    expect(panel.status()).toBe('loading');
    fixture.componentRef.setInput('activities', [recording('Other watch')]); fixture.detectChanges();
    resolve(analysis); await fixture.whenStable(); fixture.detectChanges();
    expect(panel.analysis()).toBeNull(); expect(panel.status()).toBe('unavailable');
  });

  it('offers a working retry with one feedback owner after a calculation failure', async () => {
    const { fixture, panel, host, worker, haptics, openCharts } = await render();
    worker.analyze.mockRejectedValueOnce(new Error('Calculation unavailable'));
    await openCharts();
    expect(host.textContent).toContain('Calculation unavailable');
    host.querySelector<HTMLButtonElement>('.rr-error button')!.click();
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); await fixture.whenStable();
    expect(panel.status()).toBe('ready'); expect(worker.analyze).toHaveBeenCalledTimes(2);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    expect(haptics.success).not.toHaveBeenCalled(); expect(haptics.error).not.toHaveBeenCalled();
  });

  it('shows an error when the chart loader cannot create a host and tears down pending analysis on destroy', async () => {
    const { fixture, panel, loader, worker, openCharts, host } = await render();
    loader.init.mockResolvedValue(null as any);
    await openCharts(); fixture.detectChanges();
    expect(panel.status()).toBe('error'); expect(host.textContent).toContain('R–R charts could not be displayed');
    const calls = worker.cancel.mock.calls.length;
    fixture.destroy(); expect(worker.cancel).toHaveBeenCalledTimes(calls + 1);
  });

  it('ignores a chart-link failure belonging to a recording that is no longer selected', async () => {
    const { fixture, panel, loader, logger, openCharts } = await render();
    let reject!: (error: Error) => void;
    loader.load.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    await openCharts();
    await vi.waitFor(() => expect(loader.load).toHaveBeenCalled());
    panel.onSourceChange(panel.sources()[1].key); fixture.detectChanges();
    reject(new Error('Obsolete chart load failure')); await fixture.whenStable();
    expect(panel.status()).toBe('unavailable'); expect(logger.error).not.toHaveBeenCalled();
  });

  it('keeps source identity readable when dark mode rebuilds the chart hosts', async () => {
    const { fixture, panel, openCharts, charts, worker } = await render();
    await openCharts();
    charts[0].dispatchAction({ type: 'dataZoom', start: 20, end: 80 });
    fixture.componentRef.setInput('darkTheme', true); fixture.detectChanges(); await fixture.whenStable();
    await vi.waitFor(() => expect(charts).toHaveLength(4));
    await vi.waitFor(() => expect(charts[2].setOption).toHaveBeenCalled());
    expect(charts[2].getOption().dataZoom[0]).toMatchObject({ start: 20, end: 80 });
    expect(panel.plotColor('#000000')).not.toBe('#000000');
    expect(charts[0].dispose).toHaveBeenCalledOnce(); expect(charts[1].dispose).toHaveBeenCalledOnce();
    expect(worker.analyze).toHaveBeenCalledOnce();
  });
});
