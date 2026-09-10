import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom, Observable, of } from 'rxjs';
import { projectHealthRange } from '@shared/health-query';
import { AppHealthService } from './app.health.service';
import { AppSleepService } from './app.sleep.service';
import { DashboardHrvService } from './dashboard-hrv.service';

describe('read-only dashboard HRV data', () => {
  const health = { loadMetricRange: vi.fn() };
  const sleep = { watchForDashboard: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    health.loadMetricRange.mockImplementation(async (_uid, request) => ({ result: projectHealthRange([], [], { ...request, metricIds: [request.metricId] }) }));
    sleep.watchForDashboard.mockReturnValue(of([]));
    TestBed.configureTestingModule({ providers: [{ provide: AppHealthService, useValue: health }, { provide: AppSleepService, useValue: sleep }] });
  });
  it('reads the requested owner, visible range and 60-day context with no writes or sample query', async () => {
    const stream = TestBed.inject(DashboardHrvService).watch('owner', '1y', new Date(2026, 8, 10, 12).getTime());
    expect(health.loadMetricRange).not.toHaveBeenCalled();
    const context = await firstValueFrom(stream);
    expect(health.loadMetricRange.mock.calls).toEqual([
      ['owner', { metricId: 'heart_rate_variability', includeSamples: false, startDate: '2025-09-11', endDate: '2026-09-10' }],
      ['owner', { metricId: 'heart_rate_variability', includeSamples: false, startDate: '2025-07-13', endDate: '2025-09-10' }],
    ]);
    expect(sleep.watchForDashboard.mock.calls[0][0]).toBe('owner');
    expect(sleep.watchForDashboard.mock.calls[0][2]).toBe(context.window.endTimeMs);
    expect(context.charts).toEqual([]);
  });
  it('releases the sleep listener and rejects an incomplete baseline instead of inventing a range', async () => {
    const cleanup = vi.fn();
    sleep.watchForDashboard.mockReturnValue(new Observable(s => { s.next([]); return cleanup; }));
    health.loadMetricRange.mockResolvedValue({ limitReached: 'source_records' });
    await expect(firstValueFrom(TestBed.inject(DashboardHrvService).watch('owner'))).rejects.toThrow('incomplete');
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
