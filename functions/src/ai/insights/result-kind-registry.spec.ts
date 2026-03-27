import { describe, expect, it } from 'vitest';
import { CALLABLE_RESULT_KIND_KEYS, resolveCallableResultKindHandler } from './callable.result-kind-handlers';
import { EXECUTE_QUERY_RESULT_KIND_KEYS } from './execute-query.result-kind-handlers';
import { DEFAULT_NORMALIZE_QUERY_ROUTE_DEFINITIONS } from './normalize-query.result-kind-router';

const EXPECTED_RESULT_KINDS = [
  'aggregate',
  'event_lookup',
  'latest_event',
  'multi_metric_aggregate',
  'power_curve',
] as const;

describe('AI insights result-kind registries', () => {
  it('registers all callable result kinds', () => {
    expect([...CALLABLE_RESULT_KIND_KEYS].sort()).toEqual([...EXPECTED_RESULT_KINDS].sort());
    EXPECTED_RESULT_KINDS.forEach((resultKind) => {
      expect(resolveCallableResultKindHandler(resultKind)).toBeDefined();
    });
  });

  it('registers all execute-query result kinds', () => {
    expect([...EXECUTE_QUERY_RESULT_KIND_KEYS].sort()).toEqual([...EXPECTED_RESULT_KINDS].sort());
  });

  it('registers all normalize-query routable result kinds', () => {
    const normalizeRouteIds = DEFAULT_NORMALIZE_QUERY_ROUTE_DEFINITIONS
      .map(routeDefinition => routeDefinition.id);
    expect(normalizeRouteIds).toContain('single_metric');
    expect(normalizeRouteIds).toContain('unsupported_capability');

    const routableResultKinds = new Set(
      DEFAULT_NORMALIZE_QUERY_ROUTE_DEFINITIONS
        .map(routeDefinition => routeDefinition.resultKind)
        .filter((resultKind): resultKind is (typeof EXPECTED_RESULT_KINDS)[number] => Boolean(resultKind)),
    );

    expect([...routableResultKinds].sort()).toEqual([
      'latest_event',
      'multi_metric_aggregate',
      'power_curve',
    ].sort());
  });
});
