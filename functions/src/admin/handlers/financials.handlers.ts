import { HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { onAdminCall } from '../../shared/auth';
import { getStripe } from '../../stripe/client';
import { CloudBillingClient } from '@google-cloud/billing';
import { BudgetServiceClient } from '@google-cloud/billing-budgets';
import { BigQuery } from '@google-cloud/bigquery';
import { FUNCTIONS_MANIFEST } from '../../../../shared/functions-manifest';
import { FinancialStatsResponse } from '../shared/types';

/**
 * Gets financial statistics for the current month.
 * - Revenue: Calculated from Stripe Invoices (Total - Tax)
 * - Cost: Links to GCP Cloud Billing Report (since API doesn't provide live spend safely)
 */
export const getFinancialStats = onAdminCall<void, FinancialStatsResponse>({
    region: FUNCTIONS_MANIFEST.getFinancialStats.region,
    memory: '256MiB',
}, async () => {
    try {
        const envCurrency = process.env.GCP_BILLING_CURRENCY?.toLowerCase();
        // Initialize with undefined/null so we know it's not detected yet
        const stats: FinancialStatsResponse = {
            revenue: {
                total: 0,
                currency: envCurrency as string,
                invoiceCount: 0
            },
            cost: {
                billingAccountId: null,
                projectId: process.env.GCLOUD_PROJECT || '',
                reportUrl: null,
                currency: envCurrency as string,
                total: process.env.GCP_BILLING_SPEND ? Number(process.env.GCP_BILLING_SPEND) : null,
                budget: process.env.GCP_BILLING_BUDGET
                    ? { amount: Number(process.env.GCP_BILLING_BUDGET), currency: envCurrency as string }
                    : null,
                advice: 'To automate cost tracking, enable "Billing Export to BigQuery" in the GCP Console.'
            }
        };

        // --- 1. Get Valid Products from Firestore ---
        // We only count revenue if the product ID exists in the `products` collection.
        const productsSnapshot = await admin.firestore().collection('products').get();
        const validProductIds = new Set(productsSnapshot.docs.map(doc => doc.id));

        // --- 2. Calculate Revenue (Stripe) ---
        // Sum of PAID invoice line items where product is in validProductIds
        const stripe = await getStripe();
        const now = new Date();
        const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        const startTimestamp = Math.floor(startOfMonth.getTime() / 1000);

        // Fetch paid invoices
        let hasMore = true;
        let lastId: string | undefined;
        let totalCents = 0;
        let detectedCurrency: string | undefined = envCurrency;
        let count = 0;

        while (hasMore) {
            const invoices = await stripe.invoices.list({
                limit: 100,
                starting_after: lastId,
                created: { gte: startTimestamp },
                status: 'paid',
            });

            for (const invoice of invoices.data) {
                if (!detectedCurrency && invoice.currency) detectedCurrency = invoice.currency.toLowerCase();

                const amountPaid = invoice.amount_paid || 0;
                // Use a narrow inline shape for optional Stripe invoice tax fields.
                const taxAmount = (invoice as { tax?: number }).tax || 0;
                const netAmount = amountPaid - taxAmount;

                // Check if the invoice contains valid products
                let hasValidProduct = false;
                const lineItems = invoice.lines?.data || [];
                for (const line of lineItems) {
                    const price = (line as { price?: { product?: string | { id?: string } } }).price;
                    const productId = typeof price?.product === 'string' ? price.product : price?.product?.id;

                    if (productId && validProductIds.has(productId)) {
                        hasValidProduct = true;
                        break;
                    }
                }

                if (hasValidProduct) {
                    totalCents += netAmount;
                    count++;
                }
            }

            hasMore = invoices.has_more;
            if (hasMore && invoices.data.length > 0) {
                lastId = invoices.data[invoices.data.length - 1].id;
            }
        }

        stats.revenue.total = totalCents;
        // Final fallback for revenue if nothing detected: eur (local project default) > usd
        stats.revenue.currency = detectedCurrency || 'eur';
        stats.revenue.invoiceCount = count;

        // If GCP cost currency is still not detected, inherit from revenue
        if (!stats.cost.currency) {
            stats.cost.currency = stats.revenue.currency;
            if (stats.cost.budget) {
                stats.cost.budget.currency = stats.revenue.currency;
            }
        }

        // --- 3. Get GCP Billing Info ---
        const billingClient = new CloudBillingClient();
        const budgetClient = new BudgetServiceClient();
        const projectIdForBilling = process.env.GCLOUD_PROJECT;
        const projectName = `projects/${projectIdForBilling}`;

        try {
            const [info] = await billingClient.getProjectBillingInfo({ name: projectName });

            if (info.billingAccountName) {
                const id = info.billingAccountName.split('/').pop();
                stats.cost.billingAccountId = id || null;

                if (id) {
                    stats.cost.reportUrl = `https://console.cloud.google.com/billing/${id}/reports;project=${projectIdForBilling}`;

                    // Fetch Billing Account details for currency
                    try {
                        const [billingAccount] = await billingClient.getBillingAccount({ name: info.billingAccountName });
                        if (billingAccount.currencyCode) {
                            stats.cost.currency = billingAccount.currencyCode.toLowerCase();
                            if (stats.cost.budget) stats.cost.budget.currency = stats.cost.currency;
                        }
                    } catch (e: unknown) {
                        logger.warn('Failed to fetch billing account details (permission required for service account):', {
                            error: e instanceof Error ? e.message : `${e}`,
                            billingAccount: info.billingAccountName,
                            suggestion: 'Grant "Billing Account Viewer" to the Cloud Functions service account.'
                        });
                    }

                    // Fetch Budgets (only if not manually overridden)
                    if (!process.env.GCP_BILLING_BUDGET) {
                        try {
                            const [budgets] = await budgetClient.listBudgets({ parent: info.billingAccountName });
                            if (budgets && budgets.length > 0) {
                                const budgetWithAmount = budgets.find(b => b.amount?.specifiedAmount);
                                if (budgetWithAmount && budgetWithAmount.amount?.specifiedAmount) {
                                    stats.cost.budget = {
                                        amount: Number(budgetWithAmount.amount.specifiedAmount.units || 0) * 100 +
                                            Math.floor((budgetWithAmount.amount.specifiedAmount.nanos || 0) / 10000000),
                                        currency: (budgetWithAmount.amount.specifiedAmount.currencyCode || stats.cost.currency).toLowerCase()
                                    };
                                }
                            }
                        } catch (e: unknown) {
                            logger.warn('Failed to fetch budgets:', e instanceof Error ? e.message : `${e}`);
                        }
                    }

                    // --- 4. Fetch Actual Spend via BigQuery ---
                    const bqProjectId = 'billing-administration-gr';
                    const bqDatasetId = 'all_billing_data';

                    try {
                        const bigquery = new BigQuery({ projectId: bqProjectId });

                        // 1. Find the table name dynamically (it changes based on export config)
                        const [tables] = await bigquery.dataset(bqDatasetId).getTables();
                        const exportTable = tables.find(t => t.id && t.id.startsWith('gcp_billing_export_v1_'));

                        if (exportTable) {
                            const tableName = exportTable.id;
                            logger.info(`Found BigQuery export table: ${tableName}`);
                            const fullTableName = `\`${bqProjectId}.${bqDatasetId}.${tableName}\``;

                            // 2. Query for current usage month's cost.
                            // We intentionally filter by usage timestamps, not invoice.month, so dashboard
                            // numbers align with Cloud Billing usage-based reports for the same month.
                            const query = `
                                SELECT 
                                    SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) as total_cost,
                                    MAX(usage_end_time) as last_updated,
                                    ANY_VALUE(currency) as currency,
                                    COUNT(DISTINCT currency) as currency_count
                                FROM ${fullTableName} 
                                WHERE DATE(usage_start_time) >= DATE_TRUNC(CURRENT_DATE(), MONTH)
                                AND DATE(usage_start_time) < DATE_ADD(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 1 MONTH)
                                AND project.id = @projectId
                            `;

                            const options = {
                                query,
                                location: 'EU',
                                params: { projectId: projectIdForBilling }
                            };

                            const [rows] = await bigquery.query(options);

                            // Successfully connected to BigQuery export - clear the advice message
                            stats.cost.advice = undefined;

                            if (rows && rows.length > 0) {
                                const row = rows[0] as {
                                    total_cost?: number;
                                    last_updated?: unknown;
                                    currency?: string;
                                    currency_count?: number;
                                };
                                // Convert to cents for frontend compatibility
                                stats.cost.total = (row.total_cost || 0) * 100;
                                const lastUpdated = row.last_updated as { value?: unknown } | undefined;
                                stats.cost.lastUpdated = lastUpdated?.value || row.last_updated;
                                logger.info(`Calculated total cost: ${stats.cost.total} ${row.currency}, last updated: ${stats.cost.lastUpdated}`);
                                if (Number(row.currency_count || 0) > 1) {
                                    logger.warn(`Multiple currencies detected in billing export for project ${projectIdForBilling}; total may not be directly comparable`, {
                                        currencyCount: row.currency_count
                                    });
                                }
                                if (row.currency) {
                                    stats.cost.currency = row.currency.toLowerCase();
                                }
                            }
                        } else {
                            logger.warn(`No table found starting with 'gcp_billing_export_v1_' in dataset ${bqDatasetId}`);
                        }
                    } catch (bqError: unknown) {
                        logger.warn('Failed to query BigQuery for billing stats:', bqError instanceof Error ? bqError.message : `${bqError}`);
                    }
                }
            }
        } catch (e: unknown) {
            logger.warn('Failed to fetch project billing info (likely permission denied):', e instanceof Error ? e.message : `${e}`);
        }

        return stats;

    } catch (error: unknown) {
        logger.error('Error getting financial stats:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to get financial stats';
        throw new HttpsError('internal', errorMessage);
    }
});
