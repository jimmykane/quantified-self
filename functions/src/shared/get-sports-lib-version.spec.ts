import { describe, it, expect, vi } from 'vitest';
import { getSportsLibVersion } from './get-sports-lib-version';

describe('getSportsLibVersion', () => {
    it('returns the version from the loader', () => {
        const loadPackageJson = vi.fn(() => ({ version: '8.0.9' }));
        const version = getSportsLibVersion(loadPackageJson);
        expect(version).toBe('8.0.9');
        expect(loadPackageJson).toHaveBeenCalledTimes(1);
    });

    it('propagates loader errors', () => {
        const loadPackageJson = vi.fn(() => {
            throw new Error('boom');
        });
        expect(() => getSportsLibVersion(loadPackageJson)).toThrow('boom');
    });
});
