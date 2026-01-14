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

        it('should return empty array and log error when API call fails', async () => {
            (requestPromise.get as any).mockRejectedValue(new Error('API Error'));

            const permissions = await getGarminPermissions(MOCK_ACCESS_TOKEN);

            expect(permissions).toEqual([]);
            expect(logger.error).toHaveBeenCalledWith('Failed to fetch Garmin Permissions: Error: API Error');
        });
    });
});
