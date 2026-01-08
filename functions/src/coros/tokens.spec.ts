import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import * as tokens from '../tokens';
import { refreshCOROSAPIRefreshTokens } from './tokens';
import { SERVICE_NAME } from './constants';

vi.mock('firebase-admin', () => {
    const getMock = vi.fn();
    const limitMock = vi.fn().mockReturnValue({ get: getMock });
    const whereMock = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: limitMock }) });
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

describe('COROS Token Refresh Scheduler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should query and refresh COROS tokens', async () => {
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

        await (refreshCOROSAPIRefreshTokens as any)({});

        expect(firestore.collectionGroup).toHaveBeenCalledWith('tokens');

        // Should be called 4 times (2 filters per query * 2 queries)
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
