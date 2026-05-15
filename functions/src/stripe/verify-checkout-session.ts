import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ALLOWED_CORS_ORIGINS, enforceAppCheck } from '../utils';
import { getStripe } from './client';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import type {
    VerifiedCheckoutMode,
    VerifyCheckoutSessionRequest,
    VerifyCheckoutSessionResult
} from '../../../shared/stripe-checkout-session';

type MetadataShape = Record<string, unknown>;

interface StripeCheckoutSessionShape {
    id?: unknown;
    mode?: unknown;
    status?: unknown;
    payment_status?: unknown;
    metadata?: MetadataShape | null;
    client_reference_id?: unknown;
    customer?: unknown;
    amount_total?: unknown;
    currency?: unknown;
    line_items?: {
        data?: unknown[];
    } | null;
}

interface StripeCheckoutSessionsApi {
    retrieve: (sessionId: string, options?: unknown) => Promise<StripeCheckoutSessionShape>;
}

interface StripeLikeClient {
    checkout: {
        sessions: StripeCheckoutSessionsApi;
    };
}

const CHECKOUT_SESSION_ID_PATTERN = /^cs_(test|live)_[A-Za-z0-9_]+$/;

function readTrimmedString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function readMetadataValue(metadata: MetadataShape | null | undefined, keys: string[]): string | null {
    if (!metadata) {
        return null;
    }

    for (const key of keys) {
        const value = readTrimmedString(metadata[key]);
        if (value) {
            return value;
        }
    }

    return null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    return value as Record<string, unknown>;
}

function normalizeSessionId(data: unknown): string {
    const request = readRecord(data) as Partial<VerifyCheckoutSessionRequest> | null;
    const sessionId = readTrimmedString(request?.sessionId);
    if (!sessionId || !CHECKOUT_SESSION_ID_PATTERN.test(sessionId)) {
        throw new HttpsError('invalid-argument', 'A valid Stripe Checkout session id is required.');
    }

    return sessionId;
}

function resolveCheckoutMode(session: StripeCheckoutSessionShape): VerifiedCheckoutMode {
    if (session.mode === 'payment' || session.mode === 'subscription') {
        return session.mode;
    }

    throw new HttpsError('failed-precondition', 'Stripe Checkout session has an unsupported mode.');
}

function resolveIsTrialCheckout(session: StripeCheckoutSessionShape, mode: VerifiedCheckoutMode): boolean {
    if (mode !== 'subscription') {
        return false;
    }

    return session.payment_status === 'no_payment_required' || session.amount_total === 0;
}

function assertCompletedCheckout(session: StripeCheckoutSessionShape, mode: VerifiedCheckoutMode, isTrialCheckout: boolean): void {
    if (session.status !== 'complete') {
        throw new HttpsError('failed-precondition', 'Stripe Checkout session is not complete.');
    }

    if (mode === 'payment' && session.payment_status !== 'paid') {
        throw new HttpsError('failed-precondition', 'Stripe Checkout session payment is not paid.');
    }

    if (mode === 'subscription' && !isTrialCheckout && session.payment_status !== 'paid') {
        throw new HttpsError('failed-precondition', 'Stripe Checkout subscription payment is not paid.');
    }
}

function readCustomerId(session: StripeCheckoutSessionShape): string | null {
    const customerId = readTrimmedString(session.customer);
    if (customerId) {
        return customerId;
    }

    const customerRecord = readRecord(session.customer);
    return readTrimmedString(customerRecord?.['id']);
}

async function sessionBelongsToUser(session: StripeCheckoutSessionShape, uid: string): Promise<boolean> {
    const metadataUid = readMetadataValue(session.metadata, ['firebaseUID', 'firebaseUid', 'uid']);
    if (metadataUid) {
        return metadataUid === uid;
    }

    const clientReferenceUid = readTrimmedString(session.client_reference_id);
    if (clientReferenceUid) {
        return clientReferenceUid === uid;
    }

    const customerId = readCustomerId(session);
    if (!customerId) {
        return false;
    }

    const customerDoc = await admin.firestore().collection('customers').doc(uid).get();
    const customerData = customerDoc.data() as { stripeId?: unknown } | undefined;
    return readTrimmedString(customerData?.stripeId) === customerId;
}

