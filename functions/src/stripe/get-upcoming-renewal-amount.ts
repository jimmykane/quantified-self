import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../utils';
import { getStripe } from './client';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import type { UpcomingRenewalAmountResult } from '../../../shared/stripe-renewal';

type SubscriptionDocument = {
    id?: unknown;
    subscription?: unknown;
    stripeSubscriptionId?: unknown;
    created?: unknown;
    current_period_end?: unknown;
};

type SubscriptionCandidate = {
    subscriptionId: string;
    createdAt: Date | null;
    periodEnd: Date | null;
};

type UpcomingInvoiceShape = {
    amount_due?: unknown;
    subtotal?: unknown;
    currency?: unknown;
};

type StripeInvoicesApi = {
    createPreview?: (params: { subscription: string }) => Promise<UpcomingInvoiceShape>;
    retrieveUpcoming?: (params: { subscription: string }) => Promise<UpcomingInvoiceShape>;
};

type StripeSubscriptionShape = {
    discount?: {
        coupon?: {
            duration?: unknown;
        };
    } | null;
};

type StripeSubscriptionsApi = {
    retrieve: (subscriptionId: string, options?: unknown) => Promise<StripeSubscriptionShape>;
};

function normalizeToDate(value: unknown): Date | null {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === 'number') {
        const isMilliseconds = value > 1_000_000_000_000;
        const date = new Date(isMilliseconds ? value : value * 1000);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    if (typeof value === 'string') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (typeof value === 'object') {
        const maybeTimestamp = value as {
            toDate?: () => Date;
            seconds?: number;
            _seconds?: number;
        };

        if (typeof maybeTimestamp.toDate === 'function') {
            const date = maybeTimestamp.toDate();
            return Number.isNaN(date.getTime()) ? null : date;
        }

        const seconds = typeof maybeTimestamp.seconds === 'number'
            ? maybeTimestamp.seconds
            : (typeof maybeTimestamp._seconds === 'number' ? maybeTimestamp._seconds : undefined);

        if (seconds !== undefined) {
            const date = new Date(seconds * 1000);
            return Number.isNaN(date.getTime()) ? null : date;
        }
    }

    return null;
}

function isLikelyStripeSubscriptionId(value: string): boolean {
    return value.startsWith('sub_');
}

function resolveSubscriptionId(documentId: string, data: SubscriptionDocument): string | null {
    const candidateValues: unknown[] = [data.id, data.subscription, data.stripeSubscriptionId, documentId];
    for (const candidate of candidateValues) {
        if (typeof candidate !== 'string') {
            continue;
        }

        const trimmed = candidate.trim();
        if (trimmed && isLikelyStripeSubscriptionId(trimmed)) {
            return trimmed;
        }
    }

    return null;
}

function pickPrimarySubscription(candidates: SubscriptionCandidate[]): SubscriptionCandidate | null {
    if (!candidates.length) {
        return null;
    }

    return candidates.sort((a, b) => {
        const aCreated = a.createdAt ? a.createdAt.getTime() : Number.NEGATIVE_INFINITY;
        const bCreated = b.createdAt ? b.createdAt.getTime() : Number.NEGATIVE_INFINITY;
        if (aCreated !== bCreated) {
            return bCreated - aCreated;
        }

        const aPeriodEnd = a.periodEnd ? a.periodEnd.getTime() : 0;
        const bPeriodEnd = b.periodEnd ? b.periodEnd.getTime() : 0;
        if (aPeriodEnd !== bPeriodEnd) {
            return bPeriodEnd - aPeriodEnd;
        }

        return b.subscriptionId.localeCompare(a.subscriptionId);
    })[0];
}

function isNoUpcomingInvoiceError(error: unknown): boolean {
    const errorCode = typeof (error as { code?: unknown })?.code === 'string'
        ? (error as { code: string }).code
        : '';
    if (errorCode === 'invoice_upcoming_none') {
        return true;
    }

    const errorMessage = typeof (error as { message?: unknown })?.message === 'string'
        ? (error as { message: string }).message.toLowerCase()
        : '';
    return errorMessage.includes('no upcoming invoice');
}

async function fetchUpcomingInvoicePreview(
    invoicesApi: StripeInvoicesApi,
    subscriptionId: string
): Promise<UpcomingInvoiceShape> {
    if (typeof invoicesApi.createPreview === 'function') {
        return invoicesApi.createPreview({ subscription: subscriptionId });
    }

    if (typeof invoicesApi.retrieveUpcoming === 'function') {
        return invoicesApi.retrieveUpcoming({ subscription: subscriptionId });
    }

    throw new Error('Stripe invoices API does not support createPreview or retrieveUpcoming.');
}

