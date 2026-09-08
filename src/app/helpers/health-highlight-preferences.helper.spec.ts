import { describe, expect, it } from 'vitest';
import { normalizeHealthHighlightSources } from './health-highlight-preferences.helper';

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
});
