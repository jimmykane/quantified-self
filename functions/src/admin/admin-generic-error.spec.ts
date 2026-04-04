import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
    getAdminRequest,
    getQueueStats,
    setMaintenanceMode,
    getMaintenanceStatus,
    impersonateUser,
    getFinancialStats,
    mockFirestore,
    mockRemoteConfig,
    mockCreateCustomToken,
    mockGetProjectBillingInfo,
    mockCollection,
} from './test-utils/admin-test-harness.spec';

describe('Generic Error Handling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFirestore.mockReturnValue({
            collection: vi.fn().mockReturnValue({
                doc: vi.fn().mockReturnValue({
                    get: vi.fn().mockResolvedValue({ exists: false }),
                    set: vi.fn().mockResolvedValue({})
                }),
                get: vi.fn().mockResolvedValue({ docs: [] })
            })
        });
        mockRemoteConfig.mockReturnValue({
            getTemplate: vi.fn().mockResolvedValue({ parameters: {} }),
            validateTemplate: vi.fn().mockResolvedValue({}),
            publishTemplate: vi.fn().mockResolvedValue({})
        });
    });

    it('getQueueStats should handle generic errors', async () => {
        const req = getAdminRequest();
        mockFirestore.mockImplementationOnce(() => { throw new Error('Generic Failure'); });
        await expect((getQueueStats as any)(req)).rejects.toThrow('Generic Failure');
    });

    it('setMaintenanceMode should handle generic errors', async () => {
        const req = getAdminRequest({ enabled: true });
        mockRemoteConfig.mockImplementationOnce(() => ({
            getTemplate: vi.fn().mockRejectedValue(new Error('Remote Config Failure'))
        }));
        await expect((setMaintenanceMode as any)(req)).rejects.toThrow('Remote Config Failure');
    });


    it('getMaintenanceStatus should handle generic errors', async () => {
        mockRemoteConfig.mockImplementationOnce(() => ({
            getTemplate: vi.fn().mockRejectedValue(new Error('Remote Config Failure'))
        }));
        await expect((getMaintenanceStatus as any)(getAdminRequest())).rejects.toThrow('Remote Config Failure');
    });

    it('impersonateUser should handle generic errors', async () => {
        const req = getAdminRequest({ uid: 'target' });
        mockCreateCustomToken.mockRejectedValueOnce(new Error('Token Gen Failed'));
        await expect((impersonateUser as any)(req)).rejects.toThrow('Token Gen Failed');
    });

    it('getFinancialStats should handle generic errors', async () => {
        mockFirestore.mockImplementationOnce(() => { throw new Error('Firestore init failed'); });
        await expect((getFinancialStats as any)(getAdminRequest())).rejects.toThrow('Firestore init failed');
    });

    it('should fallback to revenue currency for budget when billing currency is missing and budget is set via env', async () => {
        // Setup env var
        process.env.GCP_BILLING_BUDGET = '500';

        // Mock billing account fetch to fail (so cost.currency remains empty initially)
        mockGetProjectBillingInfo.mockRejectedValueOnce(new Error('Auth Error'));

        // Mock stripe (revenue currency defaults to 'eur')
        const stripeMock = await import('../stripe/client');
        (stripeMock.getStripe as any).mockResolvedValue({
            invoices: {
                list: vi.fn().mockResolvedValue({ data: [], has_more: false })
            }
        });

        // Mock valid products
        mockCollection.mockReturnValue({
            get: vi.fn().mockResolvedValue({ docs: [] })
        });

        const result = await (getFinancialStats as any)(getAdminRequest());

        expect(result.cost.budget).toEqual({ amount: 500, currency: 'eur' });
        expect(result.cost.currency).toBe('eur');

        // Cleanup
        delete process.env.GCP_BILLING_BUDGET;
    });
});
