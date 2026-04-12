import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Firestore, doc, docData } from 'app/firebase/firestore';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  DERIVED_METRIC_KINDS,
  DERIVED_METRIC_SCHEMA_VERSION,
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

  const createMissingState = (): DashboardDerivedMetricsState => ({
    formPoints: null,
    recoveryNow: null,
    acwr: null,
    rampRate: null,
    monotonyStrain: null,
    formNow: null,
    formPlus7d: null,
    easyPercent: null,
    hardPercent: null,
    efficiencyDelta4w: null,
    freshnessForecast: null,
    intensityDistribution: null,
    efficiencyTrend: null,
    formStatus: 'missing',
    recoveryNowStatus: 'missing',
    acwrStatus: 'missing',
    rampRateStatus: 'missing',
    monotonyStrainStatus: 'missing',
    formNowStatus: 'missing',
    formPlus7dStatus: 'missing',
    easyPercentStatus: 'missing',
    hardPercentStatus: 'missing',
    efficiencyDelta4wStatus: 'missing',
    freshnessForecastStatus: 'missing',
    intensityDistributionStatus: 'missing',
    efficiencyTrendStatus: 'missing',
  });

  beforeEach(() => {
    hoisted.docMock.mockReset();
    hoisted.docDataMock.mockReset();
    hoisted.docDataMock.mockReturnValue(of(undefined));
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

    expect(state).toEqual<DashboardDerivedMetricsState>(createMissingState());
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
        schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
        payload: {
          dailyLoads: [
            { dayMs: Date.UTC(2026, 0, 1), load: 30 },
            { dayMs: Date.UTC(2026, 0, 3), load: 10 },
          ],
        },
      }))
      .mockReturnValueOnce(of({
        status: 'ready',
        schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
        payload: {
          totalSeconds: 5400,
          endTimeMs: Date.UTC(2026, 0, 3, 12, 0, 0),
          latestWorkoutSeconds: 3600,
          latestWorkoutEndTimeMs: Date.UTC(2026, 0, 3, 12, 0, 0),
          maxSupportedRecoverySeconds: 14 * 24 * 60 * 60,
          segments: [
            { totalSeconds: 1800, endTimeMs: Date.UTC(2026, 0, 2, 12, 0, 0) },
            { totalSeconds: 3600, endTimeMs: Date.UTC(2026, 0, 3, 12, 0, 0) },
          ],
        },
      }));

    const state = await firstValueFrom(service.watch({ uid }));

    expect(doc).toHaveBeenNthCalledWith(1, {}, 'users', uid, DERIVED_METRICS_COLLECTION_ID, getDerivedMetricDocId(DERIVED_METRIC_KINDS.Form));
    expect(doc).toHaveBeenNthCalledWith(2, {}, 'users', uid, DERIVED_METRICS_COLLECTION_ID, getDerivedMetricDocId(DERIVED_METRIC_KINDS.RecoveryNow));
    expect(doc).toHaveBeenCalledTimes(13);
    expect(state.formStatus).toBe('ready');
    expect(state.recoveryNowStatus).toBe('ready');
    expect(state.acwrStatus).toBe('missing');
    expect(state.rampRateStatus).toBe('missing');
    expect(state.monotonyStrainStatus).toBe('missing');
    expect(state.formNowStatus).toBe('missing');
    expect(state.formPlus7dStatus).toBe('missing');
    expect(state.easyPercentStatus).toBe('missing');
    expect(state.hardPercentStatus).toBe('missing');
    expect(state.efficiencyDelta4wStatus).toBe('missing');
    expect(state.freshnessForecastStatus).toBe('missing');
    expect(state.intensityDistributionStatus).toBe('missing');
    expect(state.efficiencyTrendStatus).toBe('missing');
    expect(state.formPoints?.map(point => point.time)).toEqual([
      Date.UTC(2026, 0, 1),
      Date.UTC(2026, 0, 2),
      Date.UTC(2026, 0, 3),
    ]);
    expect(state.formPoints?.map(point => point.trainingStressScore)).toEqual([30, 0, 10]);
    expect(state.recoveryNow).toEqual({
      totalSeconds: 5400,
      endTimeMs: Date.UTC(2026, 0, 3, 12, 0, 0),
      latestWorkoutSeconds: 3600,
      latestWorkoutEndTimeMs: Date.UTC(2026, 0, 3, 12, 0, 0),
      maxSupportedRecoverySeconds: 14 * 24 * 60 * 60,
      segments: [
        { totalSeconds: 1800, endTimeMs: Date.UTC(2026, 0, 2, 12, 0, 0) },
        { totalSeconds: 3600, endTimeMs: Date.UTC(2026, 0, 3, 12, 0, 0) },
      ],
    });
  });

  it('supports legacy tuple daily-load payloads for backward compatibility', async () => {
    const uid = 'user-1';
    const formDocRef = { path: `users/${uid}/${DERIVED_METRICS_COLLECTION_ID}/${getDerivedMetricDocId(DERIVED_METRIC_KINDS.Form)}` };
    const recoveryDocRef = { path: `users/${uid}/${DERIVED_METRICS_COLLECTION_ID}/${getDerivedMetricDocId(DERIVED_METRIC_KINDS.RecoveryNow)}` };

    hoisted.docMock
      .mockReturnValueOnce(formDocRef)
      .mockReturnValueOnce(recoveryDocRef);
    hoisted.docDataMock
      .mockReturnValueOnce(of({
        status: 'ready',
        schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
        payload: {
          dailyLoads: [
            [Date.UTC(2026, 0, 1), 20],
            [Date.UTC(2026, 0, 3), 5],
          ],
        },
      }))
      .mockReturnValueOnce(of(undefined));

    const state = await firstValueFrom(service.watch({ uid }));

    expect(state.formPoints?.map(point => point.trainingStressScore)).toEqual([20, 0, 5]);
    expect(state.recoveryNow).toBeNull();
  });

  it('marks ready snapshots with older schema versions as stale for self-heal', async () => {
    const uid = 'user-1';
    const formDocRef = { path: `users/${uid}/${DERIVED_METRICS_COLLECTION_ID}/${getDerivedMetricDocId(DERIVED_METRIC_KINDS.Form)}` };
    const recoveryDocRef = { path: `users/${uid}/${DERIVED_METRICS_COLLECTION_ID}/${getDerivedMetricDocId(DERIVED_METRIC_KINDS.RecoveryNow)}` };

    hoisted.docMock
      .mockReturnValueOnce(formDocRef)
      .mockReturnValueOnce(recoveryDocRef);
    hoisted.docDataMock
      .mockReturnValueOnce(of({
        status: 'ready',
        schemaVersion: DERIVED_METRIC_SCHEMA_VERSION - 1,
        payload: {
          dailyLoads: [
            { dayMs: Date.UTC(2026, 0, 1), load: 30 },
          ],
        },
      }))
      .mockReturnValueOnce(of({
        status: 'ready',
        schemaVersion: DERIVED_METRIC_SCHEMA_VERSION - 1,
        payload: {
          totalSeconds: 5400,
          endTimeMs: Date.UTC(2026, 0, 3, 12, 0, 0),
        },
      }));

    const state = await firstValueFrom(service.watch({ uid }));

    expect(state.formStatus).toBe('stale');
    expect(state.recoveryNowStatus).toBe('stale');

    service.ensureForDashboard({ uid }, state);
    expect(mockFunctionsService.call).toHaveBeenCalledWith<EnsureDerivedMetricsRequest, unknown>('ensureDerivedMetrics', {
      metricKinds: [
        DERIVED_METRIC_KINDS.Form,
        DERIVED_METRIC_KINDS.RecoveryNow,
        DERIVED_METRIC_KINDS.Acwr,
        DERIVED_METRIC_KINDS.RampRate,
        DERIVED_METRIC_KINDS.MonotonyStrain,
        DERIVED_METRIC_KINDS.FormNow,
        DERIVED_METRIC_KINDS.FormPlus7d,
        DERIVED_METRIC_KINDS.EasyPercent,
        DERIVED_METRIC_KINDS.HardPercent,
        DERIVED_METRIC_KINDS.EfficiencyDelta4w,
        DERIVED_METRIC_KINDS.FreshnessForecast,
        DERIVED_METRIC_KINDS.IntensityDistribution,
        DERIVED_METRIC_KINDS.EfficiencyTrend,
      ],
    });
  });

  it('requests missing derived metrics once while a request is in flight', async () => {
    let resolveCall: ((value?: unknown) => void) | null = null;
    mockFunctionsService.call.mockImplementation(() => new Promise((resolve) => {
      resolveCall = resolve;
    }));

    const state: DashboardDerivedMetricsState = {
      ...createMissingState(),
      recoveryNowStatus: 'failed',
    };

    service.ensureForDashboard({ uid: 'user-1' }, state);
    service.ensureForDashboard({ uid: 'user-1' }, state);

    expect(mockFunctionsService.call).toHaveBeenCalledTimes(1);
    expect(mockFunctionsService.call).toHaveBeenCalledWith<EnsureDerivedMetricsRequest, unknown>('ensureDerivedMetrics', {
      metricKinds: [
        DERIVED_METRIC_KINDS.Form,
        DERIVED_METRIC_KINDS.RecoveryNow,
        DERIVED_METRIC_KINDS.Acwr,
        DERIVED_METRIC_KINDS.RampRate,
        DERIVED_METRIC_KINDS.MonotonyStrain,
        DERIVED_METRIC_KINDS.FormNow,
        DERIVED_METRIC_KINDS.FormPlus7d,
        DERIVED_METRIC_KINDS.EasyPercent,
        DERIVED_METRIC_KINDS.HardPercent,
        DERIVED_METRIC_KINDS.EfficiencyDelta4w,
        DERIVED_METRIC_KINDS.FreshnessForecast,
        DERIVED_METRIC_KINDS.IntensityDistribution,
        DERIVED_METRIC_KINDS.EfficiencyTrend,
      ],
    });

    resolveCall?.(null);
    await Promise.resolve();
  });

  it('does not request ensure when both metric snapshots are ready', () => {
    const state: DashboardDerivedMetricsState = {
      ...createMissingState(),
      formPoints: [],
      recoveryNow: { totalSeconds: 1, endTimeMs: 1 },
      formStatus: 'ready',
      recoveryNowStatus: 'ready',
      acwrStatus: 'ready',
      rampRateStatus: 'ready',
      monotonyStrainStatus: 'ready',
      formNowStatus: 'ready',
      formPlus7dStatus: 'ready',
      easyPercentStatus: 'ready',
      hardPercentStatus: 'ready',
      efficiencyDelta4wStatus: 'ready',
      freshnessForecastStatus: 'ready',
      intensityDistributionStatus: 'ready',
      efficiencyTrendStatus: 'ready',
    };

    service.ensureForDashboard({ uid: 'user-1' }, state);

    expect(mockFunctionsService.call).not.toHaveBeenCalled();
  });

  it('treats stale snapshots as ensure-required', () => {
    const state: DashboardDerivedMetricsState = {
      ...createMissingState(),
      formStatus: 'stale',
      recoveryNowStatus: 'ready',
      acwrStatus: 'ready',
      rampRateStatus: 'ready',
      monotonyStrainStatus: 'ready',
      formNowStatus: 'ready',
      formPlus7dStatus: 'ready',
      easyPercentStatus: 'ready',
      hardPercentStatus: 'ready',
      efficiencyDelta4wStatus: 'ready',
      freshnessForecastStatus: 'ready',
      intensityDistributionStatus: 'ready',
      efficiencyTrendStatus: 'ready',
    };

    service.ensureForDashboard({ uid: 'user-1' }, state);

    expect(mockFunctionsService.call).toHaveBeenCalledTimes(1);
    expect(mockFunctionsService.call).toHaveBeenCalledWith<EnsureDerivedMetricsRequest, unknown>('ensureDerivedMetrics', {
      metricKinds: [DERIVED_METRIC_KINDS.Form],
    });
  });

  it('bypasses cooldown when force is requested', async () => {
    const state: DashboardDerivedMetricsState = {
      ...createMissingState(),
      recoveryNowStatus: 'ready',
      acwrStatus: 'ready',
      rampRateStatus: 'ready',
      monotonyStrainStatus: 'ready',
      formNowStatus: 'ready',
      formPlus7dStatus: 'ready',
      easyPercentStatus: 'ready',
      hardPercentStatus: 'ready',
      efficiencyDelta4wStatus: 'ready',
      freshnessForecastStatus: 'ready',
      intensityDistributionStatus: 'ready',
      efficiencyTrendStatus: 'ready',
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
      ...createMissingState(),
      recoveryNowStatus: 'ready',
      acwrStatus: 'ready',
      rampRateStatus: 'ready',
      monotonyStrainStatus: 'ready',
      formNowStatus: 'ready',
      formPlus7dStatus: 'ready',
      easyPercentStatus: 'ready',
      hardPercentStatus: 'ready',
      efficiencyDelta4wStatus: 'ready',
      freshnessForecastStatus: 'ready',
      intensityDistributionStatus: 'ready',
      efficiencyTrendStatus: 'ready',
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
      ...createMissingState(),
      recoveryNowStatus: 'ready',
      acwrStatus: 'ready',
      rampRateStatus: 'ready',
      monotonyStrainStatus: 'ready',
      formNowStatus: 'ready',
      formPlus7dStatus: 'ready',
      easyPercentStatus: 'ready',
      hardPercentStatus: 'ready',
      efficiencyDelta4wStatus: 'ready',
      freshnessForecastStatus: 'ready',
      intensityDistributionStatus: 'ready',
      efficiencyTrendStatus: 'ready',
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
      ...createMissingState(),
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
