import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import {
    parseReplaceStripePriceScriptOptions,
    runReplaceStripePriceScript,
} from './replace-stripe-price';

function makeRecurringPrice(overrides: Partial<Stripe.Price> = {}): Stripe.Price {
    return {
        id: 'price_old',
        object: 'price',
        active: true,
        billing_scheme: 'per_unit',
        created: 0,
        currency: 'eur',
        custom_unit_amount: null,
        livemode: false,
        lookup_key: null,
        metadata: {
            firebaseRole: 'basic',
            promotion_code_id: 'promo_123',
        },
        nickname: 'Basic Monthly',
        product: 'prod_basic',
        recurring: {
            interval: 'month',
            interval_count: 1,
            meter: null,
            trial_period_days: 7,
            usage_type: 'licensed',
        },
        tax_behavior: 'exclusive',
        tiers_mode: null,
        transform_quantity: null,
        type: 'recurring',
        unit_amount: 200,
        unit_amount_decimal: '200',
        ...overrides,
    } as Stripe.Price;
}

function makeSubscription(params: {
    id: string;
    status: Stripe.Subscription.Status;
    oldPriceId: string;
    itemId?: string;
    quantity?: number | null;
}): Stripe.Subscription {
    return {
        id: params.id,
        status: params.status,
        items: {
            object: 'list',
            data: [
                {
                    id: params.itemId || `si_${params.id}`,
                    object: 'subscription_item',
                    created: 0,
                    deleted: undefined,
                    metadata: {},
                    quantity: params.quantity ?? null,
                    subscription: params.id,
                    tax_rates: [],
                    price: {
                        id: params.oldPriceId,
                    } as Stripe.Price,
                } as Stripe.SubscriptionItem,
            ],
            has_more: false,
            total_count: 1,
            url: `/v1/subscription_items?subscription=${params.id}`,
        },
    } as Stripe.Subscription;
}

function makeStripeApiList(data: Stripe.Subscription[]): Stripe.ApiList<Stripe.Subscription> {
    return {
        object: 'list',
        data,
        has_more: false,
        url: '/v1/subscriptions',
    } as Stripe.ApiList<Stripe.Subscription>;
}

function makeProduct(overrides: Partial<Stripe.Product> = {}): Stripe.Product {
    return {
        id: 'prod_basic',
        object: 'product',
        active: true,
        attributes: [],
        created: 0,
        default_price: null,
        description: null,
        images: [],
        livemode: false,
        marketing_features: [],
        metadata: {},
        name: 'Basic',
        package_dimensions: null,
        shippable: null,
        statement_descriptor: null,
        tax_code: null,
        type: 'service',
        unit_label: null,
        updated: 0,
        url: null,
        ...overrides,
    } as Stripe.Product;
}

