import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DERIVED_METRIC_KINDS } from '@shared/derived-metrics';
import { AppUserService } from './app.user.service';
import {
  createDashboardDerivedMetricsMissingState,
  DashboardDerivedMetricsService,
} from './dashboard-derived-metrics.service';
import { TrainingImpactService } from './training-impact.service';

describe('TrainingImpactService', () => {
  const viewer$ = new BehaviorSubject<any>({ uid: 'owner' });
  const users = { user$: viewer$.asObservable(), user: signal<any>({ uid: 'owner' }) };
  const derived = {
    watch: vi.fn(() => of(createDashboardDerivedMetricsMissingState())),
    ensureForDashboard: vi.fn(),
  };

  function service(): TrainingImpactService {
    TestBed.configureTestingModule({ providers: [
      TrainingImpactService,
      { provide: AppUserService, useValue: users },
      { provide: DashboardDerivedMetricsService, useValue: derived },
    ] });
    return TestBed.inject(TrainingImpactService);
  }

  it('does not read Form for a non-owner', () => {
    vi.clearAllMocks();
    viewer$.next({ uid: 'viewer' });
    const values: string[] = [];
    service().watch('owner').subscribe(state => values.push(state.status)).unsubscribe();
    expect(values).toEqual(['private']);
    expect(derived.watch).not.toHaveBeenCalled();
  });

  it('watches and ensures only the Form snapshot for the owner', () => {
    vi.clearAllMocks();
    viewer$.next({ uid: 'owner' });
    const state = {
      ...createDashboardDerivedMetricsMissingState(),
      formStatus: 'ready' as const,
      formPoints: [],
    };
    derived.watch.mockReturnValueOnce(of(state));
    const values: string[] = [];
    service().watch('owner').subscribe(value => values.push(value.status)).unsubscribe();
    expect(values).toEqual(['updating', 'ready']);
    expect(derived.watch).toHaveBeenCalledWith({ uid: 'owner' }, {
      metricKinds: [DERIVED_METRIC_KINDS.Form], reportReadErrors: true,
    });
    expect(derived.ensureForDashboard).toHaveBeenCalledWith({ uid: 'owner' }, state, {
      metricKinds: [DERIVED_METRIC_KINDS.Form],
    });
  });

  it('shares the owner Form listener and tears it down after the last subscriber', () => {
    vi.clearAllMocks();
    viewer$.next({ uid: 'owner' });
    const snapshots = new Subject<ReturnType<typeof createDashboardDerivedMetricsMissingState>>();
    derived.watch.mockReturnValueOnce(snapshots.asObservable());
    const instance = service();
    const first = instance.watch('owner').subscribe();
    const second = instance.watch('owner').subscribe();
    expect(derived.watch).toHaveBeenCalledTimes(1);
    expect(snapshots.observed).toBe(true);
    first.unsubscribe();
    expect(snapshots.observed).toBe(true);
    second.unsubscribe();
    expect(snapshots.observed).toBe(false);

    const third = instance.watch('owner').subscribe();
    expect(derived.watch).toHaveBeenCalledTimes(2);
    third.unsubscribe();
  });

  it('maps a failed Form snapshot to an error state', () => {
    vi.clearAllMocks();
    viewer$.next({ uid: 'owner' });
    derived.watch.mockReturnValueOnce(of({
      ...createDashboardDerivedMetricsMissingState(), formStatus: 'failed' as const,
    }));
    const values: string[] = [];
    service().watch('owner').subscribe(value => values.push(value.status)).unsubscribe();
    expect(values).toEqual(['updating', 'error']);
  });

  it.each(['stale', 'building'] as const)('keeps a %s Form snapshot in updating state', (formStatus) => {
    vi.clearAllMocks();
    viewer$.next({ uid: 'owner' });
    derived.watch.mockReturnValueOnce(of({
      ...createDashboardDerivedMetricsMissingState(),
      formStatus,
      formPoints: [{
        time: Date.UTC(2026, 0, 1), trainingStressScore: 42, ctl: 1, atl: 6,
        formSameDay: -5, formPriorDay: null,
      }],
    }));
    const values: Array<{ status: string; formPoints: unknown }> = [];
    service().watch('owner').subscribe(value => values.push(value)).unsubscribe();
    expect(values).toEqual([
      { status: 'updating', formPoints: null },
      { status: 'updating', formPoints: null },
    ]);
  });
});
