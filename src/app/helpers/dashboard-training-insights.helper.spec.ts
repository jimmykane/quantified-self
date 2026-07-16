import { describe, expect, it } from 'vitest';
import {
  buildDashboardAerobicCapacityContext,
  buildDashboardAerobicDurabilityContext,
  buildDashboardReadinessSignalsContext,
} from './dashboard-training-insights.helper';

describe('dashboard-training-insights.helper', () => {
  it('selects the most recent imported VO2 max without mixing it with FTP or critical power', () => {
    const context = buildDashboardAerobicCapacityContext({
      asOfDayMs: 1_000,
      disciplines: [
        {
          discipline: 'running',
          ftpSetting: null,
          modeledCriticalPower: {} as never,
          importedVo2Max: {
            kind: 'vo2-max',
            value: 54,
            sourceKey: 'garmin:watch',
            provenance: 'imported-activity-stat',
            firstSeenAtMs: 100,
            lastSeenAtMs: 900,
            observationCount: 4,
            previousValue: 52,
            previousAtMs: 500,
            previousSourceKey: 'garmin:watch',
            changePct: 3.85,
          },
        },
        {
          discipline: 'cycling',
          ftpSetting: null,
          modeledCriticalPower: {} as never,
          importedVo2Max: null,
        },
      ],
    });

    expect(context).toMatchObject({
      value: 54,
      discipline: 'running',
      sourceLabel: 'Garmin · Watch',
      observationCount: 4,
      changePct: 3.85,
      trend: [
        { time: 500, value: 52 },
        { time: 900, value: 54 },
      ],
    });
  });

  it('omits aerobic-capacity comparison data when the prior observation came from another source', () => {
    const context = buildDashboardAerobicCapacityContext({
      asOfDayMs: 1_000,
      disciplines: [{
        discipline: 'running',
        ftpSetting: null,
        modeledCriticalPower: null,
        importedVo2Max: {
          kind: 'vo2-max',
          value: 54,
          sourceKey: 'garmin:watch',
          provenance: 'imported-activity-stat',
          firstSeenAtMs: 100,
          lastSeenAtMs: 900,
          observationCount: 4,
          previousValue: 52,
          previousAtMs: 500,
          previousSourceKey: 'suunto:watch',
          changePct: null,
        },
      }],
    });

    expect(context).toMatchObject({
      value: 54,
      changePct: null,
      trend: [{ time: 900, value: 54 }],
    });
  });

  it('builds durability from the strongest current aerobic context and preserves empty weeks', () => {
    const context = buildDashboardAerobicDurabilityContext({
      dayBoundary: 'UTC',
      asOfDayMs: 10_000,
      currentWindowDays: 28,
      baselineBlockCount: 3,
      weeklyPointCount: 12,
      excludesMergedEvents: true,
      excludesFutureEvents: true,
      evidenceSource: 'persisted-activity-stat',
      scopes: [{
        scope: 'running',
        current: {
          periodDays: 28,
          windowStartDayMs: 1,
          windowEndDayMs: 2,
          coverage: {
            candidateActivityCount: 4,
            evidenceActivityCount: 3,
            eligibleActivityCount: 3,
            missingEvidenceActivityCount: 1,
            excludedActivityCount: 0,
            eligibilityRatio: 0.75,
            exclusions: [],
          },
          summaries: [{
            context: {
              contextKey: 'running|grade-adjusted-speed',
              scope: 'running',
              outputSource: 'grade-adjusted-speed',
              outputUnit: 'm/s',
              poolLengthMeters: null,
              stroke: null,
            },
            sampleCount: 3,
            medianDurationSeconds: 4_000,
            medianCoverageRatio: 0.8,
            medianDecouplingPercent: 3.2,
            medianOutputRetentionPercent: 98,
            medianHeartRateDriftBpm: 3,
            medianPaceRetentionPercent: null,
            medianSwolfChange: null,
          }],
        },
        baselineBlocks: [],
        usual: { coverage: {} as never, summaries: [] },
        weeks: [
          { periodDays: 7, windowStartDayMs: 100, windowEndDayMs: 200, coverage: {} as never, summaries: [] },
          {
            periodDays: 7,
            windowStartDayMs: 200,
            windowEndDayMs: 300,
            coverage: {} as never,
            summaries: [{
              context: {
                contextKey: 'running|grade-adjusted-speed',
                scope: 'running',
                outputSource: 'grade-adjusted-speed',
                outputUnit: 'm/s',
                poolLengthMeters: null,
                stroke: null,
              },
              sampleCount: 1,
              medianDurationSeconds: 4_000,
              medianCoverageRatio: 0.8,
              medianDecouplingPercent: 2.8,
              medianOutputRetentionPercent: 99,
              medianHeartRateDriftBpm: 2,
              medianPaceRetentionPercent: null,
              medianSwolfChange: null,
            }],
          },
        ],
        recentSupportingEvents: [],
      }],
    });

    expect(context).toMatchObject({
      value: 3.2,
      metric: 'decoupling',
      scopeLabel: 'Running',
      sampleCount: 3,
      eligibilityRatio: 0.75,
      trend: [
        { time: 100, value: null },
        { time: 200, value: 2.8 },
      ],
    });
  });

  it('selects the durability context with the strongest sample evidence across disciplines', () => {
    const context = buildDashboardAerobicDurabilityContext({
      scopes: [
        {
          scope: 'running',
          current: {
            coverage: { eligibilityRatio: 1 },
            summaries: [{
              context: { contextKey: 'running|power', outputSource: 'power' },
              sampleCount: 1,
              medianDecouplingPercent: 2,
            }],
          },
          weeks: [],
        },
        {
          scope: 'cycling',
          current: {
            coverage: { eligibilityRatio: 0.8 },
            summaries: [{
              context: { contextKey: 'cycling|power', outputSource: 'power' },
              sampleCount: 4,
              medianDecouplingPercent: 3.5,
            }],
          },
          weeks: [],
        },
      ],
    } as never);

    expect(context).toMatchObject({
      value: 3.5,
      scopeLabel: 'Cycling',
      sampleCount: 4,
      eligibilityRatio: 0.8,
    });
  });

  it('uses a deterministic context-key tie-breaker and formats pool context for display', () => {
    const context = buildDashboardAerobicDurabilityContext({
      scopes: [{
        scope: 'pool-swimming',
        current: {
          coverage: { eligibilityRatio: 1 },
          summaries: [
            {
              context: {
                contextKey: 'pool|50|backstroke',
                scope: 'pool-swimming',
                outputSource: 'pool-length-speed',
                poolLengthMeters: 50,
                stroke: 'backstroke',
              },
              sampleCount: 3,
              medianPaceRetentionPercent: 96,
            },
            {
              context: {
                contextKey: 'pool|25|freestyle',
                scope: 'pool-swimming',
                outputSource: 'pool-length-speed',
                poolLengthMeters: 25,
                stroke: 'freestyle',
              },
              sampleCount: 3,
              medianPaceRetentionPercent: 98,
            },
          ],
        },
        weeks: [],
      }],
    } as never);

    expect(context).toMatchObject({
      value: 98,
      metric: 'pace-retention',
      contextLabel: '25 m · Freestyle',
    });
  });

  it('scores readiness from available load and sleep signals and reports confidence separately', () => {
    const baselinePoints = Array.from({ length: 6 }, (_, index) => ({
      id: `baseline-${index}`,
      sleepDate: `2026-01-0${index + 1}`,
      provider: 'GarminAPI',
      startTimeMs: index * 100,
      endTimeMs: (index * 100) + 50,
      totalSeconds: 8 * 3600,
      score: 80,
      averageHrvMs: 50,
      minimumHeartRateBpm: 50,
      isNap: false,
      isPlaceholder: false,
    }));
    const latestPoint = {
      id: 'latest',
      sleepDate: '2026-01-07',
      provider: 'GarminAPI',
      startTimeMs: 700,
      endTimeMs: 750,
      totalSeconds: 8 * 3600,
      score: 90,
      averageHrvMs: 55,
      minimumHeartRateBpm: 48,
      isNap: false,
      isPlaceholder: false,
    };

    const context = buildDashboardReadinessSignalsContext({
      formNow: { value: 10 } as never,
      rampRate: { rampRate: 1 } as never,
      sleepTrend: {
        points: [...baselinePoints, latestPoint] as never,
        latestPoint: latestPoint as never,
      },
      nowMs: 800,
    });

    expect(context?.label).toBe('Ready');
    expect(context?.confidence).toBe('high');
    expect(context?.availableSignalCount).toBe(4);
    expect(context?.score).toBeGreaterThanOrEqual(78);
    expect(context?.hrvRatio).toBeCloseTo(1.1);
    expect(context?.minimumHeartRateRatio).toBeCloseTo(0.96);
    expect(context?.rampRate).toBe(1);
    expect(context?.latestSleepAtMs).toBe(750);
    expect(context?.trend).toEqual([]);
  });

  it('uses the latest aggregated non-nap point and a same-provider baseline', () => {
    const context = buildDashboardReadinessSignalsContext({
      formNow: null,
      rampRate: null,
      sleepTrend: {
        points: [
          {
            id: 'garmin-old-1', sleepDate: '2026-01-01', provider: 'GarminAPI',
            startTimeMs: 100, endTimeMs: 150, totalSeconds: 8 * 3600, score: 75,
            averageHrvMs: 40, minimumHeartRateBpm: 50, isNap: false, isPlaceholder: false,
          },
          {
            id: 'garmin-old-2', sleepDate: '2026-01-02', provider: 'GarminAPI',
            startTimeMs: 200, endTimeMs: 250, totalSeconds: 8 * 3600, score: 76,
            averageHrvMs: 40, minimumHeartRateBpm: 50, isNap: false, isPlaceholder: false,
          },
          {
            id: 'garmin-old-3', sleepDate: '2026-01-03', provider: 'GarminAPI',
            startTimeMs: 300, endTimeMs: 350, totalSeconds: 8 * 3600, score: 77,
            averageHrvMs: 40, minimumHeartRateBpm: 50, isNap: false, isPlaceholder: false,
          },
          {
            id: 'suunto-old', sleepDate: '2026-01-04', provider: 'SuuntoApp',
            startTimeMs: 400, endTimeMs: 450, totalSeconds: 8 * 3600, score: 80,
            averageHrvMs: 100, minimumHeartRateBpm: 30, isNap: false, isPlaceholder: false,
          },
          {
            id: 'garmin-latest', sleepDate: '2026-01-05', provider: 'GarminAPI',
            startTimeMs: 500, endTimeMs: 550, totalSeconds: 8 * 3600, score: 90,
            averageHrvMs: 44, minimumHeartRateBpm: 48, isNap: false, isPlaceholder: false,
          },
        ] as never,
        latestPoint: {
          id: 'newer-nap', startTimeMs: 600, endTimeMs: 650, isNap: true,
        } as never,
      },
      nowMs: 600,
    });

    expect(context).toMatchObject({
      sleepScore: 90,
      hrvRatio: 1.1,
      minimumHeartRateRatio: 0.96,
      availableSignalCount: 3,
    });
  });

  it('ignores stale sleep evidence in current readiness', () => {
    const context = buildDashboardReadinessSignalsContext({
      formNow: { value: 10 } as never,
      rampRate: { rampRate: 1 } as never,
      sleepTrend: {
        points: [{
          id: 'old', sleepDate: '2026-01-01', provider: 'GarminAPI',
          startTimeMs: 100, endTimeMs: 200, totalSeconds: 8 * 3600, score: 95,
          averageHrvMs: 60, minimumHeartRateBpm: 45, isNap: false, isPlaceholder: false,
        }] as never,
        latestPoint: null,
      },
      nowMs: 200 + (49 * 60 * 60 * 1000),
    });

    expect(context).toMatchObject({
      availableSignalCount: 1,
      sleepScore: null,
      hrvRatio: null,
      minimumHeartRateRatio: null,
      trend: [],
    });
  });

  it('ignores future-dated sleep without suppressing the latest valid night', () => {
    const nowMs = Date.UTC(2026, 0, 10, 12);
    const context = buildDashboardReadinessSignalsContext({
      sleepTrend: {
        points: [
          {
            id: 'valid', sleepDate: '2026-01-10', provider: 'GarminAPI',
            startTimeMs: nowMs - (9 * 60 * 60 * 1000), endTimeMs: nowMs - (60 * 60 * 1000),
            totalSeconds: 8 * 3600, score: 88, averageHrvMs: null,
            minimumHeartRateBpm: null, isNap: false, isPlaceholder: false,
          },
          {
            id: 'future', sleepDate: '2026-01-11', provider: 'GarminAPI',
            startTimeMs: nowMs + (60 * 60 * 1000), endTimeMs: nowMs + (9 * 60 * 60 * 1000),
            totalSeconds: 8 * 3600, score: 10, averageHrvMs: null,
            minimumHeartRateBpm: null, isNap: false, isPlaceholder: false,
          },
        ] as never,
        latestPoint: null,
      },
      nowMs,
    });

    expect(context).toMatchObject({
      score: 88,
      sleepScore: 88,
      latestSleepAtMs: nowMs - (60 * 60 * 1000),
    });
  });

  it('keeps a load-only readiness result low confidence instead of inventing missing recovery data', () => {
    const context = buildDashboardReadinessSignalsContext({
      formNow: { value: -24 } as never,
      rampRate: { rampRate: 4 } as never,
      sleepTrend: null,
    });

    expect(context).toMatchObject({
      label: 'Recover',
      confidence: 'low',
      availableSignalCount: 1,
      totalSignalCount: 4,
      sleepScore: null,
      hrvRatio: null,
      minimumHeartRateRatio: null,
    });
  });
});
