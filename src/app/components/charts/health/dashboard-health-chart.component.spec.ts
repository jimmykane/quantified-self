import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { OverlayContainer } from '@angular/cdk/overlay';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DashboardChartThumbnailComponent } from '../../summaries/dashboard-chart-library/dashboard-chart-thumbnail.component';
import { HealthMetricSeriesChartComponent } from '../../health/health-metric-series-chart.component';
import { ChartsSleepTrendComponent } from '../sleep-trend/charts.sleep-trend.component';
import { buildDashboardHealthContext } from '../../../helpers/dashboard-health-context.helper';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { DashboardHealthChartComponent } from './dashboard-health-chart.component';
import { DashboardHealthService } from '../../../services/dashboard-health.service';
import { AppHapticsService } from '../../../services/app.haptics.service';
import { resolveHealthWorkspaceWindow } from '../../../helpers/health-workspace.helper';
import { DashboardHealthEvidence } from '../../../helpers/dashboard-health-context.helper';
import { projectLoadedHealthRange } from '@shared/health-query';
import { WeightUnits } from '@sports-alliance/sports-lib';
import { normalizeUserUnitSettings } from '@shared/unit-aware-display';
import { HEALTH_METRIC_CATALOG, type HealthSourceRecord } from '@shared/health';

