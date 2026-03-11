import type Stripe from 'stripe';
import { getStripe } from '../stripe/client';

const MAX_LIST_LIMIT = 100;
const MIGRATABLE_SUBSCRIPTION_STATUSES = new Set<Stripe.Subscription.Status>([
    'active',
    'trialing',
    'past_due',
    'unpaid',
    'incomplete',
    'paused',
]);

interface ReplaceStripePriceScriptOptions {
    oldPriceId: string;
    newUnitAmount: number;
    execute: boolean;
    deactivateOldRequested: boolean | undefined;
    deactivateOldOverriddenToDryRun: boolean;
    deactivateOld: boolean;
}

export interface ReplaceStripePriceSummary {
    dryRun: boolean;
    oldPriceId: string;
    newPriceId: string | null;
    orphanedNewPriceId: string | null;
    oldUnitAmount: number;
    newUnitAmount: number;
    currency: string;
    subscriptionsScanned: number;
    eligibleMigrationCount: number;
    migratedCount: number;
    skippedCount: number;
    failedSubscriptionIds: string[];
    oldPriceDeactivated: boolean;
}

interface SubscriptionMigrationCandidate {
    subscriptionId: string;
    updateItems: Stripe.SubscriptionUpdateParams.Item[];
}

interface SubscriptionMigrationAnalysis {
    subscriptionsScanned: number;
    candidates: SubscriptionMigrationCandidate[];
    skippedCount: number;
}

interface MigrationResult {
    migratedCount: number;
    failedSubscriptionIds: string[];
}

interface ScriptDependencies {
    getStripeClient: () => Promise<StripeClient>;
}

type StripeClient = Pick<Stripe, 'prices' | 'subscriptions' | 'products'>;

function readArgValue(argv: string[], key: string): string | undefined {
    const equalsPrefix = `${key}=`;
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token.startsWith(equalsPrefix)) {
            return token.slice(equalsPrefix.length);
        }

        if (token !== key) {
            continue;
        }

        const nextToken = argv[i + 1];
        if (nextToken === undefined || nextToken.startsWith('--')) {
            return undefined;
        }
        return nextToken;
    }

    return undefined;
}

function parseOptionalBooleanFlag(argv: string[], key: string): boolean | undefined {
    const equalsPrefix = `${key}=`;
    let present = false;
    let value: string | undefined;

    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token.startsWith(equalsPrefix)) {
            present = true;
            value = token.slice(equalsPrefix.length);
            continue;
        }

        if (token !== key) {
            continue;
        }

        present = true;
        const nextToken = argv[i + 1];
        if (nextToken && !nextToken.startsWith('--')) {
            value = nextToken;
            i++; // Consume the explicit value token.
        }
    }

    if (!present) {
        return undefined;
    }

    if (value === undefined || value === '') {
        return true;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        return false;
    }

    throw new Error(`Invalid boolean value for ${key}: '${value}'. Use true/false.`);
}

function parseRequiredStringArg(argv: string[], key: string): string {
    const raw = readArgValue(argv, key);
    if (raw === undefined) {
        throw new Error(`Missing required argument: ${key}`);
    }

    const value = raw.trim();
    if (!value) {
        throw new Error(`Invalid value for ${key}: empty string.`);
    }

    return value;
}

