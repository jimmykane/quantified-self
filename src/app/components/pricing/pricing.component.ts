import { Component, OnInit, OnDestroy, inject, Output, EventEmitter, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatBadgeModule } from '@angular/material/badge';
import { MatListModule } from '@angular/material/list';
import { AppPaymentService, StripeProduct, StripeSubscription, StripePrice } from '../../services/app.payment.service';
import { AppAuthService } from '../../authentication/app.auth.service';
import { AppUserService } from '../../services/app.user.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { Auth } from '@angular/fire/auth';
import { LoggerService } from '../../services/logger.service';
import { Observable, firstValueFrom, map, take } from 'rxjs';
import { StripeRole } from '../../models/stripe-role.model';
import { Router } from '@angular/router';

import { environment } from '../../../environments/environment';

import { MatDialog } from '@angular/material/dialog';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';
import { POLICY_CONTENT } from '../../shared/policies.content';

interface SubscriptionSummary {
    status: StripeSubscription['status'];
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: Date | null;
    isTrialing: boolean;
}

@Component({
    selector: 'app-pricing',
    standalone: true,
    imports: [CommonModule, MatCardModule, MatButtonModule, MatProgressSpinnerModule, MatIconModule, MatChipsModule, MatBadgeModule, MatListModule],
    templateUrl: './pricing.component.html',
    styleUrls: ['./pricing.component.scss']
})
export class PricingComponent implements OnInit, OnDestroy {
    @Output() planSelected = new EventEmitter<void>();

    products$: Observable<StripeProduct[]> | null = null;
    currentRole: StripeRole | null = null;
    isLoading = false;
    loadingPriceId: string | null = null;
    activeSubscriptions$: Observable<StripeSubscription[]> | null = null;
    subscriptionSummary$: Observable<SubscriptionSummary | null> | null = null;
    hasPaidSubscriptionHistory: boolean | null = null;
    private readonly requiredPolicies = POLICY_CONTENT.filter((policy) => !!policy.checkboxLabel && !policy.isOptional);

    private platformId = inject(PLATFORM_ID);
    private authService = inject(AppAuthService);
    private auth = inject(Auth);
    private userService = inject(AppUserService);
    private analyticsService = inject(AppAnalyticsService);
    private logger = inject(LoggerService);
    private router = inject(Router);

    constructor(
        private paymentService: AppPaymentService,
        private dialog: MatDialog,
    ) { }

    isLoadingRole = true;

    async ngOnInit(): Promise<void> {
        // Define a synthetic "Free" product that matches the StripeProduct structure
        const freeProduct: StripeProduct = {
            id: 'free_tier',
            active: true,
            name: 'Free Forever',
            description: 'The essentials to get started',
            images: [],
            role: 'free',
            metadata: { role: 'free' },
            prices: [{
                id: 'free_price',
                active: true,
                currency: 'USD',
                unit_amount: 0,
                description: 'Free price',
                type: 'recurring',
                interval: 'year',
                interval_count: 1,
                trial_period_days: 0,
                recurring: { interval: 'forever' as any }
            }]
        };

        this.products$ = this.paymentService.getProducts().pipe(
            map(products => [freeProduct, ...products])
        );

        // Initial load
        const [role, hasPaidSubscriptionHistory] = await Promise.all([
            this.userService.getSubscriptionRole(),
            this.paymentService.hasPaidSubscriptionHistory()
        ]);
        this.currentRole = role;
        this.hasPaidSubscriptionHistory = hasPaidSubscriptionHistory;
        this.isLoadingRole = false;

        // Reactive update: specific to subscription changes
        // When the subscriptions collection updates (Stripe extension sync),
        // we force-refresh the user token to get the new claims (set by Cloud Function).
        const subscriptions$ = this.paymentService.getUserSubscriptions().pipe(
            map(subs => {
                void this.userService.getSubscriptionRole()
                    .then(newRole => {
                        if (this.currentRole !== newRole) {
                            this.currentRole = newRole;
                        }
                    })
                    .catch((error) => {
                        this.logger.error('Failed to refresh subscription role after subscription update', error);
                    });
                return subs.filter(sub => sub.role !== 'free');
            })
        );

        this.activeSubscriptions$ = subscriptions$;
        this.subscriptionSummary$ = subscriptions$.pipe(
            map(subs => this.buildSubscriptionSummary(subs))
        );

        // Reset loading state if user returns to the tab (e.g. from Stripe Checkout via back button)
        if (isPlatformBrowser(this.platformId)) {
            document.addEventListener('visibilitychange', this.handleVisibilityChange);
        }
    }

    ngOnDestroy() {
        if (isPlatformBrowser(this.platformId)) {
            document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        }
    }

