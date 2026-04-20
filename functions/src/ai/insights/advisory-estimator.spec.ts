import { describe, expect, it, vi } from 'vitest';
import {
  ActivityTypes,
  ChartDataCategoryTypes,
  ChartTypes,
  DataHeartRateMax,
  type EventInterface,
} from '@sports-alliance/sports-lib';
import type { NormalizedInsightAdvisoryQuery } from '../../../../shared/ai-insights.types';
import {
  ADVISORY_ESTIMATOR_KEYS,
  executeAdvisoryEstimator,
  executeAdvisoryEstimatorWithResolvedEstimator,
  resolveAdvisoryEstimator,
  type AdvisoryEstimatorInput,
  type AdvisoryMetricEstimator,
} from './advisory-estimator';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

function buildAdvisoryQuery(metricKey: NormalizedInsightAdvisoryQuery['metricKey']): NormalizedInsightAdvisoryQuery {
  return {
    resultKind: 'advisory',
    metricKey,
    advisoryKind: 'expected_value',
    horizon: 'current_year',
    categoryType: ChartDataCategoryTypes.DateType,
    activityTypeGroups: [],
    activityTypes: [ActivityTypes.Cycling],
    activityFilters: {
      activityTypeGroups: [],
      activityTypes: [ActivityTypes.Cycling],
    },
    dateRange: {
      kind: 'bounded',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-03-31T23:59:59.999Z',
      timezone: 'UTC',
      source: 'prompt',
    },
    chartType: ChartTypes.LinesVertical,
  };
}

function buildHeartRateEvent(eventID: string, heartRateMax: number): EventInterface {
  return {
    startDate: new Date('2026-03-10T08:00:00.000Z'),
    getID: () => eventID,
    getActivityTypesAsArray: () => [ActivityTypes.Cycling],
    getStat: (dataType: string) => {
      if (dataType === DataHeartRateMax.type) {
        return {
          getValue: () => heartRateMax,
        };
      }
      return null;
    },
  } as unknown as EventInterface;
}

function runSharedEstimatorContract(
  estimator: AdvisoryMetricEstimator,
  input: AdvisoryEstimatorInput,
): void {
  const eligibility = estimator.isEligible(input);
  expect(['eligible', 'insufficient_data', 'unsupported']).toContain(eligibility.status);
  if (eligibility.status === 'eligible') {
    const estimate = estimator.estimate(input);
    expect(Number.isFinite(estimate.pointEstimate)).toBe(true);
    expect(Number.isFinite(estimate.rangeLow)).toBe(true);
    expect(Number.isFinite(estimate.rangeHigh)).toBe(true);
    expect(['low', 'medium', 'high']).toContain(estimate.confidenceTier);
    expect(estimate.rangeLow).toBeLessThanOrEqual(estimate.rangeHigh);
    expect(estimator.explainability(input, estimate).length).toBeGreaterThan(0);
  }
}

