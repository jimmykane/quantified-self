import { describe, it, expect } from 'vitest';
import { getUsageLimitForRole, USAGE_LIMITS } from '../../../shared/limits';

describe('USAGE_LIMITS', () => {
    it('should define positive increasing limits for limited roles', () => {
        expect(USAGE_LIMITS.free).toBeGreaterThan(0);
        expect(USAGE_LIMITS.basic).toBeGreaterThan(USAGE_LIMITS.free);
    });

    it('should not have more than expected keys', () => {
        expect(Object.keys(USAGE_LIMITS)).toHaveLength(2);
    });

    it('should resolve limits explicitly for supported roles', () => {
        expect(getUsageLimitForRole('free')).toBe(USAGE_LIMITS.free);
        expect(getUsageLimitForRole('basic')).toBe(USAGE_LIMITS.basic);
        expect(getUsageLimitForRole('pro')).toBeNull();
    });

    it('should throw for unsupported roles', () => {
        expect(() => getUsageLimitForRole('enterprise')).toThrow("Unsupported subscription role 'enterprise'");
    });
});
