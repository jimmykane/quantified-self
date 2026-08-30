import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type { UserCountResponse } from './shared/types';
import {
    getUserCount,
    mockCollection,
    mockFirestore,
    mockListUsers,
} from './test-utils/admin-test-harness';

describe('getUserCount marketing consent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockListUsers.mockResolvedValue({ users: [], pageToken: undefined });
    });

    it('counts explicit marketing consent from the canonical legal agreement documents', async () => {
        const countSnapshot = (count: number) => ({ data: () => ({ count }) });
        const userWhere = vi.fn((field: string) => ({
            count: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue(countSnapshot(field === 'onboardingCompleted' ? 40 : 99)),
            }),
        }));
        const legalCountGet = vi.fn()
            .mockResolvedValueOnce(countSnapshot(35))
            .mockRejectedValueOnce(new Error('index not ready'));
        const legalWhere = vi.fn(() => ({
            count: vi.fn().mockReturnValue({
                get: legalCountGet,
            }),
        }));
        const mockCollectionGroup = vi.fn((path: string) => mockCollection(path));
        const emptyCacheDocument = {
            get: vi.fn().mockResolvedValue({ exists: false, data: () => undefined }),
            set: vi.fn().mockResolvedValue(undefined),
        };

        mockCollection.mockImplementation((path: string) => {
            if (path === 'users') {
                return {
                    count: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue(countSnapshot(150)),
                    }),
                    where: userWhere,
                };
            }
            if (path === 'legal') {
                return { where: legalWhere };
            }
            if (path === 'adminStats') {
                return { doc: vi.fn().mockReturnValue(emptyCacheDocument) };
            }
            if (path === 'events' || path === 'routes') {
                return {
                    count: vi.fn().mockReturnValue({
                        get: vi.fn().mockResolvedValue(countSnapshot(0)),
                    }),
                };
            }

            const query = {
                where: vi.fn(),
                select: vi.fn(),
                get: vi.fn().mockResolvedValue({ docs: [] }),
            };
            query.where.mockReturnValue(query);
            query.select.mockReturnValue(query);
            return query;
        });
        const defaultFirestore = mockFirestore();
        mockFirestore.mockReturnValue({
            ...defaultFirestore,
            collectionGroup: mockCollectionGroup,
        });

        const request = {
            data: {},
            auth: { uid: 'admin-uid', token: { admin: true } },
            app: { appId: 'mock-app-id' },
        } as unknown as CallableRequest<unknown>;
        const handler = getUserCount as unknown as (
            input: CallableRequest<unknown>
        ) => Promise<UserCountResponse>;

        const result = await handler(request);

        expect(result.marketingConsent).toBe(35);
        expect(mockCollectionGroup).toHaveBeenCalledWith('legal');
        expect(legalWhere).toHaveBeenCalledWith('acceptedMarketingPolicy', '==', true);
        expect(userWhere).not.toHaveBeenCalledWith('acceptedMarketingPolicy', '==', true);

        const resultWhileIndexIsUnavailable = await handler(request);
        expect(resultWhileIndexIsUnavailable.marketingConsent).toBeNull();
    });
});
