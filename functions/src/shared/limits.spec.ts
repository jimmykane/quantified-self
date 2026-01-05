import { describe, it, expect } from 'vitest';
import { USAGE_LIMITS } from './limits';

describe('USAGE_LIMITS', () => {
    it('should have correct limits defined', () => {
        expect(USAGE_LIMITS.free).toBe(10);
        expect(USAGE_LIMITS.basic).toBe(100);
    });

    it('should not have more than expected keys', () => {
        expect(Object.keys(USAGE_LIMITS)).toHaveLength(2);
    });
});
