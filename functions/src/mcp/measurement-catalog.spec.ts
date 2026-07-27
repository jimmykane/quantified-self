import {
  DataWeight,
} from '@sports-alliance/sports-lib';
import {
  DERIVED_METRIC_KINDS,
} from '../../../shared/derived-metrics';
import {
  getMcpMeasurementCatalog,
  isFirstClassMcpMeasurementMetric,
  isMcpMeasurementValueAllowed,
  resolveMcpMeasurementDefinition,
} from './measurement-catalog';

describe('MCP measurement catalog', () => {
  it('describes body weight through the canonical Sports Lib metric', () => {
    expect(getMcpMeasurementCatalog()).toEqual([{
      id: 'body_weight',
      displayName: 'Body weight',
      description: expect.stringContaining('Recorded body-weight measurements'),
      canonicalMetric: expect.objectContaining({
        type: DataWeight.type,
        unit: 'kg',
      }),
      defaultAggregation: 'median',
      supportedAggregations: [
        'median',
        'average',
        'minimum',
        'maximum',
        'latest',
      ],
      defaultInterval: 'day',
      supportedIntervals: ['day', 'week', 'month'],
      maximumRangeDays: 366,
      requiresExplicitIanaTimeZone: true,
      currentTrend: {
        tool: 'get_training_metric',
        metricKind: DERIVED_METRIC_KINDS.BodyWeightTrend,
        requiredScope: 'metrics:read',
        windowDays: 28,
        dayBoundaryTimeZone: 'UTC',
        readiness: 'ready_snapshot_required',
      },
    }]);
  });

  it('resolves natural body-weight aliases without broadening the safe catalog', () => {
    const bodyWeight = resolveMcpMeasurementDefinition('body mass');

    expect(bodyWeight?.id).toBe('body_weight');
    expect(bodyWeight?.canonicalMetricType).toBe(DataWeight.type);
    expect(isFirstClassMcpMeasurementMetric(DataWeight.type)).toBe(true);
    expect(isFirstClassMcpMeasurementMetric('Latitude')).toBe(false);
    expect(resolveMcpMeasurementDefinition('latitude')).toBeNull();
  });

  it('rejects non-positive or non-finite body-weight values', () => {
    const bodyWeight = resolveMcpMeasurementDefinition('body_weight');
    expect(bodyWeight).not.toBeNull();
    if (!bodyWeight) {
      return;
    }

    expect(isMcpMeasurementValueAllowed(bodyWeight, 72.4)).toBe(true);
    expect(isMcpMeasurementValueAllowed(bodyWeight, 0)).toBe(false);
    expect(isMcpMeasurementValueAllowed(bodyWeight, Number.NaN)).toBe(false);
  });
});
