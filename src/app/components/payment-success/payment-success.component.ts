import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterModule } from '@angular/router';
import { Auth } from 'app/firebase/auth';
import { LoggerService } from '../../services/logger.service';
import { AppAnalyticsService, SubscriptionPlan, SubscriptionStartStatus } from '../../services/app.analytics.service';
import { AppPaymentService, StripeSubscription } from '../../services/app.payment.service';
import { catchError, defer, filter, firstValueFrom, map, of, take, timeout, timer } from 'rxjs';

@Component({
  selector: 'app-payment-success',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatProgressSpinnerModule, RouterModule],
  templateUrl: './payment-success.component.html',
  styleUrls: ['./payment-success.component.scss']
})
export class PaymentSuccessComponent implements OnInit {
  private auth = inject(Auth);
  private logger = inject(LoggerService);
  private analyticsService = inject(AppAnalyticsService);
  private paymentService = inject(AppPaymentService);
  private readonly destroyRef = inject(DestroyRef);
  isRefreshing = true;
  assignedRole: SubscriptionPlan | null = null;

  async ngOnInit(): Promise<void> {
    this.isRefreshing = true;
    this.assignedRole = null;
    const user = this.auth.currentUser;

    if (!user) {
      this.logger.error('PaymentSuccess: No current user found!');
      this.isRefreshing = false;
      return;
    }

    const maxAttempts = 10;
    const deadline = Date.now() + 20_000;
    let attempt = 0;
    let hasPremiumClaim = false;

    this.logger.log('PaymentSuccess: Starting claim polling...');

    while (!hasPremiumClaim && attempt < maxAttempts && this.isCurrentUser(user.uid) && Date.now() < deadline) {
      attempt++;
      try {
        this.logger.log(`PaymentSuccess: Polling attempt ${attempt}/${maxAttempts}...`);
        // Force refresh
        const tokenResult = await firstValueFrom(defer(() => user.getIdTokenResult(true)).pipe(
          timeout({ first: Math.max(0, deadline - Date.now()) }),
          catchError(error => {
            if (this.isCurrentUser(user.uid)) {
              this.logger.error('PaymentSuccess: Error refreshing token:', error);
            }
            return of(null);
          }),
          takeUntilDestroyed(this.destroyRef),
        ), { defaultValue: null });
        if (!this.isCurrentUser(user.uid)) {
          break;
        }
        const role = tokenResult?.claims['stripeRole'];

        if (this.isPaidSubscriptionPlan(role)) {
          this.logger.log(`PaymentSuccess: Found stripeRole '${role}' on attempt ${attempt}!`);
          hasPremiumClaim = true;
          this.assignedRole = role;
          void this.logSubscriptionStarted(role);
        } else if (tokenResult) {
          this.logger.warn(`PaymentSuccess: Paid-plan access not confirmed on attempt ${attempt}.`);
        }
      } catch (error) {
        if (!this.isCurrentUser(user.uid)) {
          break;
        }
        this.logger.error('PaymentSuccess: Error refreshing token:', error);
      }

      if (!hasPremiumClaim && attempt < maxAttempts && this.isCurrentUser(user.uid) && Date.now() < deadline) {
        // Leave time for the server-owned subscription claim to arrive, including after errors.
        await firstValueFrom(timer(Math.min(2000, deadline - Date.now())).pipe(
          takeUntilDestroyed(this.destroyRef),
        ), { defaultValue: 0 });
      }
    }

    if (this.destroyRef.destroyed) {
      return;
    }

    if (!hasPremiumClaim) {
      this.logger.error('PaymentSuccess: Timeout waiting for stripeRole. User might need to re-login or wait longer.');
    }

    this.isRefreshing = false;
  }

  private isCurrentUser(uid: string): boolean {
    return !this.destroyRef.destroyed && this.auth.currentUser?.uid === uid;
  }

  private isPaidSubscriptionPlan(role: unknown): role is SubscriptionPlan {
    return role === 'basic' || role === 'pro';
  }

  private async logSubscriptionStarted(plan: SubscriptionPlan): Promise<void> {
    try {
      const subscription = await firstValueFrom(
        this.paymentService.getUserSubscriptions().pipe(
          map(subscriptions => subscriptions.find(subscription => (
            subscription.role === plan
            && (subscription.status === 'active' || subscription.status === 'trialing')
          ))),
          filter((subscription): subscription is StripeSubscription & {
            role: SubscriptionPlan;
            status: SubscriptionStartStatus;
          } => subscription !== undefined),
          take(1),
          timeout(10_000),
        ),
      );

      this.analyticsService.logSubscriptionStarted(subscription.id, plan, subscription.status);
    } catch (error) {
      this.logger.warn('PaymentSuccess: Subscription completion could not be recorded in Analytics.', error);
    }
  }
}
