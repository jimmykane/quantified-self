import { describe, expect, it } from 'vitest';
import {
  resolveDashboardEasyPercentContext,
  resolveDashboardEfficiencyDelta4wContext,
  resolveDashboardAcwrContext,
  resolveDashboardEfficiencyTrendContext,
  resolveDashboardFatigueAtlContext,
  resolveDashboardFitnessCtlContext,
  resolveDashboardFreshnessForecastContext,
  resolveDashboardFormNowContext,
  resolveDashboardFormNowContextFromPoints,
  resolveDashboardFormPlus7dContext,
  resolveDashboardHardPercentContext,
  resolveDashboardIntensityDistributionContext,
  resolveDashboardMonotonyStrainContext,
  resolveDashboardRampRateContext,
  resolveDashboardRampRateContextFromPoints,
  resolveDashboardTrainingSummaryContext,
  resolveDashboardTrainingBuildComparisonContext,
  resolveDashboardTrainingCapacityContext,
  resolveDashboardTrainingSwimPerformanceContext,
} from './dashboard-derived-metrics.helper';

describe('dashboard-derived-metrics.helper', () => {
  it('normalizes ACWR payload context', () => {
    const context = resolveDashboardAcwrContext({
      latestDayMs: Date.UTC(2026, 0, 1),
      acuteLoad7: 180,
      chronicLoad28: 150,
      ratio: 1.2,
      trend8Weeks: [{ weekStartMs: Date.UTC(2025, 11, 1), ratio: 1.1 }],
    });

    expect(context).toEqual({
      latestDayMs: Date.UTC(2026, 0, 1),
      acuteLoad7: 180,
      chronicLoad28: 150,
      ratio: 1.2,
      trend8Weeks: [{ time: Date.UTC(2025, 11, 1), value: 1.1 }],
    });
  });

  it('normalizes ramp rate and monotony/strain payload contexts', () => {
    const ramp = resolveDashboardRampRateContext({
      latestDayMs: Date.UTC(2026, 0, 1),
      ctlToday: 60,
      ctl7DaysAgo: 56,
      rampRate: 4,
      trend8Weeks: [{ weekStartMs: Date.UTC(2025, 11, 1), rampRate: 2 }],
    });
    const monotony = resolveDashboardMonotonyStrainContext({
      latestDayMs: Date.UTC(2026, 0, 1),
      weeklyLoad7: 320,
      monotony: 1.7,
      strain: 544,
      trend8Weeks: [{ weekStartMs: Date.UTC(2025, 11, 1), strain: 490 }],
    });

    expect(ramp?.rampRate).toBe(4);
    expect(ramp?.trend8Weeks[0]).toEqual({ time: Date.UTC(2025, 11, 1), value: 2 });
    expect(monotony?.strain).toBe(544);
    expect(monotony?.trend8Weeks[0]).toEqual({ time: Date.UTC(2025, 11, 1), value: 490 });
  });

  it('derives Form Now and Ramp Rate from the one current-day Form series', () => {
    const firstDayMs = Date.UTC(2026, 0, 1);
    const todayMs = Date.UTC(2026, 0, 8, 12);
    const points = [{
      time: firstDayMs,
      trainingStressScore: 84,
      ctl: 42,
      atl: 50,
      formSameDay: -8,
      formPriorDay: -4,
    }];

    const formNow = resolveDashboardFormNowContextFromPoints(points, todayMs);
    const ramp = resolveDashboardRampRateContextFromPoints(points, todayMs);

    expect(formNow).toMatchObject({
      latestDayMs: Date.UTC(2026, 0, 8),
      value: 18.4848,
    });
    expect(ramp).toMatchObject({
      latestDayMs: Date.UTC(2026, 0, 8),
      ctlToday: 35.4806,
      ctl7DaysAgo: 42,
      rampRate: -6.5194,
    });
  });

  it('normalizes freshness, intensity, and efficiency payload contexts', () => {
    const freshness = resolveDashboardFreshnessForecastContext({
      generatedAtMs: Date.UTC(2026, 0, 10),
      points: [{
        dayMs: Date.UTC(2026, 0, 10),
        trainingStressScore: 0,
        ctl: 58,
        atl: 54,
        formSameDay: 4,
        formPriorDay: 3,
        isForecast: false,
      }],
    });
    const intensity = resolveDashboardIntensityDistributionContext({
      weeks: [{
        weekStartMs: Date.UTC(2026, 0, 5),
        easySeconds: 3600,
        moderateSeconds: 1800,
        hardSeconds: 900,
        source: 'power',
      }],
      latestWeekStartMs: Date.UTC(2026, 0, 5),
      latestEasyPercent: 57,
      latestModeratePercent: 29,
      latestHardPercent: 14,
    });
    const efficiency = resolveDashboardEfficiencyTrendContext({
      points: [{
        weekStartMs: Date.UTC(2026, 0, 5),
        value: 1.92,
        sampleCount: 3,
        totalDurationSeconds: 9200,
      }],
      latestWeekStartMs: Date.UTC(2026, 0, 5),
      latestValue: 1.92,
    });

    expect(freshness?.points).toHaveLength(1);
    expect(intensity?.weeks[0].source).toBe('power');
    expect(efficiency?.latestValue).toBe(1.92);
  });

  it('normalizes readiness and execution KPI payload contexts', () => {
    const formNow = resolveDashboardFormNowContext({
      latestDayMs: Date.UTC(2026, 0, 10),
      value: -3.2,
      trend8Weeks: [{ weekStartMs: Date.UTC(2025, 11, 1), value: -1.3 }],
    });
    const formPlus7d = resolveDashboardFormPlus7dContext({
      latestDayMs: Date.UTC(2026, 0, 10),
      projectedDayMs: Date.UTC(2026, 0, 17),
      value: 2.9,
      trend8Weeks: [{ weekStartMs: Date.UTC(2025, 11, 1), value: 1.1 }],
    });
    const easyPercent = resolveDashboardEasyPercentContext({
      latestWeekStartMs: Date.UTC(2026, 0, 5),
      value: 66,
      trend8Weeks: [{ weekStartMs: Date.UTC(2025, 11, 1), value: 62 }],
    });
    const hardPercent = resolveDashboardHardPercentContext({
      latestWeekStartMs: Date.UTC(2026, 0, 5),
      value: 14,
      trend8Weeks: [{ weekStartMs: Date.UTC(2025, 11, 1), value: 12 }],
    });

    expect(formNow?.value).toBe(-3.2);
    expect(formNow?.trend8Weeks[0]).toEqual({ time: Date.UTC(2025, 11, 1), value: -1.3 });
    expect(formPlus7d?.projectedDayMs).toBe(Date.UTC(2026, 0, 17));
    expect(easyPercent?.value).toBe(66);
    expect(hardPercent?.value).toBe(14);
  });

  it('derives Fitness CTL and Fatigue ATL KPI contexts from official Form points through today', () => {
    const fitness = resolveDashboardFitnessCtlContext([
      {
        time: Date.UTC(2026, 0, 5),
        trainingStressScore: 42,
        ctl: 10,
        atl: 14,
        formSameDay: -4,
        formPriorDay: -3,
      },
      {
        time: Date.UTC(2026, 0, 6),
        trainingStressScore: 84,
        ctl: 12,
        atl: 20,
        formSameDay: -8,
        formPriorDay: -4,
      },
    ], Date.UTC(2026, 0, 8, 12));
    const fatigue = resolveDashboardFatigueAtlContext([
      {
        time: Date.UTC(2026, 0, 5),
        trainingStressScore: 42,
        ctl: 10,
        atl: 14,
        formSameDay: -4,
        formPriorDay: -3,
      },
      {
        time: Date.UTC(2026, 0, 6),
        trainingStressScore: 84,
        ctl: 12,
        atl: 20,
        formSameDay: -8,
        formPriorDay: -4,
      },
    ], Date.UTC(2026, 0, 8, 12));

    expect(fitness?.latestDayMs).toBe(Date.UTC(2026, 0, 8));
    expect(fitness?.value).toBeCloseTo(11.4354, 4);
    expect(fitness?.trend8Weeks).toEqual([
      { time: Date.UTC(2026, 0, 5), value: 11.4354 },
    ]);
    expect(fatigue?.latestDayMs).toBe(Date.UTC(2026, 0, 8));
    expect(fatigue?.value).toBeCloseTo(14.6939, 4);
    expect(fatigue?.trend8Weeks).toEqual([
      { time: Date.UTC(2026, 0, 5), value: 14.6939 },
    ]);
  });

  it('normalizes efficiency delta payload context', () => {
    const context = resolveDashboardEfficiencyDelta4wContext({
      latestWeekStartMs: Date.UTC(2026, 0, 5),
      latestValue: 1.92,
      baselineValue: 1.84,
      baselineWeekCount: 4,
      deltaAbs: 0.08,
      deltaPct: 4.35,
      trend8Weeks: [{ weekStartMs: Date.UTC(2025, 11, 1), value: 1.7 }],
    });

    expect(context?.deltaAbs).toBe(0.08);
    expect(context?.deltaPct).toBe(4.35);
    expect(context?.baselineWeekCount).toBe(4);
    expect(context?.trend8Weeks[0]).toEqual({ time: Date.UTC(2025, 11, 1), value: 1.7 });
  });

  it('normalizes the training summary without mixing in capacity markers', () => {
    const payload = {
      dayBoundary: 'UTC',
      asOfDayMs: Date.UTC(2026, 6, 10),
      currentWindowDays: 28,
      baselineWindowDays: 84,
      excludesMergedEvents: true,
      disciplines: [{
        discipline: 'running',
        current28d: {
          periodDays: 28, windowStartDayMs: Date.UTC(2026, 5, 13), windowEndDayMs: Date.UTC(2026, 6, 10),
          activityCount: 4, durationSeconds: 14_400, easySeconds: 9_000, moderateSeconds: 3_600, hardSeconds: 1_800,
        },
        baseline28d: {
          periodDays: 28, windowStartDayMs: Date.UTC(2026, 2, 21), windowEndDayMs: Date.UTC(2026, 5, 12),
          activityCount: 3, durationSeconds: 10_800, easySeconds: 7_200, moderateSeconds: 2_400, hardSeconds: 1_200,
        },
      }, {
        discipline: 'cycling',
        current28d: {
          periodDays: 28, windowStartDayMs: 1, windowEndDayMs: 2,
          activityCount: 0, durationSeconds: 0, easySeconds: 0, moderateSeconds: 0, hardSeconds: 0,
        },
        baseline28d: {
          periodDays: 28, windowStartDayMs: 1, windowEndDayMs: 2,
          activityCount: 0, durationSeconds: 0, easySeconds: 0, moderateSeconds: 0, hardSeconds: 0,
        },
      }, {
        discipline: 'swimming',
        current28d: {
          periodDays: 28, windowStartDayMs: 1, windowEndDayMs: 2,
          activityCount: 0, durationSeconds: 0, easySeconds: 0, moderateSeconds: 0, hardSeconds: 0,
        },
        baseline28d: {
          periodDays: 28, windowStartDayMs: 1, windowEndDayMs: 2,
          activityCount: 0, durationSeconds: 0, easySeconds: 0, moderateSeconds: 0, hardSeconds: 0,
        },
      }],
    };
    const context = resolveDashboardTrainingSummaryContext(payload);

    expect(context?.disciplines[0]?.current28d.activityCount).toBe(4);
    expect(context?.disciplines[0]).not.toHaveProperty('vo2Max');
    expect(resolveDashboardTrainingSummaryContext({ ...payload, dayBoundary: 'local' })).toBeNull();
    expect(resolveDashboardTrainingSummaryContext({ ...payload, excludesMergedEvents: false })).toBeNull();
  });

  it('normalizes imported capacity markers separately from modeled critical power', () => {
    const context = resolveDashboardTrainingCapacityContext({
      dayBoundary: 'UTC',
      asOfDayMs: Date.UTC(2026, 6, 13),
      excludesMergedEvents: true,
      disciplines: [{
        discipline: 'running',
        ftpSetting: null,
        importedVo2Max: {
          kind: 'vo2-max', value: 55.9, sourceKey: 'garmin', provenance: 'imported-activity-stat',
          firstSeenAtMs: Date.UTC(2026, 0, 1), lastSeenAtMs: Date.UTC(2026, 6, 12), observationCount: 14,
          previousValue: null, previousAtMs: null, previousSourceKey: null, changePct: null,
        },
        modeledCriticalPower: {
          status: 'insufficient-evidence', valueWatts: null, valueWattsPerKg: null, wPrimeJoules: null,
          confidence: null, windowDays: 90, sourceEventCount: 0, anchorPointCount: 0,
          minDurationSeconds: null, maxDurationSeconds: null, rSquared: null, normalizedRmse: null,
        },
      }, {
        discipline: 'cycling',
        ftpSetting: {
          kind: 'ftp-setting', value: 222, sourceKey: 'garmin', provenance: 'imported-activity-stat',
          firstSeenAtMs: Date.UTC(2025, 10, 1), lastSeenAtMs: Date.UTC(2026, 6, 12), observationCount: 28,
          previousValue: 215, previousAtMs: Date.UTC(2025, 9, 30), previousSourceKey: 'garmin', changePct: 3.26,
        },
        importedVo2Max: null,
        modeledCriticalPower: {
          status: 'ready', valueWatts: 240, valueWattsPerKg: 3.2, wPrimeJoules: 18_000,
          confidence: 'high', windowDays: 90, sourceEventCount: 5, anchorPointCount: 5,
          minDurationSeconds: 180, maxDurationSeconds: 1_200, rSquared: 0.99, normalizedRmse: 0.02,
        },
      }],
    });

    expect(context?.disciplines[0].importedVo2Max?.value).toBe(55.9);
    expect(context?.disciplines[1].ftpSetting).toMatchObject({ value: 222, observationCount: 28 });
    expect(context?.disciplines[1].modeledCriticalPower).toMatchObject({
      status: 'ready', valueWatts: 240, confidence: 'high', sourceEventCount: 5,
    });
  });

  it('rejects malformed capacity snapshots so they can self-heal', () => {
    const emptyDiscipline = (discipline: 'running' | 'cycling') => ({
      discipline,
      ftpSetting: null,
      importedVo2Max: null,
      modeledCriticalPower: {
        status: 'insufficient-evidence', valueWatts: null, valueWattsPerKg: null, wPrimeJoules: null,
        confidence: null, windowDays: 90, sourceEventCount: 0, anchorPointCount: 0,
        minDurationSeconds: null, maxDurationSeconds: null, rSquared: null, normalizedRmse: null,
      },
    });

    expect(resolveDashboardTrainingCapacityContext({
      dayBoundary: 'UTC', asOfDayMs: Date.UTC(2026, 6, 13), excludesMergedEvents: true,
      disciplines: [emptyDiscipline('running'), emptyDiscipline('running')],
    })).toBeNull();
    expect(resolveDashboardTrainingCapacityContext({
      dayBoundary: 'UTC', asOfDayMs: Date.UTC(2026, 6, 13), excludesMergedEvents: true,
      disciplines: [emptyDiscipline('running'), {
        ...emptyDiscipline('cycling'),
        modeledCriticalPower: {
          ...emptyDiscipline('cycling').modeledCriticalPower,
          status: 'ready', valueWatts: 240, confidence: 'low',
        },
      }],
    })).toBeNull();
    expect(resolveDashboardTrainingCapacityContext({
      dayBoundary: 'UTC', asOfDayMs: Date.UTC(2026, 6, 13), excludesMergedEvents: true,
      disciplines: [{
        ...emptyDiscipline('running'),
        modeledCriticalPower: {
          ...emptyDiscipline('running').modeledCriticalPower,
          valueWatts: 200,
        },
      }, emptyDiscipline('cycling')],
    })).toBeNull();
    expect(resolveDashboardTrainingCapacityContext({
      dayBoundary: 'UTC', asOfDayMs: Date.UTC(2026, 6, 13), excludesMergedEvents: true,
      disciplines: [emptyDiscipline('running'), {
        ...emptyDiscipline('cycling'),
        modeledCriticalPower: {
          status: 'ready', valueWatts: 240, valueWattsPerKg: null, wPrimeJoules: 18_000,
          confidence: 'high', windowDays: 90, sourceEventCount: 1, anchorPointCount: 5,
          minDurationSeconds: 180, maxDurationSeconds: 1_200, rSquared: 0.99, normalizedRmse: 0.02,
        },
      }],
    })).toBeNull();
    expect(resolveDashboardTrainingCapacityContext({
      dayBoundary: 'UTC', asOfDayMs: Date.UTC(2026, 6, 13), excludesMergedEvents: true,
      disciplines: [emptyDiscipline('running'), {
        ...emptyDiscipline('cycling'),
        modeledCriticalPower: {
          ...emptyDiscipline('cycling').modeledCriticalPower,
          minDurationSeconds: 1_200,
          maxDurationSeconds: 180,
        },
      }],
    })).toBeNull();
  });

  it('normalizes separate sport build comparisons and preserves unavailable optional metrics', () => {
    const emptyRecoveryWindow = (windowStartDayMs: number, periodDays: number) => ({
      periodDays,
      windowStartDayMs,
      windowEndDayMs: windowStartDayMs + ((periodDays - 1) * 24 * 60 * 60 * 1000),
      provider: null,
      recordedNightCount: 0,
      expectedNightCount: periodDays,
      coverage: 'none',
      averageSleepSeconds: null,
      bedtimeVariationMinutes: null,
      medianOvernightHrvMs: null,
      overnightHrvNightCount: 0,
    });
    const emptyRecoveryComparison = (currentStartDayMs: number, currentDays: number, referenceStartDayMs: number, referenceDays: number) => ({
      current: emptyRecoveryWindow(currentStartDayMs, currentDays),
      reference: emptyRecoveryWindow(referenceStartDayMs, referenceDays),
      sameProvider: false,
      isComparable: false,
    });
    const durabilityCoverage = {
      candidateActivityCount: 4,
      evidenceActivityCount: 4,
      eligibleActivityCount: 4,
      missingEvidenceActivityCount: 0,
      excludedActivityCount: 0,
      eligibilityRatio: 1,
      exclusions: [],
    };
    const durabilitySummary = {
      context: {
        contextKey: 'running:power', scope: 'running', outputSource: 'power', outputUnit: 'W',
        poolLengthMeters: null, stroke: null,
      },
      sampleCount: 4,
      medianDurationSeconds: 3_600,
      medianCoverageRatio: 0.9,
      medianDecouplingPercent: 3.5,
      medianOutputRetentionPercent: 97,
      medianHeartRateDriftBpm: 4,
      medianPaceRetentionPercent: null,
      medianSwolfChange: null,
    };
    const payload = {
      dayBoundary: 'UTC',
      asOfDayMs: Date.UTC(2026, 5, 30),
      excludesMergedEvents: true,
      recovery: emptyRecoveryComparison(Date.UTC(2026, 5, 3), 28, Date.UTC(2026, 2, 11), 84),
      disciplines: [{
        discipline: 'running',
        status: 'ready',
        selection: {
          mode: 'event', durationWeeks: 12, eventId: 'race-1', selectionKey: 'event:12:race-1',
          windowStartDayMs: Date.UTC(2026, 0, 14), windowEndDayMs: Date.UTC(2026, 3, 7), label: ' Spring marathon ',
        },
        current: {
          periodWeeks: 12, windowStartDayMs: Date.UTC(2026, 3, 8), windowEndDayMs: Date.UTC(2026, 5, 30),
          activityCount: 8, durationSeconds: 12_000, distanceMeters: 82_000, distanceEventCount: 8,
          trainingStressScore: null, trainingStressScoreEventCount: 0, activeWeekCount: 7,
          longestActivityDurationSeconds: 3_600, easySeconds: null, moderateSeconds: null, hardSeconds: null,
          intensitySourceEventCount: 0, durability: null,
          poolAveragePaceSecondsPer100m: null, poolPaceActivityCount: 0,
          openWaterAveragePaceSecondsPer100m: null, openWaterPaceActivityCount: 0,
        },
        benchmark: {
          periodWeeks: 12, windowStartDayMs: Date.UTC(2026, 0, 14), windowEndDayMs: Date.UTC(2026, 3, 7),
          activityCount: 9, durationSeconds: 14_000, distanceMeters: 94_000, distanceEventCount: 9,
          trainingStressScore: 510, trainingStressScoreEventCount: 9, activeWeekCount: 8,
          longestActivityDurationSeconds: 4_000, easySeconds: 8_000, moderateSeconds: 3_000, hardSeconds: 1_000,
          intensitySourceEventCount: 9,
          durability: { coverage: durabilityCoverage, summaries: [durabilitySummary] },
          poolAveragePaceSecondsPer100m: null, poolPaceActivityCount: 0,
          openWaterAveragePaceSecondsPer100m: null, openWaterPaceActivityCount: 0,
        },
        recovery: emptyRecoveryComparison(Date.UTC(2026, 3, 8), 84, Date.UTC(2026, 0, 14), 84),
        durabilityComparisons: [],
        suggestedRaces: [{
          eventId: 'race-1', startDayMs: Date.UTC(2026, 3, 8), label: 'Spring marathon',
          distanceMeters: 42_195, durationSeconds: 12_600, trainingStressScore: 310,
        }],
        suggestedEvents: [{
          eventId: 'event-1', startDayMs: Date.UTC(2026, 4, 12), label: 'Long run',
          distanceMeters: 18_000, durationSeconds: 6_000, trainingStressScore: null,
        }],
      }, {
        discipline: 'cycling', status: 'not-configured', selection: null, current: null, benchmark: null, recovery: null, durabilityComparisons: [], suggestedRaces: [], suggestedEvents: [],
      }, {
        discipline: 'swimming', status: 'not-configured', selection: null, current: null, benchmark: null, recovery: null, durabilityComparisons: [], suggestedRaces: [], suggestedEvents: [],
      }],
    };
    const context = resolveDashboardTrainingBuildComparisonContext(payload);

    expect(context?.disciplines).toHaveLength(3);
    expect(context?.disciplines[0].current?.trainingStressScore).toBeNull();
    expect(context?.disciplines[0].selection?.mode).toBe('event');
    expect(context?.disciplines[0].selection?.label).toBe('Spring marathon');
    expect(context?.disciplines[0].suggestedEvents).toEqual([
      {
        eventId: 'event-1', startDayMs: Date.UTC(2026, 4, 12), label: 'Long run',
        distanceMeters: 18_000, durationSeconds: 6_000, trainingStressScore: null,
      },
    ]);
    expect(context?.disciplines[1].status).toBe('not-configured');
    expect(context?.disciplines[1].suggestedEvents).toEqual([]);
    expect(context?.recovery.current.periodDays).toBe(28);
    expect(context?.disciplines[0].recovery?.reference.periodDays).toBe(84);

    for (const provider of ['GarminAPI', 'COROSAPI', 'SuuntoApp']) {
      Object.assign(payload.recovery.current, {
        provider,
        recordedNightCount: 20,
        coverage: 'sufficient',
        averageSleepSeconds: 8 * 60 * 60,
        bedtimeVariationMinutes: null,
        medianOvernightHrvMs: 42,
        overnightHrvNightCount: 18,
      });
      expect(resolveDashboardTrainingBuildComparisonContext(payload)).not.toBeNull();
    }
    Object.assign(payload.recovery.current, {
      provider: 'GarminAPI',
      recordedNightCount: 4,
      coverage: 'limited',
      averageSleepSeconds: 8 * 60 * 60,
      bedtimeVariationMinutes: 30,
      medianOvernightHrvMs: null,
      overnightHrvNightCount: 0,
    });
    expect(resolveDashboardTrainingBuildComparisonContext(payload)).toBeNull();

    Object.assign(payload.recovery.current, {
      provider: 'GarminAPI',
      recordedNightCount: 5,
      coverage: 'limited',
      averageSleepSeconds: 8 * 60 * 60,
      bedtimeVariationMinutes: 721,
    });
    expect(resolveDashboardTrainingBuildComparisonContext(payload)).toBeNull();
    Object.assign(payload.recovery.current, {
      provider: null,
      recordedNightCount: 0,
      coverage: 'none',
      averageSleepSeconds: null,
      bedtimeVariationMinutes: null,
    });

    payload.recovery.current.recordedNightCount = 1;
    expect(resolveDashboardTrainingBuildComparisonContext(payload)).toBeNull();
    payload.recovery.current.recordedNightCount = 0;

    payload.disciplines[0].suggestedEvents[0].eventId = 'race-1';
    expect(resolveDashboardTrainingBuildComparisonContext(payload)).toBeNull();
    payload.disciplines[0].suggestedEvents[0].eventId = 'event-1';
    payload.disciplines[0].selection!.selectionKey = 'event:12:another-event';
    expect(resolveDashboardTrainingBuildComparisonContext(payload)).toBeNull();
    payload.disciplines[0].selection!.selectionKey = 'event:12:race-1';
    payload.disciplines[0].selection!.windowStartDayMs += 24 * 60 * 60 * 1000;
    expect(resolveDashboardTrainingBuildComparisonContext(payload)).toBeNull();
    payload.disciplines[0].selection!.windowStartDayMs -= 24 * 60 * 60 * 1000;
    payload.disciplines[0].benchmark!.windowStartDayMs += 24 * 60 * 60 * 1000;
    expect(resolveDashboardTrainingBuildComparisonContext(payload)).toBeNull();
  });

  it('rejects incomplete or duplicated sport build comparison snapshots for self-healing', () => {
    const buildDiscipline = (discipline: 'running' | 'cycling' | 'swimming') => ({
      discipline,
      status: 'not-configured',
      selection: null,
      current: null,
      benchmark: null,
      suggestedRaces: [],
      suggestedEvents: [],
    });

    expect(resolveDashboardTrainingBuildComparisonContext({
      dayBoundary: 'UTC',
      asOfDayMs: Date.UTC(2026, 5, 30),
      excludesMergedEvents: true,
      disciplines: [buildDiscipline('running')],
    })).toBeNull();
    expect(resolveDashboardTrainingBuildComparisonContext({
      dayBoundary: 'UTC',
      asOfDayMs: Date.UTC(2026, 5, 30),
      excludesMergedEvents: true,
      disciplines: [buildDiscipline('running'), buildDiscipline('running')],
    })).toBeNull();
    expect(resolveDashboardTrainingBuildComparisonContext({
      asOfDayMs: Date.UTC(2026, 5, 30),
      disciplines: [buildDiscipline('running'), buildDiscipline('cycling'), buildDiscipline('swimming')],
    })).toBeNull();

    const snapshotWithoutActivitySummaries = buildDiscipline('running');
    snapshotWithoutActivitySummaries.suggestedEvents = [{
      eventId: 'old-event', startDayMs: Date.UTC(2026, 3, 1), label: 'New event',
    }];
    expect(resolveDashboardTrainingBuildComparisonContext({
      dayBoundary: 'UTC',
      asOfDayMs: Date.UTC(2026, 5, 30),
      excludesMergedEvents: true,
      disciplines: [snapshotWithoutActivitySummaries, buildDiscipline('cycling')],
    })).toBeNull();

  });

  it('normalizes exactly 12 paired pool and open-water swim weeks', () => {
    const weekStarts = Array.from({ length: 12 }, (_, index) => Date.UTC(2026, 3, 6 + index * 7));
    const weeks = weekStarts.flatMap((weekStartMs, index) => ([
      {
        weekStartMs, environment: 'pool' as const, activityCount: 1, distanceMeters: 1_500,
        averagePaceSecondsPer100m: 100 + index, paceActivityCount: 1,
        swolf: index === 11 ? 42 : null, swolfLengthCount: index === 11 ? 60 : 0,
      },
      {
        weekStartMs, environment: 'open-water' as const, activityCount: 0, distanceMeters: 0,
        averagePaceSecondsPer100m: null, paceActivityCount: 0, swolf: null, swolfLengthCount: 0,
      },
    ]));

    const context = resolveDashboardTrainingSwimPerformanceContext({
      dayBoundary: 'UTC', asOfDayMs: weekStarts[11], weekCount: 12, excludesMergedEvents: true,
      swolfContext: { stroke: 'freestyle', poolLengthMeters: 25 }, weeks,
    });

    expect(context?.weeks).toHaveLength(24);
    expect(context?.swolfContext).toEqual({ stroke: 'freestyle', poolLengthMeters: 25 });
    expect(context?.weeks.at(-1)?.weekStartMs).toBe(weekStarts[11]);
  });

  it('rejects malformed swim week pairs and open-water SWOLF', () => {
    const weekStarts = Array.from({ length: 12 }, (_, index) => Date.UTC(2026, 0, 5 + index * 7));
    const buildWeeks = () => weekStarts.flatMap(weekStartMs => ([
      {
        weekStartMs, environment: 'pool', activityCount: 0, distanceMeters: 0,
        averagePaceSecondsPer100m: null, paceActivityCount: 0, swolf: null, swolfLengthCount: 0,
      },
      {
        weekStartMs, environment: 'open-water', activityCount: 0, distanceMeters: 0,
        averagePaceSecondsPer100m: null, paceActivityCount: 0, swolf: null, swolfLengthCount: 0,
      },
    ]));
    const payload = (weeks: unknown[]) => ({
      dayBoundary: 'UTC', asOfDayMs: weekStarts[11], weekCount: 12, excludesMergedEvents: true,
      swolfContext: null, weeks,
    });
    const duplicatedWeek = buildWeeks();
    duplicatedWeek[duplicatedWeek.length - 2] = { ...duplicatedWeek[0] };
    duplicatedWeek[duplicatedWeek.length - 1] = { ...duplicatedWeek[1] };
    expect(resolveDashboardTrainingSwimPerformanceContext(payload(duplicatedWeek))).toBeNull();

    const openWaterSwolf = buildWeeks();
    openWaterSwolf[1] = { ...openWaterSwolf[1], swolf: 40, swolfLengthCount: 20 };
    expect(resolveDashboardTrainingSwimPerformanceContext(payload(openWaterSwolf))).toBeNull();

    const paceWithoutSamples = buildWeeks();
    paceWithoutSamples[0] = {
      ...paceWithoutSamples[0],
      activityCount: 1,
      distanceMeters: 1_500,
      averagePaceSecondsPer100m: 100,
      paceActivityCount: 0,
    };
    expect(resolveDashboardTrainingSwimPerformanceContext(payload(paceWithoutSamples))).toBeNull();

    const swolfWithoutContext = buildWeeks();
    swolfWithoutContext[0] = {
      ...swolfWithoutContext[0],
      activityCount: 1,
      swolf: 40,
      swolfLengthCount: 20,
    };
    expect(resolveDashboardTrainingSwimPerformanceContext(payload(swolfWithoutContext))).toBeNull();
  });
});
