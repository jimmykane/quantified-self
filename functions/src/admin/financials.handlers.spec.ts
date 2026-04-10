import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    getAdminRequest,
    getFinancialStats,
    mockCollection,
    mockStripeClient,
    mockGetProjectBillingInfo,
    mockGetBillingAccount,
    mockListBudgets,
    mockGetTables,
    mockBigQueryQuery,
} from './test-utils/admin-test-harness';

describe('getFinancialStats Cloud Function', () => {
    let request: any;
    const productsDocs: any[] = [];

    beforeEach(() => {
        vi.clearAllMocks();
        mockCollection.mockReset();

        // Reset BigQuery mocks
        mockGetTables.mockResolvedValue([[]]);
        mockBigQueryQuery.mockResolvedValue([[]]);

        request = {
            data: { env: 'prod' },
            auth: {
                uid: 'admin-uid',
                token: { admin: true }
            },
            app: { appId: 'mock-app-id' }
        };
        process.env.GCLOUD_PROJECT = 'test-project';
        productsDocs.length = 0;

        // Base mock for firestore
        mockCollection.mockImplementation((name) => {
            if (name === 'products') {
                return {
                    get: vi.fn().mockImplementation(async () => ({ docs: [...productsDocs] })),
                    doc: vi.fn(),
                    where: vi.fn(),
                    add: vi.fn()
                };
            }
            return {
                get: vi.fn().mockResolvedValue({ docs: [] }),
                doc: vi.fn(),
                where: vi.fn(),
                add: vi.fn()
            };
        });
    });

    it('should throw "unauthenticated" if called without auth', async () => {
        request.auth = null;
        await expect((getFinancialStats as any)(request)).rejects.toThrow('The function must be called while authenticated.');
    });

    it('should throw "permission-denied" if user is not an admin', async () => {
        request.auth = { uid: 'user1', token: { admin: false } };
        request.app = { appId: 'mock-app-id' };
        await expect((getFinancialStats as any)(request)).rejects.toThrow('Only admins can call this function.');
    });

    it('should return combined financial stats (Revenue + GCP Cost Link)', async () => {
        // Mock Firestore products
        productsDocs.push(
            { id: 'prod_valid_1' },
            { id: 'prod_valid_2' }
        );

        // Mock Stripe response
        mockStripeClient.invoices.list.mockResolvedValue({
            has_more: false,
            data: [
                { id: 'inv_1', currency: 'usd', amount_paid: 2000, tax: 200, lines: { data: [{ amount: 1800, price: { product: 'prod_valid_1' } }] } },
                { id: 'inv_2', currency: 'usd', amount_paid: 3000, tax: null, lines: { data: [{ amount: 3000, price: { product: 'prod_valid_2' } }] } },
                { id: 'inv_3', currency: 'usd', amount_paid: 5000, tax: null, lines: { data: [{ amount: 5000, price: { product: 'prod_invalid' } }] } }
            ]
        });

        // Mock GCP Billing response
        mockGetProjectBillingInfo.mockResolvedValue([{
            billingAccountName: 'billingAccounts/000000-000000-000000'
        }]);
        mockGetBillingAccount.mockResolvedValue([{
            currencyCode: 'EUR'
        }]);
        mockListBudgets.mockResolvedValue([[
            {
                amount: {
                    specifiedAmount: {
                        units: '100',
                        currencyCode: 'EUR'
                    }
                }
            }
        ]]);

        const result: any = await (getFinancialStats as any)(request);

        // Verify Revenue (only valid products)
        expect(result.revenue.total).toBe(4800); // 1800 + 3000
        expect(result.revenue.invoiceCount).toBe(2);
        expect(result.revenue.currency).toBe('usd');

        // Verify GCP Cost Details
        expect(result.cost.currency).toBe('eur');
        expect(result.cost.budget).toEqual({ amount: 10000, currency: 'eur' });

        // Verify Cost Link
        expect(result.cost.billingAccountId).toBe('000000-000000-000000');
        expect(result.cost.reportUrl).toContain('console.cloud.google.com/billing/000000-000000-000000/reports');
    });

    it('should include lastUpdated when BigQuery returns it', async () => {
        // Mock BigQuery returning a cost and a timestamp
        const mockTimestamp = '2026-01-09T10:00:00Z';
        mockGetTables.mockResolvedValue([[{ id: 'gcp_billing_export_v1_123' }]]);
        mockBigQueryQuery.mockResolvedValue([[{
            total_cost: 15.5,
            last_updated: mockTimestamp,
            currency: 'USD'
        }]]);

        const result: any = await (getFinancialStats as any)(request);

        expect(result.cost.total).toBe(1550); // 15.5 * 100
        expect(result.cost.lastUpdated).toBe(mockTimestamp);
    });

    it('should query BigQuery by usage month instead of invoice month', async () => {
        mockGetProjectBillingInfo.mockResolvedValue([{
            billingAccountName: 'billingAccounts/000000-000000-000000'
        }]);
        mockGetTables.mockResolvedValue([[{ id: 'gcp_billing_export_v1_123' }]]);
        mockBigQueryQuery.mockResolvedValue([[]]);

        await (getFinancialStats as any)(request);

        expect(mockBigQueryQuery).toHaveBeenCalledTimes(1);
        const queryText = mockBigQueryQuery.mock.calls[0][0].query as string;
        expect(queryText).toContain('DATE(usage_start_time) >= DATE_TRUNC(CURRENT_DATE(), MONTH)');
        expect(queryText).toContain('DATE(usage_start_time) < DATE_ADD(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 1 MONTH)');
        expect(queryText).not.toContain('invoice.month');
        expect(queryText).toContain('ANY_VALUE(currency) as currency');
        expect(queryText).toContain('COUNT(DISTINCT currency) as currency_count');
        expect(queryText).not.toContain('GROUP BY currency');
        expect(queryText).not.toContain('LIMIT 1');
    });

    it('should handle pagination for Stripe invoices', async () => {
        productsDocs.push({ id: 'prod_valid_1' });

        mockStripeClient.invoices.list
            .mockResolvedValueOnce({
                has_more: true,
                next_page: 'page2',
                data: [{ id: 'inv_1', currency: 'eur', amount_paid: 1000, tax: 0, lines: { data: [{ amount: 1000, price: { product: 'prod_valid_1' } }] } }]
            })
            .mockResolvedValueOnce({
                has_more: false,
                data: [{ id: 'inv_2', currency: 'eur', amount_paid: 2000, tax: 0, lines: { data: [{ amount: 2000, price: { product: 'prod_valid_1' } }] } }]
            });

        mockGetProjectBillingInfo.mockResolvedValue([{}]);

        const result: any = await (getFinancialStats as any)(request);

        expect(result.revenue.total).toBe(3000);
        expect(result.revenue.invoiceCount).toBe(2);
        expect(mockStripeClient.invoices.list).toHaveBeenCalledTimes(2);
    });

    it('should handle missing GCP permissions gracefully and fallback to revenue currency', async () => {
        // Mock Firestore products
        productsDocs.push({ id: 'prod_valid_1' });

        // Mock Stripe response in EUR
        mockStripeClient.invoices.list.mockResolvedValue({
            has_more: false,
            data: [
                { id: 'inv_1', currency: 'eur', amount_paid: 2000, tax: 0, lines: { data: [{ amount: 2000, price: { product: 'prod_valid_1' } }] } }
            ]
        });

        // Mock GCP Billing failing (Permission Denied)
        mockGetProjectBillingInfo.mockRejectedValue(new Error('Permission Denied'));

        const result: any = await (getFinancialStats as any)(request);

        // Verify Revenue is in EUR
        expect(result.revenue.currency).toBe('eur');
        expect(result.revenue.total).toBe(2000);

        // Verify Cost fallback to EUR (project default)
        expect(result.cost.currency).toBe('eur');
    });
    it('should handle missing GCP permissions gracefully', async () => {
        mockStripeClient.invoices.list.mockResolvedValue({ has_more: false, data: [] });

        // Simulate permission error
        mockGetProjectBillingInfo.mockRejectedValue(new Error('Permission denied'));

        const result: any = await (getFinancialStats as any)(request);

        // Should still return stats, just with empty cost info
        expect(result.revenue.total).toBe(0);
        expect(result.cost.billingAccountId).toBeNull();
        expect(result.cost.reportUrl).toBeNull();
    });

    it('should handle specific billing account fetch error', async () => {
        // Mock success for getProjectBillingInfo but failure for getBillingAccount
        mockGetProjectBillingInfo.mockResolvedValue([{ billingAccountName: 'billingAccounts/123' }]);
        mockGetBillingAccount.mockRejectedValue(new Error('Permission denied'));
        mockStripeClient.invoices.list.mockResolvedValue({ has_more: false, data: [] });

        const result: any = await (getFinancialStats as any)(request);
        expect(result.cost.billingAccountId).toBe('123'); // Still gets ID
        // Budget fetch might also fail or be skipped, but function shouldn't throw
    });

    it('should handle budget list error', async () => {
        mockGetProjectBillingInfo.mockResolvedValue([{ billingAccountName: 'billingAccounts/123' }]);
        mockGetBillingAccount.mockResolvedValue([{ currencyCode: 'USD' }]);
        mockListBudgets.mockRejectedValue(new Error('Budget Error'));
        mockStripeClient.invoices.list.mockResolvedValue({ has_more: false, data: [] });

        const result: any = await (getFinancialStats as any)(request);
        // Should just have null budget
        expect(result.cost.budget).toBeNull();
    });

    it('should handle BigQuery query error', async () => {
        mockGetProjectBillingInfo.mockResolvedValue([{ billingAccountName: 'billingAccounts/123' }]);
        mockGetBillingAccount.mockResolvedValue([{ currencyCode: 'USD' }]);
        mockListBudgets.mockResolvedValue([]);
        mockGetTables.mockResolvedValue([[{ id: 'gcp_billing_export_v1_xyz' }]]);
        mockBigQueryQuery.mockRejectedValue(new Error('Query Failed'));
        mockStripeClient.invoices.list.mockResolvedValue({ has_more: false, data: [] });

        const result: any = await (getFinancialStats as any)(request);
        // Total remains null or 0 from initialization
        expect(result.cost.total).toBeNull();
    });

    it('should handle missing BigQuery export table', async () => {
        mockGetProjectBillingInfo.mockResolvedValue([{ billingAccountName: 'billingAccounts/123' }]);
        mockGetBillingAccount.mockResolvedValue([{ currencyCode: 'USD' }]);
        mockListBudgets.mockResolvedValue([]);
        mockGetTables.mockResolvedValue([[]]); // No tables
        mockStripeClient.invoices.list.mockResolvedValue({ has_more: false, data: [] });

        const result: any = await (getFinancialStats as any)(request);
        expect(result.cost.total).toBeNull();
    });
});
