import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import {
    ADMIN_SUBSCRIPTION_GIFT_METADATA,
    addUtcCalendarMonthsClamped,
    buildEligibleSubscriptionGiftSnapshot,
    buildSubscriptionGiftInvariantVersion,
    buildSubscriptionGiftMetadata,
    buildSubscriptionGiftPreviewVersion,
    maximumGiftTrialEndSeconds,
    stripeGiftOutcomeIsAmbiguous,
    subscriptionHasAppliedGift,
    SubscriptionGiftEligibilityError,
} from './subscription-gift.logic';

function unixSeconds(value: string): number {
    return Math.floor(Date.parse(value) / 1000);
}

function subscription(overrides: Record<string, unknown> = {}): Stripe.Subscription {
    const base = {
        id: 'sub_gift',
        object: 'subscription',
        status: 'active',
        trial_end: null,
        cancel_at_period_end: false,
        schedule: null,
        billing_mode: { type: 'classic', flexible: null },
        billing_schedules: [],
        pause_collection: null,
        automatic_tax: { enabled: true, disabled_reason: null, liability: null },
        default_tax_rates: [],
        metadata: { firebaseUID: 'user-1', retained: 'yes' },
        items: {
            object: 'list',
            data: [{
                id: 'si_1',
                object: 'subscription_item',
                current_period_start: unixSeconds('2026-01-31T10:15:30Z'),
                current_period_end: unixSeconds('2026-01-31T10:15:30Z'),
                price: {
                    id: 'price_basic_monthly',
                    recurring: { interval: 'month', interval_count: 1 },
                },
                quantity: 1,
                tax_rates: [],
            }],
            has_more: false,
            url: '/v1/subscription_items?subscription=sub_gift',
        },
        ...overrides,
    };
    return base as unknown as Stripe.Subscription;
}

