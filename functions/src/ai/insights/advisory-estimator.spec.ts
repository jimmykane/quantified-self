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

function buildHeartRateEvent(
  eventID: string,
  heartRateMax: number,
  startDate = '2026-03-10T08:00:00.000Z',
  activityType: ActivityTypes = ActivityTypes.Cycling,
): EventInterface {
  return {
    startDate: new Date(startDate),
    getID: () => eventID,
    getActivityTypesAsArray: () => [activityType],
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

function buildWeeklyHeartRateEvents(
  heartRateValues: number[],
  activityType: ActivityTypes = ActivityTypes.Cycling,
): EventInterface[] {
  const firstEventTime = Date.parse('2026-01-05T08:00:00.000Z');
  return heartRateValues.map((heartRateMax, index) => (
    buildHeartRateEvent(
      `event-${index + 1}`,
      heartRateMax,
      new Date(firstEventTime + (index * 7 * 24 * 60 * 60 * 1000)).toISOString(),
      activityType,
    )
  ));
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
      matchedEvents: buildWeeklyHeartRateEvents([170, 173, 175, 178, 180, 181, 182, 185]),
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
      matchedEvents: buildWeeklyHeartRateEvents([162, 168, 172, 176, 180, 184, 189, 192]),
    });

    expect(result.status).toBe('available');
    if (result.status !== 'available') {
      return;
    }

    expect(result.estimate).toBeGreaterThanOrEqual(192);
    expect(result.rangeHigh).toBeGreaterThanOrEqual(192);
  });

  it('anchors heart-rate expected value to the observed max and keeps the high bound conservative', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimator({
      query,
      matchedEvents: buildWeeklyHeartRateEvents([166, 171, 175, 178, 181, 186, 190, 192]),
    });

    expect(result.status).toBe('available');
    if (result.status !== 'available') {
      return;
    }

    expect(result.estimate).toBe(192);
    expect(result.rangeHigh).toBeLessThanOrEqual(196);
  });

  it('retains high confidence when top heart-rate samples are clustered', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const matchedEvents = Array.from({ length: 24 }, (_value, index) => {
      const heartRateMax = index < 20 ? 175 : 186 + (index - 20);
      const startDate = new Date(Date.UTC(2026, 0, 1 + (index * 3), 8, 0, 0, 0)).toISOString();
      return buildHeartRateEvent(`event-${index + 1}`, heartRateMax, startDate);
    });
    const result = executeAdvisoryEstimator({
      query,
      matchedEvents,
    });

    expect(result.status).toBe('available');
    if (result.status !== 'available') {
      return;
    }

    expect(result.estimate).toBe(189);
    expect(result.confidenceTier).toBe('high');
  });

  it('downgrades confidence by one tier when the observed max is an isolated spike', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const matchedEvents = Array.from({ length: 24 }, (_value, index) => {
      const heartRateMax = index < 23 ? 172 + (index % 4) : 189;
      const startDate = new Date(Date.UTC(2026, 0, 1 + (index * 3), 8, 0, 0, 0)).toISOString();
      return buildHeartRateEvent(`event-${index + 1}`, heartRateMax, startDate);
    });
    const result = executeAdvisoryEstimator({
      query,
      matchedEvents,
    });

    expect(result.status).toBe('available');
    if (result.status !== 'available') {
      return;
    }

    expect(result.estimate).toBe(189);
    expect(result.confidenceTier).toBe('medium');
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

  it('returns insufficient_data for low-intensity-only scopes such as hiking', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimator({
      query,
      matchedEvents: buildWeeklyHeartRateEvents([132, 134, 135, 136, 137, 138, 139, 140], ActivityTypes.Hiking),
    });

    expect(result.status).toBe('insufficient_data');
    expect(result.insufficientDataReason).toContain('low-intensity');
  });

  it('ignores implausible heart-rate spikes above the physiologic cap', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimator({
      query,
      matchedEvents: buildWeeklyHeartRateEvents([168, 170, 172, 174, 176, 178, 180, 182, 252]),
    });

    expect(result.status).toBe('available');
    if (result.status !== 'available') {
      return;
    }

    expect(result.estimate).toBe(182);
    expect(result.rangeHigh).toBeLessThanOrEqual(230);
    expect(result.evidenceSummary).toContain('observed max is 182 bpm');
  });

  it('trims isolated extreme peaks above 220 bpm before estimating', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimator({
      query,
      matchedEvents: buildWeeklyHeartRateEvents([168, 170, 172, 174, 176, 178, 180, 182, 230]),
    });

    expect(result.status).toBe('available');
    if (result.status !== 'available') {
      return;
    }

    expect(result.estimate).toBe(182);
    expect(result.rangeHigh).toBeLessThanOrEqual(230);
    expect(result.evidenceSummary).toContain('observed max is 182 bpm');
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
