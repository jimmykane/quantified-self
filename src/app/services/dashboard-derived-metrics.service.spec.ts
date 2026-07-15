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
  TRAINING_WORKSPACE_DERIVED_METRIC_KINDS,
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
    trainingSummary: null,
    trainingBuildComparison: null,
    trainingCapacity: null,
    trainingExplanation: null,
    trainingDurability: null,
    powerCurve: null,
    trainingSwimPerformance: null,
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
    trainingSummaryStatus: 'missing',
    trainingBuildComparisonStatus: 'missing',
    trainingCapacityStatus: 'missing',
    trainingExplanationStatus: 'missing',
    trainingDurabilityStatus: 'missing',
    powerCurveStatus: 'missing',
    trainingSwimPerformanceStatus: 'missing',
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
    expect(doc).toHaveBeenCalledTimes(15);
    expect(hoisted.docMock.mock.calls.some((call) => call.at(-1) === getDerivedMetricDocId(DERIVED_METRIC_KINDS.TrainingBuildComparison))).toBe(false);
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

  it('marks projection-sensitive snapshots stale when asOfDayMs is behind today and keeps backend payload values', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.UTC(2026, 3, 28, 12, 0, 0)));
      const uid = 'user-1';

      hoisted.docMock.mockImplementation((_firestore, ...segments: string[]) => ({
        path: segments.join('/'),
      }));
      hoisted.docDataMock.mockImplementation((docRef: { path?: string } | undefined) => {
        const path = `${docRef?.path || ''}`;
        if (path.endsWith('/form')) {
          return of({
            status: 'ready',
            schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
            payload: {
              dailyLoads: [
                { dayMs: Date.UTC(2026, 3, 24), load: 60 },
                { dayMs: Date.UTC(2026, 3, 26), load: 275.4 },
              ],
            },
          });
        }
        if (path.endsWith('/form_now')) {
          return of({
            status: 'ready',
            schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
            payload: {
              asOfDayMs: Date.UTC(2026, 3, 27),
              latestDayMs: Date.UTC(2026, 3, 27),
              value: -999,
              trend8Weeks: [],
            },
          });
        }
        if (path.endsWith('/form_plus_7d')) {
          return of({
            status: 'ready',
            schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
            payload: {
              asOfDayMs: Date.UTC(2026, 3, 27),
              latestDayMs: Date.UTC(2026, 3, 27),
              projectedDayMs: Date.UTC(2026, 4, 4),
              value: -999,
              trend8Weeks: [],
            },
          });
        }
        if (path.endsWith('/freshness_forecast')) {
          return of({
            status: 'ready',
            schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
            payload: {
              asOfDayMs: Date.UTC(2026, 3, 27),
              generatedAtMs: Date.UTC(2026, 3, 27, 11, 0, 0),
              points: [
                {
                  dayMs: Date.UTC(2026, 3, 26),
                  trainingStressScore: 275.4,
                  ctl: 100,
                  atl: 150,
                  formSameDay: -888,
                  formPriorDay: -777,
                  isForecast: false,
                },
              ],
            },
          });
        }
        return of(undefined);
      });

      const state = await firstValueFrom(service.watch({ uid }));

      expect(state.formPoints?.length).toBeGreaterThan(0);
      expect(state.formNow).not.toBeNull();
      expect(state.freshnessForecast).not.toBeNull();
      expect(state.formNowStatus).toBe('stale');
      expect(state.formPlus7dStatus).toBe('stale');
      expect(state.freshnessForecastStatus).toBe('stale');
      expect(state.formNow?.latestDayMs).toBe(Date.UTC(2026, 3, 27));
      expect(state.formNow?.value).toBe(-999);
      expect(state.freshnessForecast?.points[0]?.dayMs).toBe(Date.UTC(2026, 3, 26));
      expect(state.freshnessForecast?.points[0]?.formSameDay).toBe(-888);
    } finally {
      vi.useRealTimers();
    }
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
        DERIVED_METRIC_KINDS.TrainingSummary,
        DERIVED_METRIC_KINDS.PowerCurve,
      ],
    });
  });

  it('marks an unsupported ready Power Curve payload stale so it is rebuilt', async () => {
    const uid = 'user-1';
    hoisted.docMock.mockImplementation((_firestore, ...segments: string[]) => ({
      path: segments.join('/'),
    }));
    hoisted.docDataMock.mockImplementation((docRef: { path?: string } | undefined) => {
      if (`${docRef?.path || ''}`.endsWith('/power_curve')) {
        return of({
          status: 'ready',
          schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
          payload: {
            asOfDayMs: Date.UTC(2026, 6, 13),
            excludesMergedEvents: true,
            pointSamplingVersion: 2,
            scopes: {},
          },
        });
      }
      return of(undefined);
    });

    const state = await firstValueFrom(service.watch({ uid }));

    expect(state.powerCurve).toBeNull();
    expect(state.powerCurveStatus).toBe('stale');
  });

  it('maps a valid Training capacity snapshot and marks malformed ready payloads stale', async () => {
    const uid = 'user-1';
    const today = new Date();
    const asOfDayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const emptyModel = {
      status: 'insufficient-evidence' as const,
      valueWatts: null,
      valueWattsPerKg: null,
      wPrimeJoules: null,
      confidence: null,
      windowDays: 90,
      sourceEventCount: 0,
      anchorPointCount: 0,
      minDurationSeconds: null,
      maxDurationSeconds: null,
      rSquared: null,
      normalizedRmse: null,
    };
    const validPayload = {
      dayBoundary: 'UTC',
      asOfDayMs,
      excludesMergedEvents: true,
      disciplines: [
        { discipline: 'running', ftpSetting: null, importedVo2Max: null, modeledCriticalPower: emptyModel },
        { discipline: 'cycling', ftpSetting: null, importedVo2Max: null, modeledCriticalPower: emptyModel },
      ],
    };
    hoisted.docMock.mockImplementation((_firestore, ...segments: string[]) => ({ path: segments.join('/') }));
    hoisted.docDataMock.mockReturnValue(of({
      status: 'ready',
      schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
      payload: validPayload,
    }));

    const state = await firstValueFrom(service.watch({ uid }, {
      metricKinds: [DERIVED_METRIC_KINDS.TrainingCapacity],
    }));

    expect(state.trainingCapacityStatus).toBe('ready');
    expect(state.trainingCapacity?.disciplines.map(item => item.discipline)).toEqual(['running', 'cycling']);
    expect((service as any).resolveSnapshotStatus(DERIVED_METRIC_KINDS.TrainingCapacity, {
      status: 'ready',
      schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
      payload: { ...validPayload, disciplines: validPayload.disciplines.slice(0, 1) },
    })).toBe('stale');
  });

  it('maps a valid Swimming performance snapshot and self-heals malformed week pairs', async () => {
    const uid = 'user-1';
    const today = new Date();
    const asOfDayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const currentWeekStartMs = asOfDayMs - (((today.getUTCDay() + 6) % 7) * 24 * 60 * 60 * 1000);
    const firstWeekStartMs = currentWeekStartMs - (11 * 7 * 24 * 60 * 60 * 1000);
    const weeks = Array.from({ length: 12 }, (_, index) => firstWeekStartMs + index * 7 * 24 * 60 * 60 * 1000)
      .flatMap(weekStartMs => ([
        {
          weekStartMs, environment: 'pool', activityCount: 1, distanceMeters: 1_500,
          averagePaceSecondsPer100m: 100, paceActivityCount: 1, swolf: 42, swolfLengthCount: 60,
        },
        {
          weekStartMs, environment: 'open-water', activityCount: 0, distanceMeters: 0,
          averagePaceSecondsPer100m: null, paceActivityCount: 0, swolf: null, swolfLengthCount: 0,
        },
      ]));
    const validPayload = {
      dayBoundary: 'UTC', asOfDayMs, weekCount: 12, excludesMergedEvents: true,
      swolfContext: { stroke: 'freestyle', poolLengthMeters: 25 }, weeks,
    };
    hoisted.docMock.mockImplementation((_firestore, ...segments: string[]) => ({ path: segments.join('/') }));
    hoisted.docDataMock.mockReturnValue(of({
      status: 'ready', schemaVersion: DERIVED_METRIC_SCHEMA_VERSION, payload: validPayload,
    }));

    const state = await firstValueFrom(service.watch({ uid }, {
      metricKinds: [DERIVED_METRIC_KINDS.TrainingSwimPerformance],
    }));

    expect(state.trainingSwimPerformanceStatus).toBe('ready');
    expect(state.trainingSwimPerformance?.weeks).toHaveLength(24);
    expect((service as any).resolveSnapshotStatus(DERIVED_METRIC_KINDS.TrainingSwimPerformance, {
      status: 'ready', schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
      payload: { ...validPayload, weeks: validPayload.weeks.slice(0, 23) },
    })).toBe('stale');
  });

  it('marks a ready build comparison stale when its current window is from yesterday', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.UTC(2026, 3, 28, 12, 0, 0)));
      const status = (service as any).resolveSnapshotStatus(DERIVED_METRIC_KINDS.TrainingBuildComparison, {
        status: 'ready',
        schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
        payload: {
          asOfDayMs: Date.UTC(2026, 3, 27),
          disciplines: [
            { discipline: 'running', status: 'not-configured', selection: null, current: null, benchmark: null, suggestedRaces: [] },
            { discipline: 'cycling', status: 'not-configured', selection: null, current: null, benchmark: null, suggestedRaces: [] },
          ],
        },
      });

      expect(status).toBe('stale');
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks an incomplete ready build comparison snapshot as stale', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.UTC(2026, 6, 13, 12, 0, 0)));
      const status = (service as any).resolveSnapshotStatus(DERIVED_METRIC_KINDS.TrainingBuildComparison, {
        status: 'ready',
        schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
        payload: {
          asOfDayMs: Date.UTC(2026, 6, 13),
          disciplines: [
            { discipline: 'running', status: 'not-configured', selection: null, current: null, benchmark: null, suggestedRaces: [] },
            { discipline: 'cycling', status: 'not-configured', selection: null, current: null, benchmark: null, suggestedRaces: [] },
          ],
        },
      });

      expect(status).toBe('stale');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rebuilds a ready build comparison snapshot whose picker candidates lack activity summaries', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.UTC(2026, 6, 13, 12, 0, 0)));
      const status = (service as any).resolveSnapshotStatus(DERIVED_METRIC_KINDS.TrainingBuildComparison, {
        status: 'ready',
        schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
        payload: {
          asOfDayMs: Date.UTC(2026, 6, 13),
          disciplines: [
            {
              discipline: 'running', status: 'not-configured', selection: null, current: null, benchmark: null,
              suggestedRaces: [{ eventId: 'old-race', startDayMs: Date.UTC(2026, 4, 1), label: 'New event' }],
              suggestedEvents: [],
            },
            { discipline: 'cycling', status: 'not-configured', selection: null, current: null, benchmark: null, suggestedRaces: [], suggestedEvents: [] },
          ],
        },
      });

      expect(status).toBe('stale');
    } finally {
      vi.useRealTimers();
    }
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
        DERIVED_METRIC_KINDS.TrainingSummary,
        DERIVED_METRIC_KINDS.PowerCurve,
      ],
    });

    resolveCall?.(null);
    await Promise.resolve();
  });

  it('still requests ensure when snapshots are ready so backend can run freshness checks', () => {
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
      trainingSummaryStatus: 'ready',
      trainingBuildComparisonStatus: 'ready',
      powerCurveStatus: 'ready',
    };

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
        DERIVED_METRIC_KINDS.TrainingSummary,
        DERIVED_METRIC_KINDS.PowerCurve,
      ],
    });
  });

  it('subscribes to and requests the Training-only metric only for the Training workspace scope', async () => {
    const uid = 'user-1';
    hoisted.docMock.mockImplementation((_firestore, ...segments: string[]) => ({ path: segments.join('/') }));

    const state = await firstValueFrom(service.watch({ uid }, {
      metricKinds: TRAINING_WORKSPACE_DERIVED_METRIC_KINDS,
    }));

    expect(hoisted.docMock.mock.calls.some((call) => call.at(-1) === getDerivedMetricDocId(DERIVED_METRIC_KINDS.TrainingBuildComparison))).toBe(true);
    expect(hoisted.docMock.mock.calls.some((call) => call.at(-1) === getDerivedMetricDocId(DERIVED_METRIC_KINDS.TrainingExplanation))).toBe(true);
    expect(hoisted.docMock.mock.calls.some((call) => call.at(-1) === getDerivedMetricDocId(DERIVED_METRIC_KINDS.TrainingDurability))).toBe(true);
    service.ensureForDashboard({ uid }, state, {
      metricKinds: TRAINING_WORKSPACE_DERIVED_METRIC_KINDS,
    });
    expect(mockFunctionsService.call).toHaveBeenCalledWith<EnsureDerivedMetricsRequest, unknown>('ensureDerivedMetrics', {
      metricKinds: TRAINING_WORKSPACE_DERIVED_METRIC_KINDS,
    });
  });

  it('does not let an in-flight dashboard probe suppress a Training workspace request', () => {
    let resolveDashboardProbe: ((value: unknown) => void) | null = null;
    mockFunctionsService.call.mockImplementationOnce(() => new Promise((resolve) => {
      resolveDashboardProbe = resolve;
    }));
    const dashboardState: DashboardDerivedMetricsState = {
      ...createMissingState(),
      formStatus: 'ready', recoveryNowStatus: 'ready', acwrStatus: 'ready', rampRateStatus: 'ready',
      monotonyStrainStatus: 'ready', formNowStatus: 'ready', formPlus7dStatus: 'ready',
      easyPercentStatus: 'ready', hardPercentStatus: 'ready', efficiencyDelta4wStatus: 'ready',
      freshnessForecastStatus: 'ready', intensityDistributionStatus: 'ready', efficiencyTrendStatus: 'ready',
      trainingSummaryStatus: 'ready', powerCurveStatus: 'ready',
    };
    const trainingState: DashboardDerivedMetricsState = {
      ...dashboardState,
      trainingBuildComparisonStatus: 'missing',
    };

    service.ensureForDashboard({ uid: 'user-1' }, dashboardState);
    service.ensureForDashboard({ uid: 'user-1' }, trainingState, {
      metricKinds: TRAINING_WORKSPACE_DERIVED_METRIC_KINDS,
    });

    expect(mockFunctionsService.call).toHaveBeenCalledTimes(2);
    expect(mockFunctionsService.call).toHaveBeenLastCalledWith<EnsureDerivedMetricsRequest, unknown>('ensureDerivedMetrics', {
      metricKinds: [
        DERIVED_METRIC_KINDS.TrainingCapacity,
        DERIVED_METRIC_KINDS.TrainingExplanation,
        DERIVED_METRIC_KINDS.TrainingDurability,
        DERIVED_METRIC_KINDS.TrainingBuildComparison,
        DERIVED_METRIC_KINDS.TrainingSwimPerformance,
      ],
    });
    resolveDashboardProbe?.({ data: { accepted: true } });
  });

  it('applies longer cooldown for healthy freshness probes', async () => {
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
      trainingSummaryStatus: 'ready',
      trainingBuildComparisonStatus: 'ready',
      powerCurveStatus: 'ready',
    };

    service.ensureForDashboard({ uid: 'user-1' }, state);
    await Promise.resolve();
    service.ensureForDashboard({ uid: 'user-1' }, state);

    expect(mockFunctionsService.call).toHaveBeenCalledTimes(1);
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
      trainingSummaryStatus: 'ready',
      trainingBuildComparisonStatus: 'ready',
      powerCurveStatus: 'ready',
    };

    service.ensureForDashboard({ uid: 'user-1' }, state);

    expect(mockFunctionsService.call).toHaveBeenCalledTimes(1);
    expect(mockFunctionsService.call).toHaveBeenCalledWith<EnsureDerivedMetricsRequest, unknown>('ensureDerivedMetrics', {
      metricKinds: [DERIVED_METRIC_KINDS.Form],
    });
  });

  it('treats long-stale snapshots as failed so UI shows retry', async () => {
    const uid = 'user-1';
    const staleUpdatedAtMs = Date.now() - (11 * 60 * 1000);
    const formDocRef = { path: `users/${uid}/${DERIVED_METRICS_COLLECTION_ID}/${getDerivedMetricDocId(DERIVED_METRIC_KINDS.Form)}` };
    const recoveryDocRef = { path: `users/${uid}/${DERIVED_METRICS_COLLECTION_ID}/${getDerivedMetricDocId(DERIVED_METRIC_KINDS.RecoveryNow)}` };

    hoisted.docMock
      .mockReturnValueOnce(formDocRef)
      .mockReturnValueOnce(recoveryDocRef);
    hoisted.docDataMock
      .mockReturnValueOnce(of({
        status: 'stale',
        schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
        updatedAtMs: staleUpdatedAtMs,
        payload: {
          dailyLoads: [
            { dayMs: Date.UTC(2026, 0, 1), load: 30 },
          ],
        },
      }))
      .mockReturnValueOnce(of({
        status: 'ready',
        schemaVersion: DERIVED_METRIC_SCHEMA_VERSION,
        payload: {
          totalSeconds: 5400,
          endTimeMs: Date.UTC(2026, 0, 3, 12, 0, 0),
        },
      }));

    const state = await firstValueFrom(service.watch({ uid }));
    expect(state.formStatus).toBe('failed');
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
