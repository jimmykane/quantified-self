import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { AppPaymentService, StripeProduct } from '../../services/app.payment.service';
import { Observable } from 'rxjs';

@Component({
    selector: 'app-pricing',
    standalone: true,
    imports: [CommonModule, MatCardModule, MatButtonModule],
    templateUrl: './pricing.component.html',
    styleUrls: ['./pricing.component.scss']
})
export class PricingComponent implements OnInit {
    products$: Observable<StripeProduct[]> | null = null;

    constructor(private paymentService: AppPaymentService) { }

    ngOnInit(): void {
        this.products$ = this.paymentService.getProducts();
    }

    async subscribe(priceId: string) {
        try {
            await this.paymentService.appendCheckoutSession(priceId);
        } catch (error) {
            console.error('Error starting checkout:', error);
            alert('Failed to start checkout. Please try again.');
        }
    }
}