    private handleVisibilityChange = () => {
        if (isPlatformBrowser(this.platformId) && !document.hidden) {
            this.logger.log('Page became visible, resetting loading state');
            this.isLoading = false;
            this.loadingPriceId = null;
        }
    };

    shouldShowFirstMonthFreeCopy(product: StripeProduct, price: StripePrice): boolean {
        if (this.hasPaidSubscriptionHistory !== false) {
            return false;
        }

        const role = product.metadata?.['role'];
        if (role !== 'basic' && role !== 'pro') {
            return false;
        }

        if (!price.recurring) {
            return false;
        }

        return !this.currentRole || this.currentRole === 'free';
    }

    async subscribe(price: any) {
        if (!this.authService.currentUser) {
            this.router.navigate(['/login'], { queryParams: { returnUrl: this.getReturnUrl() } });
            return;
        }

        const userWithRequiredPolicies = await this.getUserWithRequiredPolicies();
        if (!userWithRequiredPolicies) {
            return;
        }

        // Handle both price object and legacy string ID for backward compatibility
        const priceId = typeof price === 'string' ? price : price.id;

        // Double-Billing Protection:
        // If user already has a Paid Role (Basic/Pro), they CANNOT checkout again.
        // They must manage/swap their existing subscription via the Portal.
        if (this.currentRole === 'pro' || this.currentRole === 'basic') {
            this.loadingPriceId = priceId;
            await this.manageSubscription();
            if (!this.isLoading) {
                this.loadingPriceId = null;
            }
            return;
        }

        this.loadingPriceId = priceId;
        this.isLoading = true;

        try {
            this.analyticsService.logBeginCheckout(
                priceId,
                typeof price !== 'string' ? price.currency : undefined,
                typeof price !== 'string' ? price.unit_amount / 100 : undefined
            );
            await this.paymentService.appendCheckoutSession(price);
        } catch (error) {
            const errorMessage = (error as Error).message || '';
            if (errorMessage === 'User cancelled redirection to portal.') {
                this.logger.log('User cancelled subscription management.');
            } else if (errorMessage.startsWith('SUBSCRIPTION_RESTORED:')) {
                const role = errorMessage.split(':')[1];
                this.showSubscriptionRestoredDialog(role);
            } else {
                this.logger.error('Error starting checkout:', error);
                alert('Failed to start checkout. Please try again.');
            }
            this.isLoading = false;
            this.loadingPriceId = null;
        }
    }

    async manageSubscription() {
        if (this.currentRole === 'pro' || this.currentRole === 'basic') {
            const isPro = this.currentRole === 'pro';
            const message = `You will be redirected to our secure billing portal where you can manage your plan and payment methods.<br><br>` +
                `<span style="color: var(--mat-sys-error); font-weight: bold;">Important:</span> If you decide to downgrade your plan, you will keep your features for a 30-day grace period. ` +
                (isPro ? `After that, your device sync will be disconnected, and any activities exceeding your new plan's limit will be permanently deleted.` :
                    `After that, any activities exceeding your new plan's limit will be permanently deleted.`);

            const confirmed = await firstValueFrom(
                this.dialog.open(ConfirmationDialogComponent, {
                    data: {
                        title: 'Manage Subscription',
                        message: message,
                        confirmText: 'Manage Subscription',
                        cancelText: 'Cancel'
                    }
                }).afterClosed()
            );
            if (!confirmed) {
                return;
            }
        }

        this.analyticsService.logManageSubscription();
        this.isLoading = true;
        try {
            await this.paymentService.manageSubscriptions();
        } catch (error) {
            this.logger.error('Error managing subscription:', error);
            alert('Failed to redirect to subscription management. Please try again.');
            this.isLoading = false;
        }
    }

    async upgradeToPro() {
        if (this.currentRole !== 'basic') {
            await this.manageSubscription();
            return;
        }

        const confirmed = await firstValueFrom(
            this.dialog.open(ConfirmationDialogComponent, {
                data: {
                    title: 'Upgrade to Pro',
                    message: 'You will be redirected to our secure billing portal to switch from Basic to Pro.',
                    confirmText: 'Upgrade to Pro',
                    cancelText: 'Cancel'
                }
            }).afterClosed()
        );

        if (!confirmed) {
            return;
        }

        this.analyticsService.logManageSubscription();
        this.isLoading = true;
        try {
            await this.paymentService.manageSubscriptions();
        } catch (error) {
            this.logger.error('Error redirecting to upgrade flow:', error);
            alert('Failed to open billing portal. Please try again.');
            this.isLoading = false;
        }
    }