describe('advisory-estimator', () => {
  it('registers advisory estimators by metric key', () => {
    expect(ADVISORY_ESTIMATOR_KEYS).toContain('heart_rate');
    expect(ADVISORY_ESTIMATOR_KEYS).toContain('ftp');
  });

  it('returns available estimates for heart_rate when enough samples exist', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimator({
      query,
      matchedEvents: [
        buildHeartRateEvent('event-1', 178),
        buildHeartRateEvent('event-2', 182),
        buildHeartRateEvent('event-3', 185),
        buildHeartRateEvent('event-4', 181),
      ],
    });

    expect(result.status).toBe('available');
    if (result.status !== 'available') {
      return;
    }

    expect(result.metricKey).toBe('heart_rate');
    expect(result.estimate).toBeTypeOf('number');
    expect(result.rangeLow).toBeTypeOf('number');
    expect(result.rangeHigh).toBeTypeOf('number');
    expect(result.confidenceTier).not.toBeNull();
    expect(result.evidenceSummary.length).toBeGreaterThan(0);
  });

  it('never estimates below observed max heart-rate in the selected scope', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimator({
      query,
      matchedEvents: [
        buildHeartRateEvent('event-1', 162),
        buildHeartRateEvent('event-2', 168),
        buildHeartRateEvent('event-3', 172),
        buildHeartRateEvent('event-4', 192),
      ],
    });

    expect(result.status).toBe('available');
    if (result.status !== 'available') {
      return;
    }

    expect(result.estimate).toBeGreaterThanOrEqual(192);
    expect(result.rangeHigh).toBeGreaterThanOrEqual(192);
  });

  it('returns insufficient_data for heart_rate when samples are sparse', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimator({
      query,
      matchedEvents: [
        buildHeartRateEvent('event-1', 178),
      ],
    });

    expect(result.status).toBe('insufficient_data');
    expect(result.insufficientDataReason?.length).toBeGreaterThan(0);
  });

  it('returns unsupported for scaffolded ftp estimator until enabled', () => {
    const query = buildAdvisoryQuery('ftp');
    const result = executeAdvisoryEstimator({
      query,
      matchedEvents: [],
    });

    expect(result.status).toBe('unsupported');
    expect(result.evidenceSummary).toContain('not enabled');
  });

  it('enforces shared estimator contract checks for every registered estimator', () => {
    ADVISORY_ESTIMATOR_KEYS.forEach((metricKey) => {
      const estimator = resolveAdvisoryEstimator(metricKey);
      expect(estimator).not.toBeNull();
      if (!estimator) {
        return;
      }

      runSharedEstimatorContract(estimator, {
        query: buildAdvisoryQuery(metricKey as NormalizedInsightAdvisoryQuery['metricKey']),
        matchedEvents: [
          buildHeartRateEvent('event-1', 176),
          buildHeartRateEvent('event-2', 181),
          buildHeartRateEvent('event-3', 184),
        ],
      });
    });
  });

  it('normalizes advisory estimator ranges and falls back to evidence list when explainability is blank', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimatorWithResolvedEstimator({
      query,
      matchedEvents: [],
    }, {
      metricKey: 'heart_rate',
      enabled: true,
      isEligible: () => ({ status: 'eligible' }),
      estimate: () => ({
        pointEstimate: 203,
        rangeLow: 209,
        rangeHigh: 201,
        confidenceTier: 'high',
        evidence: ['Synthetic deterministic evidence'],
      }),
      explainability: () => '  ',
    } satisfies AdvisoryMetricEstimator);

    expect(result.status).toBe('available');
    if (result.status !== 'available') {
      return;
    }

    expect(result.rangeLow).toBe(201);
    expect(result.rangeHigh).toBe(209);
    expect(result.estimate).toBe(203);
    expect(result.evidenceSummary).toBe('Synthetic deterministic evidence');
  });

  it('enforces heart-rate invariant when custom estimator outputs below observed max', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimatorWithResolvedEstimator({
      query,
      matchedEvents: [
        buildHeartRateEvent('event-1', 171),
        buildHeartRateEvent('event-2', 176),
        buildHeartRateEvent('event-3', 192),
      ],
    }, {
      metricKey: 'heart_rate',
      enabled: true,
      isEligible: () => ({ status: 'eligible' }),
      estimate: () => ({
        pointEstimate: 184,
        rangeLow: 169,
        rangeHigh: 192,
        confidenceTier: 'medium',
        evidence: ['Synthetic deterministic evidence'],
      }),
      explainability: () => 'Synthetic deterministic evidence',
    } satisfies AdvisoryMetricEstimator);

    expect(result.status).toBe('available');
    if (result.status !== 'available') {
      return;
    }

    expect(result.estimate).toBeGreaterThanOrEqual(192);
    expect(result.rangeHigh).toBeGreaterThanOrEqual(192);
    expect(result.rangeLow).toBeLessThanOrEqual(result.estimate ?? 0);
  });

  it('returns unsupported when an advisory estimator produces invalid numeric output', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimatorWithResolvedEstimator({
      query,
      matchedEvents: [],
    }, {
      metricKey: 'heart_rate',
      enabled: true,
      isEligible: () => ({ status: 'eligible' }),
      estimate: () => ({
        pointEstimate: Number.NaN,
        rangeLow: 180,
        rangeHigh: 190,
        confidenceTier: 'medium',
        evidence: ['invalid numeric output'],
      }),
      explainability: () => 'This should not be used.',
    } satisfies AdvisoryMetricEstimator);

    expect(result.status).toBe('unsupported');
    expect(result.evidenceSummary).toContain('invalid estimate output');
  });
});
