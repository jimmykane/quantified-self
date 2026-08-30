import { createHash } from 'crypto';
import type Stripe from 'stripe';
import type {
    AdminSubscriptionGiftCadence,
    AdminSubscriptionGiftRole,
    AdminSubscriptionGiftSubscriptionStatus,
} from '../../../../shared/admin-subscription-gifts';

export const ADMIN_SUBSCRIPTION_GIFT_MIN_MONTHS = 1;
export const ADMIN_SUBSCRIPTION_GIFT_MAX_MONTHS = 12;
export const ADMIN_SUBSCRIPTION_GIFT_MAX_TRIAL_DAYS = 730;
export const ADMIN_SUBSCRIPTION_GIFT_METADATA = {
    type: 'qs_gift_type',
    operationId: 'qs_gift_operation_id',
    months: 'qs_gift_months',
    accessUntil: 'qs_gift_access_until',
} as const;

export class SubscriptionGiftEligibilityError extends Error {
    constructor(
        public readonly reason:
            | 'subscription-status'
            | 'subscription-schedule'
            | 'billing-schedule'
            | 'flexible-billing'
            | 'paused'
            | 'missing-period'
            | 'trial-too-long',
        message: string,
    ) {
        super(message);
        this.name = 'SubscriptionGiftEligibilityError';
    }
}

export interface EligibleSubscriptionGiftSnapshot {
    subscriptionId: string;
    role: AdminSubscriptionGiftRole;
    cadence: AdminSubscriptionGiftCadence;
    status: AdminSubscriptionGiftSubscriptionStatus;
    currentAccessEndSeconds: number;
    targetAccessEndSeconds: number;
    trialEndSeconds: number | null;
    cancelAtPeriodEnd: boolean;
    previewVersion: string;
    invariantVersion: string;
}

export interface CurrentSubscriptionGiftState {
    subscriptionId: string;
    role: AdminSubscriptionGiftRole;
    cadence: AdminSubscriptionGiftCadence;
    status: AdminSubscriptionGiftSubscriptionStatus;
    currentAccessEndSeconds: number;
    trialEndSeconds: number | null;
    cancelAtPeriodEnd: boolean;
    invariantVersion: string;
}

function requireUnixSeconds(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
        ? value
        : null;
}

