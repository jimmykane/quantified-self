import { describe, it, expect } from 'vitest';
import {
    AI_INSIGHTS_REQUEST_LIMITS,
    getAiInsightsRequestLimitForRole,
    getRouteUsageLimitForRole,
    getUsageLimitForRole,
    ROUTE_USAGE_LIMITS,
    USAGE_LIMITS,
} from '../../../shared/limits';

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

    it('should define route-specific limits without changing activity limits', () => {
        expect(USAGE_LIMITS).toEqual({
            free: 100,
            basic: 1000,
        });
        expect(ROUTE_USAGE_LIMITS).toEqual({
            free: 10,
            basic: 100,
        });
    });

    it('should resolve route limits explicitly for supported roles', () => {
        expect(getRouteUsageLimitForRole('free')).toBe(ROUTE_USAGE_LIMITS.free);
        expect(getRouteUsageLimitForRole('basic')).toBe(ROUTE_USAGE_LIMITS.basic);
        expect(getRouteUsageLimitForRole('pro')).toBeNull();
    });

    it('should throw for unsupported route limit roles', () => {
        expect(() => getRouteUsageLimitForRole('enterprise')).toThrow("Unsupported subscription role 'enterprise'");
    });

    it('should resolve AI insights limits explicitly for supported roles', () => {
        expect(AI_INSIGHTS_REQUEST_LIMITS).toEqual({
            free: 20,
            basic: 50,
            pro: 100,
        });
        expect(getAiInsightsRequestLimitForRole('free')).toBe(AI_INSIGHTS_REQUEST_LIMITS.free);
        expect(getAiInsightsRequestLimitForRole('basic')).toBe(AI_INSIGHTS_REQUEST_LIMITS.basic);
        expect(getAiInsightsRequestLimitForRole('pro')).toBe(AI_INSIGHTS_REQUEST_LIMITS.pro);
        expect(getAiInsightsRequestLimitForRole('basic')).toBe(AI_INSIGHTS_REQUEST_LIMITS.basic);
        expect(getAiInsightsRequestLimitForRole('pro')).toBe(AI_INSIGHTS_REQUEST_LIMITS.pro);
    });
});
