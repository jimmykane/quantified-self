import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DashboardChartThumbnailComponent } from '../../summaries/dashboard-chart-library/dashboard-chart-thumbnail.component';
import { HealthMetricSeriesChartComponent } from '../../health/health-metric-series-chart.component';
import { ChartsSleepTrendComponent } from '../sleep-trend/charts.sleep-trend.component';
import { buildDashboardHealthContext } from '../../../helpers/dashboard-health-context.helper';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  function create(metric='steps') {
    const fixture=TestBed.createComponent(DashboardHealthChartComponent);
    fixture.componentRef.setInput('user',{uid:'owner',settings:{unitSettings:{},appSettings:{}}});
    fixture.componentRef.setInput('settings',{metric,range:'30d'});
    fixture.componentInstance['visible'].set(true);fixture.detectChanges();return fixture;
  }
  function result(metric='steps',endDate='2026-09-15'):DashboardHealthEvidence {
    return {window:resolveHealthWorkspaceWindow({metric:metric as never,range:'30d',endDate},endDate),health:null,history:null,activities:null,sessions:[],errors:[]};
  }
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