function parsePositiveIntegerArg(argv: string[], key: string): number {
    const raw = readArgValue(argv, key);
    if (raw === undefined) {
        throw new Error(`Missing required argument: ${key}`);
    }

    const normalizedRaw = raw.trim();
    if (!normalizedRaw) {
        throw new Error(`Invalid value for ${key}: empty string.`);
    }

    const parsed = Number(normalizedRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid value for ${key}: '${raw}'. Expected a positive integer (minor units).`);
    }

    return parsed;
}

export function parseReplaceStripePriceScriptOptions(argv: string[]): ReplaceStripePriceScriptOptions {
    const execute = argv.includes('--execute');
    const deactivateOldArg = parseOptionalBooleanFlag(argv, '--deactivate-old');
    const deactivateOldRequested = deactivateOldArg;
    const deactivateOldOverriddenToDryRun = !execute && deactivateOldRequested === true;
    const deactivateOld = execute ? (deactivateOldArg ?? true) : false;

    return {
        oldPriceId: parseRequiredStringArg(argv, '--old-price'),
        newUnitAmount: parsePositiveIntegerArg(argv, '--new-unit-amount'),
        execute,
        deactivateOldRequested,
        deactivateOldOverriddenToDryRun,
        deactivateOld,
    };
}

function resolveProductId(product: string | Stripe.Product | Stripe.DeletedProduct): string {
    return typeof product === 'string' ? product : product.id;
}

function resolveDefaultPriceId(defaultPrice: string | Stripe.Price | null | undefined): string | null {
    if (!defaultPrice) {
        return null;
    }
    return typeof defaultPrice === 'string' ? defaultPrice : defaultPrice.id;
}

function buildRecurringCreateParams(recurring: Stripe.Price.Recurring): Stripe.PriceCreateParams.Recurring {
    const recurringParams: Stripe.PriceCreateParams.Recurring = {
        interval: recurring.interval,
    };

    if (typeof recurring.interval_count === 'number') {
        recurringParams.interval_count = recurring.interval_count;
    }
    if (typeof recurring.trial_period_days === 'number') {
        recurringParams.trial_period_days = recurring.trial_period_days;
    }
    if (recurring.usage_type) {
        recurringParams.usage_type = recurring.usage_type;
    }
    if (recurring.meter) {
        recurringParams.meter = recurring.meter;
    }

    return recurringParams;
}

function validateSourcePrice(oldPrice: Stripe.Price, newUnitAmount: number): void {
    if (!oldPrice.active) {
        throw new Error(`Price ${oldPrice.id} is inactive. Provide an active source price.`);
    }

    if (!oldPrice.recurring) {
        throw new Error(`Price ${oldPrice.id} is not recurring. This script supports recurring prices only.`);
    }

    if (oldPrice.billing_scheme !== 'per_unit') {
        throw new Error(`Price ${oldPrice.id} uses billing_scheme=${oldPrice.billing_scheme}. Only per_unit prices are supported.`);
    }

    if (oldPrice.unit_amount === null) {
        throw new Error(`Price ${oldPrice.id} has null unit_amount. Only fixed per-unit prices are supported.`);
    }

    if (oldPrice.unit_amount === newUnitAmount) {
        throw new Error(`New unit amount matches existing amount (${newUnitAmount}). Nothing to replace.`);
    }
}

function buildPriceCreateParams(oldPrice: Stripe.Price, newUnitAmount: number): Stripe.PriceCreateParams {
    const payload: Stripe.PriceCreateParams = {
        product: resolveProductId(oldPrice.product),
        currency: oldPrice.currency,
        unit_amount: newUnitAmount,
        recurring: buildRecurringCreateParams(oldPrice.recurring as Stripe.Price.Recurring),
        billing_scheme: oldPrice.billing_scheme,
        metadata: {
            ...oldPrice.metadata,
        },
    };

    // tax_behavior can be 'exclusive' | 'inclusive' | 'unspecified' | null.
    // Copy any explicit value; when Stripe reports null we intentionally omit it.
    if (oldPrice.tax_behavior !== null) {
        payload.tax_behavior = oldPrice.tax_behavior;
    }
    if (oldPrice.nickname) {
        payload.nickname = oldPrice.nickname;
    }
    if (oldPrice.lookup_key) {
        payload.lookup_key = oldPrice.lookup_key;
        payload.transfer_lookup_key = true;
    }

    return payload;
}

async function listSubscriptionsByPrice(stripe: StripeClient, oldPriceId: string): Promise<Stripe.Subscription[]> {
    const subscriptions: Stripe.Subscription[] = [];
    let startingAfter: string | undefined;

    while (true) {
        const page = await stripe.subscriptions.list({
            price: oldPriceId,
            status: 'all',
            limit: MAX_LIST_LIMIT,
            ...(startingAfter ? { starting_after: startingAfter } : {}),
        });

        subscriptions.push(...page.data);

        if (!page.has_more || page.data.length === 0) {
            break;
        }

        startingAfter = page.data[page.data.length - 1].id;
    }

    return subscriptions;
}

function analyzeSubscriptionMigrations(
    subscriptions: Stripe.Subscription[],
    oldPriceId: string,
): SubscriptionMigrationAnalysis {
    const candidates: SubscriptionMigrationCandidate[] = [];
    let skippedCount = 0;

    for (const subscription of subscriptions) {
        if (!MIGRATABLE_SUBSCRIPTION_STATUSES.has(subscription.status)) {
            skippedCount++;
            continue;
        }

        const updateItems: Stripe.SubscriptionUpdateParams.Item[] = [];
        for (const item of subscription.items.data) {
            const itemPriceId = item.price?.id;
            if (itemPriceId !== oldPriceId) {
                continue;
            }

            const updateItem: Stripe.SubscriptionUpdateParams.Item = {
                id: item.id,
            };

            if (typeof item.quantity === 'number') {
                updateItem.quantity = item.quantity;
            }

            updateItems.push(updateItem);
        }

        if (updateItems.length === 0) {
            const observedPriceIds = subscription.items.data.map((item) => item.price?.id ?? null);
            console.warn(
                `[replace-stripe-price] Subscription ${subscription.id} was returned for price ${oldPriceId} but no matching subscription item was found.`,
                { observedPriceIds, status: subscription.status },
            );
            skippedCount++;
            continue;
        }

        candidates.push({
            subscriptionId: subscription.id,
            updateItems,
        });
    }

    return {
        subscriptionsScanned: subscriptions.length,
        candidates,
        skippedCount,
    };
}

async function migrateSubscriptionsToNewPrice(
    stripe: StripeClient,
    candidates: SubscriptionMigrationCandidate[],
    newPriceId: string,
): Promise<MigrationResult> {
    let migratedCount = 0;
    const failedSubscriptionIds: string[] = [];

    for (const candidate of candidates) {
        const updateItems = candidate.updateItems.map((item) => ({
            ...item,
            price: newPriceId,
        }));

        try {
            await stripe.subscriptions.update(candidate.subscriptionId, {
                items: updateItems,
                proration_behavior: 'none',
            });
            migratedCount++;
        } catch (error) {
            const errorMessage = (error as Error)?.message || `${error}`;
            failedSubscriptionIds.push(candidate.subscriptionId);
            console.error(`[replace-stripe-price] Failed to migrate subscription ${candidate.subscriptionId}: ${errorMessage}`);
        }
    }

    return { migratedCount, failedSubscriptionIds };
}

async function reassignProductDefaultPriceIfNeeded(
    stripe: StripeClient,
    productId: string,
    oldPriceId: string,
    newPriceId: string,
): Promise<void> {
    const product = await stripe.products.retrieve(productId);
    if ('deleted' in product && product.deleted) {
        return;
    }

    const currentDefaultPriceId = resolveDefaultPriceId(product.default_price);
    if (currentDefaultPriceId !== oldPriceId) {
        return;
    }

    await stripe.products.update(product.id, { default_price: newPriceId });
    console.warn(
        `[replace-stripe-price] Product ${product.id} default_price was updated from ${oldPriceId} to ${newPriceId} before old-price deactivation.`,
    );
}

function printPreflightSummary(
    options: ReplaceStripePriceScriptOptions,
    oldPrice: Stripe.Price,
    analysis: SubscriptionMigrationAnalysis,
): void {
    const preflightSummary = {
        mode: options.execute ? 'execute' : 'dry-run',
        oldPriceId: oldPrice.id,
        productId: resolveProductId(oldPrice.product),
        currency: oldPrice.currency,
        oldUnitAmount: oldPrice.unit_amount,
        newUnitAmount: options.newUnitAmount,
        interval: oldPrice.recurring?.interval ?? null,
        intervalCount: oldPrice.recurring?.interval_count ?? null,
        usageType: oldPrice.recurring?.usage_type ?? null,
        lookupKey: oldPrice.lookup_key ?? null,
        metadataKeys: Object.keys(oldPrice.metadata || {}),
        subscriptionsScanned: analysis.subscriptionsScanned,
        eligibleMigrationCount: analysis.candidates.length,
        skippedCount: analysis.skippedCount,
        deactivateOldRequested: options.deactivateOldRequested ?? null,
        deactivateOldOverriddenToDryRun: options.deactivateOldOverriddenToDryRun,
        deactivateOldPrice: options.deactivateOld,
        prorationBehavior: 'none',
    };

    console.log(`[replace-stripe-price] Preflight\n${JSON.stringify(preflightSummary, null, 2)}`);
}

const DEFAULT_DEPENDENCIES: ScriptDependencies = {
    getStripeClient: async () => (await getStripe()) as unknown as StripeClient,
};

export async function runReplaceStripePriceScript(
    argv: string[],
    dependencies: Partial<ScriptDependencies> = {},
): Promise<ReplaceStripePriceSummary> {
    const options = parseReplaceStripePriceScriptOptions(argv);
    const deps: ScriptDependencies = {
        ...DEFAULT_DEPENDENCIES,
        ...dependencies,
    };

    const stripe = await deps.getStripeClient();
    const oldPrice = await stripe.prices.retrieve(options.oldPriceId);
    // Race-window note: Stripe state is not atomic across calls. A concurrent actor could
    // deactivate this price immediately after retrieve() but before subsequent list/update
    // operations. We still validate active here to fail fast on known-inactive inputs.
    validateSourcePrice(oldPrice, options.newUnitAmount);

    const subscriptions = await listSubscriptionsByPrice(stripe, oldPrice.id);
    const analysis = analyzeSubscriptionMigrations(subscriptions, oldPrice.id);
    printPreflightSummary(options, oldPrice, analysis);

    let newPriceId: string | null = null;
    let orphanedNewPriceId: string | null = null;
    let migratedCount = 0;
    let failedSubscriptionIds: string[] = [];
    let oldPriceDeactivated = false;
    const hasEligibleCandidates = analysis.candidates.length > 0;

    if (options.execute && !hasEligibleCandidates) {
        console.warn(
            `[replace-stripe-price] No eligible subscriptions found for old price ${oldPrice.id}. Skipping create/migrate/deactivate in execute mode.`,
        );
    }

    if (options.execute && hasEligibleCandidates) {
        const createdPrice = await stripe.prices.create(buildPriceCreateParams(oldPrice, options.newUnitAmount));
        newPriceId = createdPrice.id;
        if (oldPrice.lookup_key) {
            console.warn(
                `[replace-stripe-price] lookup_key '${oldPrice.lookup_key}' was transferred to new price ${newPriceId} at creation time. This cannot be rolled back automatically if later migration steps fail.`,
            );
        }

        const migrationResult = await migrateSubscriptionsToNewPrice(stripe, analysis.candidates, newPriceId);
        migratedCount = migrationResult.migratedCount;
        failedSubscriptionIds = migrationResult.failedSubscriptionIds;

        if (migratedCount === 0 && failedSubscriptionIds.length > 0) {
            orphanedNewPriceId = newPriceId;
            console.warn(
                `[replace-stripe-price] All eligible subscription migrations failed. New price ${newPriceId} remains active with no migrated subscriptions. Review and deactivate/delete it manually if needed.`,
            );
        }

        if (options.deactivateOld) {
            if (failedSubscriptionIds.length > 0) {
                console.warn(
                    `[replace-stripe-price] Skipping old price deactivation because ${failedSubscriptionIds.length} subscription migrations failed.`,
                );
            } else {
                await reassignProductDefaultPriceIfNeeded(stripe, resolveProductId(oldPrice.product), oldPrice.id, newPriceId);
                await stripe.prices.update(oldPrice.id, { active: false });
                oldPriceDeactivated = true;
            }
        }
    }

    const summary: ReplaceStripePriceSummary = {
        dryRun: !options.execute,
        oldPriceId: oldPrice.id,
        newPriceId,
        orphanedNewPriceId,
        oldUnitAmount: oldPrice.unit_amount as number,
        newUnitAmount: options.newUnitAmount,
        currency: oldPrice.currency,
        subscriptionsScanned: analysis.subscriptionsScanned,
        eligibleMigrationCount: analysis.candidates.length,
        migratedCount,
        skippedCount: analysis.skippedCount,
        failedSubscriptionIds,
        oldPriceDeactivated,
    };

    console.log(`[replace-stripe-price] Summary\n${JSON.stringify(summary, null, 2)}`);
    return summary;
}

async function main(): Promise<void> {
    const summary = await runReplaceStripePriceScript(process.argv.slice(2));
    if (!summary.dryRun && summary.failedSubscriptionIds.length > 0) {
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch((error) => {
        const errorMessage = (error as Error)?.message || `${error}`;
        console.error(`[replace-stripe-price] Fatal error: ${errorMessage}`);
        process.exitCode = 1;
    });
}
