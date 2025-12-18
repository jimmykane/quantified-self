import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AppPaymentService, StripeProduct, StripeSubscription } from '../../services/app.payment.service';
import { AppUserService } from '../../services/app.user.service';
import { Observable, map } from 'rxjs';
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
    currentRole: StripeRole | null = null;
    isLoading = false;
    loadingPriceId: string | null = null;

    constructor(
        private paymentService: AppPaymentService,
        private userService: AppUserService
    ) { }

    async ngOnInit(): Promise<void> {
        this.products$ = this.paymentService.getProducts();

        const role = await this.userService.getSubscriptionRole();
        // Strict assignment: We trust the backend. If it's null, it's null (No Plan).
        this.currentRole = role;

        this.activeSubscriptions$ = this.paymentService.getUserSubscriptions().pipe(
            map(subs => subs.filter(sub => sub.role !== 'free'))
        );
    }

    async subscribe(price: any) {
        // Double-Billing Protection:
        // If user already has a Paid Role (Basic/Pro), they CANNOT checkout again.
        // They must manage/swap their existing subscription via the Portal.
        if (this.currentRole === 'pro' || this.currentRole === 'basic') {
            await this.manageSubscription();
            return;
        }

        this.isLoading = true;
        // Handle both price object and legacy string ID for backward compatibility
        const priceId = typeof price === 'string' ? price : price.id;
        this.loadingPriceId = priceId;

        try {
            await this.paymentService.appendCheckoutSession(price);
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
