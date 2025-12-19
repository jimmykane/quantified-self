import { describe, it, expect } from 'vitest';
import { ROLE_HIERARCHY } from './pricing';

describe('ROLE_HIERARCHY', () => {
    it('should have correct hierarchy levels', () => {
        expect(ROLE_HIERARCHY.free).toBe(0);
        expect(ROLE_HIERARCHY.basic).toBe(1);
        expect(ROLE_HIERARCHY.pro).toBe(2);
    });

    it('should follow incremental order', () => {
        expect(ROLE_HIERARCHY.free).toBeLessThan(ROLE_HIERARCHY.basic);
        expect(ROLE_HIERARCHY.basic).toBeLessThan(ROLE_HIERARCHY.pro);
    });
});