describe('admin subscription gift logic', () => {
    it('adds UTC calendar months and clamps month ends', () => {
        expect(addUtcCalendarMonthsClamped(unixSeconds('2025-01-31T10:15:30Z'), 1))
            .toBe(unixSeconds('2025-02-28T10:15:30Z'));
        expect(addUtcCalendarMonthsClamped(unixSeconds('2024-01-31T10:15:30Z'), 1))
            .toBe(unixSeconds('2024-02-29T10:15:30Z'));
        expect(addUtcCalendarMonthsClamped(unixSeconds('2024-02-29T10:15:30Z'), 12))
            .toBe(unixSeconds('2025-02-28T10:15:30Z'));
    });

    it('calculates from the later of the paid period end and existing trial end', () => {
        const existingTrialEnd = unixSeconds('2026-03-31T10:15:30Z');
        const snapshot = buildEligibleSubscriptionGiftSnapshot(
            subscription({ status: 'trialing', trial_end: existingTrialEnd }),
            'basic',
            2,
            unixSeconds('2026-01-01T00:00:00Z'),
        );

        expect(snapshot.currentAccessEndSeconds).toBe(existingTrialEnd);
        expect(snapshot.targetAccessEndSeconds).toBe(unixSeconds('2026-05-31T10:15:30Z'));
        expect(snapshot.status).toBe('trialing');
        expect(snapshot.cadence).toBe('monthly');
    });

    it('uses the latest subscription-item paid-period end', () => {
        const result = buildEligibleSubscriptionGiftSnapshot(
            subscription({
                items: {
                    object: 'list',
                    data: [
                        {
                            id: 'si_early',
                            current_period_start: unixSeconds('2026-01-01T00:00:00Z'),
                            current_period_end: unixSeconds('2026-02-01T00:00:00Z'),
                            price: { id: 'price_early', recurring: { interval: 'month', interval_count: 1 } },
                            quantity: 1,
                            tax_rates: [],
                        },
                        {
                            id: 'si_late',
                            current_period_start: unixSeconds('2026-01-01T00:00:00Z'),
                            current_period_end: unixSeconds('2026-03-01T00:00:00Z'),
                            price: { id: 'price_late', recurring: { interval: 'month', interval_count: 1 } },
                            quantity: 1,
                            tax_rates: [],
                        },
                    ],
                    has_more: false,
                    url: '/v1/subscription_items',
                },
            }),
            'pro',
            1,
            unixSeconds('2026-01-01T00:00:00Z'),
        );

        expect(result.currentAccessEndSeconds).toBe(unixSeconds('2026-03-01T00:00:00Z'));
        expect(result.targetAccessEndSeconds).toBe(unixSeconds('2026-04-01T00:00:00Z'));
    });

    it('supports repeated grants by extending the existing gifted trial end', () => {
        const now = unixSeconds('2026-01-01T00:00:00Z');
        const first = buildEligibleSubscriptionGiftSnapshot(subscription(), 'basic', 1, now);
        const second = buildEligibleSubscriptionGiftSnapshot(subscription({
            status: 'trialing',
            trial_end: first.targetAccessEndSeconds,
            items: {
                object: 'list',
                data: [{
                    id: 'si_1',
                    current_period_start: unixSeconds('2026-01-31T10:15:30Z'),
                    current_period_end: first.targetAccessEndSeconds,
                    price: { id: 'price_basic_monthly', recurring: { interval: 'month', interval_count: 1 } },
                    quantity: 1,
                    tax_rates: [],
                }],
                has_more: false,
                url: '/v1/subscription_items',
            },
        }), 'basic', 2, now);

        expect(first.targetAccessEndSeconds).toBe(unixSeconds('2026-02-28T10:15:30Z'));
        expect(second.targetAccessEndSeconds).toBe(unixSeconds('2026-04-28T10:15:30Z'));
    });

    it('recognizes yearly cadence and preserves scheduled cancellation in the preview', () => {
        const result = buildEligibleSubscriptionGiftSnapshot(subscription({
            cancel_at_period_end: true,
            items: {
                object: 'list',
                data: [{
                    id: 'si_yearly',
                    current_period_start: unixSeconds('2026-01-01T00:00:00Z'),
                    current_period_end: unixSeconds('2027-01-01T00:00:00Z'),
                    price: { id: 'price_pro_yearly', recurring: { interval: 'year', interval_count: 1 } },
                    quantity: 1,
                    tax_rates: [],
                }],
                has_more: false,
                url: '/v1/subscription_items',
            },
        }), 'pro', 1, unixSeconds('2026-01-01T00:00:00Z'));

        expect(result.cadence).toBe('yearly');
        expect(result.cancelAtPeriodEnd).toBe(true);
    });

    it('rejects targets beyond the absolute 730-day Stripe limit', () => {
        const now = unixSeconds('2026-01-01T00:00:00Z');
        const currentAccessEnd = maximumGiftTrialEndSeconds(now);
        const candidate = subscription({
            status: 'trialing',
            trial_end: currentAccessEnd,
            items: {
                object: 'list',
                data: [{
                    id: 'si_1',
                    current_period_start: now,
                    current_period_end: currentAccessEnd,
                    price: { id: 'price_1', recurring: { interval: 'month', interval_count: 1 } },
                    quantity: 1,
                    tax_rates: [],
                }],
                has_more: false,
                url: '/v1/subscription_items',
            },
        });

        expect(() => buildEligibleSubscriptionGiftSnapshot(candidate, 'basic', 1, now))
            .toThrowError(expect.objectContaining<Partial<SubscriptionGiftEligibilityError>>({ reason: 'trial-too-long' }));
    });

    it.each([
        ['past_due status', { status: 'past_due' }, 'subscription-status'],
        ['unpaid status', { status: 'unpaid' }, 'subscription-status'],
        ['canceled status', { status: 'canceled' }, 'subscription-status'],
        ['subscription schedule', { schedule: 'sub_sched_1' }, 'subscription-schedule'],
        ['pending billing update', {
            pending_update: {
                billing_cycle_anchor: null,
                expires_at: unixSeconds('2026-01-02T00:00:00Z'),
                subscription_items: null,
                trial_end: null,
                trial_from_plan: null,
            },
        }, 'pending-update'],
        ['billing schedule', { billing_schedules: [{ key: 'phase' }] }, 'billing-schedule'],
        ['flexible billing', { billing_mode: { type: 'flexible', flexible: {} } }, 'flexible-billing'],
        ['paused collection', { pause_collection: { behavior: 'keep_as_draft' } }, 'paused'],
        ['a custom cancellation date', { cancel_at: unixSeconds('2026-02-15T00:00:00Z') }, 'custom-cancellation'],
        ['a truncated subscription-item list', {
            items: { ...subscription().items, has_more: true },
        }, 'incomplete-items'],
        ['missing item period', {
            items: { object: 'list', data: [], has_more: false, url: '/v1/subscription_items' },
        }, 'missing-period'],
    ])('rejects %s', (_label, overrides, reason) => {
        expect(() => buildEligibleSubscriptionGiftSnapshot(
            subscription(overrides),
            'basic',
            1,
            unixSeconds('2026-01-01T00:00:00Z'),
        )).toThrowError(expect.objectContaining<Partial<SubscriptionGiftEligibilityError>>({ reason }));
    });

    it('makes preview versions stale when a relevant subscription field changes', () => {
        const before = subscription();
        const after = subscription({ trial_end: unixSeconds('2026-02-15T00:00:00Z') });
        const taxChanged = subscription({
            automatic_tax: { enabled: false, disabled_reason: null, liability: null },
        });
        const discountChanged = subscription({ discounts: ['di_new'] });
        const pendingUpdateAdded = subscription({
            pending_update: {
                billing_cycle_anchor: null,
                expires_at: unixSeconds('2026-01-02T00:00:00Z'),
                subscription_items: null,
                trial_end: null,
                trial_from_plan: null,
            },
        });
        const itemListTruncated = subscription({
            items: { ...before.items, has_more: true },
        });

        expect(buildSubscriptionGiftPreviewVersion(before, 'basic', 1))
            .not.toBe(buildSubscriptionGiftPreviewVersion(after, 'basic', 1));
        expect(buildSubscriptionGiftPreviewVersion(before, 'basic', 1))
            .not.toBe(buildSubscriptionGiftPreviewVersion(before, 'basic', 2));
        expect(buildSubscriptionGiftPreviewVersion(before, 'basic', 1))
            .not.toBe(buildSubscriptionGiftPreviewVersion(taxChanged, 'basic', 1));
        expect(buildSubscriptionGiftPreviewVersion(before, 'basic', 1))
            .not.toBe(buildSubscriptionGiftPreviewVersion(discountChanged, 'basic', 1));
        expect(buildSubscriptionGiftPreviewVersion(before, 'basic', 1))
            .not.toBe(buildSubscriptionGiftPreviewVersion(pendingUpdateAdded, 'basic', 1));
        expect(buildSubscriptionGiftPreviewVersion(before, 'basic', 1))
            .not.toBe(buildSubscriptionGiftPreviewVersion(itemListTruncated, 'basic', 1));
    });

    it('keeps plan and tax invariants stable across the expected trial and gift metadata change', () => {
        const before = subscription();
        const after = subscription({
            status: 'trialing',
            trial_end: unixSeconds('2026-02-28T10:15:30Z'),
            metadata: {
                firebaseUID: 'user-1',
                retained: 'yes',
                ...buildSubscriptionGiftMetadata('00000000-0000-4000-8000-000000000001', 1, unixSeconds('2026-02-28T10:15:30Z')),
            },
        });

        expect(buildSubscriptionGiftInvariantVersion(after)).toBe(buildSubscriptionGiftInvariantVersion(before));
    });

    it('treats existing subscription and item discounts as protected invariants', () => {
        const before = subscription({ discounts: ['di_subscription'] });
        const subscriptionDiscountChanged = subscription({ discounts: ['di_replacement'] });
        const itemDiscountChanged = subscription({
            discounts: ['di_subscription'],
            items: {
                ...before.items,
                data: before.items.data.map(item => ({ ...item, discounts: ['di_item'] })),
            },
        });

        expect(buildSubscriptionGiftInvariantVersion(subscriptionDiscountChanged))
            .not.toBe(buildSubscriptionGiftInvariantVersion(before));
        expect(buildSubscriptionGiftInvariantVersion(itemDiscountChanged))
            .not.toBe(buildSubscriptionGiftInvariantVersion(before));
    });

    it('detects an applied gift only with the matching operation and target', () => {
        const operationId = '00000000-0000-4000-8000-000000000001';
        const target = unixSeconds('2026-02-28T10:15:30Z');
        const candidate = subscription({
            status: 'trialing',
            trial_end: target,
            metadata: {
                [ADMIN_SUBSCRIPTION_GIFT_METADATA.type]: 'subscription_time',
                [ADMIN_SUBSCRIPTION_GIFT_METADATA.operationId]: operationId,
                [ADMIN_SUBSCRIPTION_GIFT_METADATA.accessUntil]: `${target}`,
            },
        });

        expect(subscriptionHasAppliedGift(candidate, operationId, target)).toBe(true);
        expect(subscriptionHasAppliedGift(candidate, operationId, target + 1)).toBe(false);
        expect(subscriptionHasAppliedGift(subscription({
            ...candidate,
            status: 'active',
        }), operationId, target)).toBe(false);
    });

    it('classifies network and server failures as ambiguous but validation failures as definitive', () => {
        expect(stripeGiftOutcomeIsAmbiguous({ type: 'StripeConnectionError' })).toBe(true);
        expect(stripeGiftOutcomeIsAmbiguous({ type: 'StripeAPIError', statusCode: 500 })).toBe(true);
        expect(stripeGiftOutcomeIsAmbiguous(new Error('unknown'))).toBe(true);
        expect(stripeGiftOutcomeIsAmbiguous({ type: 'StripeInvalidRequestError', statusCode: 400 })).toBe(false);
        expect(stripeGiftOutcomeIsAmbiguous({ type: 'StripePermissionError', statusCode: 403 })).toBe(false);
    });
});
