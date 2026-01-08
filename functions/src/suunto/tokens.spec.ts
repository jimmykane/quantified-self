import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as tokens from '../tokens';
import { refreshSuuntoAppRefreshTokens } from './tokens';
import { SERVICE_NAME } from './constants';

// firebase-admin mock removed as it is not used in this test

vi.mock('../tokens', () => ({
    refreshTokens: vi.fn().mockResolvedValue({}),
    refreshStaleTokens: vi.fn().mockResolvedValue({})
}));

describe('Suunto Token Refresh Scheduler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should delegate to refreshStaleTokens', async () => {
        await (refreshSuuntoAppRefreshTokens as any)({});

        expect(tokens.refreshStaleTokens).toHaveBeenCalledTimes(1);

        const expected90DaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
        // Verify the date is within a reasonable range (e.g., +/- 1000ms delta for execution time)
        const callArgs = (tokens.refreshStaleTokens as any).mock.calls[0];
        expect(callArgs[0]).toBe(SERVICE_NAME);
        expect(callArgs[1]).toBeGreaterThan(expected90DaysAgo - 2000);
        expect(callArgs[1]).toBeLessThan(expected90DaysAgo + 2000);
    });
});
