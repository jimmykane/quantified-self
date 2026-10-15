import { describe, expect, it } from 'vitest';
import { normalizeHealthHighlightSources, normalizeHealthMetricSources } from './health-highlight-preferences.helper';

describe('Health highlight preferences', () => {
  it('retains only known highlights with opaque source keys', () => {
    expect(normalizeHealthHighlightSources({
      sleep: 'health-series-0123456789abcdef',
      heart_rate: 'raw-account-id',
      heart_rate_variability: null,
      unknown: 'health-series-0123456789abcdef',
    })).toEqual({ sleep: 'health-series-0123456789abcdef' });
  });

  it('ignores malformed and inherited preferences', () => {
    for (const input of [null, undefined, [], 'invalid', Object.create({ sleep: 'health-series-0123456789abcdef' })]) {
      expect(normalizeHealthHighlightSources(input)).toEqual({});
    }
  });

  it('retains known metric pins without allowing raw account keys or inherited entries', () => {
    expect(normalizeHealthMetricSources({
      sleep: 'health-series-0123456789abcdef', body_weight: 'health-series-abcdef0123456789',
      resting_heart_rate: 'raw-account', unknown: 'health-series-0123456789abcdef',
    })).toEqual({ sleep: 'health-series-0123456789abcdef', body_weight: 'health-series-abcdef0123456789' });
    for (const input of [null, undefined, [], 'invalid', Object.create({ sleep: 'health-series-0123456789abcdef' })]) {
      expect(normalizeHealthMetricSources(input)).toEqual({});
    }
  });
});
