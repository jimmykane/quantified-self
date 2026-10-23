import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { MatSelect } from '@angular/material/select';
import { MatCheckbox } from '@angular/material/checkbox';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityTypes, DataRRCoverage, DataRRArtifactPercentage, DataRRSuspectedEctopicPairCount, DataRRRMSSD, DataRRSDNN, DataRRPNN50, DataRRDFAAlpha1Median, DistanceUnits, EventImporterJSON, IBIStream, analyzeRRIntervals, type RRAnalysis } from '@sports-alliance/sports-lib';
import { getDefaultUserUnitSettings } from '@shared/unit-aware-display';
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
  const fullscreenRestorers: (() => void)[] = [];
  afterEach(() => fullscreenRestorers.splice(0).reverse().forEach(restore => restore()));

  function fullscreenBrowser(legacy = false) {
    let current: Element | null = null;
    const eventName = legacy ? 'webkitfullscreenchange' : 'fullscreenchange';
    function property(target: object, key: string, descriptor: PropertyDescriptor) {
      const original = Object.getOwnPropertyDescriptor(target, key);
      Object.defineProperty(target, key, { configurable: true, ...descriptor });
      fullscreenRestorers.push(() => original ? Object.defineProperty(target, key, original) : Reflect.deleteProperty(target, key));
    }
    const change = (element: Element | null) => { current = element; document.dispatchEvent(new Event(eventName)); };
    const request = vi.fn(async function(this: HTMLElement) { change(this); });
    const exit = vi.fn(async () => { change(null); });
    property(HTMLElement.prototype, legacy ? 'webkitRequestFullscreen' : 'requestFullscreen', { value: request });
    property(document, legacy ? 'webkitExitFullscreen' : 'exitFullscreen', { value: exit });
    property(document, legacy ? 'webkitFullscreenEnabled' : 'fullscreenEnabled', { value: true });
    property(document, legacy ? 'webkitFullscreenElement' : 'fullscreenElement', { get: () => current });
    return { request, exit, change };
  }

  async function render(mergeType = 'benchmark', activities = [recording('Strap', true), recording('Watch')]) {
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
      resize: vi.fn(),
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
    fixture.componentRef.setInput('event', {
      mergeType: mergeType === 'ordinary' ? undefined : mergeType,
      isMerge: mergeType !== 'ordinary', getActivities: () => activities,
    } as unknown as AppEventInterface);
    fixture.componentRef.setInput('activities', activities);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const panel = fixture.componentInstance;
    const host = fixture.nativeElement as HTMLElement;
    async function openCharts() {
      if (!panel.expanded()) host.querySelector<HTMLButtonElement>('.rr-disclosure')!.click();
      fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
      await fixture.whenStable();
      // Host initialization and setOption run asynchronously after the chart view queries settle.
      if (panel.status() === 'ready') {
        await vi.waitFor(() => {
          fixture.detectChanges();
          if (panel.status() === 'error') return;
          const active = charts.filter(chart => !chart.isDisposed());
          expect(active).toHaveLength(2);
          expect(active.every(chart => chart.setOption.mock.calls.length > 0)).toBe(true);
        });
        await fixture.whenStable();
      }
    }
    return { fixture, panel, host, activities, analysis, worker, haptics, loader, core, charts, logger, openCharts };
  }

  async function openPoincare(context: Awaited<ReturnType<typeof render>>) {
    const { host, fixture, charts } = context;
    host.querySelector<HTMLButtonElement>('mat-button-toggle[value="poincare"] button')!.click();
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    await vi.waitFor(() => {
      const active=charts.filter(chart=>!chart.isDisposed());
      expect(active).toHaveLength(1);expect(active[0].setOption).toHaveBeenCalled();
    });
    return charts.filter(chart=>!chart.isDisposed())[0];
  }

  it.each([false, true])('opens only the Poincaré panel fullscreen and exits without reanalysis (prefixed: %s)', async legacy => {
    const browser = fullscreenBrowser(legacy);
    const context = await render(); await context.openCharts();
    const chart = await openPoincare(context);
    const { panel, fixture, host, haptics } = context;
    const target = host.querySelector<HTMLElement>('.rr-poincare-panel')!;
    const button = host.querySelector<HTMLButtonElement>('.rr-fullscreen-toggle')!;
    expect(button.getAttribute('aria-label')).toBe('Open Poincaré plot fullscreen');
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    panel.onExcludeFlagged(true); fixture.detectChanges(); await fixture.whenStable();
    const analyses = panel.analyses(), summary = panel.summaryRows();
    button.click(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(browser.request).toHaveBeenCalledOnce(); expect(browser.request.mock.contexts[0]).toBe(target);
    expect(panel.poincareFullscreen()).toBe(true); expect(target.classList.contains('rr-poincare-fullscreen')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Exit fullscreen');
    expect(target.querySelector('.rr-poincare-sources')?.textContent).toContain('Strap');
    expect(target.querySelector('.rr-poincare-sources')?.textContent).not.toContain('Watch');
    expect(target.querySelector('mat-checkbox')).not.toBeNull();
    expect(panel.excludeFlagged()).toBe(true); expect(panel.analyses()).toBe(analyses); expect(panel.summaryRows()).toBe(summary);
    expect(context.worker.analyze).toHaveBeenCalledOnce(); expect(chart.isDisposed()).toBe(false);
    expect(chart.getOption().tooltip.confine).toBe(true); expect(chart.getOption().tooltip.appendTo).toBeUndefined();
    expect(haptics.selection).toHaveBeenCalledTimes(4);
    button.click(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(browser.exit).toHaveBeenCalledOnce(); expect(panel.poincareFullscreen()).toBe(false);
    expect(target.querySelector('.rr-poincare-sources')).toBeNull(); expect(chart.isDisposed()).toBe(false);
    expect(haptics.selection).toHaveBeenCalledTimes(5); expect(haptics.error).not.toHaveBeenCalled();
    browser.change(target); fixture.detectChanges(); browser.change(null); fixture.detectChanges();
    expect(panel.poincareFullscreen()).toBe(false); expect(haptics.selection).toHaveBeenCalledTimes(5);
  });

  it('leaves unsupported fullscreen silent and keeps the chart available', async () => {
    const context = await render(); await context.openCharts(); await openPoincare(context);
    expect(context.panel.fullscreenAvailable()).toBe(false);
    expect(context.host.querySelector('.rr-fullscreen-toggle')).toBeNull();
    await context.panel.togglePoincareFullscreen();
    expect(context.haptics.selection).toHaveBeenCalledTimes(2); expect(context.haptics.error).not.toHaveBeenCalled();
    expect(context.panel.status()).toBe('ready');
  });

  it('reports a rejected fullscreen request without changing or disposing the chart', async () => {
    const browser = fullscreenBrowser(); browser.request.mockRejectedValueOnce(new Error('Permission denied'));
    const context = await render(); await context.openCharts(); const chart = await openPoincare(context);
    await context.panel.togglePoincareFullscreen(); context.fixture.detectChanges();
    expect(context.panel.poincareFullscreen()).toBe(false); expect(context.panel.fullscreenPending()).toBe(false);
    expect(context.host.querySelector('[role="status"]')?.textContent).toContain('Fullscreen could not be changed');
    expect(context.haptics.selection).toHaveBeenCalledTimes(2); expect(context.haptics.error).toHaveBeenCalledOnce();
    expect(chart.isDisposed()).toBe(false); expect(context.panel.status()).toBe('ready');
    await context.panel.togglePoincareFullscreen(); context.fixture.detectChanges();
    expect(context.panel.poincareFullscreen()).toBe(true); expect(context.panel.fullscreenError()).toBe('');
    browser.change(null);
  });

  it('deduplicates pending requests and exits a late fullscreen entry after the plot is removed', async () => {
    const browser = fullscreenBrowser(); let finish!: () => void;
    browser.request.mockImplementationOnce(function(this: HTMLElement) {
      return new Promise<void>(resolve => { finish = () => { browser.change(this); resolve(); }; });
    });
    const context = await render(); await context.openCharts(); await openPoincare(context);
    const pending = context.panel.togglePoincareFullscreen();
    await context.panel.togglePoincareFullscreen(); context.fixture.detectChanges();
    expect(browser.request).toHaveBeenCalledOnce(); expect(context.host.querySelector<HTMLButtonElement>('.rr-fullscreen-toggle')?.disabled).toBe(true);
    expect(context.host.querySelector('.rr-fullscreen-toggle mat-spinner')).not.toBeNull();
    context.panel.onChartViewChange('time'); context.fixture.detectChanges(); await context.fixture.whenStable();
    finish(); await pending;
    expect(browser.exit).toHaveBeenCalledOnce(); expect(context.panel.poincareFullscreen()).toBe(false);
    expect(context.panel.fullscreenPending()).toBe(false); expect(context.haptics.selection).toHaveBeenCalledTimes(3);
    expect(context.haptics.error).not.toHaveBeenCalled();
  });

  it('rebuilds square geometry on fullscreen changes while keeping selection and chart listeners', async () => {
    const browser = fullscreenBrowser();
    const context = await render(); await context.openCharts(); const chart = await openPoincare(context);
    const target = context.host.querySelector<HTMLElement>('.rr-poincare-panel')!;
    const canvas = target.querySelector<HTMLElement>('.rr-poincare-chart')!;
    let width = 1440, height = 700;
    Object.defineProperties(canvas, {clientWidth:{get:()=>width},clientHeight:{get:()=>height}});
    chart.listeners.get('click')?.({seriesId:'activity:Strap:poincare:accepted',dataIndex:0});
    const selection = context.panel.poincareSelection(), listeners = chart.on.mock.calls.length;
    await context.panel.togglePoincareFullscreen(); context.fixture.detectChanges(); await context.fixture.whenStable();
    expect(chart.getOption().grid).toMatchObject({width:620,height:620});
    expect(chart.getOption().tooltip.confine).toBe(true);
    width = 816; height = 816; browser.change(null); context.fixture.detectChanges(); await context.fixture.whenStable();
    expect(chart.getOption().grid).toMatchObject({width:720,height:720});
    expect(chart.getOption().tooltip.confine).toBe(false); expect(chart.getOption().tooltip.appendTo).toBeTypeOf('function');
    expect(context.panel.poincareSelection()).toBe(selection); expect(chart.on).toHaveBeenCalledTimes(listeners);
    expect(context.worker.analyze).toHaveBeenCalledOnce(); expect(chart.isDisposed()).toBe(false);
    expect(context.haptics.selection).toHaveBeenCalledTimes(3);
  });

  it.each(['ordinary','multi','benchmark'])('adds a lazy Poincaré view with isolated device overlays on %s events', async kind => {
    const context=await render(kind,[recording('No HRV'),recording('Strap',true),recording('Watch',true)]);
    const {panel,host,worker,haptics,core,charts,openCharts}=context;
    expect(panel.chartView()).toBe('time');expect(worker.analyze).not.toHaveBeenCalled();
    await openCharts();
    const summary=panel.summaryRows();
    const chart=await openPoincare(context);
    expect(panel.chartView()).toBe('poincare');expect(panel.poincarePairCount()).toBe(2);
    expect(host.querySelector('.rr-poincare-chart')).not.toBeNull();expect(host.querySelector('.rr-dfa-chart')).toBeNull();
    expect(host.querySelector('.rr-source-legends')?.textContent).not.toContain('No HRV');
    expect(host.querySelectorAll('.rr-device-symbol')).toHaveLength(2);
    expect(chart.getOption().series).toHaveLength(7);
    expect(chart.getOption().series.filter(series=>series.type==='scatter').map(series=>series.symbol))
      .toEqual(['rect',expect.any(String),'emptyCircle','triangle',expect.any(String),'emptyCircle']);
    expect(charts.slice(0,2).every(chart=>chart.isDisposed())).toBe(true);
    expect(core.disconnect).toHaveBeenCalledWith('test-rr-group');expect(core.connect).toHaveBeenCalledTimes(1);
    expect(worker.analyze).toHaveBeenCalledTimes(2);expect(panel.summaryRows()).toBe(summary);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    panel.onChartViewChange('poincare');expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('preserves timeline zoom across view switches without recalculating beats', async () => {
    const context=await render();await context.openCharts();
    context.charts[0].dispatchAction({type:'dataZoom',start:20,end:80});
    const scatter=await openPoincare(context);
    context.panel.resetZoom();expect(scatter.dispatchAction).not.toHaveBeenCalled();
    context.host.querySelector<HTMLButtonElement>('mat-button-toggle[value="time"] button')!.click();
    context.fixture.detectChanges();await context.fixture.whenStable();context.fixture.detectChanges();
    await vi.waitFor(()=>{
      const active=context.charts.filter(chart=>!chart.isDisposed());expect(active).toHaveLength(2);
      expect(active[0].getOption()?.dataZoom[0]).toMatchObject({start:20,end:80});
    });
    expect(scatter.isDisposed()).toBe(true);expect(context.worker.analyze).toHaveBeenCalledOnce();
    expect(context.haptics.selection).toHaveBeenCalledTimes(3);
  });

  it('inspects flagged points with canonical values, clears filtered selections and leaves pointer haptics to the shared host', async () => {
    const context=await render('ordinary',[recording('Strap',true)]);
    context.analysis.beats[0].classification='short';await context.openCharts();
    const summary=context.panel.summaryRows(),chart=await openPoincare(context);
    context.panel.nextPoincareFlag();context.fixture.detectChanges();
    expect(context.panel.poincareDetail()).toMatchObject({current:'800.0 ms',next:'800.0 ms',classification:'Artifact flagged',label:'Strap'});
    expect(chart.dispatchAction).toHaveBeenLastCalledWith({type:'showTip',seriesIndex:2,dataIndex:0});
    expect(context.haptics.selection).toHaveBeenCalledTimes(3);
    context.panel.nextPoincareFlag();expect(context.haptics.selection).toHaveBeenCalledTimes(3);
    chart.listeners.get('click')?.({seriesId:'activity:Strap:poincare:artifact',dataIndex:0});
    chart.listeners.get('click')?.({seriesId:'unknown',dataIndex:0});
    expect(context.haptics.selection).toHaveBeenCalledTimes(3);
    expect(context.loader.attachMobileSeriesTapFeedback).toHaveBeenCalledTimes(3);
    context.panel.onExcludeFlagged(true);context.fixture.detectChanges();await context.fixture.whenStable();context.fixture.detectChanges();
    expect(context.panel.poincareSelection()).toBeNull();expect(context.panel.poincarePairCount()).toBe(0);
    expect(context.host.textContent).toContain('No consecutive interval pairs');
    expect(context.panel.summaryRows()).toBe(summary);expect(context.worker.analyze).toHaveBeenCalledOnce();
    context.panel.nextPoincareFlag();expect(context.haptics.selection).toHaveBeenCalledTimes(4);
  });

  it('rebuilds the Poincaré theme with source identity intact and disposes it on collapse', async () => {
    const context=await render();await context.openCharts();
    const first=await openPoincare(context);
    context.fixture.componentRef.setInput('darkTheme',true);context.fixture.detectChanges();await context.fixture.whenStable();
    await vi.waitFor(()=>expect(context.charts.at(-1)?.setOption).toHaveBeenCalled());
    expect(first.isDisposed()).toBe(true);expect(context.worker.analyze).toHaveBeenCalledOnce();
    expect(context.charts.at(-1)?.getOption().series[1].id).toBe('activity:Strap:poincare:accepted');
    context.host.querySelector<HTMLButtonElement>('.rr-disclosure')!.click();context.fixture.detectChanges();
    expect(context.charts.every(chart=>chart.isDisposed())).toBe(true);
    context.panel.nextPoincareFlag();expect(context.panel.poincareSelection()).toBeNull();
    expect(context.haptics.selection).toHaveBeenCalledTimes(3);
  });

  it('recovers from a Poincaré initialization failure using the existing retry and cached analysis', async () => {
    const context=await render();await context.openCharts();
    context.loader.init.mockResolvedValueOnce(null);
    context.panel.onChartViewChange('poincare');context.fixture.detectChanges();await context.fixture.whenStable();context.fixture.detectChanges();
    await vi.waitFor(()=>expect(context.panel.status()).toBe('error'));context.fixture.detectChanges();
    expect(context.charts.every(chart=>chart.isDisposed())).toBe(true);
    context.host.querySelector<HTMLButtonElement>('.rr-error button')!.click();context.fixture.detectChanges();await context.fixture.whenStable();context.fixture.detectChanges();
    await vi.waitFor(()=>expect(context.charts.at(-1)?.setOption).toHaveBeenCalled());
    expect(context.panel.status()).toBe('ready');expect(context.worker.analyze).toHaveBeenCalledOnce();
    expect(context.panel.chartView()).toBe('poincare');expect(context.haptics.selection).toHaveBeenCalledTimes(3);
  });

  it('reports and cleans up a time-series initialization failure when leaving Poincaré', async () => {
    const context=await render();await context.openCharts();await openPoincare(context);
    context.loader.init.mockResolvedValueOnce(null);
    context.panel.onChartViewChange('time');context.fixture.detectChanges();await context.fixture.whenStable();
    await vi.waitFor(()=>expect(context.panel.status()).toBe('error'));
    expect(context.charts.every(chart=>chart.isDisposed())).toBe(true);
    expect(context.worker.analyze).toHaveBeenCalledOnce();
  });

  it('disposes a late Poincaré initialization after switching back to time series', async () => {
    const context=await render();await context.openCharts();
    let resolve!: (chart: ReturnType<typeof chartStub>)=>void;
    context.loader.init.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
    context.panel.onChartViewChange('poincare');context.fixture.detectChanges();
    await vi.waitFor(()=>expect(resolve).toBeDefined());
    context.panel.onChartViewChange('time');context.fixture.detectChanges();
    const late=chartStub();resolve(late);await context.fixture.whenStable();context.fixture.detectChanges();
    await vi.waitFor(()=>expect(context.charts.filter(chart=>!chart.isDisposed())).toHaveLength(2));
    expect(late.dispose).toHaveBeenCalledOnce();expect(late.setOption).not.toHaveBeenCalled();
    expect(context.panel.chartView()).toBe('time');expect(context.panel.status()).toBe('ready');
  });

  it('starts collapsed without large summary content, beat materialization, workers or haptics', async () => {
    const strap = recording('Strap', true);
    const readBeats = vi.spyOn(strap.getStream('IBI'), 'getStreamDataByDuration');
    const { host, panel, worker, haptics, loader } = await render('benchmark', [strap]);
    expect(panel.expanded()).toBe(false);
    expect(host.classList.contains('benchmark-rr-collapsed')).toBe(true);
    expect(host.querySelector('.rr-disclosure')?.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector(`[id="${panel.contentId}"]`)?.hasAttribute('hidden')).toBe(true);
    expect(host.querySelector('table')).toBeNull(); expect(host.querySelector('.rr-chart')).toBeNull();
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(worker.analyze).not.toHaveBeenCalled(); expect(readBeats).not.toHaveBeenCalled();
    expect(loader.init).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('opens directly to charts with compact source statistics above them and the full table behind a disclosure', async () => {
    const { host, fixture, openCharts } = await render();
    await openCharts(); fixture.detectChanges();
    expect(host.classList.contains('benchmark-rr-collapsed')).toBe(false);
    const legend = host.querySelector('.rr-source-legends')!;
    expect(legend.getAttribute('tabindex')).toBe('0');
    expect(legend.getAttribute('role')).toBe('region');
    expect(legend.textContent).toContain('0.0 %');
    expect(legend.textContent).not.toContain('Watch');
    expect(legend.textContent).not.toContain('No raw R–R');
    expect(host.querySelectorAll('.rr-source-legend')).toHaveLength(1);
    expect(fixture.debugElement.query(By.directive(MatSelect))).toBeNull();
    expect(host.querySelector('table')).toBeNull();
    expect(legend.compareDocumentPosition(host.querySelector('.rr-chart')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    host.querySelector<HTMLButtonElement>('.rr-summary-toggle')!.click(); fixture.detectChanges();
    expect(host.querySelector('table')?.textContent).toContain('0.0 %');
    expect(host.querySelectorAll('[aria-label="Unavailable"]').length).toBeGreaterThan(0);
    expect(host.querySelectorAll('.rr-device-dot')).toHaveLength(1);
    expect(host.querySelector('.rr-table-scroll')?.getAttribute('tabindex')).toBe('0');
    expect(host.textContent).not.toContain('Scroll horizontally to compare recordings');
  });

  it.each([DistanceUnits.Kilometers, DistanceUnits.Miles].flatMap(distanceUnits =>
    ['benchmark', 'ordinary', 'multi'].map(kind => ({ distanceUnits, kind }))
  ))('keeps all seven canonical metrics in each recording legend ($kind, $distanceUnits)', async ({ distanceUnits, kind }) => {
    const recordings = [recording('Reference chest strap with a long recording name', true), recording('Watch', true)];
    for (const source of recordings) {
      [new DataRRArtifactPercentage(1.5), new DataRRSuspectedEctopicPairCount(24), new DataRRRMSSD(8.14),
        new DataRRSDNN(37.2), new DataRRPNN50(.5), new DataRRDFAAlpha1Median(.62)].forEach(stat => source.addStat(stat));
    }
    const { fixture, host, openCharts } = await render(kind, recordings);
    fixture.componentRef.setInput('unitSettings', { ...getDefaultUserUnitSettings(), distanceUnits }); fixture.detectChanges();
    await openCharts(); fixture.detectChanges();
    const legends = host.querySelectorAll('.rr-source-legend');
    expect(legends).toHaveLength(2);
    for (const legend of legends) {
      expect(Array.from(legend.querySelectorAll('dt'), label => label.textContent)).toEqual([
        'Coverage', 'Artifacts', 'Suspected pairs', 'RMSSD', 'SDNN', 'pNN50', 'DFA α1 · median',
      ]);
      expect(Array.from(legend.querySelectorAll('dd'), value => value.textContent)).toEqual([
        '0.0 %', '1.5 %', '24', '8.1 ms', '37.2 ms', '0.5 %', '0.62',
      ]);
    }
  });

  it.each(['ordinary', 'multi'])('supports %s events with R–R intervals, without analyzing while collapsed', async kind => {
    const { host, panel, worker, loader, openCharts, haptics } = await render(kind, [recording('Strap', true)]);
    expect(panel.visible()).toBe(true); expect(panel.expanded()).toBe(false);
    expect(host.querySelector('section')?.getAttribute('aria-label')).toBe('R–R and HRV analysis');
    expect(worker.analyze).not.toHaveBeenCalled();
    expect(loader.init).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
    await openCharts();
    expect(panel.status()).toBe('ready');
    expect(panel.chartRecordings()).toHaveLength(1);
    expect(host.querySelectorAll('.rr-chart')).toHaveLength(2);
    expect(worker.analyze).toHaveBeenCalledOnce(); expect(haptics.selection).toHaveBeenCalledOnce();
  });

  it('keeps saved HRV usable on an ordinary event without inventing raw intervals', async () => {
    const activity = recording('Strap'); activity.addStat(new DataRRRMSSD(12));
    const { host, panel, worker, loader, fixture, openCharts } = await render('ordinary', [activity]);
    expect(panel.visible()).toBe(true);
    await openCharts();
    expect(panel.status()).toBe('unavailable');
    expect(host.textContent).toContain('Original beat intervals are unavailable');
    expect(host.querySelector('.rr-chart')).toBeNull();
    host.querySelector<HTMLButtonElement>('.rr-summary-toggle')!.click(); fixture.detectChanges();
    expect(host.querySelector('table')?.textContent).toContain('12.0 ms');
    expect(worker.analyze).not.toHaveBeenCalled(); expect(loader.init).not.toHaveBeenCalled();
  });

  it('hides and disposes the panel when selection changes to an activity without HRV', async () => {
    const strap = recording('Strap', true);
    const { host, panel, fixture, charts, openCharts } = await render('ordinary', [strap]);
    await openCharts();
    fixture.componentRef.setInput('activities', [recording('No HRV')]); fixture.detectChanges();
    expect(panel.visible()).toBe(false); expect(panel.expanded()).toBe(false);
    expect(host.querySelector('section')).toBeNull();
    expect(charts.every(chart => chart.dispose.mock.calls.length === 1)).toBe(true);
    fixture.componentRef.setInput('activities', [strap]); fixture.detectChanges();
    expect(panel.visible()).toBe(true); expect(panel.expanded()).toBe(false);
  });

  it('binds the Material summary picker and ignores invalid or unchanged selections', async () => {
    const { fixture, panel, host, haptics, openCharts } = await render();
    await openCharts();
    host.querySelector<HTMLButtonElement>('.rr-summary-toggle')!.click(); fixture.detectChanges();
    haptics.selection.mockClear();
    panel.onStatsChange([...panel.selectedStats(), 'not a metric']);
    expect(haptics.selection).not.toHaveBeenCalled();
    fixture.debugElement.queryAll(By.directive(MatSelect)).at(-1)!.triggerEventHandler('selectionChange', { value: [] });
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
    const watch = recording('Watch'); watch.addStat(new DataRRRMSSD(12));
    const { fixture, panel, host, openCharts, charts, core, worker, haptics } = await render('benchmark', [recording('Strap', true), watch]);
    await openCharts();
    fixture.debugElement.queryAll(By.directive(MatSelect)).at(-1)!.triggerEventHandler('selectionChange', { value: [panel.sources()[1].key] });
    fixture.detectChanges(); await fixture.whenStable();
    expect(panel.status()).toBe('unavailable'); expect(panel.analyses().size).toBe(0);
    expect(host.querySelector('.rr-chart')).toBeNull();
    expect(host.textContent).toContain('Original beat intervals are unavailable');
    expect(charts.every(chart => chart.dispose.mock.calls.length === 1)).toBe(true);
    expect(core.disconnect).toHaveBeenCalledWith('test-rr-group');
    panel.onSourcesChange([panel.sources()[1].key, 'unknown']);
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
    expect(panel.analyses().size).toBe(0); expect(panel.status()).toBe('idle');
    expect(panel.visible()).toBe(false);
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
    const watch = recording('Watch'); watch.addStat(new DataRRRMSSD(12));
    const { fixture, panel, loader, logger, openCharts } = await render('benchmark', [recording('Strap', true), watch]);
    let reject!: (error: Error) => void;
    loader.load.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    await openCharts();
    await vi.waitFor(() => expect(loader.load).toHaveBeenCalled());
    panel.onSourcesChange([panel.sources()[1].key]); fixture.detectChanges();
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

  it('does not materialize raw beat arrays until the chart section is expanded', async () => {
    const strap = recording('Strap', true);
    const readBeats = vi.spyOn(strap.getStream('IBI'), 'getStreamDataByDuration');
    const { openCharts, worker } = await render('benchmark', [strap]);
    expect(readBeats).not.toHaveBeenCalled();
    await openCharts();
    expect(readBeats).toHaveBeenCalledOnce();
    expect(worker.analyze).toHaveBeenCalledWith({
      durationMs: 10000,
      samples: [{ time: 800, interval: 800 }, { time: 1600, interval: 800 }, { time: 2400, interval: 800 }],
    });
  });

  it.each([true, false])('keeps the selected source when an earlier recording is deselected (saved IDs: %s)', async hasIDs => {
    const recordings = [recording('First', true), recording('Second', true), recording('Third', true)];
    if (!hasIDs) recordings.forEach(activity => activity.setID(''));
    const { fixture, panel, openCharts, haptics } = await render('benchmark', recordings);
    await openCharts();
    panel.onSourcesChange([panel.sources()[2].key]); fixture.detectChanges(); await fixture.whenStable();
    const key = panel.selectedSourceKeys()[0];
    fixture.componentRef.setInput('activities', recordings.slice(1)); fixture.detectChanges(); await fixture.whenStable();
    expect(panel.selectedSources()[0]?.activity).toBe(recordings[2]);
    expect(panel.selectedSourceKeys()).toEqual([key]);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('keeps saved summaries usable when original interval timing cannot be read', async () => {
    const strap = recording('Strap', true);
    strap.getStream('IBI').getData().push(800); // Explicit sample times no longer align.
    const { panel, worker, openCharts, fixture, host } = await render('benchmark', [strap]);
    expect(panel.summaryRows()[0].cells[0].display).toBe('0.0 %');
    await openCharts(); fixture.detectChanges();
    expect(panel.status()).toBe('error');
    expect(host.textContent).toContain('recorded R–R timing could not be read');
    expect(worker.analyze).not.toHaveBeenCalled();
    expect(panel.summaryRows()[0].cells[0].display).toBe('0.0 %');
  });

  it('releases a partially initialized chart immediately when its partner fails', async () => {
    const { loader, openCharts, panel, charts } = await render();
    loader.init.mockResolvedValueOnce(null as any);
    await openCharts();
    expect(panel.status()).toBe('error'); expect(charts).toHaveLength(1);
    expect(charts[0].dispose).toHaveBeenCalledOnce();
  });

  it('overlays every selected recording and reuses independent analyses when the Material picker changes', async () => {
    const recordings = [recording('Strap', true), recording('Watch', true), recording('Ring', true)];
    recordings[1].startDate = new Date(1000); recordings[1].endDate = new Date(11000);
    const { fixture, panel, worker, charts, host, openCharts, haptics } = await render('benchmark', recordings);
    await openCharts(); fixture.detectChanges();
    expect(worker.analyze).toHaveBeenCalledTimes(3);
    expect(panel.chartRecordings()).toHaveLength(3);
    expect(host.querySelectorAll('.rr-source-legend')).toHaveLength(3);
    await vi.waitFor(() => expect(charts[0]?.setOption).toHaveBeenCalled());
    expect(charts[0].getOption().series).toHaveLength(9);
    expect(charts[1].getOption().series).toHaveLength(3);
    expect(charts[0].getOption().series[3]).toMatchObject({ id: 'activity:Watch:rr', lineStyle: { type: 'dashed' } });
    expect(charts[0].getOption().series[3].data[0][0]).toBe(1800);
    fixture.debugElement.query(By.directive(MatSelect)).triggerEventHandler('selectionChange', { value: [panel.sources()[2].key] });
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); await fixture.whenStable();
    expect(panel.chartRecordings().map(source => source.label)).toEqual(['Ring']);
    expect(panel.summaryRows()[0].cells).toHaveLength(1);
    await vi.waitFor(() => expect(charts.at(-2)?.setOption).toHaveBeenCalled());
    expect(charts.at(-2)!.getOption().series).toHaveLength(3);
    expect(charts.at(-2)!.getOption().series[0]).toMatchObject({ id: 'activity:Ring:rr', lineStyle: { type: 'dotted' } });
    expect(worker.analyze).toHaveBeenCalledTimes(3);
    panel.onSourcesChange([panel.sources()[2].key, 'unknown']);
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    panel.onSourcesChange([]); fixture.detectChanges();
    expect(panel.status()).toBe('unavailable'); expect(host.textContent).toContain('Choose at least one recording');
    expect(host.querySelector('.rr-chart')).toBeNull();
  });

  it('keeps successful recordings chartable when another source fails, and retries only the failed analysis', async () => {
    const { fixture, panel, worker, charts, host, openCharts, analysis } = await render('benchmark', [recording('Strap', true), recording('Watch', true)]);
    worker.analyze.mockRejectedValueOnce(new Error('Unreadable source')).mockResolvedValue(analysis);
    await openCharts(); fixture.detectChanges();
    expect(panel.status()).toBe('ready'); expect(worker.analyze).toHaveBeenCalledTimes(2);
    expect(panel.chartRecordings().map(source => source.label)).toEqual(['Watch']);
    expect(host.textContent).toContain('Strap: Unreadable source');
    await vi.waitFor(() => expect(charts[0]?.setOption).toHaveBeenCalled());
    expect(charts[0].getOption().series).toHaveLength(3);
    host.querySelector<HTMLButtonElement>('.rr-error button')!.click();
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); await fixture.whenStable();
    expect(panel.chartRecordings()).toHaveLength(2); expect(panel.sourceErrors()).toEqual([]);
    expect(worker.analyze).toHaveBeenCalledTimes(3);
  });

  it('releases charts on collapse and reopens without recalculating completed analyses', async () => {
    const { fixture, host, panel, worker, charts, haptics, openCharts } = await render();
    await openCharts();
    host.querySelector<HTMLButtonElement>('.rr-disclosure')!.click(); fixture.detectChanges();
    expect(panel.expanded()).toBe(false); expect(host.querySelector('.rr-source-legends')).toBeNull();
    expect(host.classList.contains('benchmark-rr-collapsed')).toBe(true);
    expect(charts.every(chart => chart.dispose.mock.calls.length === 1)).toBe(true);
    await openCharts();
    expect(panel.status()).toBe('ready'); expect(charts).toHaveLength(4);
    expect(worker.analyze).toHaveBeenCalledOnce(); expect(haptics.selection).toHaveBeenCalledTimes(3);
  });

  it('ignores in-flight analysis after collapse and keeps a replacement event collapsed', async () => {
    const { fixture, host, panel, worker, openCharts, analysis, charts } = await render();
    let resolve!: (value: RRAnalysis) => void;
    worker.analyze.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await openCharts();
    host.querySelector<HTMLButtonElement>('.rr-disclosure')!.click(); fixture.detectChanges();
    resolve(analysis); await fixture.whenStable(); fixture.detectChanges();
    expect(panel.analyses().size).toBe(0); expect(charts).toHaveLength(0);
    fixture.componentRef.setInput('event', { mergeType: 'benchmark', isMerge: true, getActivities: () => [] });
    fixture.detectChanges();
    expect(panel.expanded()).toBe(false); expect(worker.analyze).toHaveBeenCalledOnce();
  });

  it('selects the remaining event recording when the locally selected source is removed', async () => {
    const recordings = [recording('Strap', true), recording('Watch', true)];
    const { fixture, panel, openCharts, haptics } = await render('benchmark', recordings);
    await openCharts();
    panel.onSourcesChange([panel.sources()[0].key]); fixture.detectChanges(); await fixture.whenStable();
    fixture.componentRef.setInput('activities', [recordings[1]]); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(panel.selectedSources().map(source => source.activity)).toEqual([recordings[1]]);
    expect(panel.status()).toBe('ready');
    expect(panel.chartRecordings()[0].lineStyle).toBe('dashed');
    expect(haptics.selection).toHaveBeenCalledTimes(2);
  });

  it('keeps an intentionally empty selection recoverable when only one event recording remains', async () => {
    const recordings = [recording('Strap', true), recording('Watch', true)];
    const { fixture, host, panel, openCharts } = await render('benchmark', recordings);
    await openCharts();
    panel.onSourcesChange([]); fixture.detectChanges();
    fixture.componentRef.setInput('activities', [recordings[1]]); fixture.detectChanges(); await fixture.whenStable();
    expect(panel.selectedSources()).toEqual([]);
    const picker = fixture.debugElement.query(By.directive(MatSelect));
    expect(picker).not.toBeNull();
    picker.triggerEventHandler('selectionChange', { value: [panel.sources()[0].key] });
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(panel.status()).toBe('ready'); expect(host.querySelector('.rr-chart')).not.toBeNull();
  });

  it('omits unusable sources from the chart legend while retaining valid saved summaries', async () => {
    const invalid = recording('Invalid watch');
    invalid.addStream(new IBIStream([null, null], [800, 1600]));
    invalid.addStat(new DataRRCoverage(0));
    const { fixture, host, panel, worker, openCharts } = await render('benchmark', [recording('Strap', true), invalid]);
    worker.analyze.mockImplementation(async input => analyzeRRIntervals(input.samples, input.durationMs));
    await openCharts(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(panel.status()).toBe('ready'); expect(panel.chartRecordings().map(source => source.label)).toEqual(['Strap']);
    expect(host.querySelectorAll('.rr-source-legend')).toHaveLength(1);
    expect(host.querySelector('.rr-source-legends')?.textContent).not.toContain('Invalid watch');
    host.querySelector<HTMLButtonElement>('.rr-summary-toggle')!.click(); fixture.detectChanges();
    expect(host.querySelector('table')?.textContent).toContain('Invalid watch');
    expect(panel.summaryRows()[0].cells[1].display).toBe('0.0 %');
    expect(panel.sourceErrors()).toEqual([]);
  });

  it.each([true, false])('omits devices without R–R data while preserving full-event source identities and line styles (saved IDs: %s)', async hasIDs => {
    const recordings = [recording('No HRV device'), recording('Strap', true), recording('Second HRV device', true)];
    if (!hasIDs) recordings.forEach(activity => activity.setID(''));
    const { fixture, panel, host, openCharts, worker, charts } = await render('benchmark', recordings);
    await openCharts(); fixture.detectChanges();
    expect(panel.sources().map(source => source.activity)).toEqual(recordings.slice(1));
    expect(panel.sourceLegends().map(source => source.label)).toEqual(['Strap', 'Second HRV device']);
    expect(panel.chartRecordings().map(source => source.lineStyle)).toEqual(['dashed', 'dotted']);
    expect(panel.chartRecordings().map(source => source.key)).toEqual(hasIDs
      ? ['activity:Strap', 'activity:Second HRV device'] : ['recording:1', 'recording:2']);
    const picker = fixture.debugElement.query(By.directive(MatSelect)).componentInstance as MatSelect;
    expect(picker.options.map(option => option.viewValue)).toEqual(['Strap', 'Second HRV device']);
    expect(host.querySelector('.rr-source-legends')?.textContent).not.toContain('No HRV device');
    expect(worker.analyze).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(charts[0]?.setOption).toHaveBeenCalled());
    expect(charts[0].getOption().series).toHaveLength(6);
    expect(charts[1].getOption().series).toHaveLength(2);
    expect(panel.activities).toEqual(recordings);
  });

  it('keeps saved HRV statistics available outside the chart legend when a device has no raw intervals', async () => {
    const savedOnly = recording('Saved HRV'); savedOnly.addStat(new DataRRRMSSD(12));
    const { fixture, panel, host, openCharts, worker } = await render('benchmark', [recording('Strap', true), savedOnly, recording('No HRV')]);
    await openCharts(); fixture.detectChanges();
    expect(panel.sourceLegends().map(source => source.label)).toEqual(['Strap']);
    expect(host.querySelector('.rr-source-legends')?.textContent).not.toContain('Saved HRV');
    expect(worker.analyze).toHaveBeenCalledOnce();
    host.querySelector<HTMLButtonElement>('.rr-summary-toggle')!.click(); fixture.detectChanges();
    expect(host.querySelector('table')?.textContent).toContain('Saved HRV');
    expect(host.querySelector('table')?.textContent).toContain('12.0 ms');
    expect(host.querySelector('table')?.textContent).not.toContain('No HRV');
  });

  it('keeps a recording with original beat intervals chartable even when saved HRV summaries are missing', async () => {
    const rawOnly = recording('Original intervals');
    rawOnly.addStream(new IBIStream([800, 800, 800], [800, 1600, 2400]));
    const { panel, host, worker, openCharts } = await render('benchmark', [recording('No HRV'), rawOnly]);
    await openCharts();
    expect(panel.sources()).toHaveLength(1);
    expect(panel.sources()[0].hasStats).toBe(false);
    expect(panel.chartRecordings().map(source => source.label)).toEqual(['Original intervals']);
    expect(host.querySelector('.rr-source-legends')?.textContent).toContain('Original intervals');
    expect(worker.analyze).toHaveBeenCalledOnce();
  });

  it.each(['benchmark', 'ordinary', 'multi'])('hides the HRV section on %s events when no device has R–R data', async kind => {
    const { host, panel, worker, loader } = await render(kind, [recording('Watch'), recording('Bike computer')]);
    expect(panel.visible()).toBe(false); expect(host.querySelector('section')).toBeNull();
    expect(host.classList.contains('benchmark-rr-collapsed')).toBe(false);
    expect(panel.sources()).toEqual([]);
    expect(host.querySelector('.rr-source-legends')).toBeNull();
    expect(host.querySelector('.rr-chart')).toBeNull();
    expect(worker.analyze).not.toHaveBeenCalled();
    expect(loader.init).not.toHaveBeenCalled();
  });

  it('preserves disclosure and source choices on a same-event refresh, resetting them for a different event', async () => {
    const recordings = [recording('Strap', true), recording('Watch', true)];
    const { fixture, host, panel, openCharts, haptics } = await render('benchmark', recordings);
    const event = { mergeType: 'benchmark', isMerge: true, getID: () => 'benchmark-event', getActivities: () => recordings };
    fixture.componentRef.setInput('event', event); fixture.detectChanges();
    await openCharts();
    panel.onSourcesChange([panel.sources()[1].key]); fixture.detectChanges(); await fixture.whenStable();
    host.querySelector<HTMLButtonElement>('.rr-summary-toggle')!.click(); fixture.detectChanges();
    fixture.componentRef.setInput('event', { ...event }); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(panel.expanded()).toBe(true); expect(panel.showSummary()).toBe(true);
    expect(panel.selectedSources().map(source => source.activity)).toEqual([recordings[1]]);
    expect(haptics.selection).toHaveBeenCalledTimes(3);
    fixture.componentRef.setInput('event', { ...event, getID: () => 'another-event' }); fixture.detectChanges();
    expect(panel.expanded()).toBe(false); expect(panel.showSummary()).toBe(false);
    expect(panel.selectedSources()).toHaveLength(2);
    expect(haptics.selection).toHaveBeenCalledTimes(3);
  });
});
