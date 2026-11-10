import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { AppUserInterface } from '../models/app-user.interface';
import type { SleepSession } from '@shared/sleep';
import { DashboardTodayAvailabilityService } from './dashboard-today-availability.service';
import { DashboardTodayDataService } from './dashboard-today-data.service';
import { AppUserService } from './app.user.service';
import { AppSleepService } from './app.sleep.service';
import { DashboardDerivedMetricsService, createDashboardDerivedMetricsMissingState, type DashboardDerivedMetricsState } from './dashboard-derived-metrics.service';
import type { DashboardTodayMetricValues } from '../helpers/dashboard-today-metrics.helper';

describe('Today editor evidence lifecycle', () => {
  const user = { uid: 'owner', settings: { appSettings: {}, unitSettings: {}, dashboardSettings: { tiles: [] } } } as AppUserInterface;
  const users = { user: signal<AppUserInterface | null>(null) };
  const optional = { connect: vi.fn(), metrics: signal<DashboardTodayMetricValues>({}) };
  const derived = { watch: vi.fn(), ensureForDashboard: vi.fn() };
  const sleep = { watchForDashboard: vi.fn() };
  let snapshots: Subject<DashboardDerivedMetricsState>;
  let nights: Subject<SleepSession[]>;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 10, 23, 59, 30));
    vi.clearAllMocks(); users.user.set(user); optional.metrics.set({});
    snapshots = new Subject(); nights = new Subject();
    derived.watch.mockReturnValue(snapshots); sleep.watchForDashboard.mockReturnValue(nights);
    TestBed.configureTestingModule({ providers: [DashboardTodayAvailabilityService,
      { provide: AppUserService, useValue: users }, { provide: DashboardTodayDataService, useValue: optional },
      { provide: DashboardDerivedMetricsService, useValue: derived }, { provide: AppSleepService, useValue: sleep },
    ] });
  });
  afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); });
  const open = () => { const service = TestBed.inject(DashboardTodayAvailabilityService); service.connect(user); TestBed.flushEffects(); return service; };
  it('checks all candidate metrics with one shared scope, read-only snapshot access and no preference writes', () => {
    const service = open();
    expect(derived.watch).toHaveBeenCalledExactlyOnceWith(user, { metricKinds: ['form', 'form_now', 'ramp_rate', 'recovery_now'], reportReadErrors: true });
    expect(sleep.watchForDashboard).toHaveBeenCalledTimes(1);
    expect(optional.connect.mock.calls.at(-1)?.[1].metrics).toHaveLength(11);
    service.connect(user); TestBed.flushEffects();
    expect(derived.watch).toHaveBeenCalledTimes(1);
    expect(derived.ensureForDashboard).not.toHaveBeenCalled();
    expect(user.settings.dashboardSettings.today).toBeUndefined();
  });
  it('keeps failures separate from empty results and receives shared optional metric updates', () => {
    const service = open();
    expect(service.availability().sleep.state).toBe('loading');
    snapshots.next(createDashboardDerivedMetricsMissingState()); nights.next([]);
    expect(service.availability().sleep.state).toBe('no-data');
    optional.metrics.set({ steps: { value: '0', detail: 'Today', status: 'ready', hasData: true } });
    expect(service.availability().steps.state).toBe('ready');
    nights.error(new Error('offline'));
    expect(service.availability().sleep.state).toBe('error');
    expect(service.availability().steps.state).toBe('ready');
    snapshots.error(new Error('offline'));
    expect(service.availability().trainingState.state).toBe('error');
  });
  it('cancels readers and clears old-owner evidence on account changes and destruction', () => {
    const service = open();
    optional.metrics.set({ weight: { value: '70 kg', detail: 'Today', status: 'ready', hasData: true } });
    expect(service.availability().weight.hasData).toBe(true);
    users.user.set({ ...user, uid: 'other' });
    expect(service.availability().weight.hasData).toBe(false);
    TestBed.flushEffects();
    expect(snapshots.observed).toBe(false); expect(nights.observed).toBe(false);
    expect(optional.connect.mock.calls.at(-1)?.[0]).toBeNull();
    users.user.set(user); TestBed.flushEffects();
    expect(snapshots.observed).toBe(true);
    TestBed.resetTestingModule();
    expect(snapshots.observed).toBe(false); expect(nights.observed).toBe(false);
  });
  it('rolls activity checks to the next local day without restarting Sleep or snapshot readers', () => {
    open();
    expect(optional.connect.mock.calls.at(-1)?.[2]).toBe('2026-11-10');
    vi.advanceTimersByTime(60_000); TestBed.flushEffects();
    expect(optional.connect.mock.calls.at(-1)?.[2]).toBe('2026-11-11');
    expect(derived.watch).toHaveBeenCalledTimes(1); expect(sleep.watchForDashboard).toHaveBeenCalledTimes(1);
  });
});
