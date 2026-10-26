import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmationDialogComponent } from '../components/confirmation-dialog/confirmation-dialog.component';
import { Firestore, collection, collectionData, doc, docData, getDocFromServer, getDocsFromServer, limit, query, setDoc, where } from 'app/firebase/firestore';

// ... (other imports)


import { Auth } from 'app/firebase/auth';
import type { FirebaseUserType } from 'app/firebase/auth';
import { EMPTY, Observable, catchError, from, mergeMap, switchMap, filter, take, map, merge, of, retry, throwError, timeout, timer, firstValueFrom, tap } from 'rxjs';
import { AppWindowService } from './app.window.service';
import { LoggerService } from './logger.service';
import { AppFunctionsService } from './app.functions.service';
import { UpcomingRenewalAmountResult } from '@shared/stripe-renewal';
import { STRIPE_CHECKOUT_TERMS_VERSION } from '@shared/stripe-checkout-terms';

export interface StripeProduct {
    id: string;
    active: boolean;
    name: string;
    description: string | null;
    role: string | null;
    images: string[];
    metadata: { [key: string]: string };
    prices?: StripePrice[];
}

export interface StripePrice {
    id: string;
    active: boolean;
    currency: string;
    unit_amount: number | null;
    description: string | null;
    type: 'one_time' | 'recurring';
    interval: 'day' | 'month' | 'week' | 'year' | null;
    interval_count: number | null;
    trial_period_days: number | null;
    metadata?: { [key: string]: string };
    product?: string;
    stripe_metadata_promotion_code_id?: string;
    recurring?: {
        interval: 'day' | 'month' | 'week' | 'year';
        interval_count?: number;
    } | null;
}

export interface StripeSubscription {
    id: string;
    status: 'active' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'past_due' | 'trialing' | 'unpaid';
    current_period_end: any;
    current_period_start: any;
    cancel_at_period_end: boolean;
    created?: any;
    metadata?: Record<string, string>;
}

type CheckoutMode = 'subscription' | 'payment';

interface CheckoutInput {
    priceId: string;
    mode: CheckoutMode;
}

interface CheckoutSubscriptionState {
    hasHistory: boolean;
    hasActiveSubscription: boolean;
}

interface CheckoutSessionPayload {
    price: string;
    success_url: string;
    cancel_url: string;
    allow_promotion_codes: boolean;
    mode: CheckoutMode;
    automatic_tax: { enabled: true };
    metadata: { firebaseUID: string };
    checkout_terms_version: typeof STRIPE_CHECKOUT_TERMS_VERSION;
    payment_method_collection?: 'if_required';
    trial_period_days?: number;
    promotion_code?: string;
}

interface CheckoutSessionDocumentData {
    url?: string;
    error?: string | { code?: string; message?: string };
    status?: 'updating' | 'ready' | 'failed';
}

export class CheckoutStartError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CheckoutStartError';
    }
}

@Injectable({
    providedIn: 'root'
})
export class AppPaymentService {
    private firestore = inject(Firestore);
    private auth = inject(Auth);
    private functionsService = inject(AppFunctionsService);
    private dialog = inject(MatDialog);
    private readonly userCancelledPortalMessage = 'User cancelled redirection to portal.';
    private readonly maxCheckoutRetryAttempts = 1;
    private readonly checkoutSubscriptionReadLimit = 100;
    private readonly checkoutSessionWaitMs = 60000;
    private readonly subscriptionReadRetryAttempts = 4;
    private readonly subscriptionReadRetryDelayMs = 750;

    constructor(private windowService: AppWindowService, private logger: LoggerService) { }

    /**
     * Fetches all active products with their prices.
     * Transforms Single-Product-Multi-Price model into Virtual Multi-Products for UI.
     */
    getProducts(): Observable<StripeProduct[]> {
        return from(this.getProductsFromServer());
    }

    private async getProductsFromServer(): Promise<StripeProduct[]> {
        const productsRef = collection(this.firestore, 'products');
        const activeProductsQuery = query(productsRef, where('active', '==', true));
        const productsSnapshot = await getDocsFromServer(activeProductsQuery);
        const products = productsSnapshot.docs.map((productDoc) => ({
            id: productDoc.id,
            ...(productDoc.data() as Omit<StripeProduct, 'id'>)
        } as StripeProduct));

        const productsWithPrices = await Promise.all(products.map(async product => this.getProductWithPrices(product)));
        return this.transformProductsForPricing(productsWithPrices);
    }

