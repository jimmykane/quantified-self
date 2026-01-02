import { Component, OnInit, OnDestroy, inject, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatBadgeModule } from '@angular/material/badge';
import { AppPaymentService, StripeProduct, StripeSubscription } from '../../services/app.payment.service';
import { AppUserService } from '../../services/app.user.service';
import { Observable, map } from 'rxjs';
import { StripeRole } from '../../models/stripe-role.model';
import { Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { environment } from '../../../environments/environment';

import { MatDialog } from '@angular/material/dialog';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';
import { firstValueFrom } from 'rxjs';
import { LoggerService } from '../../services/logger.service';

@Component({
    selector: 'app-pricing',
    standalone: true,
    imports: [CommonModule, MatCardModule, MatButtonModule, MatProgressSpinnerModule, MatIconModule, MatChipsModule, MatBadgeModule],
    templateUrl: './pricing.component.html',
    styleUrls: ['./pricing.component.scss']
})
export class PricingComponent implements OnInit, OnDestroy {
    @Output() planSelected = new EventEmitter<void>();

    products$: Observable<StripeProduct[]> | null = null;
    currentRole: StripeRole | null = null;
    isLoading = false;
    loadingPriceId: string | null = null;

    private auth = inject(Auth);
    private router = inject(Router);

    constructor(
        private paymentService: AppPaymentService,
        private userService: AppUserService,
        private dialog: MatDialog,
        private logger: LoggerService
    ) { }

    isLoadingRole = true;

    async ngOnInit(): Promise<void> {
        // Define a synthetic "Free" product that matches the StripeProduct structure
        const freeProduct: any = {
            id: 'free_tier',
            name: 'Free Forever',
            description: 'The essentials to get started',
            metadata: { role: 'free' },
            prices: [{
                id: 'free_price',
                unit_amount: 0,
                currency: 'USD',
                recurring: { interval: 'forever' }
            }]
        };

        this.products$ = this.paymentService.getProducts().pipe(
            map(products => [freeProduct, ...products])
        );

        // Initial load
        const role = await this.userService.getSubscriptionRole();
        this.currentRole = role;
        this.isLoadingRole = false;

        // Reactive update: specific to subscription changes
        // When the subscriptions collection updates (Stripe extension sync), 
        // we force-refresh the user token to get the new claims (set by Cloud Function).
        this.activeSubscriptions$ = this.paymentService.getUserSubscriptions().pipe(
            map(subs => {
                // Trigger token refresh in background when subs change
                // distinctUntilChanged handling is implicit via Firestore subscription emission behavior usually,
                // but checking if role actually matches current might be good optimization.
                // For now, simple trigger is robust.
                this.userService.getSubscriptionRole().then(newRole => {
                    if (this.currentRole !== newRole) {
                        this.currentRole = newRole;
                    }
                });
                return subs.filter(sub => sub.role !== 'free');
            })
        );

        // Reset loading state if user returns to the tab (e.g. from Stripe Checkout via back button)
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    ngOnDestroy() {
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }

    private handleVisibilityChange = () => {
        if (!document.hidden) {
            this.logger.log('Page became visible, resetting loading state');
            this.isLoading = false;
            this.loadingPriceId = null;
        }
    };

    async subscribe(price: any) {
        if (!this.auth.currentUser) {
            this.router.navigate(['/login'], { queryParams: { returnUrl: '/pricing' } });
            return;
        }

        // Handle both price object and legacy string ID for backward compatibility
        const priceId = typeof price === 'string' ? price : price.id;
        this.loadingPriceId = priceId;

        // Double-Billing Protection:
        // If user already has a Paid Role (Basic/Pro), they CANNOT checkout again.
        // They must manage/swap their existing subscription via the Portal.
        if (this.currentRole === 'pro' || this.currentRole === 'basic') {
            await this.manageSubscription();
            // If we are back here, it means manageSubscription failed or was cancelled/completed
            // (though success usually redirects). We must clear the local loading state if isLoading is false.
            if (!this.isLoading) {
                this.loadingPriceId = null;
            }
            return;
        }

        this.isLoading = true;

        try {
            await this.paymentService.appendCheckoutSession(price);
        } catch (error) {
            const errorMessage = (error as Error).message || '';
            if (errorMessage === 'User cancelled redirection to portal.') {
                // User cancelled the dialog, just stop loading
                this.logger.log('User cancelled subscription management.');
            } else if (errorMessage.startsWith('SUBSCRIPTION_RESTORED:')) {
                // Existing subscription was linked, show success message
                const role = errorMessage.split(':')[1];
                this.dialog.open(ConfirmationDialogComponent, {
                    data: {
                        title: 'Subscription Restored!',
                        message: `We found your existing ${role} subscription and linked it to your account. No need to subscribe again!`,
                        confirmText: 'OK'
                    }
                }).afterClosed().subscribe(() => {
                    window.location.reload();
                });
            } else {
                this.logger.error('Error starting checkout:', error);
                alert('Failed to start checkout. Please try again.');
            }
            this.isLoading = false;
            this.loadingPriceId = null;
        }
    }

    async manageSubscription() {
        if (this.currentRole === 'pro') {
            const confirmed = await firstValueFrom(
                this.dialog.open(ConfirmationDialogComponent, {
                    data: {
                        title: 'Downgrade Warning',
                        message: 'You are about to downgrade your plan. You will keep your Pro features for a 30-day grace period. After that, your device sync will be disconnected, and any activities exceeding your new plan\'s limit (starting with the newest ones) will be permanently deleted.',
                        confirmText: 'Manage Subscription',
                        cancelText: 'Cancel'
                    }
                }).afterClosed()
            );
            if (!confirmed) {
                return;
            }
        }

        this.isLoading = true;
        try {
            await this.paymentService.manageSubscriptions();
        } catch (error) {
            this.logger.error('Error managing subscription:', error);
            alert('Failed to redirect to subscription management. Please try again.');
            this.isLoading = false;
        }
    }

    async selectFreeTier() {
        if (!this.auth.currentUser) {
            this.router.navigate(['/login']);
            return;
        }

        this.isLoading = true;
        try {
            // We need the full user object to pass to setFreeTier.
            // We can get it from userService.getUserByID or via the authService observable if we had it here.
            // But simpler: just get the uid and let the service handle it? 
            // The method signature I added expects 'User' object.
            // Let's fetch it quickly or assume we have it via a subscription if we inject authService properly.
            // Actually, `AppUserService` update methods generally take the partial user object or just UID for some things, 
            // but `updateUserProperties` takes `User`.

            // Let's get the user first.
            const uid = this.auth.currentUser.uid;
            const user = await firstValueFrom(this.userService.getUserByID(uid));

            if (user) {
                await this.userService.setFreeTier(user);
                this.logger.log('Free tier selected. Waiting for reactive updates to handle navigation.');

                this.planSelected.emit();

                // Do NOT navigate from here. 
                // The OnboardingComponent listens to user changes and will checkAndAdvance/finishOnboarding automatically.
                // Navigation here causes a race condition with the guard.

                this.isLoading = false;
            }
        } catch (error) {
            this.logger.error('Error selecting free tier:', error);
            this.isLoading = false;
        }
    }

    // New property for template
    activeSubscriptions$: Observable<StripeSubscription[]> | null = null;

    async restorePurchases() {
        if (!this.auth.currentUser) {
            this.router.navigate(['/login'], { queryParams: { returnUrl: '/pricing' } });
            return;
        }

        this.isLoading = true;
        try {
            await this.paymentService.restorePurchases();
            // Reload window to reflect new state
            window.location.reload();
        } catch (error) {
            this.logger.error('Error restoring purchases:', error);
            const message = `Failed to restore purchases. Please <a href="mailto:${environment.supportEmail}">contact support</a>.`;
            this.dialog.open(ConfirmationDialogComponent, {
                data: {
                    title: 'Error',
                    message,
                    confirmText: 'OK'
                }
            });
            this.isLoading = false;
        }
    }
}
