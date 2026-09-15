import { TestBed } from '@angular/core/testing';
import { firstValueFrom, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardHealthService } from './dashboard-health.service';
import { HealthMetricQueryService } from './health-metric-query.service';

// Verify request boundaries here; projection/source semantics are covered by dashboard-health-context.
describe('dashboard Health read adapter', () => {
  const queries = {
    isOwner: vi.fn(), invalidated$: new Subject<string>(),
    loadMetricRange: vi.fn(), loadActivityRange: vi.fn(), loadSleepRange: vi.fn(),
  };
  beforeEach(() => {
    vi.clearAllMocks(); queries.isOwner.mockReturnValue(true);
    queries.loadMetricRange.mockResolvedValue(null);
    queries.loadActivityRange.mockResolvedValue(null);
    queries.loadSleepRange.mockResolvedValue([]);
    TestBed.configureTestingModule({ providers: [{ provide: HealthMetricQueryService, useValue: queries }] });
  });
  it('reads only the requested metric and bounded window', async () => {
    await firstValueFrom(TestBed.inject(DashboardHealthService).watch('owner', { metric: 'steps', range: '1y' }, '2026-09-15', 100));
    expect(queries.loadMetricRange).toHaveBeenCalledExactlyOnceWith('owner', {
      metricId: 'steps', startDate: '2025-09-16', endDate: '2026-09-15', includeSamples: false,
    }, 100, expect.any(AbortSignal));
    expect(queries.loadSleepRange).not.toHaveBeenCalled();
    expect(queries.loadActivityRange).not.toHaveBeenCalled();
  });
  it('loads the shared HRV context independently of the selected range', async () => {
    await firstValueFrom(TestBed.inject(DashboardHealthService).watch('owner', { metric: 'heart_rate_variability', range: '14d' }, '2026-09-15'));
    expect(queries.loadMetricRange.mock.calls.map(call => call[1])).toEqual([
      { metricId: 'heart_rate_variability', startDate: '2026-09-02', endDate: '2026-09-15', includeSamples: true },
      { metricId: 'heart_rate_variability', startDate: '2026-07-04', endDate: '2026-09-01', includeSamples: false },
    ]);
    expect(queries.loadSleepRange).toHaveBeenCalledTimes(1);
    expect(queries.loadActivityRange).not.toHaveBeenCalled();
  });
  it('retains workout evidence when the Health source fails', async () => {
    const activities = { observations: [], complete: false };
    queries.loadMetricRange.mockRejectedValue(Error('offline'));
    queries.loadActivityRange.mockResolvedValue(activities);
    const value = await firstValueFrom(TestBed.inject(DashboardHealthService).watch('owner', { metric: 'vo2_max', range: '30d' }, '2026-09-15'));
    expect(value.errors).toEqual(['Health readings']);
    expect(value.activities).toBe(activities);
    expect(value.health).toBeNull();
  });
  it('makes no private reads for a public dashboard', async () => {
    queries.isOwner.mockReturnValue(false);
    await expect(firstValueFrom(TestBed.inject(DashboardHealthService).watch('public-owner', { metric: 'steps', range: '30d' }))).rejects.toThrow('owner');
    expect(queries.loadMetricRange).not.toHaveBeenCalled();
    expect(queries.loadSleepRange).not.toHaveBeenCalled();
  });
  it('invalidates only the current owner and cancels reads when the preview closes', async () => {
    const service = TestBed.inject(DashboardHealthService);
    const subscription = service.watch('owner', { metric: 'steps', range: '30d' }).subscribe();
    await Promise.resolve(); await Promise.resolve();
    queries.invalidated$.next('someone-else');
    expect(queries.loadMetricRange).toHaveBeenCalledTimes(1);
    queries.invalidated$.next('owner');
    expect(queries.loadMetricRange).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
    expect(queries.loadMetricRange.mock.calls.every(call => call[3].aborted)).toBe(true);
  });
});
