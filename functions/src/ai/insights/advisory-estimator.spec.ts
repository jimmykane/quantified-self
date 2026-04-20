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
  type AdvisoryEstimatorEstimateResult,
  type AdvisoryEstimatorInput,
  type AdvisoryMetricEstimator,
} from './advisory-estimator';

vi.mock('@sports-alliance/sports-lib', async (importOriginal) => await importOriginal());

function buildAdvisoryQuery(
  metricKey: NormalizedInsightAdvisoryQuery['metricKey'],
  advisoryKind: NormalizedInsightAdvisoryQuery['advisoryKind'] = 'expected_value',
): NormalizedInsightAdvisoryQuery {
  return {
    resultKind: 'advisory',
    metricKey,
    advisoryKind,
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

function buildSyntheticEstimate(overrides: Partial<AdvisoryEstimatorEstimateResult> = {}): AdvisoryEstimatorEstimateResult {
  return {
    semanticKind: 'current_ceiling',
    estimate: {
      value: 203,
      unit: 'bpm',
    },
    interval: {
      low: 209,
      high: 201,
      kind: 'deterministic_range',
      confidenceLevel: 'high',
    },
    observed: {
      bestValue: 203,
      bestDate: '2026-03-10T08:00:00.000Z',
      sampleCount: 24,
      qualifyingSampleCount: 4,
      trainingWeeks: 12,
      recencyDays: 5,
    },
    confidence: {
      tier: 'high',
      score: 0.84,
      reasons: ['Synthetic confidence'],
    },
    method: {
      id: 'synthetic-heart-rate',
      version: 'v2',
      deterministic: true,
    },
    evidence: [{
      code: 'synthetic',
      label: 'Synthetic',
      value: 'Synthetic deterministic evidence',
    }],
    ...overrides,
  };
}

function runSharedEstimatorContract(
  estimator: AdvisoryMetricEstimator,
  input: AdvisoryEstimatorInput,
): void {
  const eligibility = estimator.isEligible(input);
  expect(['eligible', 'insufficient_data', 'unsupported']).toContain(eligibility.status);

  if (eligibility.status === 'eligible') {
    const estimate = estimator.estimate(input);
    expect(estimate.semanticKind).toBe(
      input.query.advisoryKind === 'potential_value'
        ? 'potential_ceiling'
        : 'current_ceiling',
    );
    expect(Number.isFinite(estimate.estimate.value)).toBe(true);
    expect(Number.isFinite(estimate.interval.low)).toBe(true);
    expect(Number.isFinite(estimate.interval.high)).toBe(true);
    expect(['low', 'medium', 'high']).toContain(estimate.confidence.tier);
    expect(estimate.interval.kind).toBe('deterministic_range');
    expect(estimate.method.deterministic).toBe(true);
    expect(estimate.evidence.length).toBeGreaterThan(0);
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
      matchedEvents: buildWeeklyHeartRateEvents([170, 173, 176, 179, 182, 184, 184, 185]),
    });

    expect(result.status).toBe('available');
    if (result.status !== 'available') {
      return;
    }

    expect(result.metricKey).toBe('heart_rate');
    expect(result.semanticKind).toBe('current_ceiling');
    expect(result.estimate).not.toBeNull();
    expect(result.interval).not.toBeNull();
    expect(result.confidence.tier).not.toBeNull();
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it('returns potential-ceiling estimates for heart_rate when advisory kind requests potential mode', () => {
    const query = buildAdvisoryQuery('heart_rate', 'potential_value');
    const result = executeAdvisoryEstimator({
      query,
      matchedEvents: buildWeeklyHeartRateEvents([170, 173, 176, 179, 182, 184, 184, 185]),
    });

    expect(result.status).toBe('available');
    if (result.status !== 'available' || !result.estimate || !result.interval) {
      return;
    }

    expect(result.semanticKind).toBe('potential_ceiling');
    expect(result.estimate.value).toBeGreaterThanOrEqual(185);
    expect(result.interval.high).toBeGreaterThanOrEqual(result.estimate.value);
  });

  it('never estimates below observed max heart-rate in the selected scope', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimator({
      query,
      matchedEvents: buildWeeklyHeartRateEvents([162, 168, 172, 176, 188, 190, 191, 192]),
    });

    expect(result.status).toBe('available');
    if (result.status !== 'available' || !result.estimate || !result.interval) {
      return;
    }

    expect(result.estimate.value).toBeGreaterThanOrEqual(192);
    expect(result.interval.high).toBeGreaterThanOrEqual(192);
  });

  it('anchors current-ceiling heart-rate expected value to the observed max and keeps the high bound conservative', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimator({
      query,
      matchedEvents: buildWeeklyHeartRateEvents([166, 171, 175, 178, 189, 190, 191, 192]),
    });

    expect(result.status).toBe('available');
    if (result.status !== 'available' || !result.estimate || !result.interval) {
      return;
    }

    expect(result.estimate.value).toBe(192);
    expect(result.interval.high).toBeLessThanOrEqual(196);
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

    expect(result.estimate?.value).toBe(189);
    expect(result.confidence.tier).toBe('high');
  });

  it('caps confidence when near-max tail support is sparse despite high coverage', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimator({
      query,
      matchedEvents: buildWeeklyHeartRateEvents([
        170, 170, 171, 171, 172, 172, 173, 173,
        174, 174, 175, 175, 176, 176, 177, 177,
        178, 178, 189, 189, 189, 189, 189, 193,
      ]),
    });

    expect(result.status).toBe('available');
    if (result.status !== 'available') {
      return;
    }

    expect(result.observed.qualifyingSampleCount).toBe(1);
    expect(result.confidence.tier).toBe('medium');
    expect(result.confidence.score).toBeLessThanOrEqual(0.69);
    expect(result.confidence.reasons.some(reason => reason.includes('Tail-confidence cap applied'))).toBe(true);
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

    expect(result.estimate?.value).toBe(189);
    expect(result.confidence.tier).toBe('medium');
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
    expect(result.insufficientData?.reasonCode).toBe('too_few_samples');
    expect((result.insufficientData?.message ?? '').length).toBeGreaterThan(0);
  });

  it('returns insufficient_data for low-intensity-only scopes such as hiking', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimator({
      query,
      matchedEvents: buildWeeklyHeartRateEvents([132, 134, 135, 136, 137, 138, 139, 140], ActivityTypes.Hiking),
    });

    expect(result.status).toBe('insufficient_data');
    expect(result.insufficientData?.reasonCode).toBe('low_intensity_scope');
  });

  it('returns weak-tail insufficient_data with observed diagnostics preserved', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimator({
      query,
      matchedEvents: buildWeeklyHeartRateEvents([160, 165, 170, 172, 174, 176, 178, 188]),
    });

    expect(result.status).toBe('insufficient_data');
    if (result.status !== 'insufficient_data') {
      return;
    }

    expect(result.insufficientData?.reasonCode).toBe('weak_tail_signal');
    expect(result.observed.sampleCount).toBe(8);
    expect(result.observed.trainingWeeks).toBe(8);
    expect(result.observed.bestValue).toBe(188);
    expect(result.observed.qualifyingSampleCount).toBe(1);
  });

  it('ignores implausible heart-rate spikes above the physiologic cap', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimator({
      query,
      matchedEvents: buildWeeklyHeartRateEvents([168, 170, 174, 176, 179, 180, 181, 182, 252]),
    });

    expect(result.status).toBe('available');
    if (result.status !== 'available' || !result.estimate || !result.interval) {
      return;
    }

    expect(result.estimate.value).toBe(182);
    expect(result.interval.high).toBeLessThanOrEqual(230);
    expect(result.observed.bestValue).toBe(182);
  });

  it('trims isolated extreme peaks above 220 bpm before estimating', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimator({
      query,
      matchedEvents: buildWeeklyHeartRateEvents([168, 170, 174, 176, 179, 180, 181, 182, 230]),
    });

    expect(result.status).toBe('available');
    if (result.status !== 'available' || !result.estimate || !result.interval) {
      return;
    }

    expect(result.estimate.value).toBe(182);
    expect(result.interval.high).toBeLessThanOrEqual(230);
    expect(result.observed.bestValue).toBe(182);
  });

  it('returns unsupported for scaffolded ftp estimator until enabled', () => {
    const query = buildAdvisoryQuery('ftp');
    const result = executeAdvisoryEstimator({
      query,
      matchedEvents: [],
    });

    expect(result.status).toBe('unsupported');
    expect(result.evidence.some(entry => entry.value.includes('not enabled'))).toBe(true);
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
      estimate: () => buildSyntheticEstimate(),
      explainability: () => '  ',
    } satisfies AdvisoryMetricEstimator);

    expect(result.status).toBe('available');
    if (result.status !== 'available') {
      return;
    }

    expect(result.interval?.low).toBe(201);
    expect(result.interval?.high).toBe(209);
    expect(result.estimate?.value).toBe(203);
    expect(result.evidence[0]?.value).toBe('Synthetic deterministic evidence');
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
      estimate: () => buildSyntheticEstimate({
        estimate: {
          value: 184,
          unit: 'bpm',
        },
        interval: {
          low: 169,
          high: 192,
          kind: 'deterministic_range',
          confidenceLevel: 'medium',
        },
        confidence: {
          tier: 'medium',
          score: 0.61,
          reasons: ['Synthetic confidence'],
        },
      }),
      explainability: () => 'Synthetic deterministic evidence',
    } satisfies AdvisoryMetricEstimator);

    expect(result.status).toBe('available');
    if (result.status !== 'available' || !result.estimate || !result.interval) {
      return;
    }

    expect(result.estimate.value).toBeGreaterThanOrEqual(192);
    expect(result.interval.high).toBeGreaterThanOrEqual(192);
    expect(result.interval.low).toBeLessThanOrEqual(result.estimate.value);
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
      estimate: () => buildSyntheticEstimate({
        estimate: {
          value: Number.NaN,
          unit: 'bpm',
        },
      }),
      explainability: () => 'This should not be used.',
    } satisfies AdvisoryMetricEstimator);

    expect(result.status).toBe('unsupported');
    expect(result.evidence.some(entry => entry.value.includes('invalid estimate output'))).toBe(true);
  });

  it('returns unsupported when estimator eligibility throws', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimatorWithResolvedEstimator({
      query,
      matchedEvents: [],
    }, {
      metricKey: 'heart_rate',
      enabled: true,
      isEligible: () => {
        throw new Error('eligibility crash');
      },
      estimate: () => buildSyntheticEstimate(),
      explainability: () => 'unused',
    } satisfies AdvisoryMetricEstimator);

    expect(result.status).toBe('unsupported');
    expect(result.evidence.some(entry => entry.value.includes('failed eligibility checks'))).toBe(true);
  });

  it('returns unsupported when estimator estimate throws', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimatorWithResolvedEstimator({
      query,
      matchedEvents: [],
    }, {
      metricKey: 'heart_rate',
      enabled: true,
      isEligible: () => ({ status: 'eligible' }),
      estimate: () => {
        throw new Error('estimate crash');
      },
      explainability: () => 'unused',
    } satisfies AdvisoryMetricEstimator);

    expect(result.status).toBe('unsupported');
    expect(result.evidence.some(entry => entry.value.includes('failed while estimating'))).toBe(true);
  });

  it('returns unsupported instead of throwing when estimator output omits required nested objects', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimatorWithResolvedEstimator({
      query,
      matchedEvents: [],
    }, {
      metricKey: 'heart_rate',
      enabled: true,
      isEligible: () => ({ status: 'eligible' }),
      estimate: () => ({
        semanticKind: 'current_ceiling',
        estimate: {
          value: 184,
          unit: 'bpm',
        },
        interval: {
          low: 180,
          high: 190,
          kind: 'deterministic_range',
          confidenceLevel: 'medium',
        },
      } as unknown as AdvisoryEstimatorEstimateResult),
      explainability: () => 'This should not be used.',
    } satisfies AdvisoryMetricEstimator);

    expect(result.status).toBe('unsupported');
    expect(result.evidence.some(entry => entry.value.includes('invalid estimate output'))).toBe(true);
  });

  it('ignores malformed evidence entries from estimator output without throwing', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimatorWithResolvedEstimator({
      query,
      matchedEvents: [],
    }, {
      metricKey: 'heart_rate',
      enabled: true,
      isEligible: () => ({ status: 'eligible' }),
      estimate: () => ({
        ...buildSyntheticEstimate(),
        evidence: [
          {
            code: 'synthetic',
            label: 'Synthetic',
            value: 'Synthetic deterministic evidence',
          },
          null as unknown as {
            code: string;
            label: string;
            value: string;
          },
        ],
      }),
      explainability: () => '  ',
    } satisfies AdvisoryMetricEstimator);

    expect(result.status).toBe('available');
    if (result.status !== 'available') {
      return;
    }

    expect(result.evidence.length).toBe(1);
    expect(result.evidence[0]?.code).toBe('synthetic');
  });

  it('falls back to normalized estimate evidence when explainability throws', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimatorWithResolvedEstimator({
      query,
      matchedEvents: [],
    }, {
      metricKey: 'heart_rate',
      enabled: true,
      isEligible: () => ({ status: 'eligible' }),
      estimate: () => buildSyntheticEstimate(),
      explainability: () => {
        throw new Error('explainability crash');
      },
    } satisfies AdvisoryMetricEstimator);

    expect(result.status).toBe('available');
    if (result.status !== 'available') {
      return;
    }

    expect(result.evidence.some(entry => entry.code === 'synthetic')).toBe(true);
  });

  it('maps eligibility details into insufficient-data observed diagnostics', () => {
    const query = buildAdvisoryQuery('heart_rate');
    const result = executeAdvisoryEstimatorWithResolvedEstimator({
      query,
      matchedEvents: [],
    }, {
      metricKey: 'heart_rate',
      enabled: true,
      isEligible: () => ({
        status: 'insufficient_data',
        reasonCode: 'weak_tail_signal',
        message: 'Tail signal is weak.',
        suggestedQuery: 'Show my max heart rate over time this year.',
        details: {
          sampleCount: 14,
          qualifyingSampleCount: 1,
          trainingWeeks: 6,
          recencyDays: 2,
          bestValue: 191,
          bestDate: '2026-03-10T08:00:00.000Z',
        },
      }),
      estimate: () => buildSyntheticEstimate(),
      explainability: () => 'unused',
    } satisfies AdvisoryMetricEstimator);

    expect(result.status).toBe('insufficient_data');
    if (result.status !== 'insufficient_data') {
      return;
    }

    expect(result.observed.sampleCount).toBe(14);
    expect(result.observed.qualifyingSampleCount).toBe(1);
    expect(result.observed.trainingWeeks).toBe(6);
    expect(result.observed.recencyDays).toBe(2);
    expect(result.observed.bestValue).toBe(191);
    expect(result.observed.bestDate).toBe('2026-03-10T08:00:00.000Z');
    expect(result.evidence.some(entry => entry.code === 'sample_count' && entry.value === '14')).toBe(true);
  });
});
