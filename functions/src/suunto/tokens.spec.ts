import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import * as tokens from '../tokens';
import { refreshSuuntoAppRefreshTokens } from './tokens';
import { SERVICE_NAME } from './constants';

vi.mock('firebase-admin', () => {
    const getMock = vi.fn();
    const limitMock = vi.fn().mockReturnValue({ get: getMock });
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    const collectionGroupMock = vi.fn().mockReturnValue({ where: whereMock });

    return {
        firestore: () => ({
            collectionGroup: collectionGroupMock
        })
    };
});

vi.mock('../tokens', () => ({
    refreshTokens: vi.fn().mockResolvedValue({})
}));

describe('Suunto Token Refresh Scheduler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should query and refresh Suunto tokens (proactive and missing)', async () => {
        const firestore = admin.firestore();
        const mockSnapshot = { size: 3, docs: [] };

        // Mock chain for where filters
        const getMock = vi.fn().mockResolvedValue(mockSnapshot);
        const limitMock = vi.fn().mockReturnValue({ get: getMock });

        // Setup recursive mock for chaining .where().where()
        const whereMock = vi.fn();
        const queryObj = {
            where: whereMock,
            limit: limitMock
        };
        whereMock.mockReturnValue(queryObj);

        (firestore.collectionGroup as any).mockReturnValue({ where: whereMock });

        await (refreshSuuntoAppRefreshTokens as any)({});

        expect(firestore.collectionGroup).toHaveBeenCalledWith('tokens');

        // Should be called 4 times now (2 filters per query * 2 queries)
        // Query 1: serviceName AND dateRefreshed <= 90 days
        // Query 2: serviceName AND dateRefreshed == null
        expect(whereMock).toHaveBeenCalledTimes(4);

        // Verify Service Name filter is applied
        expect(whereMock).toHaveBeenCalledWith('serviceName', '==', SERVICE_NAME);

        // Verify specific date filters
        expect(whereMock).toHaveBeenCalledWith('dateRefreshed', '<=', expect.any(Number));
        expect(whereMock).toHaveBeenCalledWith('dateRefreshed', '==', null);

        // tokens.refreshTokens should be called twice
        expect(tokens.refreshTokens).toHaveBeenCalledTimes(2);
        expect(tokens.refreshTokens).toHaveBeenCalledWith(mockSnapshot, SERVICE_NAME);
    });
});