describe('replace-stripe-price script', () => {
    const mockPricesRetrieve = vi.fn();
    const mockPricesCreate = vi.fn();
    const mockPricesUpdate = vi.fn();
    const mockProductsRetrieve = vi.fn();
    const mockProductsUpdate = vi.fn();
    const mockSubscriptionsList = vi.fn();
    const mockSubscriptionsUpdate = vi.fn();
    const sleep = vi.fn(async () => undefined);

    const mockStripe = {
        prices: {
            retrieve: mockPricesRetrieve,
            create: mockPricesCreate,
            update: mockPricesUpdate,
        },
        subscriptions: {
            list: mockSubscriptionsList,
            update: mockSubscriptionsUpdate,
        },
        products: {
            retrieve: mockProductsRetrieve,
            update: mockProductsUpdate,
        },
    } as unknown as Pick<Stripe, 'prices' | 'subscriptions' | 'products'>;

    const getStripeClient = vi.fn(async () => mockStripe);

    beforeEach(() => {
        vi.clearAllMocks();
        mockPricesRetrieve.mockResolvedValue(makeRecurringPrice());
        mockPricesCreate.mockResolvedValue(makeRecurringPrice({ id: 'price_new', unit_amount: 199 }));
        mockPricesUpdate.mockResolvedValue(makeRecurringPrice({ id: 'price_old', active: false }));
        mockProductsRetrieve.mockResolvedValue(makeProduct());
        mockProductsUpdate.mockResolvedValue(makeProduct({ default_price: 'price_new' }));
        mockSubscriptionsList.mockResolvedValue(makeStripeApiList([]));
        mockSubscriptionsUpdate.mockResolvedValue({ id: 'sub_1' } as Stripe.Subscription);
    });

    it('dry-run should not mutate Stripe resources', async () => {
        mockSubscriptionsList.mockResolvedValue(
            makeStripeApiList([
                makeSubscription({
                    id: 'sub_1',
                    status: 'active',
                    oldPriceId: 'price_old',
                    quantity: 2,
                }),
            ]),
        );

        const summary = await runReplaceStripePriceScript(
            ['--old-price', 'price_old', '--new-unit-amount', '199'],
            { getStripeClient, sleep },
        );

        expect(summary.dryRun).toBe(true);
        expect(summary.newPriceId).toBeNull();
        expect(summary.eligibleMigrationCount).toBe(1);
        expect(summary.migratedCount).toBe(0);
        expect(mockPricesCreate).not.toHaveBeenCalled();
        expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
        expect(mockPricesUpdate).not.toHaveBeenCalled();
    });

    it('execute should create replacement price preserving metadata and recurring config', async () => {
        mockSubscriptionsList.mockResolvedValue(
            makeStripeApiList([
                makeSubscription({
                    id: 'sub_create',
                    status: 'active',
                    oldPriceId: 'price_old',
                    itemId: 'si_create',
                    quantity: 1,
                }),
            ]),
        );

        await runReplaceStripePriceScript(
            ['--old-price', 'price_old', '--new-unit-amount', '199', '--execute'],
            { getStripeClient, sleep },
        );

        expect(mockPricesCreate).toHaveBeenCalledTimes(1);
        expect(mockPricesCreate).toHaveBeenCalledWith(expect.objectContaining({
            product: 'prod_basic',
            currency: 'eur',
            unit_amount: 199,
            billing_scheme: 'per_unit',
            tax_behavior: 'exclusive',
            nickname: 'Basic Monthly',
            metadata: {
                firebaseRole: 'basic',
                promotion_code_id: 'promo_123',
            },
            recurring: expect.objectContaining({
                interval: 'month',
                interval_count: 1,
                trial_period_days: 7,
                usage_type: 'licensed',
            }),
        }));
    });

    it('execute should transfer lookup key when source price has one', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        mockPricesRetrieve.mockResolvedValue(makeRecurringPrice({
            lookup_key: 'basic_monthly',
        }));
        mockSubscriptionsList.mockResolvedValue(
            makeStripeApiList([
                makeSubscription({
                    id: 'sub_lookup',
                    status: 'active',
                    oldPriceId: 'price_old',
                    itemId: 'si_lookup',
                    quantity: 1,
                }),
            ]),
        );

        await runReplaceStripePriceScript(
            ['--old-price', 'price_old', '--new-unit-amount', '199', '--execute'],
            { getStripeClient, sleep },
        );

        expect(mockPricesCreate).toHaveBeenCalledWith(expect.objectContaining({
            lookup_key: 'basic_monthly',
            transfer_lookup_key: true,
        }));
        expect(warnSpy).toHaveBeenCalledWith(
            "[replace-stripe-price] lookup_key 'basic_monthly' was transferred to new price price_new at creation time. This cannot be rolled back automatically if later migration steps fail.",
        );
        warnSpy.mockRestore();
    });

    it('execute should preserve tax_behavior when it is explicitly unspecified', async () => {
        mockPricesRetrieve.mockResolvedValue(makeRecurringPrice({
            tax_behavior: 'unspecified',
        }));
        mockSubscriptionsList.mockResolvedValue(
            makeStripeApiList([
                makeSubscription({
                    id: 'sub_tax',
                    status: 'active',
                    oldPriceId: 'price_old',
                    itemId: 'si_tax',
                    quantity: 1,
                }),
            ]),
        );

        await runReplaceStripePriceScript(
            ['--old-price', 'price_old', '--new-unit-amount', '199', '--execute'],
            { getStripeClient, sleep },
        );

        expect(mockPricesCreate).toHaveBeenCalledWith(expect.objectContaining({
            tax_behavior: 'unspecified',
        }));
    });

    it('execute should migrate subscription items with no proration and preserve quantity', async () => {
        mockSubscriptionsList.mockResolvedValue(
            makeStripeApiList([
                makeSubscription({
                    id: 'sub_123',
                    status: 'active',
                    oldPriceId: 'price_old',
                    itemId: 'si_old',
                    quantity: 3,
                }),
            ]),
        );
        mockPricesCreate.mockResolvedValue(makeRecurringPrice({ id: 'price_new', unit_amount: 199 }));

        const summary = await runReplaceStripePriceScript(
            ['--old-price', 'price_old', '--new-unit-amount', '199', '--execute'],
            { getStripeClient, sleep },
        );

        expect(summary.migratedCount).toBe(1);
        expect(mockSubscriptionsUpdate).toHaveBeenCalledTimes(1);
        expect(mockSubscriptionsUpdate).toHaveBeenCalledWith('sub_123', {
            items: [{ id: 'si_old', price: 'price_new', quantity: 3 }],
            proration_behavior: 'none',
        });
    });

    it('should deactivate old price only after migration phase is complete', async () => {
        mockSubscriptionsList.mockResolvedValue(
            makeStripeApiList([
                makeSubscription({
                    id: 'sub_1',
                    status: 'active',
                    oldPriceId: 'price_old',
                    itemId: 'si_old',
                    quantity: 1,
                }),
            ]),
        );

        await runReplaceStripePriceScript(
            ['--old-price', 'price_old', '--new-unit-amount', '199', '--execute'],
            { getStripeClient, sleep },
        );

        expect(mockPricesUpdate).toHaveBeenCalledWith('price_old', { active: false });
        expect(mockSubscriptionsUpdate).toHaveBeenCalledTimes(1);
        expect(mockPricesUpdate.mock.invocationCallOrder[0]).toBeGreaterThan(
            mockSubscriptionsUpdate.mock.invocationCallOrder[0],
        );
    });

    it('should update product default_price before deactivating an old default price', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        mockProductsRetrieve.mockResolvedValue(makeProduct({
            default_price: 'price_old',
        }));
        mockSubscriptionsList.mockResolvedValue(
            makeStripeApiList([
                makeSubscription({
                    id: 'sub_default',
                    status: 'active',
                    oldPriceId: 'price_old',
                    itemId: 'si_default',
                    quantity: 1,
                }),
            ]),
        );

        await runReplaceStripePriceScript(
            ['--old-price', 'price_old', '--new-unit-amount', '199', '--execute'],
            { getStripeClient, sleep },
        );

        expect(mockProductsUpdate).toHaveBeenCalledWith('prod_basic', { default_price: 'price_new' });
        expect(mockPricesUpdate).toHaveBeenCalledWith('price_old', { active: false });
        expect(mockProductsUpdate.mock.invocationCallOrder[0]).toBeLessThan(
            mockPricesUpdate.mock.invocationCallOrder[0],
        );
        expect(warnSpy).toHaveBeenCalledWith(
            '[replace-stripe-price] Product prod_basic default_price was updated from price_old to price_new before old-price deactivation.',
        );
        warnSpy.mockRestore();
    });

    it('should skip old price deactivation when any migration fails', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        mockSubscriptionsList.mockResolvedValue(
            makeStripeApiList([
                makeSubscription({
                    id: 'sub_failed',
                    status: 'active',
                    oldPriceId: 'price_old',
                    itemId: 'si_failed',
                    quantity: 1,
                }),
            ]),
        );
        mockSubscriptionsUpdate.mockRejectedValue(new Error('Stripe update failed'));

        const summary = await runReplaceStripePriceScript(
            ['--old-price', 'price_old', '--new-unit-amount', '199', '--execute'],
            { getStripeClient, sleep },
        );

        expect(summary.failedSubscriptionIds).toEqual(['sub_failed']);
        expect(summary.oldPriceDeactivated).toBe(false);
        expect(summary.orphanedNewPriceId).toBe('price_new');
        expect(mockPricesUpdate).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(
            '[replace-stripe-price] All eligible subscription migrations failed. New price price_new remains active with no migrated subscriptions. Review and deactivate/delete it manually if needed.',
        );
        warnSpy.mockRestore();
    });

    it('should still create a new price and deactivate the old price when execute mode has no eligible migration candidates', async () => {
        mockSubscriptionsList.mockResolvedValue(makeStripeApiList([]));

        const summary = await runReplaceStripePriceScript(
            ['--old-price', 'price_old', '--new-unit-amount', '199', '--execute'],
            { getStripeClient, sleep },
        );

        expect(summary.dryRun).toBe(false);
        expect(summary.eligibleMigrationCount).toBe(0);
        expect(summary.newPriceId).toBe('price_new');
        expect(summary.orphanedNewPriceId).toBeNull();
        expect(summary.oldPriceDeactivated).toBe(true);
        expect(mockPricesCreate).toHaveBeenCalledTimes(1);
        expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
        expect(mockPricesUpdate).toHaveBeenCalledWith('price_old', { active: false });
    });

    it('should warn when a listed subscription contains no matching old-price item', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        mockSubscriptionsList.mockResolvedValue(
            makeStripeApiList([
                {
                    ...makeSubscription({
                        id: 'sub_anomalous',
                        status: 'active',
                        oldPriceId: 'price_old',
                        itemId: 'si_anomalous',
                        quantity: 1,
                    }),
                    items: {
                        object: 'list',
                        data: [
                            {
                                id: 'si_anomalous',
                                object: 'subscription_item',
                                created: 0,
                                metadata: {},
                                quantity: 1,
                                subscription: 'sub_anomalous',
                                tax_rates: [],
                            } as Stripe.SubscriptionItem,
                        ],
                        has_more: false,
                        total_count: 1,
                        url: '/v1/subscription_items?subscription=sub_anomalous',
                    },
                } as Stripe.Subscription,
            ]),
        );

        const summary = await runReplaceStripePriceScript(
            ['--old-price', 'price_old', '--new-unit-amount', '199'],
            { getStripeClient, sleep },
        );

        expect(summary.eligibleMigrationCount).toBe(0);
        expect(summary.skippedCount).toBe(1);
        expect(warnSpy).toHaveBeenCalledWith(
            '[replace-stripe-price] Subscription sub_anomalous was returned for price price_old but no matching subscription item was found.',
            { observedPriceIds: [null], status: 'active' },
        );
        warnSpy.mockRestore();
    });

    it('parseReplaceStripePriceScriptOptions should reject missing or invalid args', () => {
        expect(() => parseReplaceStripePriceScriptOptions([])).toThrow('Missing required argument: --old-price');
        expect(() => parseReplaceStripePriceScriptOptions(['--old-price', 'price_old'])).toThrow(
            'Missing required argument: --new-unit-amount',
        );
        expect(() => parseReplaceStripePriceScriptOptions([
            '--old-price',
            'price_old',
            '--new-unit-amount',
            '1.99',
        ])).toThrow("Invalid value for --new-unit-amount: '1.99'. Expected a positive integer (minor units).");
        expect(() => parseReplaceStripePriceScriptOptions([
            '--old-price',
            'price_old',
            '--new-unit-amount',
            '0',
        ])).toThrow("Invalid value for --new-unit-amount: '0'. Expected a positive integer (minor units).");
        expect(() => parseReplaceStripePriceScriptOptions([
            '--old-price',
            '',
            '--new-unit-amount',
            '199',
        ])).toThrow('Invalid value for --old-price: empty string.');
        expect(() => parseReplaceStripePriceScriptOptions([
            '--old-price',
            'price_old',
            '--new-unit-amount',
            '',
        ])).toThrow('Invalid value for --new-unit-amount: empty string.');
    });

    it('parseReplaceStripePriceScriptOptions should support space-separated --deactivate-old value', () => {
        const options = parseReplaceStripePriceScriptOptions([
            '--old-price',
            'price_old',
            '--new-unit-amount',
            '199',
            '--deactivate-old',
            'false',
            '--execute',
        ]);

        expect(options.execute).toBe(true);
        expect(options.deactivateOld).toBe(false);
        expect(options.oldPriceId).toBe('price_old');
        expect(options.newUnitAmount).toBe(199);
    });

    it('dry-run preflight should surface deactivate-old override metadata', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        mockSubscriptionsList.mockResolvedValue(
            makeStripeApiList([
                makeSubscription({
                    id: 'sub_preflight',
                    status: 'active',
                    oldPriceId: 'price_old',
                    itemId: 'si_preflight',
                    quantity: 1,
                }),
            ]),
        );

        await runReplaceStripePriceScript(
            ['--old-price', 'price_old', '--new-unit-amount', '199', '--deactivate-old=true'],
            { getStripeClient, sleep },
        );

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"deactivateOldRequested": true'));
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"deactivateOldOverriddenToDryRun": true'));
        logSpy.mockRestore();
    });

    it('should retry subscription migration on Stripe rate limit errors', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        mockSubscriptionsList.mockResolvedValue(
            makeStripeApiList([
                makeSubscription({
                    id: 'sub_retry',
                    status: 'active',
                    oldPriceId: 'price_old',
                    itemId: 'si_retry',
                    quantity: 1,
                }),
            ]),
        );
        mockSubscriptionsUpdate
            .mockRejectedValueOnce(Object.assign(new Error('Too many requests'), { statusCode: 429 }))
            .mockResolvedValueOnce({ id: 'sub_retry' } as Stripe.Subscription);

        const summary = await runReplaceStripePriceScript(
            ['--old-price', 'price_old', '--new-unit-amount', '199', '--execute'],
            { getStripeClient, sleep },
        );

        expect(summary.migratedCount).toBe(1);
        expect(summary.failedSubscriptionIds).toEqual([]);
        expect(mockSubscriptionsUpdate).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledWith(500);
        expect(warnSpy).toHaveBeenCalledWith(
            '[replace-stripe-price] Rate limited updating subscription sub_retry. Retrying in 500ms (attempt 1/3).',
        );
        warnSpy.mockRestore();
    });
});
