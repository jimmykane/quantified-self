import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AppPaymentService, StripeProduct, StripeSubscription } from '../../services/app.payment.service';
import { AppUserService } from '../../services/app.user.service';
import { Observable } from 'rxjs';
import { StripeRole } from '../../models/stripe-role.model';

@Component({
    selector: 'app-pricing',
    standalone: true,
    imports: [CommonModule, MatCardModule, MatButtonModule, MatProgressSpinnerModule],
    templateUrl: './pricing.component.html',
    styleUrls: ['./pricing.component.scss']
})
export class PricingComponent implements OnInit {
    products$: Observable<StripeProduct[]> | null = null;
    currentRole: StripeRole = 'free';
    isLoading = false;
    loadingPriceId: string | null = null;

    constructor(
        private paymentService: AppPaymentService,
        private userService: AppUserService
    ) { }

    async ngOnInit(): Promise<void> {
        this.products$ = this.paymentService.getProducts();

        const role = await this.userService.getSubscriptionRole();
        if (role === 'premium' || role === 'basic') {
            this.currentRole = role;
        } else {
            this.currentRole = 'free';
        }

        this.activeSubscriptions$ = this.paymentService.getUserSubscriptions();
    }

    async subscribe(priceId: string) {
        if (this.currentRole === 'premium' || this.currentRole === 'basic') {
            // Usually this path is guarded by UI, but if they click "Upgrade" we shouldn't block them here
            // actually upgrades should proceed to checkout session.
            // The check for existing subscription is done in paymentService.appendCheckoutSession specific logic.
            // for now let's just allow it call through, payment service handles the "you have a sub, manage it" flow.
        }
        this.isLoading = true;
        this.loadingPriceId = priceId;
        try {
            await this.paymentService.appendCheckoutSession(priceId);
        } catch (error) {
            if (error.message === 'User cancelled redirection to portal.') {
                // User cancelled the dialog, just stop loading
                console.log('User cancelled subscription management.');
            } else {
                console.error('Error starting checkout:', error);
                alert('Failed to start checkout. Please try again.');
            }
            this.isLoading = false;
            this.loadingPriceId = null;
        }
    }

    async manageSubscription() {
        this.isLoading = true;
        try {
            await this.paymentService.manageSubscriptions();
        } catch (error) {
            console.error('Error managing subscription:', error);
            alert('Failed to redirect to subscription management. Please try again.');
            this.isLoading = false;
        }
    }

    // New property for template
    activeSubscriptions$: Observable<StripeSubscription[]> | null = null;

    async restorePurchases() {
        this.isLoading = true;
        try {
            await this.paymentService.restorePurchases();
            // Reload window to reflect new state
            window.location.reload();
        } catch (error) {
            console.error('Error restoring purchases:', error);
            alert('Failed to restore purchases. Please contact support.');
            this.isLoading = false;
        }
    }
}
