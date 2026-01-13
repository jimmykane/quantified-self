import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as tokens from '../tokens';
import { ServiceNames } from '@sports-alliance/sports-lib';

// Mock shared tokens module
vi.mock('../tokens', () => ({
    refreshStaleTokens: vi.fn(),
}));

// Mock firebase-functions
vi.mock('firebase-functions/v1', () => ({
    region: () => ({
        runWith: () => ({
            pubsub: {
                schedule: () => ({
                    onRun: (handler: any) => handler
                })
            }
        })
    })
}));

import { refreshGarminHealthAPIRefreshTokens } from './tokens';

describe('Garmin Tokens Scheduler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should call refreshStaleTokens with correct service name and threshold', async () => {
        // Execute the scheduled function handler
        await (refreshGarminHealthAPIRefreshTokens as any)();

        // Calculate expected threshold (approximate)
        const now = Date.now();
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        const expectedThreshold = now - thirtyDaysMs;

        expect(tokens.refreshStaleTokens).toHaveBeenCalledWith(
            ServiceNames.GarminHealthAPI,
            expect.any(Number)
        );

        // Verify the threshold is roughly correct (within 1 second)
        const calledArg = vi.mocked(tokens.refreshStaleTokens).mock.calls[0][1];
        expect(Math.abs(calledArg - expectedThreshold)).toBeLessThan(1000);
    });
});