    private async getProductWithPrices(product: StripeProduct): Promise<StripeProduct> {
        const pricesRef = collection(this.firestore, `products/${product.id}/prices`);
        const activePricesQuery = query(pricesRef, where('active', '==', true));

        const pricesSnapshot = await getDocsFromServer(activePricesQuery);
        const prices = pricesSnapshot.docs.map((priceDoc) => ({
            id: priceDoc.id,
            ...(priceDoc.data() as Omit<StripePrice, 'id'>)
        } as StripePrice));

        return { ...product, prices };
    }

    private transformProductsForPricing(products: StripeProduct[]): StripeProduct[] {
        const virtualProducts: StripeProduct[] = [];

        this.logger.log('getProducts raw input:', products);

        // Flatten/Split logic
        for (const product of products) {
            this.logger.log(`Processing product ${product.id}`, product);

            const paidRecurringPrices = (product.prices ?? []).filter((price) => this.isPaidRecurringPrice(price));

            // Check if this product has prices with 'firebaseRole' metadata
            const getRole = (p: StripePrice) => p.metadata?.firebaseRole?.toLowerCase();

            const basicPrices = paidRecurringPrices.filter(p => getRole(p) === 'basic');
            const proPrices = paidRecurringPrices.filter(p => getRole(p) === 'pro');

            this.logger.log(`Product ${product.id} prices split:`, { basicPrices, proPrices });

            if ((basicPrices && basicPrices.length > 0) || (proPrices && proPrices.length > 0)) {
                // Split this product into virtual products per price/role
                if (basicPrices && basicPrices.length > 0) {
                    virtualProducts.push({
                        ...product,
                        id: `${product.id}_basic`, // Virtual ID
                        name: 'Basic', // Override name
                        description: 'Essential features for everyday users.',
                        role: 'basic',
                        metadata: { ...product.metadata, role: 'basic' },
                        prices: basicPrices
                    });
                }

                if (proPrices && proPrices.length > 0) {
                    virtualProducts.push({
                        ...product,
                        id: `${product.id}_pro`, // Virtual ID
                        name: 'Pro', // Override name
                        description: 'Advanced tools for power users.',
                        role: 'pro',
                        metadata: { ...product.metadata, role: 'pro' },
                        prices: proPrices
                    });
                }
            } else {
                // Legacy/Fallback behavior: Use product-level metadata
                if (!product.metadata?.role && product.metadata?.firebaseRole) {
                    product.metadata.role = product.metadata.firebaseRole;
                }

                // Ignore strictly free products if we are killing the free tier?
                if (product.metadata?.role !== 'free' && paidRecurringPrices.length > 0) {
                    virtualProducts.push({
                        ...product,
                        prices: paidRecurringPrices
                    });
                }
            }
        }

        const mergedRoleProducts = this.mergeRecurringProductsByRole(virtualProducts);
        this.logger.log('getProducts virtual output:', mergedRoleProducts);

        // Sort: Basic first, then Pro
        const roleOrder: Record<string, number> = { 'basic': 1, 'pro': 2 };
        return mergedRoleProducts.sort((a, b) => {
            const rA = (a.role || a.metadata?.role || '') as string;
            const rB = (b.role || b.metadata?.role || '') as string;
            return (roleOrder[rA] || 99) - (roleOrder[rB] || 99);
        });
    }

    private mergeRecurringProductsByRole(products: StripeProduct[]): StripeProduct[] {
        const mergedByRole = new Map<'basic' | 'pro', StripeProduct>();
        const passthroughProducts: StripeProduct[] = [];

        for (const product of products) {
            const normalizedRole = this.normalizePlanRole(product.role ?? product.metadata?.role ?? null);
            if (!normalizedRole) {
                passthroughProducts.push(product);
                continue;
            }

            const existingProduct = mergedByRole.get(normalizedRole);
            if (!existingProduct) {
                mergedByRole.set(normalizedRole, {
                    ...product,
                    role: normalizedRole,
                    metadata: { ...product.metadata, role: normalizedRole },
                    prices: this.sortRecurringPrices(product.prices ?? [])
                });
                continue;
            }

            existingProduct.prices = this.sortRecurringPrices([
                ...(existingProduct.prices ?? []),
                ...(product.prices ?? [])
            ]);
        }

        return [...mergedByRole.values(), ...passthroughProducts];
    }

