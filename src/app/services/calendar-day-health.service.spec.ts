import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { CalendarDayHealthService } from './calendar-day-health.service';
import { HealthMetricQueryService } from './health-metric-query.service';
import { DashboardDerivedMetricsService, createDashboardDerivedMetricsMissingState } from './dashboard-derived-metrics.service';
import { DERIVED_METRIC_KINDS } from '@shared/derived-metrics';
import { buildDashboardReadinessSleepQueryWindow } from '../helpers/dashboard-training-insights.helper';
import { buildCalendarDayHealthSummary } from '../helpers/calendar-day-health.helper';

describe('CalendarDayHealthService', () => {
  const queries = {
    isOwner: vi.fn(() => true),
    loadSleepRange: vi.fn().mockResolvedValue([]),
    loadMetricRange: vi.fn().mockRejectedValue(new Error('HRV offline')),
  };
  const derived = { watch: vi.fn(() => of({ trainingReadinessStatus: 'missing' })), ensureForDashboard: vi.fn() };
  const service = () => {
    TestBed.configureTestingModule({ providers: [
      { provide: HealthMetricQueryService, useValue: queries },
      { provide: DashboardDerivedMetricsService, useValue: derived },
    ] });
    return TestBed.inject(CalendarDayHealthService);
  };
  const read = (instance: CalendarDayHealthService, ...args: Parameters<CalendarDayHealthService['watch']>) =>
    firstValueFrom(instance.watch(...args));
  it('reads only the selected historical date and keeps partial source failure separate', async () => {
    vi.clearAllMocks();
    const result = await read(service(), 'owner', '2026-09-10', new Date('2026-09-15T12:00:00').getTime(), new AbortController().signal);
    expect(queries.loadMetricRange).toHaveBeenCalledWith('owner', expect.objectContaining({ startDate: '2026-09-10', endDate: '2026-09-10', includeSamples: true }), 30, expect.any(AbortSignal));
    expect(derived.watch).toHaveBeenCalledWith({ uid: 'owner' }, { metricKinds: [DERIVED_METRIC_KINDS.TrainingReadiness], reportReadErrors: true });
    expect(derived.ensureForDashboard).toHaveBeenCalledWith({ uid: 'owner' }, expect.anything(), {
      metricKinds: [DERIVED_METRIC_KINDS.TrainingReadiness],
    });
    expect(result.hrvError).toBe(true);
    expect(result.sleepError).toBe(false);
    expect(result.readinessError).toBe(false);
  });
  it('keeps date-matched Sleep HRV available when the all-day HRV source fails', async () => {
    vi.clearAllMocks();
    queries.loadSleepRange.mockResolvedValueOnce([{
      id: 'night', sleepDate: '2026-09-10', startTimeMs: new Date(2026, 8, 9, 23).getTime(),
      endTimeMs: new Date(2026, 8, 10, 7).getTime(), durationSeconds: 8 * 3600,
      source: { provider: 'SuuntoApp', providerUserId: 'suunto-owner', sourceSessionKey: 'night' },
      vitals: { averageHrvMs: 34 },
    }]);
    const result = await read(service(), 'owner', '2026-09-10', new Date(2026, 8, 15, 12).getTime(), new AbortController().signal);
    expect(result.hrvError).toBe(true);
    expect(result.hrvSeries.some(series => series.points.some(point => point.calendarDate === '2026-09-10' && point.value === 34))).toBe(true);
  });
  it('uses the same bounded sleep window as Today for current readiness', async () => {
    vi.clearAllMocks();
    const nowMs = new Date(2026, 8, 15, 12).getTime();
    await read(service(), 'owner', '2026-09-15', nowMs, new AbortController().signal);
    const window = buildDashboardReadinessSleepQueryWindow(nowMs);
    expect(queries.loadSleepRange).toHaveBeenCalledWith('owner', window.startMs, window.endMs, 30, expect.any(AbortSignal));
    expect(derived.watch).toHaveBeenCalledWith({ uid: 'owner' }, { metricKinds: [
      DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.FormNow,
      DERIVED_METRIC_KINDS.RampRate, DERIVED_METRIC_KINDS.RecoveryNow,
    ], reportReadErrors: true });
  });
  it('reports readiness and recovery snapshot failures independently', async () => {
    vi.clearAllMocks();
    const instance = service();
    derived.watch.mockReturnValueOnce(of({ formStatus: 'ready', formNowStatus: 'ready', rampRateStatus: 'ready', recoveryNowStatus: 'failed' }));
    const today = await read(instance, 'owner', '2026-09-15', new Date(2026, 8, 15, 12).getTime(), new AbortController().signal);
    expect(today.readinessError).toBe(false);
    expect(today.recoveryError).toBe(true);
    derived.watch.mockReturnValueOnce(of({ trainingReadinessStatus: 'failed' }));
    const past = await read(instance, 'owner', '2026-09-10', new Date(2026, 8, 15, 12).getTime(), new AbortController().signal);
    expect(past.readinessError).toBe(true);
    expect(past.recoveryError).toBe(false);
  });
  it('starts a historical sleep window at the previous local midnight across daylight-saving changes', async () => {
    vi.clearAllMocks();
    await read(service(), 'owner', '2026-10-26', new Date(2026, 9, 28, 12).getTime(), new AbortController().signal);
    expect(queries.loadSleepRange).toHaveBeenCalledWith('owner',
      new Date(2026, 9, 25).getTime(), new Date(2026, 9, 27).getTime(), 30, expect.any(AbortSignal));
  });
  it('rejects non-owners and invalid dates before starting a read', async () => {
    vi.clearAllMocks();
    const instance = service();
    queries.isOwner.mockReturnValueOnce(false);
    await expect(read(instance, 'other', '2026-09-10', Date.now(), new AbortController().signal)).rejects.toThrow('owner-only');
    await expect(read(instance, 'owner', '2026-02-30', Date.now(), new AbortController().signal)).rejects.toThrow('Invalid calendar date');
    expect(queries.loadSleepRange).not.toHaveBeenCalled();
    expect(derived.ensureForDashboard).not.toHaveBeenCalled();
  });
  it('requests one scoped refresh for stale readiness and never repeats it on snapshot updates', async () => {
    vi.clearAllMocks();
    const snapshots = new Subject<ReturnType<typeof createDashboardDerivedMetricsMissingState>>();
    derived.watch.mockReturnValueOnce(snapshots.asObservable());
    const controller = new AbortController();
    const subscription = service().watch('owner', '2026-09-10', new Date(2026, 8, 15, 12).getTime(), controller.signal).subscribe();
    for (const status of ['stale', 'queued', 'building', 'ready', 'stale'] as const) {
      snapshots.next({ ...createDashboardDerivedMetricsMissingState(), trainingReadinessStatus: status });
    }
    expect(derived.ensureForDashboard).toHaveBeenCalledTimes(1);
    expect(derived.ensureForDashboard).toHaveBeenCalledWith({ uid: 'owner' }, expect.objectContaining({ trainingReadinessStatus: 'stale' }), {
      metricKinds: [DERIVED_METRIC_KINDS.TrainingReadiness],
    });
    controller.abort();
    expect(snapshots.observed).toBe(false);
    subscription.unsubscribe();
  });
  it('does not rebuild unsupported dates, healthy or pending snapshots, or failed reads', async () => {
    vi.clearAllMocks();
    const instance = service();
    const now = new Date(2026, 8, 15, 12).getTime();
    for (const dateKey of ['2026-08-01', '2026-09-16']) {
      await read(instance, 'owner', dateKey, now, new AbortController().signal);
    }
    for (const status of ['ready', 'queued', 'building', 'failed'] as const) {
      derived.watch.mockReturnValueOnce(of({ trainingReadinessStatus: status }));
      await read(instance, 'owner', '2026-09-10', now, new AbortController().signal);
    }
    expect(derived.ensureForDashboard).not.toHaveBeenCalled();
  });
  it('does not refresh after cancellation or an account change', async () => {
    vi.clearAllMocks();
    const instance = service();
    const controller = new AbortController();
    controller.abort();
    await expect(read(instance, 'owner', '2026-09-10', Date.now(), controller.signal)).rejects.toThrow('cancelled');
    expect(derived.watch).not.toHaveBeenCalled();
    const snapshots = new Subject<ReturnType<typeof createDashboardDerivedMetricsMissingState>>();
    derived.watch.mockReturnValueOnce(snapshots.asObservable());
    const subscription = instance.watch('owner', '2026-09-10', new Date(2026, 8, 15, 12).getTime(), new AbortController().signal)
      .subscribe({ error: () => undefined });
    queries.isOwner.mockReturnValueOnce(false);
    snapshots.next(createDashboardDerivedMetricsMissingState());
    expect(derived.ensureForDashboard).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });
  it('checks cancellation and ownership again before a deferred subscription starts private reads', async () => {
    vi.clearAllMocks();
    const instance = service();
    const controller = new AbortController();
    const cancelled$ = instance.watch('owner', '2026-09-10', Date.now(), controller.signal);
    controller.abort();
    await expect(firstValueFrom(cancelled$)).rejects.toThrow('cancelled');
    const switched$ = instance.watch('owner', '2026-09-10', Date.now(), new AbortController().signal);
    queries.isOwner.mockReturnValueOnce(false);
    await expect(firstValueFrom(switched$)).rejects.toThrow('cancelled');
    expect(queries.loadSleepRange).not.toHaveBeenCalled();
    expect(queries.loadMetricRange).not.toHaveBeenCalled();
    expect(derived.watch).not.toHaveBeenCalled();
    expect(derived.ensureForDashboard).not.toHaveBeenCalled();
  });
  it('requests only the current load and recovery scope for a stale today selection', async () => {
    vi.clearAllMocks();
    const state = { ...createDashboardDerivedMetricsMissingState(), formStatus: 'stale' as const };
    derived.watch.mockReturnValueOnce(of(state));
    await read(service(), 'owner', '2026-09-15', new Date(2026, 8, 15, 12).getTime(), new AbortController().signal);
    expect(derived.ensureForDashboard).toHaveBeenCalledOnce();
    expect(derived.ensureForDashboard).toHaveBeenCalledWith({ uid: 'owner' }, state, {
      metricKinds: [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.FormNow, DERIVED_METRIC_KINDS.RampRate, DERIVED_METRIC_KINDS.RecoveryNow],
    });
  });
  it('updates readiness without repeating the bounded Sleep and HRV reads', async () => {
    vi.clearAllMocks();
    const snapshots = new Subject<ReturnType<typeof createDashboardDerivedMetricsMissingState>>();
    derived.watch.mockReturnValueOnce(snapshots.asObservable());
    const values: string[] = [];
    const subscription = service().watch('owner', '2026-09-10', new Date(2026, 8, 15, 12).getTime(), new AbortController().signal)
      .subscribe(value => {
        const readiness = buildCalendarDayHealthSummary('2026-09-10', value, {
          nowMs: new Date(2026, 8, 15, 12).getTime(),
        }).readiness;
        values.push(`${readiness.status}:${readiness.value}`);
      });
    snapshots.next({ ...createDashboardDerivedMetricsMissingState(), trainingReadinessStatus: 'building' });
    await vi.waitFor(() => expect(values).toEqual(['updating:—']));
    snapshots.next({ ...createDashboardDerivedMetricsMissingState(), trainingReadinessStatus: 'ready',
      trainingReadiness: { points: [{ dayMs: Date.UTC(2026, 8, 10), score: 67, label: 'Mixed' }] } as ReturnType<typeof createDashboardDerivedMetricsMissingState>['trainingReadiness'],
    });
    expect(values).toEqual(['updating:—', 'ready:Mixed 67/100']);
    expect(queries.loadSleepRange).toHaveBeenCalledTimes(1);
    expect(queries.loadMetricRange).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
    expect(snapshots.observed).toBe(false);
  });

  it('delivers sleep evidence before a delayed derived-metrics snapshot', async () => {
    vi.clearAllMocks();
    const snapshots = new Subject<ReturnType<typeof createDashboardDerivedMetricsMissingState>>();
    derived.watch.mockReturnValueOnce(snapshots.asObservable());
    queries.loadSleepRange.mockResolvedValueOnce([{
      id: 'night', sleepDate: '2026-09-10', startTimeMs: new Date(2026, 8, 9, 23).getTime(),
      endTimeMs: new Date(2026, 8, 10, 7).getTime(), durationSeconds: 8 * 3600,
      score: { value: 74 }, source: { provider: 'SuuntoApp' },
    }]);
    const values: Array<{ pending: boolean; sleep: string; readiness: string }> = [];
    const subscription = service().watch('owner', '2026-09-10', new Date(2026, 8, 15, 12).getTime(), new AbortController().signal)
      .subscribe(evidence => {
        const summary = buildCalendarDayHealthSummary('2026-09-10', evidence, { nowMs: new Date(2026, 8, 15, 12).getTime() });
        values.push({ pending: evidence.derivedPending === true, sleep: summary.sleep.value, readiness: summary.readiness.status });
      });
    await vi.waitFor(() => expect(values).toEqual([{ pending: true, sleep: '74/100', readiness: 'updating' }]));
    snapshots.next(createDashboardDerivedMetricsMissingState());
    expect(values).toHaveLength(2);
    expect(values[1].pending).toBe(false);
    expect(queries.loadSleepRange).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
  });
});
