import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as tokens from '../tokens';
import { refreshCOROSAPIRefreshTokens } from './tokens';
import { SERVICE_NAME } from './constants';

// firebase-admin mock removed as it is not used in this test

vi.mock('../tokens', () => ({
    refreshTokens: vi.fn().mockResolvedValue({}),
    refreshStaleTokens: vi.fn().mockResolvedValue({})
}));

describe('COROS Token Refresh Scheduler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should delegate to refreshStaleTokens', async () => {
        await (refreshCOROSAPIRefreshTokens as any)({});

        expect(tokens.refreshStaleTokens).toHaveBeenCalledTimes(1);

        const expected20DaysAgo = Date.now() - 20 * 24 * 60 * 60 * 1000;
        // Verify precision
        const callArgs = (tokens.refreshStaleTokens as any).mock.calls[0];
        expect(callArgs[0]).toBe(SERVICE_NAME);
        expect(callArgs[1]).toBeGreaterThan(expected20DaysAgo - 2000);
        expect(callArgs[1]).toBeLessThan(expected20DaysAgo + 2000);
    });
});