    private normalizePlanRole(role: string | null | undefined): 'basic' | 'pro' | null {
        if (typeof role !== 'string') {
            return null;
        }

        const normalizedRole = role.toLowerCase();
        if (normalizedRole === 'basic' || normalizedRole === 'pro') {
            return normalizedRole;
        }

        return null;
    }

    private sortRecurringPrices(prices: StripePrice[]): StripePrice[] {
        const seenPriceIds = new Set<string>();
        const recurringIntervalOrder: Record<string, number> = { month: 1, year: 2 };

        return prices
            .filter((price) => {
                if (!price?.id || seenPriceIds.has(price.id)) {
                    return false;
                }
                seenPriceIds.add(price.id);
                return true;
            })
            .sort((leftPrice, rightPrice) => {
                const leftInterval = leftPrice.recurring?.interval ?? leftPrice.interval ?? '';
                const rightInterval = rightPrice.recurring?.interval ?? rightPrice.interval ?? '';
                const intervalDelta = (recurringIntervalOrder[leftInterval] ?? 99) - (recurringIntervalOrder[rightInterval] ?? 99);
                if (intervalDelta !== 0) {
                    return intervalDelta;
                }

                const leftIntervalCount = leftPrice.recurring?.interval_count ?? leftPrice.interval_count ?? 1;
                const rightIntervalCount = rightPrice.recurring?.interval_count ?? rightPrice.interval_count ?? 1;
                if (leftIntervalCount !== rightIntervalCount) {
                    return leftIntervalCount - rightIntervalCount;
                }

                const leftAmount = typeof leftPrice.unit_amount === 'number' ? leftPrice.unit_amount : Number.MAX_SAFE_INTEGER;
                const rightAmount = typeof rightPrice.unit_amount === 'number' ? rightPrice.unit_amount : Number.MAX_SAFE_INTEGER;
                if (leftAmount !== rightAmount) {
                    return leftAmount - rightAmount;
                }

                return leftPrice.id.localeCompare(rightPrice.id);
            });
    }

    private isPaidRecurringPrice(price: StripePrice): boolean {
        if (price.type !== 'recurring') {
            return false;
        }

        const interval = price.recurring?.interval ?? price.interval;
        return interval === 'month' || interval === 'year';
    }

    /**
     * Creates a checkout session and redirects the user to Stripe.
     */
    async appendCheckoutSession(price: string | StripePrice, successUrl?: string, cancelUrl?: string, canRedirect?: () => boolean, onProgress?: (status: 'updating') => void): Promise<void> {
        const user = this.auth.currentUser;
        if (!user) {
            throw new Error('User must be authenticated to create a checkout session.');
        }

        await this.assertBillingAvailable();
        const success = successUrl || `${this.windowService.currentDomain}/payment/success`;
        const cancel = cancelUrl || `${this.windowService.currentDomain}/payment/cancel`;
        await this.appendCheckoutSessionWithAttempt(price, user.uid, success, cancel, user, 0, canRedirect, onProgress);
    }

