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
    expect(queries.loadMetricRange).toHaveBeenCalledWith('owner', expect.objectContaining({ startDate: '2026-09-10', endDate: '2026-09-10', includeSamples: false }), 30, expect.any(AbortSignal));
    expect(derived.watch).toHaveBeenCalledWith({ uid: 'owner' }, { metricKinds: [DERIVED_METRIC_KINDS.TrainingReadiness] });
    expect(result.hrvError).toBe(true);
    expect(result.sleepError).toBe(false);
    expect(result.derivedError).toBe(false);
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
    ] });
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
