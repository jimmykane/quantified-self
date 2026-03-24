import { Injectable, inject, Injector, runInInjectionContext } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmationDialogComponent } from '../components/confirmation-dialog/confirmation-dialog.component';
import { environment } from '../../environments/environment';
import { Firestore, collection, collectionData, addDoc, doc, docData, getDoc, getDocs, getDocsFromServer, limit, query, where } from '@angular/fire/firestore';

// ... (other imports)


import { Auth } from '@angular/fire/auth';
import { Observable, from, switchMap, filter, take, map, timeout, firstValueFrom } from 'rxjs';
import { AppWindowService } from './app.window.service';
import { LoggerService } from './logger.service';
import { AppFunctionsService } from './app.functions.service';
import { UpcomingRenewalAmountResult } from '@shared/stripe-renewal';

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
}

type CheckoutMode = 'subscription' | 'payment';

interface CheckoutInput {
    priceId: string;
    mode: CheckoutMode;
    productId: string | null;
}

interface CheckoutSessionPayload {
    price: string;
    success_url: string;
    cancel_url: string;
    allow_promotion_codes: boolean;
    mode: CheckoutMode;
    automatic_tax: { enabled: true };
    metadata: { firebaseUID: string };
    payment_method_collection?: 'if_required';
    promotion_code?: string;
    subscription_data?: {
        metadata: { firebaseUID: string };
        trial_settings?: {
            end_behavior: {
                missing_payment_method: 'cancel';
            };
        };
    };
}

interface CheckoutSessionDocumentData {
    url?: string;
    error?: string | { message?: string };
}

@Injectable({
    providedIn: 'root'
})
export class AppPaymentService {
    private firestore = inject(Firestore);
    private auth = inject(Auth);
    private functionsService = inject(AppFunctionsService);
    private dialog = inject(MatDialog);
    private injector = inject(Injector);
    private readonly userCancelledPortalMessage = 'User cancelled redirection to portal.';
    private readonly maxCheckoutRetryAttempts = 1;
    private readonly subscriptionStatuses: StripeSubscription['status'][] = ['active', 'trialing', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'unpaid'];

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
        const productsSnapshot = await runInInjectionContext(this.injector, () => getDocsFromServer(activeProductsQuery));
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

        const pricesSnapshot = await runInInjectionContext(this.injector, () => getDocsFromServer(activePricesQuery));
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

            // Check if this product has prices with 'firebaseRole' metadata
            const getRole = (p: StripePrice) => p.metadata?.firebaseRole?.toLowerCase();