function utcDaysInMonth(year: number, monthIndex: number): number {
    return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function addUtcCalendarMonthsClamped(unixSeconds: number, months: number): number {
    if (!Number.isSafeInteger(unixSeconds) || unixSeconds <= 0) {
        throw new Error('A positive Unix timestamp is required.');
    }
    if (!Number.isSafeInteger(months) || months < ADMIN_SUBSCRIPTION_GIFT_MIN_MONTHS) {
        throw new Error('A positive integer month count is required.');
    }

    const source = new Date(unixSeconds * 1000);
    const targetMonthStart = new Date(Date.UTC(
        source.getUTCFullYear(),
        source.getUTCMonth() + months,
        1,
        source.getUTCHours(),
        source.getUTCMinutes(),
        source.getUTCSeconds(),
    ));
    const clampedDay = Math.min(
        source.getUTCDate(),
        utcDaysInMonth(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth()),
    );
    targetMonthStart.setUTCDate(clampedDay);
    return Math.floor(targetMonthStart.getTime() / 1000);
}

export function maximumGiftTrialEndSeconds(nowSeconds: number): number {
    if (!Number.isSafeInteger(nowSeconds) || nowSeconds <= 0) {
        throw new Error('A positive current Unix timestamp is required.');
    }
    return nowSeconds + (ADMIN_SUBSCRIPTION_GIFT_MAX_TRIAL_DAYS * 24 * 60 * 60);
}

function resolveCurrentPaidPeriodEnd(subscription: Stripe.Subscription): number {
    const itemPeriodEnds = subscription.items.data
        .map(item => requireUnixSeconds(item.current_period_end))
        .filter((value): value is number => value !== null);
    if (itemPeriodEnds.length === 0) {
        throw new SubscriptionGiftEligibilityError(
            'missing-period',
            'The subscription does not have a current paid-period end.',
        );
    }
    return Math.max(...itemPeriodEnds);
}

function resolveCadence(subscription: Stripe.Subscription): AdminSubscriptionGiftCadence {
    const recurring = subscription.items.data[0]?.price.recurring;
    const intervalCount = recurring?.interval_count ?? 1;
    if (recurring?.interval === 'month' && intervalCount === 1) {
        return 'monthly';
    }
    if (recurring?.interval === 'year' && intervalCount === 1) {
        return 'yearly';
    }
    return 'unknown';
}

function objectId(value: string | { id: string } | null | undefined): string | null {
    if (!value) {
        return null;
    }
    return typeof value === 'string' ? value : value.id;
}

function taxRateIds(value: Array<string | Stripe.TaxRate> | null | undefined): Array<string | null> {
    return (value || []).map(rate => objectId(rate)).sort();
}

function sortedMetadata(
    metadata: Stripe.Metadata | null | undefined,
    excludeGiftMetadata = false,
): Array<[string, string]> {
    const giftKeys = new Set<string>(Object.values(ADMIN_SUBSCRIPTION_GIFT_METADATA));
    return Object.entries(metadata || {})
        .filter(([key]) => !excludeGiftMetadata || !giftKeys.has(key))
        .sort(([left], [right]) => left.localeCompare(right));
}

function hashVersion(prefix: string, value: unknown): string {
    return `${prefix}_${createHash('sha256').update(JSON.stringify(value)).digest('base64url')}`;
}

export function buildSubscriptionGiftInvariantVersion(subscription: Stripe.Subscription): string {
    return hashVersion('iv1', {
        subscriptionId: subscription.id,
        cancellation: subscription.cancel_at_period_end,
        schedule: objectId(subscription.schedule),
        billingMode: subscription.billing_mode?.type || null,
        automaticTax: subscription.automatic_tax,
        defaultTaxRates: taxRateIds(subscription.default_tax_rates),
        metadata: sortedMetadata(subscription.metadata, true),
        items: subscription.items.data.map(item => ({
            id: item.id,
            priceId: item.price.id,
            quantity: item.quantity ?? null,
            taxRates: taxRateIds(item.tax_rates),
        })).sort((left, right) => left.id.localeCompare(right.id)),
    });
}

export function buildSubscriptionGiftPreviewVersion(
    subscription: Stripe.Subscription,
    role: AdminSubscriptionGiftRole,
    months: number,
): string {
    return hashVersion('pv1', {
        subscriptionId: subscription.id,
        role,
        months,
        status: subscription.status,
        trialEnd: subscription.trial_end,
        cancellation: subscription.cancel_at_period_end,
        schedule: objectId(subscription.schedule),
        billingMode: subscription.billing_mode?.type || null,
        billingSchedules: subscription.billing_schedules,
        pauseCollection: subscription.pause_collection,
        metadata: sortedMetadata(subscription.metadata),
        items: subscription.items.data.map(item => ({
            id: item.id,
            priceId: item.price.id,
            currentPeriodStart: item.current_period_start,
            currentPeriodEnd: item.current_period_end,
            quantity: item.quantity ?? null,
        })).sort((left, right) => left.id.localeCompare(right.id)),
    });
}

export function buildEligibleSubscriptionGiftSnapshot(
    subscription: Stripe.Subscription,
    role: AdminSubscriptionGiftRole,
    months: number,
    nowSeconds = Math.floor(Date.now() / 1000),
): EligibleSubscriptionGiftSnapshot {
    const current = buildCurrentSubscriptionGiftState(subscription, role);
    const targetAccessEnd = addUtcCalendarMonthsClamped(current.currentAccessEndSeconds, months);
    if (targetAccessEnd > maximumGiftTrialEndSeconds(nowSeconds)) {
        throw new SubscriptionGiftEligibilityError(
            'trial-too-long',
            'The requested extension would exceed Stripe’s two-year trial limit.',
        );
    }

    return {
        ...current,
        targetAccessEndSeconds: targetAccessEnd,
        previewVersion: buildSubscriptionGiftPreviewVersion(subscription, role, months),
    };
}

export function buildCurrentSubscriptionGiftState(
    subscription: Stripe.Subscription,
    role: AdminSubscriptionGiftRole,
): CurrentSubscriptionGiftState {
    if (subscription.status !== 'active' && subscription.status !== 'trialing') {
        throw new SubscriptionGiftEligibilityError(
            'subscription-status',
            'Only active or trialing subscriptions are eligible.',
        );
    }
    if (subscription.schedule) {
        throw new SubscriptionGiftEligibilityError(
            'subscription-schedule',
            'Subscriptions managed by a Subscription Schedule are not eligible.',
        );
    }
    if ((subscription.billing_schedules || []).length > 0) {
        throw new SubscriptionGiftEligibilityError(
            'billing-schedule',
            'Subscriptions with billing schedules are not eligible.',
        );
    }
    if (subscription.billing_mode?.type === 'flexible') {
        throw new SubscriptionGiftEligibilityError(
            'flexible-billing',
            'Flexible-billing subscriptions are not eligible.',
        );
    }
    if (subscription.pause_collection) {
        throw new SubscriptionGiftEligibilityError(
            'paused',
            'Paused subscriptions are not eligible.',
        );
    }

    const paidPeriodEnd = resolveCurrentPaidPeriodEnd(subscription);
    const trialEnd = requireUnixSeconds(subscription.trial_end);
    const currentAccessEnd = Math.max(paidPeriodEnd, trialEnd || 0);
    const status: AdminSubscriptionGiftSubscriptionStatus = subscription.status === 'active'
        ? 'active'
        : 'trialing';

    return {
        subscriptionId: subscription.id,
        role,
        cadence: resolveCadence(subscription),
        status,
        currentAccessEndSeconds: currentAccessEnd,
        trialEndSeconds: trialEnd,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        invariantVersion: buildSubscriptionGiftInvariantVersion(subscription),
    };
}

export function buildSubscriptionGiftMetadata(
    operationId: string,
    months: number,
    targetAccessEndSeconds: number,
): Stripe.MetadataParam {
    return {
        [ADMIN_SUBSCRIPTION_GIFT_METADATA.type]: 'subscription_time',
        [ADMIN_SUBSCRIPTION_GIFT_METADATA.operationId]: operationId,
        [ADMIN_SUBSCRIPTION_GIFT_METADATA.months]: `${months}`,
        [ADMIN_SUBSCRIPTION_GIFT_METADATA.accessUntil]: `${targetAccessEndSeconds}`,
    };
}

export function subscriptionHasAppliedGift(
    subscription: Stripe.Subscription,
    operationId: string,
    targetAccessEndSeconds: number,
): boolean {
    return subscription.trial_end === targetAccessEndSeconds
        && subscription.metadata?.[ADMIN_SUBSCRIPTION_GIFT_METADATA.type] === 'subscription_time'
        && subscription.metadata?.[ADMIN_SUBSCRIPTION_GIFT_METADATA.operationId] === operationId
        && subscription.metadata?.[ADMIN_SUBSCRIPTION_GIFT_METADATA.accessUntil] === `${targetAccessEndSeconds}`;
}

export function stripeGiftOutcomeIsAmbiguous(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return true;
    }
    const stripeError = error as {
        type?: unknown;
        statusCode?: unknown;
    };
    const type = typeof stripeError.type === 'string' ? stripeError.type : '';
    const statusCode = typeof stripeError.statusCode === 'number' ? stripeError.statusCode : null;
    if (
        type === 'StripeInvalidRequestError'
        || type === 'StripeAuthenticationError'
        || type === 'StripePermissionError'
        || type === 'StripeCardError'
    ) {
        return false;
    }
    return statusCode === null || statusCode >= 500 || statusCode === 409
        || type === 'StripeConnectionError'
        || type === 'StripeAPIError';
}