    private async appendCheckoutSessionWithAttempt(
        price: string | StripePrice,
        userId: string,
        successUrl: string,
        cancelUrl: string,
        user: { getIdToken: (forceRefresh?: boolean) => Promise<string> },
        attempt: number,
        canRedirect?: () => boolean,
        onProgress?: (status: 'updating') => void
    ): Promise<void> {
        this.assertCheckoutUserStillCurrent(userId);
        const checkoutInput = this.resolveCheckoutInput(price);
        const offeredTrialPeriodDays = this.resolveOfferedTrialPeriodDays(price);

        await this.runPreCheckoutLinkCheck(user, userId);
        this.assertCheckoutUserStillCurrent(userId);

        // Read once after linking, which can restore an existing subscription.
        // Keep this per attempt: neither pricing-page state nor a previous
        // checkout attempt is authoritative enough for the duplicate/trial gate.
        const subscriptions = await this.readCheckoutSubscriptionState(userId, offeredTrialPeriodDays !== null);
        this.assertCheckoutUserStillCurrent(userId);
        const trialPeriodDays = subscriptions.hasHistory ? null : offeredTrialPeriodDays;
        const shouldExitCheckout = await this.handleExistingActiveSubscriptions(userId, subscriptions.hasActiveSubscription);
        if (shouldExitCheckout) {
            return;
        }
        this.assertCheckoutUserStillCurrent(userId);

        this.logger.log('Creating checkout session for price:', checkoutInput.priceId, 'mode:', checkoutInput.mode);
        const checkoutSessionsRef = collection(this.firestore, `customers/${userId}/checkout_sessions`);
        const sessionPayload = this.buildCheckoutSessionPayload(checkoutInput, userId, successUrl, cancelUrl, trialPeriodDays);
        const sessionDoc = doc(checkoutSessionsRef);
        const checkoutSessionDocId = sessionDoc.id;

        try {
            await setDoc(sessionDoc, sessionPayload, { merge: true });
            this.logger.log('Checkout session created with ID:', checkoutSessionDocId);
        } catch (error) {
            this.logger.error('Error creating checkout doc:', error);
            throw error;
        }

        let session: CheckoutSessionDocumentData;
        try {
            session = await this.waitForCheckoutSessionUpdate(userId, checkoutSessionDocId, status => {
                if (this.auth.currentUser?.uid === userId && canRedirect?.() !== false) onProgress?.(status);
            });
        } catch (error) {
            this.logger.error('Error waiting for checkout session URL:', error);
            const errorName = error instanceof Error ? error.name : '';
            if (errorName === 'TimeoutError') {
                throw new CheckoutStartError('Checkout is taking longer than expected. Please try again. If the problem continues, contact support.');
            }
            throw new CheckoutStartError('An error occurred starting the payment. Please try again.');
        }
        this.assertCheckoutUserStillCurrent(userId);
        if (canRedirect?.() === false) {
            return;
        }

        if (session.error) {
            const errorMessage = this.getCheckoutErrorMessage(session.error);
            const code = typeof session.error === 'object' ? session.error.code : undefined;
            if (code === 'checkout_completed' || code === 'checkout_replaced') {
                this.logger.log('Checkout selection changed:', code);
                if (code === 'checkout_completed' && checkoutInput.mode === 'subscription') {
                    await this.runPreCheckoutLinkCheck(user, userId);
                    this.assertCheckoutUserStillCurrent(userId);
                }
                throw new CheckoutStartError(errorMessage);
            }
            this.logger.error('Stripe billing returned an error:', session.error);

            if (errorMessage.includes('No such customer') && attempt < this.maxCheckoutRetryAttempts) {
                this.logger.log('Detected stale Stripe customer ID. Clearing and retrying...');
                await this.functionsService.call<void, { success: boolean, cleaned: boolean }>('cleanupStripeCustomer');
                await this.appendCheckoutSessionWithAttempt(price, userId, successUrl, cancelUrl, user, attempt + 1, canRedirect, onProgress);
                return;
            }

            throw new CheckoutStartError(`Payment error: ${errorMessage}`);
        }

        if (!session.url) {
            throw new CheckoutStartError('An error occurred starting the payment. Please try again.');
        }

        this.logger.log('Redirecting to Stripe:', session.url);
        window.location.assign(session.url);
    }

    private resolveCheckoutInput(price: string | StripePrice): CheckoutInput {
        if (typeof price === 'string') {
            return {
                priceId: price,
                mode: 'subscription',
            };
        }

        return {
            priceId: price.id,
            mode: price.type === 'recurring' ? 'subscription' : 'payment',
        };
    }

    private resolveOfferedTrialPeriodDays(price: string | StripePrice): number | null {
        if (typeof price === 'string') {
            return null;
        }

        if (price.type !== 'recurring') {
            return null;
        }

        return this.resolveMetadataTrialDays(price.metadata?.trial_days);
    }