describe('independent dashboard Health views',()=>{
  const owner=signal(true), watch=vi.fn(), haptics={selection:vi.fn()};
  const streams:Subject<DashboardHealthEvidence>[]=[];
  beforeEach(async()=>{
    owner.set(true);vi.clearAllMocks();streams.length=0;
    watch.mockImplementation(()=>{const stream=new Subject<DashboardHealthEvidence>();streams.push(stream);return stream;});
    await TestBed.configureTestingModule({imports:[DashboardHealthChartComponent],providers:[
      {provide:DashboardHealthService,useValue:{isOwner:()=>owner(),watch,invalidate:vi.fn()}},
      {provide:AppHapticsService,useValue:haptics},
    ]}).overrideComponent(DashboardHealthChartComponent,{set:{template:'',imports:[]}}).compileComponents();
  });
  afterEach(() => vi.unstubAllGlobals());
  function create(metric='steps', range: '30d' | '1y' = '30d') {
    const fixture=TestBed.createComponent(DashboardHealthChartComponent);
    fixture.componentRef.setInput('user',{uid:'owner',settings:{unitSettings:{},appSettings:{}}});
    fixture.componentRef.setInput('settings',{metric,range});
    fixture.componentInstance['visible'].set(true);fixture.detectChanges();return fixture;
  }
  function result(metric='steps',endDate='2026-09-15'):DashboardHealthEvidence {
    return {window:resolveHealthWorkspaceWindow({metric:metric as never,range:'30d',endDate},endDate),health:null,history:null,activities:null,sessions:[],errors:[]};
  }
  it('reports a fatal refresh failure after an empty context and supports retrying the closed reader', () => {
    const fixture = create('body_weight'), component = fixture.componentInstance;
    const failed = vi.fn(); component.readFailed.subscribe(failed);
    streams[0].next(result('body_weight')); fixture.detectChanges();
    expect(component.context()?.availability.state).toBe('no-data');
    expect(failed).not.toHaveBeenCalled();
    streams[0].error(new Error('read failed')); fixture.detectChanges();
    expect(component.error()).toBe(true);
    expect(component.loading()).toBe(false);
    expect(failed).toHaveBeenCalledOnce();
    expect(haptics.selection).not.toHaveBeenCalled();
    component.reload(); fixture.detectChanges();
    expect(watch).toHaveBeenCalledTimes(2);
    expect(component.error()).toBe(false);
    streams[1].next(result('body_weight')); fixture.detectChanges();
    expect(component.loading()).toBe(false);
    expect(failed).toHaveBeenCalledOnce();
    expect(haptics.selection).toHaveBeenCalledOnce();
    fixture.destroy();
  });
  it('starts a saved dashboard chart after its host is attached, without waiting for scrolling', () => {
    const observer = { observe: vi.fn(), disconnect: vi.fn() };
    vi.stubGlobal('IntersectionObserver', vi.fn(function () { return observer; }));
    const fixture = TestBed.createComponent(DashboardHealthChartComponent);
    const dashboard = document.createElement('section');
    dashboard.dataset['chartPreload'] = 'background';
    document.body.append(dashboard);
    // Angular constructs embedded children before attaching their containing view.
    dashboard.append(fixture.nativeElement);
    fixture.componentRef.setInput('user', { uid: 'owner', settings: { unitSettings: {}, appSettings: {} } });
    fixture.componentRef.setInput('settings', { metric: 'steps', range: '30d' });
    fixture.detectChanges();
    fixture.detectChanges();
    expect(watch).toHaveBeenCalledOnce();
    expect(observer.observe).not.toHaveBeenCalled();
    streams[0].next(result());
    fixture.detectChanges();
    expect(fixture.componentInstance.loading()).toBe(false);
    expect(watch).toHaveBeenCalledOnce();
    fixture.destroy();
    expect(streams[0].observed).toBe(false);
    dashboard.remove();
  });
  it('uses the shared chart preload window before starting an offscreen read', () => {
    let callback!: IntersectionObserverCallback;
    const observer = { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() };
    vi.stubGlobal('IntersectionObserver', vi.fn(function (handler: IntersectionObserverCallback) {
      callback = handler; return observer;
    }));
    const fixture = TestBed.createComponent(DashboardHealthChartComponent);
    fixture.componentRef.setInput('user',{uid:'owner',settings:{unitSettings:{},appSettings:{}}});
    fixture.componentRef.setInput('settings',{metric:'steps',range:'30d'});
    fixture.detectChanges();

    expect(IntersectionObserver).toHaveBeenCalledWith(expect.any(Function), { root: null, rootMargin: '600px 0px' });
    expect(observer.observe).toHaveBeenCalledWith(fixture.nativeElement);
    expect(watch).not.toHaveBeenCalled();

    callback([{ target: fixture.nativeElement, isIntersecting: true } as IntersectionObserverEntry], observer as never);
    fixture.detectChanges();

    expect(watch).toHaveBeenCalledOnce();
    expect(observer.disconnect).toHaveBeenCalledOnce();
    fixture.destroy();
  });
  it('does not restart reads for structurally identical row inputs',()=>{
    const fixture=create();expect(watch).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('settings',{metric:'steps',range:'30d'});fixture.detectChanges();
    expect(watch).toHaveBeenCalledTimes(1);expect(haptics.selection).not.toHaveBeenCalled();
    fixture.destroy();expect(streams[0].observed).toBe(false);
  });
  it('re-evaluates automatic overview sources on refresh while preserving a user-selected zero source', () => {
    const fixture = create('steps'), component = fixture.componentInstance;
    fixture.componentRef.setInput('overview', true); fixture.detectChanges();
    const changed = vi.fn(); component.settingsChange.subscribe(changed);
    const readings = (includeSuunto: boolean): DashboardHealthEvidence => {
      const window = component.window();
      const records: HealthSourceRecord[] = (includeSuunto ? ['GarminAPI', 'SuuntoApp'] as const : ['GarminAPI'] as const).map(provider => ({
        schemaVersion: 1, id: provider, userID: 'owner', kind: 'daily_summary', calendarDate: window.endDate,
        startTimeMs: window.startTimeMs, endTimeMs: window.endTimeMs,
        source: { provider, accountKey: provider, sourceRecordType: 'daily', sourceRecordKey: provider,
          revision: { order: 1, token: '1', digest: provider }, receivedAtMs: window.endTimeMs },
        metricIds: ['steps'], metrics: [{ kind: 'value', metricId: 'steps', valueType: 'number', aggregation: 'total',
          semanticVariant: 'daily_total', origin: 'provider_summary', recordingMethod: 'provider_calculated',
          quality: { status: 'valid' }, normalizationStatus: 'canonical',
          native: { metric: 'steps', value: provider === 'GarminAPI' ? 0 : 1000, unit: 'count' },
          canonical: { value: provider === 'GarminAPI' ? 0 : 1000, unit: 'count' } }],
        coverage: { status: 'complete' }, sampleChunkIds: [], createdAtMs: 0, updatedAtMs: 0,
      }));
      const projected = projectLoadedHealthRange(records, [], { startDate: window.startDate, endDate: window.endDate,
        metricIds: ['steps'], includeSamples: false }, { sourceRecordsComplete: true, samplesComplete: true });
      return { window, health: { result: projected, limitReached: null, sourceRecordCount: records.length,
        sampleChunkCount: 0, samplePointCount: 0, serializedBytes: 0, hasMatchingSourceRecords: true,
        hasSampleBackedMetric: false, providers: records.map(record => record.source.provider), sampleBackedProviders: [] },
        history: null, activities: null, sessions: [], errors: [] };
    };
    streams[0].next(readings(false)); fixture.detectChanges();
    expect(component.context()?.selected?.model.series.provider).toBe('GarminAPI');
    streams[0].next(readings(true)); fixture.detectChanges();
    expect(component.context()?.selected?.model.series.provider).toBe('SuuntoApp');
    expect(changed).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
    const zeroKey = component.context()!.sources.find(source => source.provider === 'GarminAPI')!.key;
    component.selectSource(zeroKey);
    fixture.componentRef.setInput('settings', changed.mock.calls[0][0].settings); fixture.detectChanges();
    streams[0].next(readings(true)); fixture.detectChanges();
    expect(component.context()?.selectedKey).toBe(zeroKey);
    expect(component.context()?.selected?.latestValueText).toBe('0');
    expect(watch).toHaveBeenCalledOnce(); expect(haptics.selection).toHaveBeenCalledOnce();
    fixture.destroy();
  });
  it('keeps explicit public examples separate from owner reads, refreshes and evidence callbacks', () => {
    const fixture = TestBed.createComponent(DashboardHealthChartComponent), component = fixture.componentInstance;
    fixture.componentRef.setInput('user', { uid: 'owner', settings: { unitSettings: {} } });
    fixture.componentRef.setInput('settings', { metric: 'body_weight', range: '30d' });
    fixture.componentRef.setInput('exampleOnly', true);
    fixture.componentRef.setInput('referenceDate', '2026-08-31');
    component['visible'].set(true);
    const contextChanged = vi.fn(); component.contextChange.subscribe(contextChanged);
    fixture.detectChanges();
    expect(component.showingExample()).toBe(true);
    expect(component.displayContext()?.selected?.model.ariaLabel).toContain('Fictional readings');
    expect(watch).not.toHaveBeenCalled();
    component.reload();
    fixture.componentRef.setInput('user', { uid: 'another-owner', settings: { unitSettings: {} } }); fixture.detectChanges();
    expect(watch).not.toHaveBeenCalled();
    expect(TestBed.inject(DashboardHealthService).invalidate).not.toHaveBeenCalled();
    expect(contextChanged).not.toHaveBeenCalled();
    expect(haptics.selection).not.toHaveBeenCalled();
    fixture.destroy();
  });
  it('unsubscribes and clears private evidence when switching an owner chart to a public example', () => {
    const fixture = create('body_weight'), component = fixture.componentInstance;
    streams[0].next(result('body_weight')); fixture.detectChanges();
    expect(component.context()).not.toBeNull();
    fixture.componentRef.setInput('exampleOnly', true); fixture.detectChanges();
    expect(streams[0].observed).toBe(false);
    expect(component.context()).toBeNull();
    expect(component.displayContext()?.selected?.model.ariaLabel).toContain('Fictional readings');
    expect(watch).toHaveBeenCalledOnce();
    fixture.destroy();
  });
  it('clears an account load error when switching to a public example and can resume account reads', () => {
    const fixture = create('body_weight'), component = fixture.componentInstance;
    streams[0].error(Error('offline')); fixture.detectChanges();
    expect(component.error()).toBe(true);
    fixture.componentRef.setInput('exampleOnly', true); fixture.detectChanges();
    expect(component.error()).toBe(false);
    expect(component.loading()).toBe(false);
    expect(component.previewNotice()).not.toContain('could not be loaded');
    component.reload();
    expect(watch).toHaveBeenCalledOnce();
    expect(TestBed.inject(DashboardHealthService).invalidate).not.toHaveBeenCalled();
    fixture.componentRef.setInput('exampleOnly', false); fixture.detectChanges();
    expect(watch).toHaveBeenCalledTimes(2);
    expect(component.loading()).toBe(true);
    streams[1].next(result('body_weight')); fixture.detectChanges();
    expect(component.showingExample()).toBe(false);
    expect(component.context()).not.toBeNull();
    expect(haptics.selection).not.toHaveBeenCalled();
    fixture.destroy();
  });
  it('advances an overview window without dropping its selected source or producing feedback', () => {
    const fixture = create(), component = fixture.componentInstance;
    fixture.componentRef.setInput('overview', true);
    fixture.componentRef.setInput('settings', { metric: 'steps', range: '30d', sourceKey: 'saved-reading' });
    fixture.componentRef.setInput('referenceDate', '2026-10-09'); fixture.detectChanges();
    expect(component.window().endDate).toBe('2026-10-09');
    fixture.componentRef.setInput('referenceDate', '2026-10-10'); fixture.detectChanges();
    expect(watch.mock.lastCall?.[2]).toBe('2026-10-10');
    expect(component.settings().sourceKey).toBe('saved-reading');
    expect(haptics.selection).not.toHaveBeenCalled(); fixture.destroy();
  });
  it('keeps completed results during refresh and ignores stale responses',()=>{
    const fixture=create();const component=fixture.componentInstance;
    streams[0].next(result());const previous=component.context();
    component.navigate('older');fixture.detectChanges();
    expect(component.loading()).toBe(true);expect(component.context()).toBe(previous);
    streams[0].next(result('steps','2026-01-01'));expect(component.context()).toBe(previous);
    streams[1].next(result('steps','2026-08-15'));expect(component.context()?.window.endDate).toBe('2026-08-15');
  });
  it('keeps navigation local and emits settings without changing the Health hub',()=>{
    const first=create(), second=create('heart_rate');
    const firstEnd=first.componentInstance.window().endDate, secondEnd=second.componentInstance.window().endDate;
    first.componentInstance.navigate('older');first.detectChanges();second.detectChanges();
    expect(first.componentInstance.window().endDate).not.toBe(firstEnd);expect(second.componentInstance.window().endDate).toBe(secondEnd);
    const changed=vi.fn();first.componentInstance.settingsChange.subscribe(changed);
    first.componentInstance.selectRange('14d');
    expect(changed).toHaveBeenCalledWith({settings:{metric:'steps',range:'14d'},initial:false});
    expect(first.componentInstance.settings().range).toBe('30d');
  });
  it('clears private state and subscriptions when the signed-in owner changes',()=>{
    const fixture=create();streams[0].next(result());expect(fixture.componentInstance.context()).not.toBeNull();
    owner.set(false);fixture.detectChanges();
    expect(fixture.componentInstance.context()).toBeNull();expect(streams[0].observed).toBe(false);
    expect(watch).toHaveBeenCalledTimes(1);
  });
  it('restarts a failed subscription when retrying and keeps loading retries silent', () => {
    const fixture = create(); const component = fixture.componentInstance;
    component.reload(); expect(haptics.selection).not.toHaveBeenCalled();
    streams[0].error(Error('offline')); expect(component.error()).toBe(true);
    component.reload(); fixture.detectChanges();
    expect(watch).toHaveBeenCalledTimes(2);
    expect(haptics.selection).toHaveBeenCalledTimes(1);
    streams[1].next(result()); expect(component.error()).toBe(false);
    expect(component.context()).not.toBeNull();
  });

  it('shows progress without clearing the chart during an invalidation refresh', () => {
    const fixture = create(); const component = fixture.componentInstance;
    streams[0].next(result()); const previous = component.context();
    // The shared adapter calls this for each refresh, including Retry/manual edits.
    watch.mock.calls[0][4]();
    expect(component.loading()).toBe(true);
    expect(component.context()).toBe(previous);
    component.reload(); expect(haptics.selection).not.toHaveBeenCalled();
    streams[0].next(result()); expect(component.loading()).toBe(false);
  });

  it('replaces an example with recorded readings and retains those readings during refresh', () => {
    const fixture = create('sleep'); const component = fixture.componentInstance;
    fixture.componentRef.setInput('preview', true); fixture.detectChanges();
    expect(component.showingExample()).toBe(true);
    const evidence = result('sleep');
    evidence.sessions = [{ id: 'recorded-sleep', userID: 'owner', sleepDate: '2026-09-14',
      source: { provider: 'SuuntoApp', accountKey: 'real-account', providerUserId: 'provider-user', sourceSessionKey: 'recorded-night' },
      startTimeMs: Date.parse('2026-09-13T22:00:00Z'), endTimeMs: Date.parse('2026-09-14T06:00:00Z'),
      durationSeconds: 28800, stages: [], isNap: false, createdAtMs: 0, updatedAtMs: 0 }];
    streams[0].next(evidence);
    expect(component.showingExample()).toBe(false);
    expect(component.displayContext()).toBe(component.context());
    expect(component.displayContext()?.sleep.hasRealPoints).toBe(true);
    expect(component.displayContext()?.sources[0].label).toBe('Suunto');
    watch.mock.calls[0][4]();
    expect(component.showingExample()).toBe(false);
    expect(component.displayContext()).toBe(component.context());
    fixture.destroy();
  });

  it('uses examples only in previews without emitting fictional availability or saved settings', () => {
    const fixture = create(); const component = fixture.componentInstance;
    const changed = vi.fn(), availability = vi.fn();
    component.settingsChange.subscribe(changed); component.contextChange.subscribe(availability);
    expect(component.displayContext()).toBeNull();
    fixture.componentRef.setInput('preview', true); fixture.detectChanges();
    expect(component.showingExample()).toBe(true);
    expect(component.displayContext()?.selected?.model.displayedPointCount).toBeGreaterThan(1);
    expect(changed).not.toHaveBeenCalled(); expect(availability).not.toHaveBeenCalled();
    streams[0].next(result());
    expect(availability.mock.calls[0][0].availability.hasData).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    fixture.componentRef.setInput('preview', false); fixture.detectChanges();
    expect(component.showingExample()).toBe(false);
    expect(component.displayContext()?.hasData).toBe(false);
  });

  it('immediately renders shared real evidence in a thumbnail without restarting reads or changing a full preview', () => {
    const fixture = create('sleep'); const component = fixture.componentInstance;
    const data = result('sleep', component.window().endDate);
    const endTimeMs = data.window.endTimeMs - 3600000;
    data.sessions = [{ id: 'night', userID: 'owner', sleepDate: data.window.endDate,
      source: { provider: 'SuuntoApp', accountKey: 'account', providerUserId: 'provider', sourceSessionKey: 'night' },
      startTimeMs: endTimeMs - 28800000, endTimeMs,
      durationSeconds: 28800, stages: [], isNap: false, createdAtMs: 0, updatedAtMs: 0 }];
    const context = buildDashboardHealthContext(data, { metric: 'sleep', range: '30d' });
    fixture.componentRef.setInput('preview', true);
    fixture.componentRef.setInput('thumbnail', true);
    fixture.componentRef.setInput('thumbnailContext', { uid: 'owner', context }); fixture.detectChanges();
    expect(component.displayContext()).toBe(context);
    expect(component.showingExample()).toBe(false);
    expect(watch).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('thumbnail', false); fixture.detectChanges();
    expect(component.showingExample()).toBe(true);
    fixture.componentRef.setInput('thumbnail', true);
    fixture.componentRef.setInput('thumbnailContext', { uid: 'other-owner', context }); fixture.detectChanges();
    expect(component.showingExample()).toBe(true);
    fixture.componentRef.setInput('thumbnailContext', { uid: 'owner', context });
    owner.set(false); fixture.detectChanges();
    expect(component.showingExample()).toBe(true);
    expect(component.displayContext()).not.toBe(context);
    expect(streams[0].observed).toBe(false);
  });

  it('uses shared real thumbnail evidence when a saved detailed source resolves to its daily average', () => {
    const fixture = create('heart_rate'), component = fixture.componentInstance;
    const data = result('heart_rate', component.window().endDate), window = data.window;
    const record: HealthSourceRecord = { schemaVersion: 1, id: 'daily', userID: 'owner', kind: 'daily_summary',
      calendarDate: window.endDate, startTimeMs: window.endTimeMs - 3600000, endTimeMs: window.endTimeMs,
      source: { provider: 'SuuntoApp', accountKey: 'account', sourceRecordType: 'daily', sourceRecordKey: 'daily',
        revision: { order: 1, token: '1', digest: '1' }, receivedAtMs: window.endTimeMs },
      metricIds: ['heart_rate'], metrics: [{ kind: 'value', metricId: 'heart_rate', valueType: 'number', aggregation: 'average',
        semanticVariant: 'qs_daily_interval_mean', origin: 'quantified_self_derived', recordingMethod: 'quantified_self_calculated',
        quality: { status: 'valid' }, normalizationStatus: 'canonical', native: { metric: 'HR', value: 65, unit: 'bpm' },
        canonical: { value: 65, unit: 'bpm' } }], coverage: { status: 'unknown' }, sampleChunkIds: [], createdAtMs: 0, updatedAtMs: 0 };
    data.health = { result: projectLoadedHealthRange([record], [], { startDate: window.startDate, endDate: window.endDate,
      metricIds: ['heart_rate'] }, { sourceRecordsComplete: true, samplesComplete: true }), limitReached: null,
      sourceRecordCount: 1, sampleChunkCount: 0, samplePointCount: 0, serializedBytes: 0, hasMatchingSourceRecords: true,
      hasSampleBackedMetric: false, providers: ['SuuntoApp'], sampleBackedProviders: [] };
    const context = buildDashboardHealthContext(data, { metric: 'heart_rate', range: '30d' });
    const sourceKey = context.selected!.model.series.alternateResolutionKey!;
    fixture.componentRef.setInput('settings', { metric: 'heart_rate', range: '30d', sourceKey });
    fixture.componentRef.setInput('preview', true); fixture.componentRef.setInput('thumbnail', true);
    fixture.componentRef.setInput('thumbnailContext', { uid: 'owner', context }); fixture.detectChanges();
    expect(component.displayContext()).toBe(context); expect(component.showingExample()).toBe(false);
    expect(component.displayContext()?.selected?.latestValueText).toBe('65 bpm');
    fixture.componentRef.setInput('settings', { metric: 'heart_rate', range: '30d', sourceKey: 'unrelated' }); fixture.detectChanges();
    expect(component.displayContext()).not.toBe(context);
    expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('ignores unavailable source selections without haptic feedback or settings changes', () => {
    const fixture = create(); const component = fixture.componentInstance;
    streams[0].next(result());
    const changed = vi.fn(); component.settingsChange.subscribe(changed);
    component.selectSource('no-data');
    expect(changed).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
  });

  it('normalizes an existing sample-only year to 90 days and disables selecting it again', () => {
    const fixture = create('stress_state', '1y');
    const component = fixture.componentInstance;
    const changed = vi.fn(); component.settingsChange.subscribe(changed);
    const window = resolveHealthWorkspaceWindow({ metric: 'stress_state', range: '1y', endDate: '2026-09-15' }, '2026-09-15');
    const result = projectLoadedHealthRange([], [], {
      startDate: window.startDate, endDate: window.endDate, metricIds: ['stress_state'], includeSamples: false,
    }, { sourceRecordsComplete: true, samplesComplete: true });
    const evidence = { window, health: { result, limitReached: null, sourceRecordCount: 1, sampleChunkCount: 0,
      samplePointCount: 0, serializedBytes: 0, hasMatchingSourceRecords: true, hasSampleBackedMetric: true,
      providers: ['SuuntoApp'], sampleBackedProviders: ['SuuntoApp'] }, history: null, activities: null, sessions: [], errors: [] } as DashboardHealthEvidence;
    streams[0].next(evidence);
    fixture.detectChanges();
    expect(component.isRangeDisabled('1y')).toBe(true);
    expect(changed).toHaveBeenCalledWith({ settings: { metric: 'stress_state', range: '90d' }, initial: false });
    streams[0].next(evidence);
    expect(changed).toHaveBeenCalledTimes(1);
  });

});


describe('Health library preview states', () => {
  it('keeps the shorter-range action available alongside an example for sample-only metrics', async () => {
    await TestBed.configureTestingModule({ imports: [DashboardHealthChartComponent, NoopAnimationsModule], providers: [
      { provide: DashboardHealthService, useValue: { isOwner: () => false } },
      { provide: AppHapticsService, useValue: { selection: vi.fn() } },
    ] }).overrideComponent(DashboardHealthChartComponent, {
      remove: { imports: [DashboardChartThumbnailComponent, HealthMetricSeriesChartComponent, ChartsSleepTrendComponent] },
      add: { schemas: [NO_ERRORS_SCHEMA] },
    }).compileComponents();
    const fixture = TestBed.createComponent(DashboardHealthChartComponent);
    fixture.componentRef.setInput('user', { uid: 'owner', settings: { unitSettings: {} } });
    fixture.componentRef.setInput('settings', { metric: 'stress_state', range: '1y' });
    fixture.componentRef.setInput('preview', true);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const context = buildDashboardHealthContext({ window: component.window(), health: null, history: null, activities: null, sessions: [], errors: [] }, component.settings());
    component.context.set({ ...context, sampleOnly: true, sampleRangeLimited: true, availability: { ...context.availability, reason: 'Detailed readings are available without a daily summary. Choose 90 days or less.' } });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Example data');
    expect(fixture.nativeElement.textContent).toContain('Choose 90 days or less');
    expect(fixture.nativeElement.querySelector('app-health-metric-series-chart')).toBeTruthy();
    const changed = vi.fn(); component.settingsChange.subscribe(changed);
    const button = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(item => item.textContent?.includes('Show 90 days'))!;
    button.click();
    expect(changed).toHaveBeenCalledWith({ settings: { metric: 'stress_state', range: '90d' }, initial: false });
    fixture.destroy();
  });
});

describe('dashboard chart source interactions', () => {
  const haptics = { selection: vi.fn() };
  let readings: Subject<DashboardHealthEvidence>;
  let watch: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    vi.clearAllMocks(); readings = new Subject(); watch = vi.fn(() => readings);
    await TestBed.configureTestingModule({ imports: [DashboardHealthChartComponent, NoopAnimationsModule], providers: [
      { provide: DashboardHealthService, useValue: { isOwner: () => true, watch } },
      { provide: AppHapticsService, useValue: haptics },
    ] }).overrideComponent(DashboardHealthChartComponent, {
      remove: { imports: [DashboardChartThumbnailComponent, HealthMetricSeriesChartComponent, ChartsSleepTrendComponent] },
      add: { schemas: [NO_ERRORS_SCHEMA] },
    }).compileComponents();
  });
  function create(metric: 'sleep_duration' | 'sleep' | 'heart_rate' = 'sleep_duration', sourceKey?: string, multiple = true) {
    const fixture = TestBed.createComponent(DashboardHealthChartComponent);
    fixture.componentRef.setInput('user', { uid: 'owner', settings: { unitSettings: {}, appSettings: {} } });
    fixture.componentRef.setInput('settings', { metric, range: '30d', ...(sourceKey ? { sourceKey } : {}) });
    fixture.componentInstance['visible'].set(true); fixture.detectChanges();
    const window = fixture.componentInstance.window();
    const session = { id: 'night', userID: 'owner', sleepDate: window.endDate,
      source: { provider: 'SuuntoApp' as const, accountKey: 'suunto', providerUserId: 'suunto', sourceSessionKey: 'night' },
      startTimeMs: window.endTimeMs - 12 * 3600000, endTimeMs: window.endTimeMs - 4 * 3600000,
      durationSeconds: 28800, stages: [], isNap: false,
      vitals: { averageHeartRateBpm: 63, minimumHeartRateBpm: 57 }, createdAtMs: 0, updatedAtMs: 0 };
    readings.next({ window, health: null, history: null, activities: null, errors: [], sessions: [session,
      ...(multiple ? [{ ...session, id: 'other', source: { ...session.source, accountKey: 'second', providerUserId: 'second' } }] : [])] });
    fixture.detectChanges(); return fixture;
  }
  it('renders recorded manual and synced Weight independently on overview cards with user units and source filters', () => {
    const fixture = TestBed.createComponent(DashboardHealthChartComponent), component = fixture.componentInstance;
    const user = { uid: 'owner', settings: { unitSettings: normalizeUserUnitSettings({}), appSettings: {} } };
    fixture.componentRef.setInput('user', user);
    fixture.componentRef.setInput('settings', { metric: 'body_weight', range: '30d' });
    fixture.componentRef.setInput('overview', true);
    fixture.componentRef.setInput('hideTitle', true);
    component['visible'].set(true); fixture.detectChanges();
    const window = component.window(), definition = HEALTH_METRIC_CATALOG.body_weight;
    const records: HealthSourceRecord[] = (['QuantifiedSelf', 'GarminAPI'] as const).map((provider, index) => ({
      schemaVersion: 1, id: provider, userID: 'owner', kind: 'point_measurement', calendarDate: window.endDate,
      startTimeMs: window.endTimeMs - 3600000, endTimeMs: window.endTimeMs - 3600000,
      source: { provider, accountKey: provider, sourceRecordKey: provider,
        sourceRecordType: provider === 'QuantifiedSelf' ? 'manual_measurement' : 'body_composition',
        revision: { order: 1, token: 'one', digest: 'one' }, receivedAtMs: window.endTimeMs + 86400000 },
      metricIds: ['body_weight'], metrics: [{ kind: 'value', metricId: 'body_weight', valueType: definition.valueType,
        aggregation: 'measurement', semanticVariant: 'point', origin: 'recorded', recordingMethod: provider === 'QuantifiedSelf' ? 'manual' : 'device',
        quality: { status: 'valid' }, normalizationStatus: 'canonical',
        native: { metric: 'weight', value: 72 + index, unit: definition.canonicalUnit }, canonical: { value: 72 + index, unit: definition.canonicalUnit } }],
      coverage: { status: 'complete' }, sampleChunkIds: [], createdAtMs: 0, updatedAtMs: 0,
    }));
    const result = projectLoadedHealthRange(records, [], { startDate: window.startDate, endDate: window.endDate, metricIds: ['body_weight'], includeSamples: true }, { sourceRecordsComplete: true, samplesComplete: true });
    const evidence: DashboardHealthEvidence = { window, health: { result, limitReached: null, sourceRecordCount: 2, sampleChunkCount: 0,
      samplePointCount: 0, serializedBytes: 0, hasMatchingSourceRecords: true, hasSampleBackedMetric: false,
      providers: ['QuantifiedSelf', 'GarminAPI'], sampleBackedProviders: [] }, history: null, activities: null, sessions: [], errors: [] };
    readings.next(evidence); fixture.detectChanges();
    const manual = component.context()!.sources.find(source => source.provider === 'QuantifiedSelf')!;
    fixture.componentRef.setInput('settings', { metric: 'body_weight', range: '30d', sourceKey: manual.key }); fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.health-value-row strong')?.textContent).toBe('72.0 kg');
    expect(host.querySelector('.health-range-controls')).toBeNull();
    expect(host.querySelector('.health-recorded-date')?.textContent).toBe('Recorded ' + component.recordedDate());
    expect(component.context()?.selected?.model.series.points).toHaveLength(1);
    fixture.componentRef.setInput('user', { ...user, settings: { ...user.settings, unitSettings: normalizeUserUnitSettings({ weightUnits: WeightUnits.Pounds }) } }); fixture.detectChanges();
    expect(host.querySelector('.health-value-row strong')?.textContent).toBe('158.7 lb');
    expect(watch).toHaveBeenCalledTimes(1); expect(haptics.selection).not.toHaveBeenCalled();
    expect(host.querySelector('.health-value-row app-chart-source-picker')?.textContent).toContain('Recorded measurement');
    expect(host.querySelector('.health-evidence-text')?.textContent).toContain('1 reading recorded · No trend inferred');
    expect(host.querySelector('.health-two-reading-comparison')).toBeNull();
    const older = structuredClone(records[0]);
    older.id = 'older-manual'; older.source.sourceRecordKey = 'older-manual';
    older.startTimeMs -= 7 * 86400000; older.endTimeMs -= 7 * 86400000;
    older.calendarDate = new Date(older.endTimeMs).toISOString().slice(0, 10);
    if (older.metrics[0].kind !== 'value') throw new Error('Expected a Weight value fixture');
    older.metrics[0].canonical!.value = 73;
    older.metrics[0].native.value = 73;
    const twoReadings = { ...evidence, health: { ...evidence.health!, result: projectLoadedHealthRange([...records, older], [],
      { startDate: window.startDate, endDate: window.endDate, metricIds: ['body_weight'], includeSamples: true }, { sourceRecordsComplete: true, samplesComplete: true }) } };
    readings.next(twoReadings); fixture.detectChanges();
    const comparison = component.context()!.selected!.model.twoReadingComparisonText!;
    expect(comparison).toContain('Recorded change:'); expect(comparison).toContain('lb');
    expect(host.querySelector('.health-two-reading-comparison')?.textContent).toBe(comparison);
    fixture.componentRef.setInput('thumbnail', true); fixture.detectChanges();
    expect(host.querySelector('.health-thumbnail-source')?.textContent).toBe(component.context()!.selected!.model.series.sourceLabel);
    expect(host.querySelector('.health-thumbnail-value')?.textContent).toBe('158.7 lb');
    expect(host.querySelector('.health-thumbnail-summary')?.getAttribute('aria-label')).toContain('No trend inferred');
    expect(host.querySelector('.health-thumbnail-summary')?.getAttribute('aria-label')).toContain(comparison);
    expect(watch).toHaveBeenCalledTimes(1); expect(haptics.selection).not.toHaveBeenCalled();
    fixture.componentRef.setInput('thumbnail', false); fixture.detectChanges();
    fixture.componentRef.setInput('providerFilter', ['GarminAPI']); fixture.detectChanges();
    expect(component.context()?.hasData).toBe(false); expect(component.context()?.selectedKey).toBe(manual.key);
    expect(component.context()?.sources.map(source => source.provider)).toEqual(['GarminAPI']);
    expect(host.querySelector('.health-value-row strong')).toBeNull();
    fixture.componentRef.setInput('providerFilter', []); fixture.detectChanges();
    watch.mock.calls[0][4](); fixture.detectChanges();
    expect(host.querySelector('.health-value-row strong')?.textContent).toBe('158.7 lb');
    expect(host.textContent).toContain('Updating readings');
    readings.next(evidence); fixture.detectChanges();
    expect(component.loading()).toBe(false); expect(watch).toHaveBeenCalledTimes(1);
    fixture.destroy(); expect(readings.observed).toBe(false);
  });
  it.each(['sleep_duration', 'sleep'] as const)('changes %s from a compact menu without additional reads or resetting the range', async metric => {
    const fixture = create(metric), component = fixture.componentInstance;
    const changed = vi.fn(); component.settingsChange.subscribe(changed);
    const trigger = fixture.nativeElement.querySelector('.chart-source-trigger') as HTMLButtonElement;
    expect(trigger).toBeTruthy(); expect(fixture.nativeElement.querySelector('mat-form-field')).toBeNull();
    expect(trigger.closest(metric === 'sleep' ? '.health-tile-controls' : '.health-value-row')).toBeTruthy();
    const watchCount = watch.mock.calls.length;
    expect(haptics.selection).not.toHaveBeenCalled();
    trigger.click(); fixture.detectChanges(); await fixture.whenStable();
    expect(watch).toHaveBeenCalledTimes(watchCount); expect(haptics.selection).toHaveBeenCalledTimes(1);
    const options = TestBed.inject(OverlayContainer).getContainerElement().querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    expect(options).toHaveLength(2);
    options[1].click(); fixture.detectChanges(); await fixture.whenStable();
    expect(changed).toHaveBeenCalledExactlyOnceWith({ settings: { metric, range: '30d', sourceKey: component.context()!.sources[1].key }, initial: false });
    expect(haptics.selection).toHaveBeenCalledTimes(2);
    expect(watch).toHaveBeenCalledTimes(watchCount);
    fixture.destroy(); expect(readings.observed).toBe(false);
  });
  it('uses plain attribution for one source and keeps an unavailable saved source replaceable', () => {
    const single = create('sleep_duration', undefined, false);
    expect(single.nativeElement.querySelector('.chart-source-trigger')).toBeNull();
    expect(single.nativeElement.querySelector('.chart-source-caption').textContent).toContain('Suunto · Main sleep');
    single.destroy();
    const missing = create('sleep_duration', 'previous-account', false);
    expect(missing.nativeElement.querySelector('.health-source-empty .chart-source-trigger').textContent).toContain('Source unavailable');
    expect(missing.componentInstance.context()?.selectedKey).toBe('previous-account');
    expect(missing.componentInstance.context()?.hasData).toBe(false);
    expect(haptics.selection).not.toHaveBeenCalled();
    missing.destroy();
  });

  it('names minimum sleep heart rate and its record date on a full Dashboard tile and thumbnail', () => {
    const fixture = create('heart_rate'), component = fixture.componentInstance;
    const minimum = component.context()!.sources.find(source => source.shortLabel.endsWith('Minimum sleep HR'))!;
    expect(minimum).toBeDefined();
    fixture.componentRef.setInput('settings', { metric: 'heart_rate', range: '30d', sourceKey: minimum.key });
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.health-value-row app-chart-source-picker')?.textContent).toContain('Minimum sleep HR');
    expect(host.classList.contains('health-dashboard-tile')).toBe(true);
    const picker = host.querySelector('.health-value-row app-chart-source-picker')!;
    expect(picker.querySelector('.chart-reading-picker > span')?.classList.contains('cdk-visually-hidden')).toBe(true);
    expect(picker.querySelector('.chart-reading-method')).toBeNull();
    expect(picker.querySelector('button')?.getAttribute('aria-label')).toContain('Minimum sleep HR');
    expect(picker.querySelector('.chart-source-row')?.textContent).toContain('Suunto');
    expect(host.querySelector('.health-value-row strong')?.textContent).toBe('57 bpm');
    expect(host.querySelector('.health-recorded-date')?.textContent).toBe('Recorded ' + component.recordedDate());
    expect(host.querySelector('.health-evidence-text')?.textContent).toContain('No trend inferred');
    fixture.componentRef.setInput('thumbnail', true); fixture.detectChanges();
    expect(host.querySelector('.health-thumbnail-source')?.textContent).toContain('Suunto');
    expect(host.classList.contains('health-dashboard-tile')).toBe(false);
    expect(host.querySelector('.health-thumbnail-summary')?.getAttribute('aria-label')).toContain('Minimum sleep HR');
    expect(host.querySelector('.health-thumbnail-value')?.textContent).toBe('57 bpm');
    expect(watch).toHaveBeenCalledOnce();
    expect(haptics.selection).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('attributes the single-source Sleep overview and keeps public examples clearly fictional', () => {
    const fixture = create('sleep', undefined, false);
    expect(fixture.nativeElement.querySelector('.health-sleep-attribution')?.textContent).toBe('Suunto · Sleep overview');
    fixture.componentRef.setInput('exampleOnly', true); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.health-sleep-attribution')?.textContent).toBe('Example data · Sleep overview');
    expect(watch).toHaveBeenCalledOnce();
    expect(haptics.selection).not.toHaveBeenCalled();
    fixture.destroy();
  });
  it('reuses loaded evidence after source persistence, source changes and unit updates', () => {
    const fixture = create(), component = fixture.componentInstance;
    const initial = component.context()!;
    fixture.componentRef.setInput('settings', { ...component.settings(), sourceKey: initial.selectedKey });
    fixture.detectChanges();
    expect(component.context()).toBe(initial);
    const secondKey = initial.sources[1].key;
    fixture.componentRef.setInput('settings', { ...component.settings(), sourceKey: secondKey });
    fixture.detectChanges();
    expect(component.context()?.selectedKey).toBe(secondKey);
    expect(component.context()?.hasData).toBe(true);
    fixture.componentRef.setInput('user', { ...component.user(), settings: {
      ...component.user().settings, unitSettings: { distanceUnits: ['Miles'] },
    } });
    fixture.detectChanges();
    expect(component.context()?.selectedKey).toBe(secondKey);
    expect(watch).toHaveBeenCalledTimes(1);
    expect(component.loading()).toBe(false);
    expect(haptics.selection).not.toHaveBeenCalled();
    fixture.componentRef.setInput('settings', { ...component.settings(), sourceKey: 'missing-account' });
    fixture.detectChanges();
    expect(component.context()?.missingSource).toBe(true);
    expect(component.context()?.hasData).toBe(false);
    expect(watch).toHaveBeenCalledTimes(1);
    fixture.destroy();
    expect(readings.observed).toBe(false);
  });
});
