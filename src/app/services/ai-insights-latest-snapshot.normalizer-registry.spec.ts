import { describe, expect, it } from 'vitest';
import {
  INSIGHT_QUERY_NORMALIZER_RESULT_KIND_KEYS,
  OK_RESPONSE_NORMALIZER_RESULT_KIND_KEYS,
} from './ai-insights-latest-snapshot.service';

const EXPECTED_RESULT_KINDS = [
  'aggregate',
  'event_lookup',
  'latest_event',
  'multi_metric_aggregate',
] as const;

describe('AiInsightsLatestSnapshotService result-kind normalizer registry', () => {
  it('registers all query normalizers', () => {
    expect([...INSIGHT_QUERY_NORMALIZER_RESULT_KIND_KEYS].sort()).toEqual([...EXPECTED_RESULT_KINDS].sort());
  });

  it('registers all ok-response normalizers', () => {
    expect([...OK_RESPONSE_NORMALIZER_RESULT_KIND_KEYS].sort()).toEqual([...EXPECTED_RESULT_KINDS].sort());
  });
});
