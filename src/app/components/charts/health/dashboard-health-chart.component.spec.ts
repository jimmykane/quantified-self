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
  function create(metric='steps') {
    const fixture=TestBed.createComponent(DashboardHealthChartComponent);
    fixture.componentRef.setInput('user',{uid:'owner',settings:{unitSettings:{},appSettings:{}}});
    fixture.componentRef.setInput('settings',{metric,range:'30d'});
    fixture.componentInstance['visible'].set(true);fixture.detectChanges();return fixture;
  }
  function result(metric='steps',endDate='2026-09-15'):DashboardHealthEvidence {
    return {window:resolveHealthWorkspaceWindow({metric:metric as never,range:'30d',endDate},endDate),health:null,history:null,activities:null,sessions:[],errors:[]};
  }
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

  it('ignores unavailable source selections without haptic feedback or settings changes', () => {
    const fixture = create(); const component = fixture.componentInstance;
    streams[0].next(result());
    const changed = vi.fn(); component.settingsChange.subscribe(changed);
    component.selectSource('no-data');
    expect(changed).not.toHaveBeenCalled(); expect(haptics.selection).not.toHaveBeenCalled();
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
    fixture.componentRef.setInput('settings', { metric: 'heart_rate', range: '90d' });
    fixture.componentRef.setInput('preview', true);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const context = buildDashboardHealthContext({ window: component.window(), health: null, history: null, activities: null, sessions: [], errors: [] }, component.settings());
    component.context.set({ ...context, sampleOnly: true, availability: { ...context.availability, reason: 'Detailed readings are available without a daily summary. Choose 30 days or less.' } });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Example data');
    expect(fixture.nativeElement.textContent).toContain('Choose 30 days or less');
    expect(fixture.nativeElement.querySelector('app-health-metric-series-chart')).toBeTruthy();
    const changed = vi.fn(); component.settingsChange.subscribe(changed);
    const button = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(item => item.textContent?.includes('Show 30 days'))!;
    button.click();
    expect(changed).toHaveBeenCalledWith({ settings: { metric: 'heart_rate', range: '30d' }, initial: false });
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
  function create(metric: 'sleep_duration' | 'sleep' = 'sleep_duration', sourceKey?: string, multiple = true) {
    const fixture = TestBed.createComponent(DashboardHealthChartComponent);
    fixture.componentRef.setInput('user', { uid: 'owner', settings: { unitSettings: {}, appSettings: {} } });
    fixture.componentRef.setInput('settings', { metric, range: '30d', ...(sourceKey ? { sourceKey } : {}) });
    fixture.componentInstance['visible'].set(true); fixture.detectChanges();
    const window = fixture.componentInstance.window();
    const session = { id: 'night', userID: 'owner', sleepDate: window.endDate,
      source: { provider: 'SuuntoApp' as const, accountKey: 'suunto', providerUserId: 'suunto', sourceSessionKey: 'night' },
      startTimeMs: window.endTimeMs - 12 * 3600000, endTimeMs: window.endTimeMs - 4 * 3600000,
      durationSeconds: 28800, stages: [], isNap: false, createdAtMs: 0, updatedAtMs: 0 };
    readings.next({ window, health: null, history: null, activities: null, errors: [], sessions: [session,
      ...(multiple ? [{ ...session, id: 'other', source: { ...session.source, accountKey: 'second', providerUserId: 'second' } }] : [])] });
    fixture.detectChanges(); return fixture;
  }
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
