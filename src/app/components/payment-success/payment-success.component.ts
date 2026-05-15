import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Auth } from 'app/firebase/auth';
import { LoggerService } from '../../services/logger.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppFunctionsService } from '../../services/app.functions.service';
import type {
  VerifyCheckoutSessionRequest,
  VerifyCheckoutSessionResult
} from '@shared/stripe-checkout-session';

@Component({
  selector: 'app-payment-success',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatProgressSpinnerModule, RouterModule],
  templateUrl: './payment-success.component.html',
  styleUrls: ['./payment-success.component.scss']
})
export class PaymentSuccessComponent implements OnInit {
  private auth = inject(Auth);
  private route = inject(ActivatedRoute);
  private logger = inject(LoggerService);
  private analyticsService = inject(AppAnalyticsService);
  private functionsService = inject(AppFunctionsService);
  isRefreshing = true;
  verificationFailed = false;
  assignedRole: string | null = null;

  async ngOnInit(): Promise<void> {
    this.isRefreshing = true;
    this.verificationFailed = false;
    const user = this.auth.currentUser;

    if (!user) {
      this.logger.error('PaymentSuccess: No current user found!');
      this.verificationFailed = true;
      this.isRefreshing = false;
      return;
    }

    const verifiedCheckout = await this.verifyCheckoutSessionFromUrl();
    if (!verifiedCheckout) {
      this.verificationFailed = true;
      this.isRefreshing = false;
      return;
    }

    this.logPurchaseAnalytics(null, verifiedCheckout);

    if (verifiedCheckout.mode === 'payment') {
      this.logger.log('PaymentSuccess: Payment-mode checkout verified without waiting for stripeRole.');
      this.isRefreshing = false;
      return;
    }

    const maxAttempts = 10;
    let attempt = 0;
    let hasPaidClaim = false;

    this.logger.log('PaymentSuccess: Starting claim polling...');

    while (!hasPaidClaim && attempt < maxAttempts) {
      attempt++;
      try {
        this.logger.log(`PaymentSuccess: Polling attempt ${attempt}/${maxAttempts}...`);
        // Force refresh
        const tokenResult = await user.getIdTokenResult(true);
        const role = tokenResult.claims['stripeRole'] as string;

        this.logger.log('PaymentSuccess: Claims:', tokenResult.claims);

        if (this.isPaidRole(role)) {
          this.logger.log(`PaymentSuccess: Found paid stripeRole '${role}' on attempt ${attempt}!`);
          hasPaidClaim = true;
          this.assignedRole = role;
        } else {
          this.logger.warn(`PaymentSuccess: paid stripeRole not found on attempt ${attempt}. Waiting...`);
          // Wait 2 seconds before next try
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        this.logger.error('PaymentSuccess: Error refreshing token:', error);
        // Wait even on error, so we don't spam
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (!hasPaidClaim) {
      this.logger.error('PaymentSuccess: Timeout waiting for paid stripeRole. User might need to re-login or wait longer.');
    }

    this.isRefreshing = false;
  }

  private async verifyCheckoutSessionFromUrl(): Promise<VerifyCheckoutSessionResult | null> {
    const queryParamMap = this.route.snapshot.queryParamMap;
    const sessionId = queryParamMap.get('session_id');
    if (!sessionId) {
      this.logger.warn('PaymentSuccess: Missing checkout session id; skipping purchase analytics.');
      return null;
    }

    try {
      const result = await this.functionsService.call<VerifyCheckoutSessionRequest, VerifyCheckoutSessionResult>(
        'verifyCheckoutSession',
        { sessionId }
      );
      return result.data;
    } catch (error) {
      this.logger.warn('PaymentSuccess: Checkout session verification failed; skipping purchase analytics.', error);
      return null;
    }
  }

  private logPurchaseAnalytics(role: string | null, verifiedCheckout: VerifyCheckoutSessionResult): void {
    const queryParamMap = this.route.snapshot.queryParamMap;
    this.analyticsService.logPurchaseOnce({
      transactionId: verifiedCheckout.transactionId,
      role: role ?? verifiedCheckout.role ?? null,
      contextId: queryParamMap.get('purchase_context_id'),
      isTrialCheckout: verifiedCheckout.isTrialCheckout,
      mode: verifiedCheckout.mode,
      priceId: verifiedCheckout.priceId,
      currency: verifiedCheckout.currency,
      value: verifiedCheckout.value,
      isVerifiedCheckout: true
    });
  }

  private isPaidRole(role: unknown): role is 'basic' | 'pro' {
    return role === 'basic' || role === 'pro';
  }
}