    private resolveMetadataTrialDays(metadataTrialDays: string | undefined): number | null {
        if (typeof metadataTrialDays !== 'string') {
            return null;
        }

        const normalizedTrialDays = metadataTrialDays.trim();
        if (!/^[1-9]\d*$/.test(normalizedTrialDays)) {
            return null;
        }

        return Number.parseInt(normalizedTrialDays, 10);
    }

    private async runPreCheckoutLinkCheck(
        user: { getIdToken: (forceRefresh?: boolean) => Promise<string> },
        userId: string
    ): Promise<void> {
        try {
            const result = await this.functionsService.call<void, { linked: boolean, role?: string }>('linkExistingStripeCustomer');
            this.assertCheckoutUserStillCurrent(userId);
            if (!result.data.linked) {
                return;
            }

            this.logger.log(`Existing subscription found and linked. Role: ${result.data.role}. Skipping checkout.`);
            await user.getIdToken(true);
            this.assertCheckoutUserStillCurrent(userId);
            throw new Error(`SUBSCRIPTION_RESTORED:${result.data.role}`);
        } catch (error: unknown) {
            if (error instanceof Error && error.message.startsWith('SUBSCRIPTION_RESTORED:')) {
                throw error;
            }
            this.logger.warn('Pre-checkout link check failed, proceeding with checkout:', error);
        }
    }

    private async readCheckoutSubscriptionState(userId: string, checkHistory: boolean): Promise<CheckoutSubscriptionState> {
        const subscriptionsRef = collection(this.firestore, `customers/${userId}/subscriptions`);
        const activeQuery = query(subscriptionsRef, where('status', 'in', ['active', 'trialing']), limit(1));

        try {
            // Any history rules out another trial, including statuses not yet
            // known to this client. Without an offered trial, only check active access.
            const snapshot = await getDocsFromServer(checkHistory
                ? query(subscriptionsRef, limit(this.checkoutSubscriptionReadLimit))
                : activeQuery);
            this.assertCheckoutUserStillCurrent(userId);
            let hasActiveSubscription = snapshot.docs.some(subscription => {
                const status = subscription.data().status;
                return status === 'active' || status === 'trialing';
            });

            // A full history page may hide an active subscription beyond the
            // read bound. Check it directly instead of scanning all old records.
            if (checkHistory && !hasActiveSubscription && snapshot.docs.length >= this.checkoutSubscriptionReadLimit) {
                const activeSnapshot = await getDocsFromServer(activeQuery);
                this.assertCheckoutUserStillCurrent(userId);
                hasActiveSubscription = activeSnapshot.docs.length > 0;
            }

            return { hasHistory: snapshot.docs.length > 0, hasActiveSubscription };
        } catch (error) {
            // This read also guards against duplicate subscriptions. Never turn
            // an unavailable read into an empty history or a trial-free checkout.
            this.logger.error('Error checking existing subscriptions:', error);
            throw error;
        }
    }

    private async handleExistingActiveSubscriptions(userId: string, hasActiveSubscription: boolean): Promise<boolean> {
        if (!hasActiveSubscription) {
            return false;
        }

        try {
            this.logger.warn('User already has an active subscription. Opening management dialog.');
            const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
                data: {
                    title: 'Active Subscription',
                    message: 'You already have an active subscription. Would you like to manage it instead?',
                    confirmText: 'Manage Subscription',
                    cancelText: 'Cancel'
                }
            });

            const confirmed = !!(await firstValueFrom(dialogRef.afterClosed().pipe(take(1))));
            if (!confirmed) {
                throw new Error(this.userCancelledPortalMessage);
            }

