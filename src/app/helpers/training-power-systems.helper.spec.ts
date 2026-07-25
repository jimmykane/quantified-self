import { describe, expect, it } from 'vitest';
import type {
  DerivedTrainingPowerSystemsComponentStatus,
  DerivedTrainingPowerSystemsReason,
  DerivedTrainingPowerSystemsStatus,
} from '@shared/derived-metrics';
import {
  buildTrainingPowerSystemsActivityTypeViewModels,
  resolveTrainingPowerSystemsMetricPayload,
} from './training-power-systems.helper';

const DAY_MS = 24 * 60 * 60 * 1000;
const asOfDayMs = Date.UTC(2026, 6, 20);

function component(
  status: DerivedTrainingPowerSystemsComponentStatus,
  value: number,
  reason: DerivedTrainingPowerSystemsReason = 'insufficient-history',
) {
  return {
    status,
    reason: status === 'ready' ? null : reason,
    value: status === 'ready' ? value : null,
  };
}

function entry(
  activityType: string,
  status: DerivedTrainingPowerSystemsStatus = 'ready',
  reason: DerivedTrainingPowerSystemsReason | null = null,
) {
  const componentStatus: DerivedTrainingPowerSystemsComponentStatus = status === 'partial' || status === 'ready'
    ? 'ready'
    : status;
  const maximumPowerStatus: DerivedTrainingPowerSystemsComponentStatus = status === 'partial'
    ? 'insufficient-evidence'
    : componentStatus;
  const resolvedReason = status === 'ready'
    ? null
    : reason ?? (status === 'partial' ? 'insufficient-maximum-power-range' : 'insufficient-history');
  const current = {
    effectiveDayMs: asOfDayMs,
    status,
    reason: resolvedReason,
    estimatorVersion: 1,
    activityType,
    sourceFingerprint: 'capacity-v1:test',
    criticalPower: component(componentStatus, 260, resolvedReason ?? 'insufficient-history'),
    wPrime: component(componentStatus, 18_500, resolvedReason ?? 'insufficient-history'),
    maximumPower: component(maximumPowerStatus, 1_200, resolvedReason ?? 'insufficient-history'),
    diagnostics: {
      sourceCount: 3,
      historyStartDayMs: asOfDayMs - (30 * DAY_MS),
      historyEndDayMs: asOfDayMs - DAY_MS,
      historySpanDays: 29,
      rejectedPointCount: 0,
      criticalPowerAnchorCount: 8,
      earlyCriticalPowerAnchorCount: 4,
      longCriticalPowerAnchorCount: 3,
      maximumPowerAnchorCount: status === 'partial' ? 2 : 8,
      criticalPowerNormalizedRmse: status === 'insufficient-evidence' ? null : 0.02,
      criticalPowerSpreadRatio: status === 'insufficient-evidence' ? null : 0.01,
      wPrimeSpreadRatio: status === 'insufficient-evidence' ? null : 0.04,
      criticalPowerLeaveOneOutSpreadRatio: status === 'insufficient-evidence' ? null : 0.02,
      wPrimeLeaveOneOutSpreadRatio: status === 'insufficient-evidence' ? null : 0.08,
      maximumPowerNormalizedRmse: status === 'ready' ? 0.02 : null,
      maximumPowerLeaveOneOutSpreadRatio: status === 'ready' ? 0.04 : null,
    },
  };
  return {
    activityType,
    current,
    history: [{
      effectiveDayMs: asOfDayMs - (14 * DAY_MS),
      status: 'ready',
      reason: null,
      criticalPowerStatus: 'ready',
      criticalPowerWatts: 250,
      wPrimeStatus: 'ready',
      wPrimeJoules: 18_000,
      maximumPowerStatus: 'ready',
      maximumPowerWatts: 1_180,
    }, {
      effectiveDayMs: asOfDayMs - (7 * DAY_MS),
      status: 'insufficient-evidence',
      reason: 'insufficient-history',
      criticalPowerStatus: 'insufficient-evidence',
      criticalPowerWatts: null,
      wPrimeStatus: 'insufficient-evidence',
      wPrimeJoules: null,
      maximumPowerStatus: 'insufficient-evidence',
      maximumPowerWatts: null,
    }, {
      effectiveDayMs: asOfDayMs,
      status: current.status,
      reason: current.reason,
      criticalPowerStatus: current.criticalPower.status,
      criticalPowerWatts: current.criticalPower.value,
      wPrimeStatus: current.wPrime.status,
      wPrimeJoules: current.wPrime.value,
      maximumPowerStatus: current.maximumPower.status,
      maximumPowerWatts: current.maximumPower.value,
    }],
    evidenceCounts: {
      candidateActivityCount: 5,
      usableCurveActivityCount: 3,
      excludedActivityCount: 2,
    },
  };
}

