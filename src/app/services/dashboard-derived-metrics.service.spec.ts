import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Firestore, doc, docData } from 'app/firebase/firestore';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  DERIVED_METRIC_KINDS,
  DERIVED_METRICS_COLLECTION_ID,
  getDerivedMetricDocId,
  type EnsureDerivedMetricsRequest,
} from '@shared/derived-metrics';
import { AppFunctionsService } from './app.functions.service';
import {
  DashboardDerivedMetricsService,
  type DashboardDerivedMetricsState,
} from './dashboard-derived-metrics.service';

const hoisted = vi.hoisted(() => ({
  docMock: vi.fn(),
  docDataMock: vi.fn(),
}));

vi.mock('app/firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/firebase/firestore')>();
  class MockFirestore {}
  return {
    ...actual,
    Firestore: MockFirestore,
    doc: hoisted.docMock,
    docData: hoisted.docDataMock,
  };
});

describe('DashboardDerivedMetricsService', () => {
  let service: DashboardDerivedMetricsService;
  let mockFunctionsService: { call: ReturnType<typeof vi.fn> };
  let mockSnackBar: { open: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    hoisted.docMock.mockReset();
    hoisted.docDataMock.mockReset();
    mockFunctionsService = {
      call: vi.fn().mockResolvedValue({ data: { accepted: true } }),
    };
    mockSnackBar = {
      open: vi.fn().mockReturnValue({
        onAction: () => of(void 0),
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        DashboardDerivedMetricsService,
        { provide: Firestore, useValue: {} },
        { provide: AppFunctionsService, useValue: mockFunctionsService },
        { provide: MatSnackBar, useValue: mockSnackBar },
      ],
    });

    service = TestBed.inject(DashboardDerivedMetricsService);
  });

  it('returns missing snapshot state when uid is not available', async () => {
    const state = await firstValueFrom(service.watch(null));

    expect(state).toEqual<DashboardDerivedMetricsState>({
      formPoints: null,
      recoveryNow: null,
      formStatus: 'missing',
      recoveryNowStatus: 'missing',
    });
    expect(doc).not.toHaveBeenCalled();
    expect(docData).not.toHaveBeenCalled();
  });

  it('maps derived snapshots to form points and recovery-now context', async () => {
    const uid = 'user-1';
    const formDocRef = { path: `users/${uid}/${DERIVED_METRICS_COLLECTION_ID}/${getDerivedMetricDocId(DERIVED_METRIC_KINDS.Form)}` };
    const recoveryDocRef = { path: `users/${uid}/${DERIVED_METRICS_COLLECTION_ID}/${getDerivedMetricDocId(DERIVED_METRIC_KINDS.RecoveryNow)}` };

    hoisted.docMock
      .mockReturnValueOnce(formDocRef)
      .mockReturnValueOnce(recoveryDocRef);
    hoisted.docDataMock
      .mockReturnValueOnce(of({
        status: 'ready',
        payload: {
          dailyLoads: [
            [Date.UTC(2026, 0, 1), 30],
            [Date.UTC(2026, 0, 3), 10],
          ],
        },
      }))
      .mockReturnValueOnce(of({
        status: 'ready',
        payload: {
          totalSeconds: 5400,
          endTimeMs: Date.UTC(2026, 0, 3, 12, 0, 0),
          segments: [
            { totalSeconds: 1800, endTimeMs: Date.UTC(2026, 0, 2, 12, 0, 0) },
            { totalSeconds: 3600, endTimeMs: Date.UTC(2026, 0, 3, 12, 0, 0) },
          ],
        },
      }));

    const state = await firstValueFrom(service.watch({ uid }));

    expect(doc).toHaveBeenNthCalledWith(1, {}, 'users', uid, DERIVED_METRICS_COLLECTION_ID, getDerivedMetricDocId(DERIVED_METRIC_KINDS.Form));
    expect(doc).toHaveBeenNthCalledWith(2, {}, 'users', uid, DERIVED_METRICS_COLLECTION_ID, getDerivedMetricDocId(DERIVED_METRIC_KINDS.RecoveryNow));
    expect(state.formStatus).toBe('ready');
    expect(state.recoveryNowStatus).toBe('ready');
    expect(state.formPoints?.map(point => point.time)).toEqual([
      Date.UTC(2026, 0, 1),
      Date.UTC(2026, 0, 2),
      Date.UTC(2026, 0, 3),
    ]);
    expect(state.formPoints?.map(point => point.trainingStressScore)).toEqual([30, 0, 10]);
    expect(state.recoveryNow).toEqual({
      totalSeconds: 5400,
      endTimeMs: Date.UTC(2026, 0, 3, 12, 0, 0),
      segments: [
        { totalSeconds: 1800, endTimeMs: Date.UTC(2026, 0, 2, 12, 0, 0) },
        { totalSeconds: 3600, endTimeMs: Date.UTC(2026, 0, 3, 12, 0, 0) },
      ],
    });
  });

  it('requests missing derived metrics once while a request is in flight', async () => {
    let resolveCall: ((value?: unknown) => void) | null = null;
    mockFunctionsService.call.mockImplementation(() => new Promise((resolve) => {
      resolveCall = resolve;
    }));

    const state: DashboardDerivedMetricsState = {
      formPoints: null,
      recoveryNow: null,
      formStatus: 'missing',
      recoveryNowStatus: 'failed',
    };

    service.ensureForDashboard({ uid: 'user-1' }, state);
    service.ensureForDashboard({ uid: 'user-1' }, state);

    expect(mockFunctionsService.call).toHaveBeenCalledTimes(1);
    expect(mockFunctionsService.call).toHaveBeenCalledWith<EnsureDerivedMetricsRequest, unknown>('ensureDerivedMetrics', {
      metricKinds: [DERIVED_METRIC_KINDS.Form, DERIVED_METRIC_KINDS.RecoveryNow],
    });

    resolveCall?.(null);
    await Promise.resolve();
  });

  it('does not request ensure when both metric snapshots are ready', () => {
    const state: DashboardDerivedMetricsState = {
      formPoints: [],
      recoveryNow: { totalSeconds: 1, endTimeMs: 1 },
      formStatus: 'ready',
      recoveryNowStatus: 'ready',
    };

    service.ensureForDashboard({ uid: 'user-1' }, state);

    expect(mockFunctionsService.call).not.toHaveBeenCalled();
  });

  it('treats stale snapshots as ensure-required', () => {
    const state: DashboardDerivedMetricsState = {
      formPoints: null,
      recoveryNow: null,
      formStatus: 'stale',
      recoveryNowStatus: 'ready',
    };

    service.ensureForDashboard({ uid: 'user-1' }, state);

    expect(mockFunctionsService.call).toHaveBeenCalledTimes(1);
    expect(mockFunctionsService.call).toHaveBeenCalledWith<EnsureDerivedMetricsRequest, unknown>('ensureDerivedMetrics', {
      metricKinds: [DERIVED_METRIC_KINDS.Form],
    });
  });

  it('bypasses cooldown when force is requested', async () => {
    const state: DashboardDerivedMetricsState = {
      formPoints: null,
      recoveryNow: null,
      formStatus: 'missing',
      recoveryNowStatus: 'ready',
    };

    service.ensureForDashboard({ uid: 'user-1' }, state);
    await Promise.resolve();
    service.ensureForDashboard({ uid: 'user-1' }, state);
    service.ensureForDashboard({ uid: 'user-1' }, state, { force: true });

    expect(mockFunctionsService.call).toHaveBeenCalledTimes(2);
  });

  it('does not show a snackbar on the first transient ensure failure', async () => {
    mockFunctionsService.call.mockRejectedValue(new Error('ensure failed'));

    const state: DashboardDerivedMetricsState = {
      formPoints: null,
      recoveryNow: null,
      formStatus: 'missing',
      recoveryNowStatus: 'ready',
    };

    service.ensureForDashboard({ uid: 'user-1' }, state);
    await Promise.resolve();

    expect(mockSnackBar.open).not.toHaveBeenCalled();
  });

  it('shows a snackbar after repeated ensure failures and retries on action', async () => {
    const retryAction$ = new Subject<void>();
    mockSnackBar.open.mockReturnValue({
      onAction: () => retryAction$.asObservable(),
    });
    mockFunctionsService.call.mockRejectedValue(new Error('ensure failed'));

    const state: DashboardDerivedMetricsState = {
      formPoints: null,
      recoveryNow: null,
      formStatus: 'missing',
      recoveryNowStatus: 'ready',
    };

    service.ensureForDashboard({ uid: 'user-1' }, state);
    await Promise.resolve();
    service.ensureForDashboard({ uid: 'user-1' }, state, { force: true });
    await Promise.resolve();

    expect(mockSnackBar.open).toHaveBeenCalledWith(
      'Could not refresh dashboard derived metrics. Showing last known values.',
      'Retry',
      { duration: 7000 },
    );
    expect(mockFunctionsService.call).toHaveBeenCalledTimes(2);

    retryAction$.next();
    await Promise.resolve();
    expect(mockFunctionsService.call).toHaveBeenCalledTimes(3);
  });

  it('resets failure streak after a successful ensure call', async () => {
    mockFunctionsService.call
      .mockRejectedValueOnce(new Error('first failure'))
      .mockResolvedValueOnce({ data: { accepted: true } })
      .mockRejectedValueOnce(new Error('third call failure'));

    const state: DashboardDerivedMetricsState = {
      formPoints: null,
      recoveryNow: null,
      formStatus: 'missing',
      recoveryNowStatus: 'ready',
    };

    service.ensureForDashboard({ uid: 'user-1' }, state);
    await Promise.resolve();
    service.ensureForDashboard({ uid: 'user-1' }, state, { force: true });
    await Promise.resolve();
    service.ensureForDashboard({ uid: 'user-1' }, state, { force: true });
    await Promise.resolve();

    expect(mockSnackBar.open).not.toHaveBeenCalled();
  });
});
