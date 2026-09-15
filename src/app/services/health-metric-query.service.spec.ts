import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthMetricQueryService } from './health-metric-query.service';
import { AppHealthService, HealthWorkspaceRangeLoad } from './app.health.service';
import { AppSleepService } from './app.sleep.service';
import { AppUserService } from './app.user.service';
import { HealthActivityQueryService } from '../components/health/health-activity-query.service';
import { of } from 'rxjs';
import type { SleepSession } from '@shared/sleep';
import { nightlyHealthAccountKey } from '@shared/nightly-hrv';

describe('shared Health request queue', () => {
  const user = signal<{uid:string}|null>({uid:'owner'});
  const health = { loadMetricRange: vi.fn() };
  const sleep = { watchForDashboard: vi.fn() };
  const pending: Array<() => void> = [];
  const request = (day:number) => ({metricId:'steps' as const,startDate:`2026-09-${String(day).padStart(2,'0')}`,endDate:'2026-09-30',includeSamples:false});
  const flush = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };
  beforeEach(() => {
    vi.clearAllMocks(); pending.length=0; user.set({uid:'owner'});
    health.loadMetricRange.mockImplementation(() => new Promise(resolve => pending.push(() => resolve({} as HealthWorkspaceRangeLoad))));
    TestBed.configureTestingModule({providers:[
      {provide:AppUserService,useValue:{user}}, {provide:AppHealthService,useValue:health},
      {provide:AppSleepService,useValue:sleep}, {provide:HealthActivityQueryService,useValue:{}},
    ]});
  });
  it('matches Sleep accounts to Health reference identities without extra reads or mutating sessions', async () => {
    const session: SleepSession = { id: 'night', userID: 'owner',
      source: { provider: 'COROSAPI', providerUserId: 'account', sourceSessionKey: 'night' },
      sleepDate: '2026-09-01', startTimeMs: 1, endTimeMs: 2, durationSeconds: 1,
      isNap: false, stages: [], stageDurationsSeconds: {}, createdAtMs: 1, updatedAtMs: 2 };
    sleep.watchForDashboard.mockReturnValue(of([session, { ...session, id: 'second-night' }]));
    const service = TestBed.inject(HealthMetricQueryService);
    const first = service.loadSleepRange('owner', 1, 2);
    expect(service.loadSleepRange('owner', 1, 2)).toBe(first);
    const loaded = await first;
    expect(loaded.map(item => item.healthAccountKey)).toEqual([
      await nightlyHealthAccountKey('owner', 'COROSAPI', 'account'),
      await nightlyHealthAccountKey('owner', 'COROSAPI', 'account'),
    ]);
    expect(session).not.toHaveProperty('healthAccountKey');
    expect(sleep.watchForDashboard).toHaveBeenCalledTimes(1);
    expect(health.loadMetricRange).not.toHaveBeenCalled();
  });
  it('coalesces reads, limits concurrency to three, and promotes a selected preview', async () => {
    const service=TestBed.inject(HealthMetricQueryService);
    const reads=[1,2,3,4,5].map(day=>service.loadMetricRange('owner',request(day),0));
    expect(service.loadMetricRange('owner',request(5),100)).toBe(reads[4]);
    TestBed.flushEffects(); await flush();
    expect(health.loadMetricRange).toHaveBeenCalledTimes(3);
    pending[0](); await flush();
    expect(health.loadMetricRange.mock.calls[3][1]).toEqual(request(5));
    pending[1](); pending[2](); await flush(); pending[3](); pending[4](); await Promise.all(reads);
    await service.loadMetricRange('owner',request(5));
    expect(health.loadMetricRange).toHaveBeenCalledTimes(5);
  });
  it('rejects public reads and results belonging to a previous account', async () => {
    const service=TestBed.inject(HealthMetricQueryService);
    await expect(service.loadMetricRange('other',request(1))).rejects.toThrow('owner');
    expect(health.loadMetricRange).not.toHaveBeenCalled();
    const result=service.loadMetricRange('owner',request(1));
    const rejected=expect(result).rejects.toThrow('account changed');
    await flush(); user.set({uid:'other'}); TestBed.flushEffects(); pending[0](); await rejected;
  });
  it('retries errors and invalidated measurements without poisoning the queue', async () => {
    const service=TestBed.inject(HealthMetricQueryService);
    health.loadMetricRange.mockImplementationOnce(() => { throw Error('offline'); });
    await expect(service.loadMetricRange('owner',request(1))).rejects.toThrow('offline');
    const second=service.loadMetricRange('owner',request(1)); await flush(); pending[0](); await second;
    service.invalidate('owner');
    const third=service.loadMetricRange('owner',request(1)); await flush(); pending[1](); await third;
    expect(health.loadMetricRange).toHaveBeenCalledTimes(3);
  });
  it('cancels queued work only when its last preview closes', async () => {
    const service=TestBed.inject(HealthMetricQueryService);
    const active=[1,2,3].map(day=>service.loadMetricRange('owner',request(day)));
    const a=new AbortController(), b=new AbortController();
    const queued=service.loadMetricRange('owner',request(4),0,a.signal);
    expect(service.loadMetricRange('owner',request(4),100,b.signal)).toBe(queued);
    const cancelled=expect(queued).rejects.toThrow('cancelled');
    a.abort(); await flush();expect(health.loadMetricRange).toHaveBeenCalledTimes(3);
    b.abort();await cancelled;
    pending.forEach(resolve=>resolve());await Promise.all(active);await flush();
    expect(health.loadMetricRange).toHaveBeenCalledTimes(3);
  });

});
