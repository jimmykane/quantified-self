import { Injectable, inject } from '@angular/core';
import { Firestore, collection, collectionData, addDoc, doc, docData, query, where, orderBy } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Auth } from '@angular/fire/auth';
import { Observable, from, switchMap, filter, take, map, timeout } from 'rxjs';
import { AppWindowService } from './app.window.service';

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
}

export interface StripeSubscription {
    id: string;
    status: 'active' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'past_due' | 'trialing' | 'unpaid';
    current_period_end: any;
    current_period_start: any;
    cancel_at_period_end: boolean;
}

@Injectable({
    providedIn: 'root'
})
export class AppPaymentService {
    private firestore = inject(Firestore);
    private functions = inject(Functions);
    private auth = inject(Auth);

    constructor(private windowService: AppWindowService) { }

    /**
     * Fetches all active products with their prices.
     */
    getProducts(): Observable<StripeProduct[]> {
        const productsRef = collection(this.firestore, 'products');
        const activeProductsQuery = query(productsRef, where('active', '==', true));

        return collectionData(activeProductsQuery, { idField: 'id' }).pipe(
            switchMap((products: StripeProduct[]) => {
                // Fetch prices for each product
                const productsWithPrices$ = products.map(product => this.getProductWithPrices(product));
                return from(Promise.all(productsWithPrices$));
            })
        );
    }

    private async getProductWithPrices(product: StripeProduct): Promise<StripeProduct> {
        const pricesRef = collection(this.firestore, `products/${product.id}/prices`);
        const activePricesQuery = query(pricesRef, where('active', '==', true));

        return new Promise((resolve) => {
            collectionData(activePricesQuery, { idField: 'id' }).pipe(take(1)).subscribe((prices: StripePrice[]) => {
                resolve({ ...product, prices });
            });
        });
    }

    /**
     * Creates a checkout session and redirects the user to Stripe.
     */
    async appendCheckoutSession(priceId: string, successUrl?: string, cancelUrl?: string): Promise<void> {
        const user = this.auth.currentUser;
        if (!user) {
            throw new Error('User must be authenticated to create a checkout session.');
        }

        const success = successUrl || `${this.windowService.currentDomain}/payment/success`;
        const cancel = cancelUrl || `${this.windowService.currentDomain}/payment/cancel`;

        console.log('Creating checkout session for price:', priceId);
        const checkoutSessionsRef = collection(this.firestore, `customers/${user.uid}/checkout_sessions`);

        try {
            const sessionDoc = await addDoc(checkoutSessionsRef, {
                price: priceId,
                success_url: success,
                cancel_url: cancel,
                allow_promotion_codes: true,
            });

            console.log('Checkout session created with ID:', sessionDoc.id);

            // Wait for the extension to add the URL
            const sessionRef = doc(this.firestore, `customers/${user.uid}/checkout_sessions/${sessionDoc.id}`);

            docData(sessionRef).pipe(
                filter((session: any) => session?.url),
                take(1),
                timeout(10000) // Timeout after 10 seconds if extension doesn't respond
            ).subscribe({
                next: (session: any) => {
                    console.log('Redirecting to Stripe:', session.url);
                    window.location.assign(session.url);
                },
                error: (err) => {
                    console.error('Error waiting for checkout session URL:', err);
                    if (err.name === 'TimeoutError') {
                        alert('Payment system is slow to respond. Please check if the popup was blocked or try again.');
                    } else {
                        alert('An error occurred starting the payment. Please try again.');
                    }
                }
            });
        } catch (e) {
            console.error('Error creating checkout doc:', e);
            throw e;
        }
    }

    /**
     * Gets the current user's active subscriptions.
     */
    getUserSubscriptions(): Observable<StripeSubscription[]> {
        const user = this.auth.currentUser;
        if (!user) {
            return from([[]]);
        }

        const subscriptionsRef = collection(this.firestore, `customers/${user.uid}/subscriptions`);
        const activeQuery = query(subscriptionsRef, where('status', 'in', ['active', 'trialing']));

        return collectionData(activeQuery, { idField: 'id' }) as Observable<StripeSubscription[]>;
    }

    /**
     * Opens the Stripe Customer Portal for managing subscriptions.
     */
    async manageSubscriptions(): Promise<void> {
        const returnUrl = `${this.windowService.currentDomain}/settings`;

        const createPortalLink = httpsCallable<{ returnUrl: string }, { url: string }>(
            this.functions,
            'ext-firestore-stripe-payments-createPortalLink'
        );

        try {
            const result = await createPortalLink({ returnUrl });
            window.location.assign(result.data.url);
        } catch (error) {
            console.error('Error creating portal link:', error);
            throw error;
        }
    }
}
