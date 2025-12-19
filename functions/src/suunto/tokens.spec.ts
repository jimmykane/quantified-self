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

    it('should query and refresh Suunto tokens', async () => {
        const firestore = admin.firestore();
        const mockSnapshot = { size: 3, docs: [] };
        // Chain: collectionGroup('tokens').where('dateRefreshed', '<=', ...).limit(50).get()
        const getMock = vi.fn().mockResolvedValue(mockSnapshot);
        const limitMock = vi.fn().mockReturnValue({ get: getMock });
        const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
        (firestore.collectionGroup as any).mockReturnValue({ where: whereMock });

        await (refreshSuuntoAppRefreshTokens as any)({});

        expect(firestore.collectionGroup).toHaveBeenCalledWith('tokens');
        expect(tokens.refreshTokens).toHaveBeenCalledWith(mockSnapshot, SERVICE_NAME);
    });
});
