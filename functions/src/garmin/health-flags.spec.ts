import { describe, expect, it } from 'vitest';
import { isGarminHealthSyncEnabled } from './health-flags';

describe('Garmin Health availability', () => {
  it('keeps the production-wide operational switch enabled', () => {
    expect(isGarminHealthSyncEnabled()).toBe(true);
  });
});
