import { describe, expect, it } from 'vitest';
import {
  GARMIN_HEALTH_SYNC_ALLOWED_USER_IDS,
  isGarminHealthSyncEnabled,
  isGarminHealthSyncUserAllowed,
} from './health-rollout';

describe('Garmin Health rollout', () => {
  it('enables every staged UID and rejects unknown or malformed identifiers', () => {
    expect(isGarminHealthSyncEnabled()).toBe(true);
    expect(GARMIN_HEALTH_SYNC_ALLOWED_USER_IDS).toHaveLength(2);
    for (const userID of GARMIN_HEALTH_SYNC_ALLOWED_USER_IDS) {
      expect(isGarminHealthSyncUserAllowed(userID)).toBe(true);
    }
    expect(isGarminHealthSyncUserAllowed('not-staged')).toBe(false);
    expect(isGarminHealthSyncUserAllowed('')).toBe(false);
    expect(isGarminHealthSyncUserAllowed(null)).toBe(false);
    expect(isGarminHealthSyncUserAllowed(undefined)).toBe(false);
  });
});