function getFirstLineItem(session: StripeCheckoutSessionShape): Record<string, unknown> | null {
    const firstItem = session.line_items?.data?.[0];
    return readRecord(firstItem);
}

function getPriceRecord(session: StripeCheckoutSessionShape): Record<string, unknown> | null {
    const item = getFirstLineItem(session);
    return readRecord(item?.['price']);
}

function getProductRecord(price: Record<string, unknown> | null): Record<string, unknown> | null {
    return readRecord(price?.['product']);
}

function resolvePriceId(session: StripeCheckoutSessionShape): string | undefined {
    const price = getPriceRecord(session);
    return readTrimmedString(price?.['id']) ?? undefined;
}

function resolveCurrency(session: StripeCheckoutSessionShape): string | undefined {
    const sessionCurrency = readTrimmedString(session.currency);
    if (sessionCurrency) {
        return sessionCurrency.toUpperCase();
    }

    const price = getPriceRecord(session);
    return readTrimmedString(price?.['currency'])?.toUpperCase();
}

function resolveValue(session: StripeCheckoutSessionShape): number | undefined {
    if (typeof session.amount_total !== 'number' || !Number.isFinite(session.amount_total)) {
        return undefined;
    }

    return session.amount_total / 100;
}

function resolveRole(session: StripeCheckoutSessionShape): string | null {
    const sessionRole = readMetadataValue(session.metadata, ['role', 'firebaseRole']);
    if (sessionRole) {
        return sessionRole.toLowerCase();
    }

    const price = getPriceRecord(session);
    const priceMetadata = readRecord(price?.['metadata']);
    const priceRole = readMetadataValue(priceMetadata, ['role', 'firebaseRole']);
    if (priceRole) {
        return priceRole.toLowerCase();
    }

    const product = getProductRecord(price);
    const productMetadata = readRecord(product?.['metadata']);
    const productRole = readMetadataValue(productMetadata, ['role', 'firebaseRole']);
    return productRole?.toLowerCase() ?? null;
}

function buildResult(
    session: StripeCheckoutSessionShape,
    mode: VerifiedCheckoutMode,
    isTrialCheckout: boolean
): VerifyCheckoutSessionResult {
    const transactionId = readTrimmedString(session.id);
    if (!transactionId) {
        throw new HttpsError('failed-precondition', 'Stripe Checkout session is missing its id.');
    }

    const result: VerifyCheckoutSessionResult = {
        verified: true,
        transactionId,
        mode,
        isTrialCheckout,
    };

    const priceId = resolvePriceId(session);
    if (priceId) {
        result.priceId = priceId;
    }

    const currency = resolveCurrency(session);
    if (currency) {
        result.currency = currency;
    }

    const value = resolveValue(session);
    if (typeof value === 'number') {
        result.value = value;
    }

    const role = resolveRole(session);
    if (role) {
        result.role = role;
    }

    return result;
}

export const verifyCheckoutSession = onCall({
    region: FUNCTIONS_MANIFEST.verifyCheckoutSession.region,
    cors: ALLOWED_CORS_ORIGINS
}, async (request): Promise<VerifyCheckoutSessionResult> => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    enforceAppCheck(request);

    const sessionId = normalizeSessionId(request.data);
    const uid = request.auth.uid;

    try {
        const stripe = await getStripe() as StripeLikeClient;
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['line_items.data.price.product']
        });

        const belongsToUser = await sessionBelongsToUser(session, uid);
        if (!belongsToUser) {
            throw new HttpsError('permission-denied', 'Stripe Checkout session does not belong to the authenticated user.');
        }

        const mode = resolveCheckoutMode(session);
        const isTrialCheckout = resolveIsTrialCheckout(session, mode);
        assertCompletedCheckout(session, mode, isTrialCheckout);

        return buildResult(session, mode, isTrialCheckout);
    } catch (error: unknown) {
        if (error instanceof HttpsError) {
            throw error;
        }

        logger.error('[verifyCheckoutSession] Failed to verify Stripe Checkout session.', {
            uid,
            sessionId,
            error
        });
        throw new HttpsError('internal', 'Unable to verify Stripe Checkout session.');
    }
});
