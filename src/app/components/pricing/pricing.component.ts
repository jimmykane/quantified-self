import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { AppPaymentService, StripeProduct, StripeSubscription } from '../../services/app.payment.service';
import { AppUserService } from '../../services/app.user.service';
import { Observable, map } from 'rxjs';
import { StripeRole } from '../../models/stripe-role.model';
import { Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';

import { MatDialog } from '@angular/material/dialog';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';
import { firstValueFrom } from 'rxjs';
import { LoggerService } from '../../services/logger.service';

@Component({
    selector: 'app-pricing',
    standalone: true,
    imports: [CommonModule, MatCardModule, MatButtonModule, MatProgressSpinnerModule, MatIconModule],
    templateUrl: './pricing.component.html',
    styleUrls: ['./pricing.component.scss']
})
export class PricingComponent implements OnInit {
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
        this.products$ = this.paymentService.getProducts();

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
    }

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
            if ((error as any).message === 'User cancelled redirection to portal.') {
                // User cancelled the dialog, just stop loading
                this.logger.log('User cancelled subscription management.');
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
            alert('Failed to restore purchases. Please contact support.');
            this.isLoading = false;
        }
    }
}
