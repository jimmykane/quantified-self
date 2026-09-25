import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { CalendarDayHealthService } from './calendar-day-health.service';
import { HealthMetricQueryService } from './health-metric-query.service';
import { DashboardDerivedMetricsService } from './dashboard-derived-metrics.service';
import { DERIVED_METRIC_KINDS } from '@shared/derived-metrics';
import { buildDashboardReadinessSleepQueryWindow } from '../helpers/dashboard-training-insights.helper';

describe('CalendarDayHealthService', () => {
  const queries = {
    isOwner: vi.fn(() => true),
    loadSleepRange: vi.fn().mockResolvedValue([]),
    loadMetricRange: vi.fn().mockRejectedValue(new Error('HRV offline')),
  };
  const derived = { watch: vi.fn(() => of({ trainingReadinessStatus: 'missing' })) };
  const service = () => {
    TestBed.configureTestingModule({ providers: [
      { provide: HealthMetricQueryService, useValue: queries },
      { provide: DashboardDerivedMetricsService, useValue: derived },
    ] });
    return TestBed.inject(CalendarDayHealthService);
  };
  it('reads only the selected historical date and keeps partial source failure separate', async () => {
    vi.clearAllMocks();
    const result = await service().load('owner', '2026-09-10', new Date('2026-09-15T12:00:00').getTime(), new AbortController().signal);
    expect(queries.loadMetricRange).toHaveBeenCalledWith('owner', expect.objectContaining({ startDate: '2026-09-10', endDate: '2026-09-10', includeSamples: true }), 30, expect.any(AbortSignal));
    expect(derived.watch).toHaveBeenCalledWith({ uid: 'owner' }, { metricKinds: [DERIVED_METRIC_KINDS.TrainingReadiness], reportReadErrors: true });
    expect(result.hrvError).toBe(true);
    expect(result.sleepError).toBe(false);
    expect(result.readinessError).toBe(false);
  });
  it('keeps date-matched Sleep HRV available when the all-day HRV source fails', async () => {
    vi.clearAllMocks();
    queries.loadSleepRange.mockResolvedValueOnce([{
      id: 'night', sleepDate: '2026-09-10', startTimeMs: new Date(2026, 8, 9, 23).getTime(),
      endTimeMs: new Date(2026, 8, 10, 7).getTime(), durationSeconds: 8 * 3600,
      source: { provider: 'SuuntoApp' }, vitals: { averageHrvMs: 34 },
    }]);
    const result = await service().load('owner', '2026-09-10', new Date(2026, 8, 15, 12).getTime(), new AbortController().signal);
    expect(result.hrvError).toBe(true);
    expect(result.hrvSeries.some(series => series.points.some(point => point.calendarDate === '2026-09-10' && point.value === 34))).toBe(true);
  });
  it('uses the same bounded sleep window as Today for current readiness', async () => {
    vi.clearAllMocks();
    const nowMs = new Date(2026, 8, 15, 12).getTime();
    await service().load('owner', '2026-09-15', nowMs, new AbortController().signal);
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
    const today = await instance.load('owner', '2026-09-15', new Date(2026, 8, 15, 12).getTime(), new AbortController().signal);
    expect(today.readinessError).toBe(false);
    expect(today.recoveryError).toBe(true);
    derived.watch.mockReturnValueOnce(of({ trainingReadinessStatus: 'failed' }));
    const past = await instance.load('owner', '2026-09-10', new Date(2026, 8, 15, 12).getTime(), new AbortController().signal);
    expect(past.readinessError).toBe(true);
    expect(past.recoveryError).toBe(false);
  });
  it('starts a historical sleep window at the previous local midnight across daylight-saving changes', async () => {
    vi.clearAllMocks();
    await service().load('owner', '2026-10-26', new Date(2026, 9, 28, 12).getTime(), new AbortController().signal);
    expect(queries.loadSleepRange).toHaveBeenCalledWith('owner',
      new Date(2026, 9, 25).getTime(), new Date(2026, 9, 27).getTime(), 30, expect.any(AbortSignal));
  });
  it('rejects non-owners and invalid dates before starting a read', async () => {
    vi.clearAllMocks();
    const instance = service();
    queries.isOwner.mockReturnValueOnce(false);
    await expect(instance.load('other', '2026-09-10', Date.now(), new AbortController().signal)).rejects.toThrow('owner-only');
    await expect(instance.load('owner', '2026-02-30', Date.now(), new AbortController().signal)).rejects.toThrow('Invalid calendar date');
    expect(queries.loadSleepRange).not.toHaveBeenCalled();
  });
});
