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
        const mockSnapshot = { size: 5, docs: [] };
        // Chain: collectionGroup('tokens').where('serviceName', '==', ...).where('dateRefreshed', '<=', ...).limit(50).get()
        // Our mock is a bit simplified but needs to match the call depth
        const getMock = vi.fn().mockResolvedValue(mockSnapshot);
        const limitMock = vi.fn().mockReturnValue({ get: getMock });
        const where2Mock = vi.fn().mockReturnValue({ limit: limitMock });
        const where1Mock = vi.fn().mockReturnValue({ where: where2Mock });
        (firestore.collectionGroup as any).mockReturnValue({ where: where1Mock });

        // Invoke the handler (refreshCOROSAPIRefreshTokens is already the handler due to our global mock)
        await (refreshCOROSAPIRefreshTokens as any)({});

        expect(firestore.collectionGroup).toHaveBeenCalledWith('tokens');
        expect(tokens.refreshTokens).toHaveBeenCalledWith(mockSnapshot, SERVICE_NAME);
    });
});