async function resolveNextPaymentAmountForZeroDueInvoice(
    subscriptionsApi: StripeSubscriptionsApi,
    subscriptionId: string,
    upcomingInvoice: UpcomingInvoiceShape
): Promise<number> {
    const subtotal = typeof upcomingInvoice.subtotal === 'number'
        ? upcomingInvoice.subtotal
        : null;
    if (subtotal === null || subtotal <= 0) {
        return 0;
    }

    try {
        const subscription = await subscriptionsApi.retrieve(subscriptionId, {
            expand: ['discount.coupon']
        });
        const couponDuration = subscription.discount?.coupon?.duration;
        const hasLongRunningDiscount = couponDuration === 'forever' || couponDuration === 'repeating';
        if (hasLongRunningDiscount) {
            return 0;
        }
    } catch (error) {
        logger.warn('[getUpcomingRenewalAmount] Could not inspect subscription discount while resolving zero-due invoice.', {
            subscriptionId,
            error
        });
        return 0;
    }

    return Math.round(subtotal);
}

export const getUpcomingRenewalAmount = onCall({
    region: FUNCTIONS_MANIFEST.getUpcomingRenewalAmount.region,
    cors: ALLOWED_CORS_ORIGINS
}, async (request): Promise<UpcomingRenewalAmountResult> => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    enforceAppCheck(request);

    const uid = request.auth.uid;

    try {
        const subscriptionsSnapshot = await admin.firestore()
            .collection(`customers/${uid}/subscriptions`)
            .where('status', 'in', ['active', 'trialing'])
            .orderBy('created', 'desc')
            .limit(25)
            .get();

        if (subscriptionsSnapshot.empty) {
            return { status: 'no_upcoming_charge' };
        }

        const candidates: SubscriptionCandidate[] = subscriptionsSnapshot.docs
            .map((subscriptionDoc) => {
                const subscriptionData = subscriptionDoc.data() as SubscriptionDocument;
                const subscriptionId = resolveSubscriptionId(subscriptionDoc.id, subscriptionData);
                if (!subscriptionId) {
                    return null;
                }

                return {
                    subscriptionId,
                    createdAt: normalizeToDate(subscriptionData.created),
                    periodEnd: normalizeToDate(subscriptionData.current_period_end)
                };
            })
            .filter((candidate): candidate is SubscriptionCandidate => candidate !== null);

        const primarySubscription = pickPrimarySubscription(candidates);
        if (!primarySubscription) {
            logger.error('[getUpcomingRenewalAmount] Could not resolve Stripe subscription id.', {
                uid,
                subscriptionDocIds: subscriptionsSnapshot.docs.map((doc) => doc.id)
            });
            return { status: 'unavailable' };
        }

        const subscriptionId = primarySubscription.subscriptionId;

        const stripe = await getStripe();
        const invoicesApi = stripe.invoices as unknown as StripeInvoicesApi;
        const subscriptionsApi = stripe.subscriptions as unknown as StripeSubscriptionsApi;
        try {
            const upcomingInvoice = await fetchUpcomingInvoicePreview(invoicesApi, subscriptionId);

            let amountDue = typeof upcomingInvoice.amount_due === 'number'
                ? upcomingInvoice.amount_due
                : null;
            const currency = typeof upcomingInvoice.currency === 'string'
                ? upcomingInvoice.currency.trim()
                : '';
            if (amountDue === null || !currency) {
                logger.error('[getUpcomingRenewalAmount] Stripe upcoming invoice missing amount_due or currency.', {
                    uid,
                    subscriptionId
                });
                return { status: 'unavailable' };
            }

            if (amountDue <= 0) {
                amountDue = await resolveNextPaymentAmountForZeroDueInvoice(
                    subscriptionsApi,
                    subscriptionId,
                    upcomingInvoice
                );
            }

            return {
                status: 'ready',
                amountMinor: Math.round(amountDue),
                currency: currency.toUpperCase()
            };
        } catch (error) {
            if (isNoUpcomingInvoiceError(error)) {
                return { status: 'no_upcoming_charge' };
            }

            logger.error('[getUpcomingRenewalAmount] Stripe upcoming invoice lookup failed.', {
                uid,
                subscriptionId,
                error
            });
            return { status: 'unavailable' };
        }
    } catch (error) {
        logger.error('[getUpcomingRenewalAmount] Failed to fetch renewal amount.', { uid, error });
        return { status: 'unavailable' };
    }
});