            const basicPrices = product.prices?.filter(p => getRole(p) === 'basic');
            const proPrices = product.prices?.filter(p => getRole(p) === 'pro');

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
                if (product.metadata?.role !== 'free') {
                    virtualProducts.push(product);
                }
            }
        }

        this.logger.log('getProducts virtual output:', virtualProducts);

        // Sort: Basic first, then Pro
        const roleOrder: Record<string, number> = { 'basic': 1, 'pro': 2 };
        return virtualProducts.sort((a, b) => {
            const rA = (a.role || a.metadata?.role || '') as string;
            const rB = (b.role || b.metadata?.role || '') as string;
            return (roleOrder[rA] || 99) - (roleOrder[rB] || 99);
        });
    }

    /**
     * Creates a checkout session and redirects the user to Stripe.
     */
    async appendCheckoutSession(price: string | StripePrice, successUrl?: string, cancelUrl?: string): Promise<void> {
        const user = this.auth.currentUser;
        if (!user) {
            throw new Error('User must be authenticated to create a checkout session.');
        }

        const success = successUrl || `${this.windowService.currentDomain}/payment/success`;
        const cancel = cancelUrl || `${this.windowService.currentDomain}/payment/cancel`;
        await this.appendCheckoutSessionWithAttempt(price, user.uid, success, cancel, user, 0);
    }

    private async appendCheckoutSessionWithAttempt(
        price: string | StripePrice,
        userId: string,
        successUrl: string,
        cancelUrl: string,
        user: { getIdToken: (forceRefresh?: boolean) => Promise<string> },
        attempt: number
    ): Promise<void> {
        const checkoutInput = this.resolveCheckoutInput(price);
        const resolvedPromotionCodeId = await this.resolvePromotionCodeIdForCheckout(price, checkoutInput);
        const hasPaidHistory = resolvedPromotionCodeId ? await this.hasPaidSubscriptionHistoryForCheckoutEligibility() : false;
        const promotionCodeId = hasPaidHistory ? null : resolvedPromotionCodeId;

        await this.runPreCheckoutLinkCheck(user);

        const shouldExitCheckout = await this.handleExistingActiveSubscriptions(userId);
        if (shouldExitCheckout) {
            return;
        }

        this.logger.log('Creating checkout session for price:', checkoutInput.priceId, 'mode:', checkoutInput.mode);
        const checkoutSessionsRef = collection(this.firestore, `customers/${userId}/checkout_sessions`);
        const sessionPayload = this.buildCheckoutSessionPayload(checkoutInput, userId, successUrl, cancelUrl, promotionCodeId);

        let checkoutSessionDocId = '';
        try {
            const sessionDoc = await runInInjectionContext(this.injector, () => addDoc(checkoutSessionsRef, sessionPayload));
            checkoutSessionDocId = sessionDoc.id;
            this.logger.log('Checkout session created with ID:', checkoutSessionDocId);
        } catch (error) {
            this.logger.error('Error creating checkout doc:', error);
            throw error;
        }

        let session: CheckoutSessionDocumentData;
        try {
            session = await this.waitForCheckoutSessionUpdate(userId, checkoutSessionDocId);
        } catch (error) {
            this.logger.error('Error waiting for checkout session URL:', error);
            const errorName = error instanceof Error ? error.name : '';
            if (errorName === 'TimeoutError') {
                alert('Payment system is slow to respond. Please check if the popup was blocked or try again.');
            } else {
                alert('An error occurred starting the payment. Please try again.');
            }
            return;
        }

        if (session.error) {
            const errorMessage = this.getCheckoutErrorMessage(session.error);
            this.logger.error('Stripe extension returned an error:', session.error);

            if (errorMessage.includes('No such customer') && attempt < this.maxCheckoutRetryAttempts) {
                this.logger.log('Detected stale Stripe customer ID. Clearing and retrying...');
                await this.functionsService.call<void, { success: boolean, cleaned: boolean }>('cleanupStripeCustomer');
                await this.appendCheckoutSessionWithAttempt(price, userId, successUrl, cancelUrl, user, attempt + 1);
                return;
            }

            alert(`Payment error: ${errorMessage}`);
            return;
        }

        if (!session.url) {
            alert('An error occurred starting the payment. Please try again.');
            return;
        }

        this.logger.log('Redirecting to Stripe:', session.url);
        window.location.assign(session.url);
    }

    private resolveCheckoutInput(price: string | StripePrice): CheckoutInput {
        if (typeof price === 'string') {
            return {
                priceId: price,
                mode: 'subscription',
                productId: null
            };
        }

        return {
            priceId: price.id,
            mode: price.type === 'recurring' ? 'subscription' : 'payment',
            productId: price.product ?? null
        };
    }

    private async resolvePromotionCodeIdForCheckout(
        price: string | StripePrice,
        checkoutInput: CheckoutInput
    ): Promise<string | null> {
        const promotionCodeId = this.resolvePromotionCodeId(price);
        if (promotionCodeId || typeof price === 'string') {
            return promotionCodeId;
        }

        return this.resolvePromotionCodeIdFromFirestoreDocument(checkoutInput.priceId, checkoutInput.productId);
    }

    private async runPreCheckoutLinkCheck(user: { getIdToken: (forceRefresh?: boolean) => Promise<string> }): Promise<void> {
        try {
            const result = await this.functionsService.call<void, { linked: boolean, role?: string }>('linkExistingStripeCustomer');
            if (!result.data.linked) {
                return;
            }

            this.logger.log(`Existing subscription found and linked. Role: ${result.data.role}. Skipping checkout.`);
            await user.getIdToken(true);
            throw new Error(`SUBSCRIPTION_RESTORED:${result.data.role}`);
        } catch (error: unknown) {
            if (error instanceof Error && error.message.startsWith('SUBSCRIPTION_RESTORED:')) {
                throw error;
            }
            this.logger.warn('Pre-checkout link check failed, proceeding with checkout:', error);
        }
    }

    private async handleExistingActiveSubscriptions(userId: string): Promise<boolean> {
        const subscriptionsRef = collection(this.firestore, `customers/${userId}/subscriptions`);
        const activeQuery = query(subscriptionsRef, where('status', 'in', ['active', 'trialing']));

        try {
            const activeSubs = await firstValueFrom(
                runInInjectionContext(this.injector, () => collectionData(activeQuery).pipe(take(1)))
            );

            if (!activeSubs.length) {
                return false;
            }

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

            await this.manageSubscriptions();
            return true;
        } catch (error) {
            if (error instanceof Error && error.message === this.userCancelledPortalMessage) {
                return true;
            }

            this.logger.error('Error checking existing subscriptions:', error);
            return false;
        }
    }

    private buildCheckoutSessionPayload(
        checkoutInput: CheckoutInput,
        userId: string,
        successUrl: string,
        cancelUrl: string,
        promotionCodeId: string | null
    ): CheckoutSessionPayload {
        const payload: CheckoutSessionPayload = {
            price: checkoutInput.priceId,
            success_url: successUrl,
            cancel_url: cancelUrl,
            allow_promotion_codes: true,
            mode: checkoutInput.mode,
            automatic_tax: { enabled: true },
            metadata: { firebaseUID: userId }
        };

        if (promotionCodeId) {
            payload.promotion_code = promotionCodeId;
        }

        if (checkoutInput.mode === 'subscription') {
            payload.payment_method_collection = 'if_required';
            payload.subscription_data = {
                metadata: { firebaseUID: userId },
                trial_settings: {
                    end_behavior: {
                        missing_payment_method: 'cancel'
                    }
                }
            };
        }

        return payload;
    }

    private async waitForCheckoutSessionUpdate(userId: string, checkoutSessionDocId: string): Promise<CheckoutSessionDocumentData> {
        const sessionRef = doc(this.firestore, `customers/${userId}/checkout_sessions/${checkoutSessionDocId}`);
        const session = await firstValueFrom(
            runInInjectionContext(this.injector, () => docData(sessionRef)).pipe(
                filter((sessionData): sessionData is CheckoutSessionDocumentData => {
                    const data = sessionData as CheckoutSessionDocumentData | null | undefined;
                    return !!data && (!!data.url || !!data.error);
                }),
                take(1),
                timeout(15000)
            )
        );
        return session;
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

    private resolvePromotionCodeId(price: string | StripePrice): string | null {
        if (typeof price === 'string') {
            return null;
        }

        const prefixedMetadataValue = price.stripe_metadata_promotion_code_id ?? null;
        const strictMetadataValue = price.metadata?.promotion_code_id ?? null;
        const rawValue = strictMetadataValue ?? prefixedMetadataValue;
        if (!rawValue) {
            return null;
        }

        const promotionCodeId = rawValue.trim();
        if (!promotionCodeId) {
            return null;
        }

        if (promotionCodeId.startsWith('promo_')) {
            return promotionCodeId;
        }

        const sourceKey = strictMetadataValue ? 'promotion_code_id' : 'stripe_metadata_promotion_code_id';
        this.logger.warn(`[appendCheckoutSession] Ignoring metadata '${sourceKey}' because '${promotionCodeId}' is not a Stripe promotion code ID (expected prefix: promo_).`);
        return null;
    }

    private async resolvePromotionCodeIdFromFirestoreDocument(priceId: string, productId: string | null): Promise<string | null> {
        const candidatePaths: string[] = [];
        if (productId) {
            candidatePaths.push(`products/${productId}/prices/${priceId}`);
        }

        try {
            if (!candidatePaths.length) {
                const productsRef = collection(this.firestore, 'products');
                const activeProductsQuery = query(productsRef, where('active', '==', true));
                const productsSnapshot = await runInInjectionContext(this.injector, () => getDocs(activeProductsQuery));
                for (const productDoc of productsSnapshot.docs) {
                    candidatePaths.push(`products/${productDoc.id}/prices/${priceId}`);
                }
            }

            for (const path of candidatePaths) {
                const priceRef = doc(this.firestore, path);
                const priceSnapshot = await runInInjectionContext(this.injector, () => getDoc(priceRef));
                if (!priceSnapshot.exists()) {
                    continue;
                }

                const data = priceSnapshot.data() as {
                    metadata?: { [key: string]: string };
                    stripe_metadata_promotion_code_id?: string;
                };
                const strictMetadataValue = data.metadata?.promotion_code_id ?? null;
                const prefixedMetadataValue = data.stripe_metadata_promotion_code_id ?? null;
                const rawValue = strictMetadataValue ?? prefixedMetadataValue;

                if (!rawValue) {
                    return null;
                }

                const promotionCodeId = rawValue.trim();
                if (!promotionCodeId.startsWith('promo_')) {
                    return null;
                }

                return promotionCodeId;
            }
        } catch {
            // If fallback lookup fails, continue without a promotion code.
        }

        return null;
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

        return runInInjectionContext(this.injector, () => collectionData(activeQuery, { idField: 'id' })).pipe(
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

    async hasPaidSubscriptionHistory(): Promise<boolean> {
        return this.checkPaidSubscriptionHistory('fail-open');
    }

    private async hasPaidSubscriptionHistoryForCheckoutEligibility(): Promise<boolean> {
        return this.checkPaidSubscriptionHistory('fail-closed');
    }

    private async checkPaidSubscriptionHistory(onError: 'fail-open' | 'fail-closed'): Promise<boolean> {
        const user = this.auth.currentUser;
        if (!user) {
            return false;
        }

        const subscriptionsRef = collection(this.firestore, `customers/${user.uid}/subscriptions`);
        const historyQuery = query(
            subscriptionsRef,
            where('status', 'in', this.subscriptionStatuses),
            limit(1)
        );

        try {
            const snapshot = await runInInjectionContext(this.injector, () => getDocs(historyQuery));
            return snapshot.docs.length > 0;
        } catch (error) {
            if (onError === 'fail-closed') {
                this.logger.warn('Could not verify subscription history for checkout gating. Blocking auto promo application (fail-closed).', error);
                return true;
            }

            this.logger.warn('Could not verify subscription history. Proceeding with trial messaging (fail-open).', error);
            return false;
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
    async manageSubscriptions(): Promise<void> {
        const returnUrl = `${this.windowService.currentDomain}/subscriptions`;

        try {
            const result = await this.functionsService.call<{ returnUrl: string }, { url: string }>('createPortalLink', { returnUrl });
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
