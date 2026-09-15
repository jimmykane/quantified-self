import { signal } from '@angular/core';
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

});
