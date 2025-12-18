import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmationDialogComponent } from '../components/confirmation-dialog/confirmation-dialog.component';
import { environment } from '../../environments/environment';
import { Firestore, collection, collectionData, addDoc, doc, docData, query, where, orderBy } from '@angular/fire/firestore';
import { Functions, httpsCallable, httpsCallableFromURL } from '@angular/fire/functions';

// ... (other imports)


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
    private dialog = inject(MatDialog);

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

        // Check for existing active subscriptions first
        const subscriptionsRef = collection(this.firestore, `customers/${user.uid}/subscriptions`);
        const activeQuery = query(subscriptionsRef, where('status', 'in', ['active', 'trialing']));

        try {
            const snapshot = from(collectionData(activeQuery).pipe(take(1)));
            const activeSubs = await snapshot.toPromise();

            if (activeSubs && activeSubs.length > 0) {
                console.warn('User already has an active subscription. Opening management dialog.');

                const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
                    data: {
                        title: 'Active Subscription',
                        message: 'You already have an active subscription. Would you like to manage it instead?',
                        confirmText: 'Manage Subscription',
                        cancelText: 'Cancel'
                    }
                });

                // Convert Observable to Promise
                // We use firstValueFrom roughly equivalent to toPromise here, or simple subscription logic wrapped in Promise
                // Since this file uses 'rxjs', let's stick to simple promise wrapper or import firstValueFrom if available (it wasn't imported before but 'take' was).
                // Let's use a simple promise wrapper to avoid adding imports if possible, or just add firstValueFrom to imports.
                // Actually, I can just await a custom promise helper or standard rxjs way.
                // Let's assume toPromise or firstValueFrom. I'll check imports. 
                // The file has: import { Observable, from, switchMap, filter, take, map, timeout } from 'rxjs';
                // I should add firstValueFrom to imports in a separate edit or use a one-off promise wrapper inline.
                // Inline wrapper to be safe and avoid multi-step import fix if strict.

                const confirmed = await new Promise<boolean>(resolve => {
                    dialogRef.afterClosed().pipe(take(1)).subscribe(result => resolve(!!result));
                });

                if (confirmed) {
                    await this.manageSubscriptions();
                    return; // Successfully handed off to manage portal
                } else {
                    // Explicitly throw a known error for cancellation so UI can stop loading
                    throw new Error('User cancelled redirection to portal.');
                }
            }
        } catch (e) {
            // If error checking subs, we might want to proceed or stop. 
            // For now, if it's the specific "cancelled" error, rethrow. 
            // Otherwise, log and proceed with caution or block.
            if (e.message === 'User cancelled redirection to portal.') {
                return;
            }
            console.error('Error checking existing subscriptions:', e);
            // Proceeding might be risky if we failed to check, but let's assume loose fail-open for now 
            // or clearer: block if unsure? Let's log.
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
                filter((session: any) => session?.url || session?.error),
                take(1),
                timeout(15000) // Timeout after 15 seconds
            ).subscribe({
                next: (session: any) => {
                    if (session.error) {
                        console.error('Stripe extension returned an error:', session.error);
                        alert(`Payment error: ${session.error.message}`);
                        return;
                    }
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
        const returnUrl = `${this.windowService.currentDomain}/pricing`;

        const createPortalLink = httpsCallableFromURL<{ returnUrl: string }, { url: string }>(
            this.functions,
            environment.functions.createPortalLink
        );

        try {
            const result = await createPortalLink({ returnUrl });
            window.location.assign(result.data.url);
        } catch (error) {
            console.error('Error creating portal link:', error);
            throw error;
        }
    }

    /**
     * Restores purchases by force-refreshing the user's claims.
     */
    async restorePurchases(): Promise<void> {
        const restoreUserClaims = httpsCallableFromURL<void, { success: boolean, role: string }>(
            this.functions,
            environment.functions.restoreUserClaims
        );

        try {
            await restoreUserClaims();
            // Force token refresh to pick up new claims
            const user = this.auth.currentUser;
            if (user) {
                await user.getIdToken(true);
            }
        } catch (error) {
            console.error('Error restoring purchases:', error);
            throw error;
        }
    }
}