    async selectFreeTier() {
        if (!this.authService.currentUser) {
            this.router.navigate(['/login'], { queryParams: { returnUrl: this.getReturnUrl() } });
            return;
        }

        const userWithRequiredPolicies = await this.getUserWithRequiredPolicies();
        if (!userWithRequiredPolicies) {
            return;
        }

        this.isLoading = true;
        try {
            this.analyticsService.logSelectFreeTier();
            await this.userService.setFreeTier(userWithRequiredPolicies);
            this.logger.log('Free tier selected. Waiting for reactive updates to handle navigation.');
            this.planSelected.emit();
        } catch (error) {
            this.logger.error('Error selecting free tier:', error);
        } finally {
            this.isLoading = false;
        }
    }

    async restorePurchases() {
        if (!this.auth.currentUser) {
            this.router.navigate(['/login'], { queryParams: { returnUrl: this.getReturnUrl() } });
            return;
        }

        this.analyticsService.logRestorePurchases('initiated');
        this.isLoading = true;
        try {
            const role = await this.paymentService.restorePurchases();
            this.analyticsService.logRestorePurchases('success', role);
            this.showSubscriptionRestoredDialog(role);
        } catch (error) {
            this.logger.error('Error restoring purchases:', error);
            this.analyticsService.logRestorePurchases('failure', undefined, (error as Error).message);
            const message = `Failed to restore purchases. Please <a href="mailto:${environment.supportEmail}">contact support</a>.`;
            this.dialog.open(ConfirmationDialogComponent, {
                data: {
                    title: 'Error',
                    message,
                    confirmText: 'OK'
                }
            });
        } finally {
            this.isLoading = false;
        }
    }

    private showSubscriptionRestoredDialog(role: string): void {
        this.dialog.open(ConfirmationDialogComponent, {
            data: {
                title: 'Subscription Restored!',
                message: `We found your existing ${role} subscription and linked it to your account. No need to subscribe again!`,
                confirmText: 'OK'
            }
        });
    }

    private getReturnUrl(): string {
        const url = this.router.url;
        return url && url.startsWith('/') ? url : '/subscriptions';
    }

    private async getUserWithRequiredPolicies() {
        const user = await this.getCurrentAppUser();
        if (!user) {
            this.router.navigate(['/onboarding'], { queryParams: { returnUrl: '/subscriptions' } });
            return null;
        }

        const termsAccepted = this.requiredPolicies.every((policy) => {
            const userProperty = this.mapFormControlNameToUserProperty(policy.formControlName || '');
            return (user as any)[userProperty] === true;
        });

        if (termsAccepted) {
            return user;
        }

        this.logger.log('[PricingComponent] Required legal policies are missing. Redirecting to onboarding.');
        this.router.navigate(['/onboarding'], { queryParams: { returnUrl: '/subscriptions' } });
        return null;
    }

    private async getCurrentAppUser() {
        const user = await firstValueFrom(this.authService.user$.pipe(take(1)));
        return user;
    }

    private mapFormControlNameToUserProperty(formControlName: string): string {
        if (!formControlName) {
            return '';
        }
        return formControlName.replace(/^accept/, 'accepted');
    }

    private buildSubscriptionSummary(subscriptions: StripeSubscription[]): SubscriptionSummary | null {
        if (!subscriptions.length) {
            return null;
        }

        const withPeriodEnd = subscriptions.map(sub => ({
            sub,
            periodEnd: this.normalizeToDate(sub.current_period_end)
        }));

        const primary = withPeriodEnd.sort((a, b) => {
            const aTime = a.periodEnd ? a.periodEnd.getTime() : 0;
            const bTime = b.periodEnd ? b.periodEnd.getTime() : 0;
            return bTime - aTime;
        })[0];

        return {
            status: primary.sub.status,
            cancelAtPeriodEnd: !!primary.sub.cancel_at_period_end,
            currentPeriodEnd: primary.periodEnd,
            isTrialing: primary.sub.status === 'trialing'
        };
    }

    private normalizeToDate(value: unknown): Date | null {
        if (!value) {
            return null;
        }

        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : value;
        }

        if (typeof value === 'number') {
            const isMilliseconds = value > 1_000_000_000_000;
            const date = new Date(isMilliseconds ? value : value * 1000);
            return Number.isNaN(date.getTime()) ? null : date;
        }

        if (typeof value === 'string') {
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }

        if (typeof value === 'object') {
            const maybeTimestamp = value as {
                toDate?: () => Date;
                seconds?: number;
                _seconds?: number;
            };

            if (typeof maybeTimestamp.toDate === 'function') {
                const date = maybeTimestamp.toDate();
                return Number.isNaN(date.getTime()) ? null : date;
            }

            const seconds = typeof maybeTimestamp.seconds === 'number'
                ? maybeTimestamp.seconds
                : (typeof maybeTimestamp._seconds === 'number' ? maybeTimestamp._seconds : undefined);

            if (seconds !== undefined) {
                const date = new Date(seconds * 1000);
                return Number.isNaN(date.getTime()) ? null : date;
            }
        }

        return null;
    }
}