function payload(activityTypes = [entry('Rowing'), entry('Cycling')]) {
  return {
    dayBoundary: 'UTC',
    asOfDayMs,
    policyVersion: 1,
    windowDays: 42,
    historyDays: 84,
    cadence: 'workout-date',
    excludesEffectiveDay: true,
    excludesMergedEvents: true,
    activityTypes,
  };
}

describe('training-power-systems.helper', () => {
  it('strictly normalizes exact canonical types and sorts them for the selector', () => {
    const result = resolveTrainingPowerSystemsMetricPayload(payload());

    expect(result?.activityTypes.map(item => item.activityType)).toEqual(['Cycling', 'Rowing']);
    expect(result?.activityTypes[1].current).toMatchObject({
      status: 'ready',
      criticalPower: { value: 260 },
      wPrime: { value: 18_500 },
      maximumPower: { value: 1_200 },
    });
  });

  it('accepts a discovered same-day type with no preceding evidence as a valid unavailable state', () => {
    const unavailable = entry('Rowing', 'insufficient-evidence', 'no-evidence');
    unavailable.current.sourceFingerprint = null;
    unavailable.current.diagnostics = {
      ...unavailable.current.diagnostics,
      sourceCount: 0,
      historyStartDayMs: null,
      historyEndDayMs: null,
      historySpanDays: 0,
      criticalPowerAnchorCount: 0,
      earlyCriticalPowerAnchorCount: 0,
      longCriticalPowerAnchorCount: 0,
      maximumPowerAnchorCount: 0,
      criticalPowerNormalizedRmse: null,
      criticalPowerSpreadRatio: null,
      wPrimeSpreadRatio: null,
      criticalPowerLeaveOneOutSpreadRatio: null,
      wPrimeLeaveOneOutSpreadRatio: null,
      maximumPowerNormalizedRmse: null,
      maximumPowerLeaveOneOutSpreadRatio: null,
    };
    unavailable.history = [unavailable.history.at(-1)!];
    unavailable.evidenceCounts = {
      candidateActivityCount: 0,
      usableCurveActivityCount: 0,
      excludedActivityCount: 0,
    };

    expect(resolveTrainingPowerSystemsMetricPayload(payload([unavailable]))).not.toBeNull();
  });

  it.each([
    (value: any) => ({ ...value, windowDays: 41 }),
    (value: any) => ({ ...value, activityTypes: [value.activityTypes[0], value.activityTypes[0]] }),
    (value: any) => {
      value.activityTypes[0].current.criticalPower.value = null;
      return value;
    },
    (value: any) => {
      value.activityTypes[0].history[1].criticalPowerWatts = 0;
      return value;
    },
    (value: any) => {
      value.activityTypes[0].history[2].maximumPowerWatts = 999;
      return value;
    },
    (value: any) => {
      value.activityTypes[0].current.diagnostics.sourceCount = 5;
      return value;
    },
    (value: any) => {
      value.activityTypes[0].history[0].effectiveDayMs = asOfDayMs - (85 * DAY_MS);
      return value;
    },
    (value: any) => {
      value.activityTypes[0].current.status = 'ready';
      value.activityTypes[0].current.reason = null;
      value.activityTypes[0].current.maximumPower = component(
        'insufficient-evidence',
        1_200,
        'insufficient-maximum-power-range',
      );
      value.activityTypes[0].history[2].maximumPowerStatus = 'insufficient-evidence';
      value.activityTypes[0].history[2].maximumPowerWatts = null;
      return value;
    },
    (value: any) => {
      value.activityTypes[0].history[1].status = 'partial';
      return value;
    },
    (value: any) => {
      const unavailable = entry('Rowing', 'poor-fit', 'poor-critical-power-fit');
      unavailable.current.criticalPower.reason = 'invalid-source';
      value.activityTypes = [unavailable];
      return value;
    },
    (value: any) => {
      const unavailable = entry('Rowing', 'poor-fit', 'poor-critical-power-fit');
      unavailable.current.reason = 'invalid-source';
      unavailable.current.criticalPower.reason = 'invalid-source';
      unavailable.current.wPrime.reason = 'invalid-source';
      unavailable.current.maximumPower.reason = 'invalid-source';
      const endpoint = unavailable.history.at(-1)!;
      endpoint.reason = 'invalid-source';
      value.activityTypes = [unavailable];
      return value;
    },
    (value: any) => {
      const partial = entry('Rowing', 'partial', 'poor-maximum-power-fit');
      partial.current.maximumPower = component(
        'insufficient-evidence',
        1_200,
        'poor-maximum-power-fit',
      );
      partial.history.at(-1)!.maximumPowerStatus = 'insufficient-evidence';
      value.activityTypes = [partial];
      return value;
    },
    (value: any) => {
      value.activityTypes[0].current.diagnostics.sourceCount = 0;
      value.activityTypes[0].current.diagnostics.historyStartDayMs = null;
      value.activityTypes[0].current.diagnostics.historyEndDayMs = null;
      value.activityTypes[0].current.diagnostics.historySpanDays = 0;
      value.activityTypes[0].evidenceCounts.usableCurveActivityCount = 0;
      value.activityTypes[0].evidenceCounts.excludedActivityCount = 5;
      return value;
    },
    (value: any) => {
      value.activityTypes[0].current.diagnostics.sourceCount = 0;
      value.activityTypes[0].current.diagnostics.historyStartDayMs = null;
      value.activityTypes[0].current.diagnostics.historyEndDayMs = null;
      value.activityTypes[0].current.diagnostics.historySpanDays = 0;
      value.activityTypes[0].current.sourceFingerprint = null;
      value.activityTypes[0].evidenceCounts.usableCurveActivityCount = 0;
      value.activityTypes[0].evidenceCounts.excludedActivityCount = 5;
      return value;
    },
    (value: any) => {
      value.activityTypes[0].current.diagnostics.criticalPowerAnchorCount = 5;
      value.activityTypes[0].current.diagnostics.earlyCriticalPowerAnchorCount = 4;
      value.activityTypes[0].current.diagnostics.longCriticalPowerAnchorCount = 4;
      return value;
    },
    (value: any) => {
      value.activityTypes[0].history[0] = {
        ...value.activityTypes[0].history[0],
        status: 'partial',
        reason: 'poor-maximum-power-fit',
        maximumPowerStatus: 'insufficient-evidence',
        maximumPowerWatts: null,
      };
      return value;
    },
  ])('rejects malformed or internally inconsistent payloads for snapshot self-healing', (mutate) => {
    expect(resolveTrainingPowerSystemsMetricPayload(mutate(structuredClone(payload())))).toBeNull();
  });

  it.each([
    ['ready', null],
    ['partial', 'insufficient-maximum-power-range'],
    ['insufficient-evidence', 'insufficient-history'],
    ['poor-fit', 'poor-critical-power-fit'],
    ['unstable', 'unstable-critical-power-fit'],
    ['invalid-input', 'invalid-source'],
  ] as const)('preserves and explains the %s state without converting missing values to zero', (status, reason) => {
    const normalized = resolveTrainingPowerSystemsMetricPayload(payload([entry('Rowing', status, reason)]));
    const view = buildTrainingPowerSystemsActivityTypeViewModels(normalized)[0];

    expect(view.status).toBe(status);
    expect(view.reasonText.length).toBeGreaterThan(10);
    if (status === 'ready') {
      expect(view.cards.map(card => card.valueText)).toEqual(['260 W', '18.5 kJ', '1,200 W']);
    } else if (status === 'partial') {
      expect(view.cards.map(card => card.valueText)).toEqual(['260 W', '18.5 kJ', 'Unavailable']);
    } else {
      expect(view.cards.every(card => card.valueText === 'Unavailable')).toBe(true);
    }
  });

  it('builds three aligned sparse trends and keeps today as the current endpoint', () => {
    const normalized = resolveTrainingPowerSystemsMetricPayload(payload([entry('Rowing')]));
    const view = buildTrainingPowerSystemsActivityTypeViewModels(normalized)[0];

    expect(view.trends.map(trend => [trend.label, trend.unit])).toEqual([
      ['Critical power', 'W'],
      ['W′', 'kJ'],
      ['Maximum power', 'W'],
    ]);
    view.trends.forEach((trend) => {
      expect(trend.points).toHaveLength(2);
      expect(trend.points.at(-1)).toMatchObject({ dayMs: asOfDayMs, isCurrent: true });
      expect(trend.path).toContain('M');
    });
    expect(view.trends[1].points.map(point => point.value)).toEqual([18, 18.5]);
  });

  it('never creates an all-sports aggregate option', () => {
    const normalized = resolveTrainingPowerSystemsMetricPayload(payload());
    const views = buildTrainingPowerSystemsActivityTypeViewModels(normalized);

    expect(views.map(view => view.activityType)).not.toContain('All sports');
    expect(views).toHaveLength(2);
  });
});
