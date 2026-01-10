
import { describe, it, vi, expect, beforeEach } from 'vitest';
import { executeWithTokenRetry } from './retry-helper';
import * as admin from 'firebase-admin';

// Mock dependencies
const tokensMocks = {
    getTokenData: vi.fn(),
};

vi.mock('../tokens', () => ({
    getTokenData: (...args: any[]) => tokensMocks.getTokenData(...args),
}));

describe('executeWithTokenRetry', () => {
    let mockTokenDoc: any;
    let mockOperation: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockTokenDoc = { id: 'test-token-id' } as any;
        mockOperation = vi.fn();
    });

    it('should succeed on first attempt', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'valid-token' });
        mockOperation.mockResolvedValue('success');

        const result = await executeWithTokenRetry(mockTokenDoc, mockOperation, 'test-context');

        expect(result).toBe('success');
        expect(tokensMocks.getTokenData).toHaveBeenCalledTimes(1);
        expect(tokensMocks.getTokenData).toHaveBeenCalledWith(mockTokenDoc, expect.anything(), false);
        expect(mockOperation).toHaveBeenCalledWith('valid-token');
    });

    it('should retry on 401 error', async () => {
        // First token fetch succeeds
        tokensMocks.getTokenData.mockResolvedValueOnce({ accessToken: 'stale-token' });
        // Second token fetch (force refresh) succeeds
        tokensMocks.getTokenData.mockResolvedValueOnce({ accessToken: 'fresh-token' });

        // First operation fails with 401
        mockOperation.mockRejectedValueOnce({ statusCode: 401 });
        // Second operation succeeds
        mockOperation.mockResolvedValueOnce('retry-success');

        const result = await executeWithTokenRetry(mockTokenDoc, mockOperation, 'test-context');

        expect(result).toBe('retry-success');

        // Verify token calls
        expect(tokensMocks.getTokenData).toHaveBeenCalledTimes(2);
        expect(tokensMocks.getTokenData).toHaveBeenNthCalledWith(1, expect.anything(), expect.anything(), false);
        expect(tokensMocks.getTokenData).toHaveBeenNthCalledWith(2, expect.anything(), expect.anything(), true);

        // Verify operation calls
        expect(mockOperation).toHaveBeenCalledTimes(2);
        expect(mockOperation).toHaveBeenNthCalledWith(1, 'stale-token');
        expect(mockOperation).toHaveBeenNthCalledWith(2, 'fresh-token');
    });

    it('should retry on invalid_grant error', async () => {
        tokensMocks.getTokenData
            .mockResolvedValueOnce({ accessToken: 'stale-token' })
            .mockResolvedValueOnce({ accessToken: 'fresh-token' });

        mockOperation.mockRejectedValueOnce({ error: { error: 'invalid_grant' } });
        mockOperation.mockResolvedValueOnce('retry-success');

        const result = await executeWithTokenRetry(mockTokenDoc, mockOperation, 'test-context');

        expect(result).toBe('retry-success');
        expect(tokensMocks.getTokenData).toHaveBeenCalledTimes(2);
    });

    it('should throw immediately on non-auth error', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'valid-token' });
        const error = { statusCode: 500, message: 'Server Error' };
        mockOperation.mockRejectedValue(error);

        await expect(executeWithTokenRetry(mockTokenDoc, mockOperation, 'test-context'))
            .rejects.toEqual(error);

        expect(tokensMocks.getTokenData).toHaveBeenCalledTimes(1); // No retry
        expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should throw if retry fails (still 401)', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'token' });
        mockOperation.mockRejectedValue({ statusCode: 401 });

        await expect(executeWithTokenRetry(mockTokenDoc, mockOperation, 'test-context'))
            .rejects.toEqual({ statusCode: 401 });

        expect(tokensMocks.getTokenData).toHaveBeenCalledTimes(2); // Tried refresh
        expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    it('should throw if token refresh fails', async () => {
        tokensMocks.getTokenData.mockResolvedValueOnce({ accessToken: 'stale-token' });

        // Operation fails 401
        mockOperation.mockRejectedValueOnce({ statusCode: 401 });

        // Refresh fails
        const refreshError = new Error('Refresh failed');
        tokensMocks.getTokenData.mockRejectedValueOnce(refreshError);

        await expect(executeWithTokenRetry(mockTokenDoc, mockOperation, 'test-context'))
            .rejects.toEqual(refreshError);

        expect(tokensMocks.getTokenData).toHaveBeenCalledTimes(2);
        expect(mockOperation).toHaveBeenCalledTimes(1); // Operation not retried because token failed
    });

    it('should propagate initial token fetch failure', async () => {
        const error = new Error('Database down');
        tokensMocks.getTokenData.mockRejectedValue(error);

        await expect(executeWithTokenRetry(mockTokenDoc, mockOperation, 'test-context'))
            .rejects.toThrow('Database down');

        expect(mockOperation).not.toHaveBeenCalled();
    });
});
