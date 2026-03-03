import { describe, it, expect } from 'vitest';
import { getUsageLimitForRole, USAGE_LIMITS } from './limits';

describe('USAGE_LIMITS', () => {
    it('should have correct limits defined', () => {
        expect(USAGE_LIMITS.free).toBe(10);
        expect(USAGE_LIMITS.basic).toBe(100);
    });

    it('should not have more than expected keys', () => {
        expect(Object.keys(USAGE_LIMITS)).toHaveLength(2);
    });

    it('should resolve limits explicitly for supported roles', () => {
        expect(getUsageLimitForRole('free')).toBe(10);
        expect(getUsageLimitForRole('basic')).toBe(100);
        expect(getUsageLimitForRole('pro')).toBeNull();
    });

    it('should throw for unsupported roles', () => {
        expect(() => getUsageLimitForRole('enterprise')).toThrow("Unsupported subscription role 'enterprise'");
    });
});
