import { describe, expect, it } from 'vitest';
import { CALLABLE_RESULT_KIND_KEYS, resolveCallableResultKindHandler } from './callable.result-kind-handlers';
import { EXECUTE_QUERY_RESULT_KIND_KEYS } from './execute-query.result-kind-handlers';

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
});