            this.assertCheckoutUserStillCurrent(userId);
            await this.manageSubscriptions(userId);
            return true;
        } catch (error) {
            if (error instanceof Error && error.message === this.userCancelledPortalMessage) {
                throw error;
            }

            this.logger.error('Error checking existing subscriptions:', error);
            throw error;
        }
    }

    private assertCheckoutUserStillCurrent(userId: string): void {
        if (this.auth.currentUser?.uid !== userId) {
            throw new Error('Authenticated user changed while checkout was being prepared. Please try again.');
        }
    }

    private buildCheckoutSessionPayload(
        checkoutInput: CheckoutInput,
        userId: string,
        successUrl: string,
        cancelUrl: string,
        trialPeriodDays: number | null
    ): CheckoutSessionPayload {
        const payload: CheckoutSessionPayload = {
            price: checkoutInput.priceId,
            success_url: successUrl,
            cancel_url: cancelUrl,
            allow_promotion_codes: true,
            mode: checkoutInput.mode,
            automatic_tax: { enabled: true },
            metadata: { firebaseUID: userId },
            checkout_terms_version: STRIPE_CHECKOUT_TERMS_VERSION,
        };

        if (checkoutInput.mode === 'subscription') {
            payload.payment_method_collection = 'if_required';
            if (trialPeriodDays) {
                payload.trial_period_days = trialPeriodDays;
            }
        }

        return payload;
    }

    private async waitForCheckoutSessionUpdate(userId: string, checkoutSessionDocId: string, onProgress?: (status: 'updating') => void): Promise<CheckoutSessionDocumentData> {
        const sessionRef = doc(this.firestore, `customers/${userId}/checkout_sessions/${checkoutSessionDocId}`);
        let reportedServerReadFailure = false;
        let reportedUpdating = false;
        // A server read also recovers sessions when the live Firestore listener misses a billing update.
        const serverUpdates$ = timer(5000, 10000).pipe(
            mergeMap(() => from(this.readCheckoutSessionFromServer(userId, checkoutSessionDocId)).pipe(
                catchError((error: unknown) => {
                    if (!this.isRecoverableFirestoreReadError(error)) {
                        return throwError(() => error);
                    }
                    if (!reportedServerReadFailure) {
                        reportedServerReadFailure = true;
                        this.logger.warn('[AppPaymentService] Checkout session server read failed; retrying.', {
                            code: this.getErrorCode(error),
                        });
                    }
                    return EMPTY;
                })
            ), 1)
        );
        const session = await firstValueFrom(
            merge(docData(sessionRef), serverUpdates$).pipe(
                tap(sessionData => {
                    const data = sessionData as CheckoutSessionDocumentData | undefined;
                    if (data?.status === 'updating' && !data.url && !data.error && !reportedUpdating) {
                        reportedUpdating = true;
                        onProgress?.('updating');
                    }
                }),
                filter((sessionData): sessionData is CheckoutSessionDocumentData => {
                    const data = sessionData as CheckoutSessionDocumentData | null | undefined;
                    return !!data && (!!data.url || !!data.error);
                }),
                take(1),
                timeout(this.checkoutSessionWaitMs)
            )
        );
        return session;
    }

    private async assertBillingAvailable(): Promise<void> {
        const snapshot = await getDocFromServer(doc(this.firestore, 'configuration/stripeBilling'));
        if (snapshot.data()?.requestsEnabled !== true) {
            throw new CheckoutStartError('Billing is temporarily unavailable. Your existing subscription continues normally. Please try again later.');
        }
    }

    private async readCheckoutSessionFromServer(userId: string, checkoutSessionDocId: string): Promise<CheckoutSessionDocumentData | undefined> {
        // The full SDK's getDocFromServer can reuse a stale watch/cache result. Lite reads through REST.
        const { getFirestore, doc: liteDoc, getDoc } = await import('firebase/firestore/lite');
        const liteFirestore = getFirestore(this.firestore.app);
        const sessionRef = liteDoc(liteFirestore, `customers/${userId}/checkout_sessions/${checkoutSessionDocId}`);
        const sessionSnapshot = await getDoc(sessionRef);
        return sessionSnapshot.data() as CheckoutSessionDocumentData | undefined;
    }

    private getCheckoutErrorMessage(error: CheckoutSessionDocumentData['error']): string {
        if (!error) {
            return 'Unknown payment error.';
        }

        if (typeof error === 'string') {
            return error;
        }

        if (error.message && error.message.trim()) {
            return error.message;
        }

        return 'Unknown payment error.';
    }

    /**
     * Gets the current user's active subscriptions with product role metadata.
     */
    getUserSubscriptions(): Observable<(StripeSubscription & { role?: string })[]> {
        const user = this.auth.currentUser;
        if (!user) {
            return from([[]]);
        }

        const subscriptionsRef = collection(this.firestore, `customers/${user.uid}/subscriptions`);
        const activeQuery = query(subscriptionsRef, where('status', 'in', ['active', 'trialing']));

        return collectionData(activeQuery, { idField: 'id' }).pipe(
            retry({
                count: this.subscriptionReadRetryAttempts,
                delay: (error, retryCount) => this.getSubscriptionReadRetryNotifier(user, error, retryCount),
            }),
            map(docs => docs as StripeSubscription[]),
            switchMap((subscriptions: StripeSubscription[]) => {
                if (subscriptions.length === 0) return from([[]]);

                const subsWithRole$ = subscriptions.map(async (sub: any) => {
                    // We need to fetch the product or price to know the role
                    // The subscription object from Stripe Extension usually has `items` array or `product` reference
                    // but the extension mirroring often mirrors specific fields. 
                    // Let's check what the extension mirrors. standard mirrors: 
                    // items: [{ price: { product: ref } }] etc.
                    // Or sometimes simply `role` is copied if configured? 
                    // Default extension behavior does NOT copy custom metadata to the sub document directly usually.
                    // However, the `role` field on the USER custom claims comes from the product metadata.

                    // If we can't easily get the role from the sub doc, we act defensively:
                    // We assume if the user has role='free', and they have a subscription, 
                    // valid "paid" subscriptions usually have role='pro' or 'basic'.
                    // The sub doc usually contains `role` field IF the extension is configured to sync it?
                    // Let's assume the extension puts `role` on the sub doc if it updated the claims.
                    // IF NOT, we might need to fetch the product. 
                    // For now, let's look for `role` on the subscription document itself, 
                    // as the extension mirrors metadata if configured.

                    // If that fails, we can try to look up the product from the price ref if available?
                    // BUT for the "Free Plan" subscription I recommended, it has role='free'.
                    // So `sub.role` should be 'free'.

                    return sub;
                });
                return from(Promise.all(subsWithRole$));
            })
        ) as Observable<(StripeSubscription & { role?: string })[]>;
    }

    private getSubscriptionReadRetryNotifier(
        user: FirebaseUserType,
        error: unknown,
        retryCount: number
    ): Observable<unknown> {
        if (this.auth.currentUser?.uid !== user.uid) {
            return throwError(() => error);
        }

        if (!this.isRecoverableFirestoreReadError(error)) {
            return throwError(() => error);
        }

        const code = this.getErrorCode(error);
        const retryDelayMs = this.subscriptionReadRetryDelayMs * Math.pow(2, retryCount - 1);
        this.logger.warn('[AppPaymentService] Retrying subscription listener after a recoverable read failure.', {
            uid: user.uid,
            code,
            retryCount,
            retryDelayMs,
        });

        if (!this.isSubscriptionAuthenticationReadError(error)) {
            return this.waitForSubscriptionRetryDelay(user, error, retryDelayMs);
        }

        return from(user.getIdToken(true)).pipe(
            catchError((tokenError) => {
                if (this.isRecoverableFirestoreReadError(tokenError)) {
                    this.logger.warn('[AppPaymentService] Auth refresh was temporarily unavailable; retrying the subscription read.', {
                        uid: user.uid,
                        code: this.getErrorCode(tokenError),
                        retryCount,
                    });
                    return of(null);
                }
                return throwError(() => tokenError);
            }),
            switchMap(() => this.waitForSubscriptionRetryDelay(user, error, retryDelayMs))
        );
    }

    private waitForSubscriptionRetryDelay(
        user: FirebaseUserType,
        originalError: unknown,
        retryDelayMs: number
    ): Observable<unknown> {
        return timer(retryDelayMs).pipe(
            switchMap(() => this.auth.currentUser?.uid === user.uid
                ? of(null)
                : throwError(() => originalError))
        );
    }

    private isRecoverableFirestoreReadError(error: unknown): boolean {
        const code = this.getErrorCode(error);
        return this.isPermissionDenied(error)
            || code === 'unauthenticated'
            || code === 'firestore/unauthenticated'
            || code === 'unavailable'
            || code === 'firestore/unavailable'
            || code === 'deadline-exceeded'
            || code === 'firestore/deadline-exceeded'
            || code === 'aborted'
            || code === 'firestore/aborted'
            || code === 'cancelled'
            || code === 'firestore/cancelled'
            || code === 'network-request-failed'
            || code === 'auth/network-request-failed';
    }

    private isPermissionDenied(error: unknown): boolean {
        const code = this.getErrorCode(error);
        return code === 'permission-denied' || code === 'firestore/permission-denied';
    }

    private isSubscriptionAuthenticationReadError(error: unknown): boolean {
        const code = this.getErrorCode(error);
        return this.isPermissionDenied(error)
            || code === 'unauthenticated'
            || code === 'firestore/unauthenticated';
    }

    private getErrorCode(error: unknown): string | null {
        const code = (error as { code?: unknown } | null)?.code;
        return typeof code === 'string' ? code : null;
    }

    async hasPaidSubscriptionHistory(): Promise<boolean | null> {
        const user = this.auth.currentUser;
        if (!user) {
            return false;
        }

        const subscriptionsRef = collection(this.firestore, `customers/${user.uid}/subscriptions`);
        // Match checkout's server-side trial policy: any subscription history
        // counts, including paused, future or missing status projections.
        const historyQuery = query(subscriptionsRef, limit(1));

        try {
            const snapshot = await getDocsFromServer(historyQuery);
            return snapshot.docs.length > 0;
        } catch (error) {
            this.logger.warn('Could not verify subscription history. Suppressing trial messaging until the read recovers.', error);
            return null;
        }
    }

    async getUpcomingRenewalAmount(): Promise<UpcomingRenewalAmountResult> {
        if (!this.auth.currentUser) {
            return { status: 'unavailable' };
        }

        try {
            const result = await this.functionsService.call<void, unknown>('getUpcomingRenewalAmount');
            return this.normalizeUpcomingRenewalAmountResult(result.data);
        } catch (error) {
            this.logger.warn('Could not fetch upcoming renewal amount. Falling back to unavailable state.', error);
            return { status: 'unavailable' };
        }
    }

    private normalizeUpcomingRenewalAmountResult(raw: unknown): UpcomingRenewalAmountResult {
        if (!raw || typeof raw !== 'object') {
            return { status: 'unavailable' };
        }

        const status = (raw as { status?: unknown }).status;
        if (status === 'no_upcoming_charge') {
            return { status: 'no_upcoming_charge' };
        }

        if (status === 'unavailable') {
            return { status: 'unavailable' };
        }

        if (status !== 'ready') {
            return { status: 'unavailable' };
        }

        const amountMinor = (raw as { amountMinor?: unknown }).amountMinor;
        const currency = (raw as { currency?: unknown }).currency;
        if (typeof amountMinor !== 'number' || !Number.isFinite(amountMinor) || typeof currency !== 'string' || !currency.trim()) {
            return { status: 'unavailable' };
        }

        return {
            status: 'ready',
            amountMinor: Math.round(amountMinor),
            currency: currency.toUpperCase(),
        };
    }

    /**
     * Opens the Stripe Customer Portal for managing subscriptions.
     */
    async manageSubscriptions(expectedUserId?: string): Promise<void> {
        const userId = expectedUserId ?? this.auth.currentUser?.uid;
        if (!userId) {
            throw new Error('User must be authenticated to manage subscriptions.');
        }
        this.assertCheckoutUserStillCurrent(userId);
        await this.assertBillingAvailable();
        this.assertCheckoutUserStillCurrent(userId);
        const returnUrl = `${this.windowService.currentDomain}/subscriptions`;

        try {
            const result = await this.functionsService.call<{ returnUrl: string }, { url: string }>('createPortalLink', { returnUrl });
            this.assertCheckoutUserStillCurrent(userId);
            window.location.assign(result.data.url);
        } catch (error) {
            this.logger.error('Error creating portal link:', error);
            throw error;
        }
    }

    /**
     * Restores purchases by force-refreshing the user's claims.
     */
    async restorePurchases(): Promise<string> {
        try {
            const result = await this.functionsService.call<void, { success: boolean, role: string }>('restoreUserClaims');
            // Force token refresh to pick up new claims
            const user = this.auth.currentUser;
            if (user) {
                await user.getIdToken(true);
            }
            return result.data.role;
        } catch (error) {
            this.logger.error('Error restoring purchases:', error);
            throw error;
        }
    }
}
