import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Auth } from 'app/firebase/auth';
import { LoggerService } from '../../services/logger.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';

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
  isRefreshing = true;
  assignedRole: string | null = null;

  async ngOnInit(): Promise<void> {
    this.isRefreshing = true;
    const user = this.auth.currentUser;

    if (!user) {
      this.logger.error('PaymentSuccess: No current user found!');
      this.isRefreshing = false;
      return;
    }

    if (this.resolveCheckoutMode() === 'payment') {
      this.logger.log('PaymentSuccess: Payment-mode checkout succeeded. Logging purchase without waiting for stripeRole.');
      this.logPurchaseAnalytics(null);
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
          this.logPurchaseAnalytics(role);
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

  private logPurchaseAnalytics(role: string | null): void {
    const queryParamMap = this.route.snapshot.queryParamMap;
    const sessionId = queryParamMap.get('session_id');
    if (!sessionId) {
      this.logger.warn('PaymentSuccess: Missing checkout session id; skipping purchase analytics.');
      return;
    }

    this.analyticsService.logPurchaseOnce({
      transactionId: sessionId,
      role,
      contextId: queryParamMap.get('purchase_context_id'),
      isTrialCheckout: this.resolveTrialCheckoutParam(queryParamMap.get('trial_checkout'))
    });
  }

  private isPaidRole(role: unknown): role is 'basic' | 'pro' {
    return role === 'basic' || role === 'pro';
  }

  private resolveTrialCheckoutParam(value: string | null): boolean | undefined {
    if (value === '1') {
      return true;
    }

    if (value === '0') {
      return false;
    }

    return undefined;
  }

  private resolveCheckoutMode(): 'payment' | 'subscription' {
    return this.route.snapshot.queryParamMap.get('checkout_mode') === 'payment' ? 'payment' : 'subscription';
  }
}
