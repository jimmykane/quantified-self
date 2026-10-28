
import { describe, it, vi, expect, beforeEach } from 'vitest';
import { executeWithTokenRetry } from './retry-helper';
import * as logger from 'firebase-functions/logger';

vi.mock('firebase-functions/logger', () => ({ info: vi.fn() }));

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
        expect(mockOperation).toHaveBeenCalledWith('valid-token', expect.objectContaining({ accessToken: 'valid-token' }));
    });

    it.each([401, 403])('should retry once on HTTP %s', async statusCode => {
        // First token fetch succeeds
        tokensMocks.getTokenData.mockResolvedValueOnce({ accessToken: 'stale-token' });
        // Second token fetch (force refresh) succeeds
        tokensMocks.getTokenData.mockResolvedValueOnce({ accessToken: 'fresh-token' });

        // First operation fails with 401
        mockOperation.mockRejectedValueOnce({ statusCode });
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
        expect(mockOperation).toHaveBeenNthCalledWith(1, 'stale-token', expect.anything());
        expect(mockOperation).toHaveBeenNthCalledWith(2, 'fresh-token', expect.anything());
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

    it('does not loop on a persistent resource 403', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'token' });
        const error = { response: { statusCode: 403 } };
        mockOperation.mockRejectedValue(error);
        await expect(executeWithTokenRetry(mockTokenDoc, mockOperation, 'test-context')).rejects.toBe(error);
        expect(tokensMocks.getTokenData).toHaveBeenCalledTimes(2);
        expect(mockOperation).toHaveBeenCalledTimes(2);
    });

    it('does not interpret a refresh endpoint 403 as another resource rejection', async () => {
        tokensMocks.getTokenData.mockResolvedValueOnce({ accessToken: 'token' });
        const refreshError = { statusCode: 403 };
        tokensMocks.getTokenData.mockRejectedValueOnce(refreshError);
        mockOperation.mockRejectedValueOnce({ statusCode: 403 });
        await expect(executeWithTokenRetry(mockTokenDoc, mockOperation, 'test-context')).rejects.toMatchObject({ statusCode: 503 });
        expect(tokensMocks.getTokenData).toHaveBeenCalledTimes(2);
        expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('never retries against a different account after refresh', async () => {
        tokensMocks.getTokenData.mockResolvedValueOnce({ accessToken: 'old', userName: 'account' })
            .mockResolvedValueOnce({ accessToken: 'new', userName: 'other-account' });
        mockOperation.mockRejectedValueOnce({ statusCode: 403 });
        await expect(executeWithTokenRetry(mockTokenDoc, mockOperation, 'test-context')).rejects.toThrow('account changed');
        expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('does not label an initial expiry-refresh 403 as a resource permission rejection', async () => {
        tokensMocks.getTokenData.mockRejectedValueOnce({ statusCode: 403 });
        await expect(executeWithTokenRetry(mockTokenDoc, mockOperation, 'private-context')).rejects.toMatchObject({ statusCode: 503 });
        expect(mockOperation).not.toHaveBeenCalled();
        expect(tokensMocks.getTokenData).toHaveBeenCalledOnce();
    });

    it.each([false, true])('recognizes an OAuth SDK refresh 403 (forced: %s) without retrying resource access', async forced => {
        const sdkError = Object.assign(new Error('Response Error: 403 Forbidden'), {
            isBoom: true, output: { statusCode: 403 }, data: { payload: { message: 'private provider detail' } },
        });
        if (forced) {
            tokensMocks.getTokenData.mockResolvedValueOnce({ accessToken: 'token' });
            mockOperation.mockRejectedValueOnce({ statusCode: 403 });
        }
        tokensMocks.getTokenData.mockRejectedValueOnce(sdkError);
        await expect(executeWithTokenRetry(mockTokenDoc, mockOperation, 'private-context'))
            .rejects.toMatchObject({ statusCode: 503, message: 'Suunto token refresh was rejected; resource access was not retried.' });
        expect(mockOperation).toHaveBeenCalledTimes(forced ? 1 : 0);
        expect(tokensMocks.getTokenData).toHaveBeenCalledTimes(forced ? 2 : 1);
    });

    it.each([false, true])('preserves a terminal credential-lifecycle decision even for refresh 403 (forced: %s)', async forced => {
        const terminalError = Object.assign(new Error('Reconnect required'), {
            name: 'TerminalServiceAuthError', statusCode: 403, providerErrorCode: 'invalid_grant',
        });
        if (forced) {
            tokensMocks.getTokenData.mockResolvedValueOnce({ accessToken: 'token' });
            mockOperation.mockRejectedValueOnce({ statusCode: 403 });
        }
        tokensMocks.getTokenData.mockRejectedValueOnce(terminalError);
        await expect(executeWithTokenRetry(mockTokenDoc, mockOperation, 'private-context')).rejects.toBe(terminalError);
        expect(mockOperation).toHaveBeenCalledTimes(forced ? 1 : 0);
    });

    it('logs only a fixed recovery message and numeric auth status, never private context or provider text', async () => {
        tokensMocks.getTokenData.mockResolvedValue({ accessToken: 'private-token' });
        mockOperation.mockRejectedValueOnce({ statusCode: 'private-provider-text', error: { error: 'invalid_grant' } })
            .mockResolvedValueOnce('success');
        await executeWithTokenRetry(mockTokenDoc, mockOperation, 'private-context');
        expect(logger.info).toHaveBeenCalledExactlyOnceWith(
            '[SuuntoAuth] Resource request rejected; attempting one same-account refresh.', { statusCode: undefined },
        );
    });
});
