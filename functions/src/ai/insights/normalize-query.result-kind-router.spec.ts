import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NORMALIZE_QUERY_ROUTE_DEFINITIONS,
  resolveNormalizeQueryRouteDecision,
  resolveResultKindRouteDecision,
  type ResultKindRouteDefinition,
} from './normalize-query.result-kind-router';

describe('normalize-query.result-kind-router', () => {
  it('routes unsupported capability prompts to the unsupported guard route', () => {
    const decision = resolveNormalizeQueryRouteDecision({
      hasUnsupportedCapability: true,
      hasPowerCurveIntent: false,
      hasDigestIntent: false,
      hasMultiMetricIntent: false,
      hasLatestEventIntent: false,
    });

    expect(decision).toEqual(expect.objectContaining({
      routeId: 'unsupported_capability',
      resultKind: null,
      source: 'deterministic',
    }));
  });

  it('prioritizes digest over generic multi-metric routing when both intents are present', () => {
    const decision = resolveNormalizeQueryRouteDecision({
      hasUnsupportedCapability: false,
      hasPowerCurveIntent: false,
      hasDigestIntent: true,
      hasMultiMetricIntent: true,
      hasLatestEventIntent: false,
    });

    expect(decision).toEqual(expect.objectContaining({
      routeId: 'digest',
      resultKind: 'multi_metric_aggregate',
    }));
  });

  it('routes latest-event prompts ahead of the single-metric fallback route', () => {
    const decision = resolveNormalizeQueryRouteDecision({
      hasUnsupportedCapability: false,
      hasPowerCurveIntent: false,
      hasDigestIntent: false,
      hasMultiMetricIntent: false,
      hasLatestEventIntent: true,
    });

    expect(decision).toEqual(expect.objectContaining({
      routeId: 'latest_event',
      resultKind: 'latest_event',
    }));
  });

  it('falls back to single-metric route when no specialized route matches', () => {
    const decision = resolveNormalizeQueryRouteDecision({
      hasUnsupportedCapability: false,
      hasPowerCurveIntent: false,
      hasDigestIntent: false,
      hasMultiMetricIntent: false,
      hasLatestEventIntent: false,
    });

    expect(decision).toEqual(expect.objectContaining({
      routeId: 'single_metric',
      resultKind: null,
    }));
  });

  it('supports synthetic future route extension without changing resolver logic', () => {
    type SyntheticRouteId = 'hr_curve' | 'fallback';
    type SyntheticResultKind = 'hr_curve';
    interface SyntheticContext {
      hasHrCurveIntent: boolean;
    }

    const syntheticRouteDefinitions: ReadonlyArray<
      ResultKindRouteDefinition<SyntheticRouteId, SyntheticResultKind, SyntheticContext>
    > = [
      {
        id: 'hr_curve',
        priority: 100,
        resultKind: 'hr_curve',
        intentHints: ['hr curve'],
        constraints: ['test-only synthetic extension'],
        examples: ['Show my hr curve over time'],
        reason: 'Prompt indicates synthetic hr-curve route.',
        match: (context) => context.hasHrCurveIntent,
      },
      {
        id: 'fallback',
        priority: 1,
        resultKind: null,
        intentHints: ['fallback'],
        constraints: ['always matches'],
        examples: ['fallback'],
        reason: 'Fallback synthetic route.',
        match: () => true,
      },
    ];

    const extendedRouteDefinitions = [
      ...DEFAULT_NORMALIZE_QUERY_ROUTE_DEFINITIONS,
    ];
    expect(extendedRouteDefinitions.length).toBeGreaterThan(0);

    const decision = resolveResultKindRouteDecision(syntheticRouteDefinitions, {
      hasHrCurveIntent: true,
    });

    expect(decision).toEqual({
      status: 'matched',
      routeId: 'hr_curve',
      resultKind: 'hr_curve',
      source: 'deterministic',
      reason: 'Prompt indicates synthetic hr-curve route.',
    });
  });
});
