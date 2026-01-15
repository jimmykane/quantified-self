import { getGarminUserId, getGarminPermissions } from './api';
import * as requestPromise from '../../request-helper';
import * as logger from 'firebase-functions/logger';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock request-helper
vi.mock('../../request-helper', () => ({
    get: vi.fn(),
}));

// Mock logger
vi.mock('firebase-functions/logger', () => ({
    error: vi.fn(),
    warn: vi.fn(),
}));

describe('Garmin API Utils', () => {
    const MOCK_ACCESS_TOKEN = 'mock-access-token';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getGarminUserId', () => {
        it('should return userId when API returns valid response', async () => {
            const mockResponse = { userId: '12345' };
            (requestPromise.get as any).mockResolvedValue(mockResponse);

            const userId = await getGarminUserId(MOCK_ACCESS_TOKEN);

            expect(userId).toBe('12345');
            expect(requestPromise.get).toHaveBeenCalledWith({
                url: 'https://apis.garmin.com/wellness-api/rest/user/id',
                headers: {
                    Authorization: `Bearer ${MOCK_ACCESS_TOKEN}`,
                },
            });
        });

        it('should parse string response correctly', async () => {
            const mockResponse = JSON.stringify({ userId: '67890' });
            (requestPromise.get as any).mockResolvedValue(mockResponse);

            const userId = await getGarminUserId(MOCK_ACCESS_TOKEN);

            expect(userId).toBe('67890');
        });

        it('should throw error when userId is missing in response', async () => {
            (requestPromise.get as any).mockResolvedValue({});

            await expect(getGarminUserId(MOCK_ACCESS_TOKEN)).rejects.toThrow('User ID not found in response');
            expect(logger.error).toHaveBeenCalled();
        });

        it('should throw and log error when API call fails', async () => {
            (requestPromise.get as any).mockRejectedValue(new Error('API Error'));

            await expect(getGarminUserId(MOCK_ACCESS_TOKEN)).rejects.toThrow('Failed to fetch Garmin User ID: API Error');
            expect(logger.error).toHaveBeenCalledWith('Failed to fetch Garmin User ID: Error: API Error');
        });
    });

    describe('getGarminPermissions', () => {
        it('should return permissions array when API returns valid response', async () => {
            const mockPermissions = ['HISTORICAL_DATA_EXPORT', 'ACTIVITY_EXPORT'];
            const mockResponse = { permissions: mockPermissions };
            (requestPromise.get as any).mockResolvedValue(mockResponse);

            const permissions = await getGarminPermissions(MOCK_ACCESS_TOKEN);

            expect(permissions).toEqual(mockPermissions);
            expect(requestPromise.get).toHaveBeenCalledWith({
                url: 'https://apis.garmin.com/wellness-api/rest/user/permissions',
                headers: {
                    Authorization: `Bearer ${MOCK_ACCESS_TOKEN}`,
                },
            });
        });

        it('should parse string response correctly', async () => {
            const mockPermissions = ['HEALTH_EXPORT'];
            const mockResponse = JSON.stringify({ permissions: mockPermissions });
            (requestPromise.get as any).mockResolvedValue(mockResponse);

            const permissions = await getGarminPermissions(MOCK_ACCESS_TOKEN);

            expect(permissions).toEqual(mockPermissions);
        });

        it('should return empty array when permissions are missing in response', async () => {
            (requestPromise.get as any).mockResolvedValue({});

            const permissions = await getGarminPermissions(MOCK_ACCESS_TOKEN);

            expect(permissions).toEqual([]);
        });


        it('should retry and succeed (1st retry)', async () => {
            const mockPermissions = ['HISTORICAL_DATA_EXPORT'];
            const mockResponse = { permissions: mockPermissions };

            // First call fails, second succeeds
            (requestPromise.get as any)
                .mockRejectedValueOnce(new Error('403 Forbidden'))
                .mockResolvedValueOnce(mockResponse);

            vi.useFakeTimers();
            const promise = getGarminPermissions(MOCK_ACCESS_TOKEN);

            // Advance time for backoff 1s
            await vi.advanceTimersByTimeAsync(1000);

            const permissions = await promise;

            expect(permissions).toEqual(mockPermissions);
            expect(requestPromise.get).toHaveBeenCalledTimes(2);
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Retrying in 1000ms'));
            vi.useRealTimers();
        });

        it('should retry and succeed (3rd retry)', async () => {
            const mockPermissions = ['HISTORICAL_DATA_EXPORT'];
            const mockResponse = { permissions: mockPermissions };

            // fails 3 times, succeeds on 4th call (retry #3)
            (requestPromise.get as any)
                .mockRejectedValueOnce(new Error('Fail 1'))
                .mockRejectedValueOnce(new Error('Fail 2'))
                .mockRejectedValueOnce(new Error('Fail 3'))
                .mockResolvedValueOnce(mockResponse);

            vi.useFakeTimers();
            const promise = getGarminPermissions(MOCK_ACCESS_TOKEN);

            await vi.advanceTimersByTimeAsync(1000); // 1st retry
            await vi.advanceTimersByTimeAsync(2000); // 2nd retry
            await vi.advanceTimersByTimeAsync(4000); // 3rd retry

            const permissions = await promise;

            expect(permissions).toEqual(mockPermissions);
            expect(requestPromise.get).toHaveBeenCalledTimes(4);
            vi.useRealTimers();
        });

        it('should return empty array and log error after exhausting retries', async () => {
            (requestPromise.get as any).mockRejectedValue(new Error('API Error'));

            vi.useFakeTimers();
            const promise = getGarminPermissions(MOCK_ACCESS_TOKEN);

            await vi.advanceTimersByTimeAsync(1000); // 1st
            await vi.advanceTimersByTimeAsync(2000); // 2nd
            await vi.advanceTimersByTimeAsync(4000); // 3rd
            await vi.advanceTimersByTimeAsync(8000); // 4th
            await vi.advanceTimersByTimeAsync(16000); // 5th
            await vi.advanceTimersByTimeAsync(32000); // 6th

            const permissions = await promise;

            expect(permissions).toEqual([]);
            // initial call + 6 retries = 7 calls total
            expect(requestPromise.get).toHaveBeenCalledTimes(7);
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch Garmin Permissions after 7 attempts'));
            vi.useRealTimers();
        });

    });
});
