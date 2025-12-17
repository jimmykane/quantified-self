import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AppPaymentService, StripeProduct } from '../../services/app.payment.service';
import { AppUserService } from '../../services/app.user.service';
import { Observable } from 'rxjs';

@Component({
    selector: 'app-pricing',
    standalone: true,
    imports: [CommonModule, MatCardModule, MatButtonModule, MatProgressSpinnerModule],
    templateUrl: './pricing.component.html',
    styleUrls: ['./pricing.component.scss']
})
export class PricingComponent implements OnInit {
    products$: Observable<StripeProduct[]> | null = null;
    isPremium = false;
    isLoading = false;
    loadingPriceId: string | null = null;

    constructor(
        private paymentService: AppPaymentService,
        private userService: AppUserService
    ) { }

    async ngOnInit(): Promise<void> {
        this.products$ = this.paymentService.getProducts();
        this.isPremium = await this.userService.isPremium();
    }

    async subscribe(priceId: string) {
        if (this.isPremium) {
            alert('You are already subscribed!');
            return;
        }
        this.isLoading = true;
        this.loadingPriceId = priceId;
        try {
            await this.paymentService.appendCheckoutSession(priceId);
        } catch (error) {
            console.error('Error starting checkout:', error);
            alert('Failed to start checkout. Please try again.');
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
}
