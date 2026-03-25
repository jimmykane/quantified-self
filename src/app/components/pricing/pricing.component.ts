import { Component, OnInit, OnDestroy, inject, Output, EventEmitter, PLATFORM_ID, Input } from '@angular/core';
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
import { BehaviorSubject, Observable, Subscription, firstValueFrom, map, take } from 'rxjs';
import { StripeRole } from '../../models/stripe-role.model';
import { Router } from '@angular/router';
import { User } from '@sports-alliance/sports-lib';
import { UpcomingRenewalAmountResult } from '@shared/stripe-renewal';

import { environment } from '../../../environments/environment';

import { MatDialog } from '@angular/material/dialog';
import { ConfirmationDialogComponent } from '../confirmation-dialog/confirmation-dialog.component';
import { POLICY_CONTENT } from '../../shared/policies.content';
import { getAiInsightsRequestLimitForRole, getUsageLimitForRole } from '@shared/limits';

interface SubscriptionSummary {
    status: StripeSubscription['status'];
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: Date | null;
    isTrialing: boolean;
    renewalAmountDisplay: string;
}

@Component({
    selector: 'app-pricing',
    standalone: true,
    imports: [CommonModule, MatCardModule, MatButtonModule, MatProgressSpinnerModule, MatIconModule, MatChipsModule, MatBadgeModule, MatListModule],
    templateUrl: './pricing.component.html',
    styleUrls: ['./pricing.component.scss']
})
export class PricingComponent implements OnInit, OnDestroy {
    @Input() isOnboarding = false;
    @Input() onboardingUser: User | null = null;
    @Output() planSelected = new EventEmitter<void>();
    @Output() loadingStateChange = new EventEmitter<boolean>();

    products$: Observable<StripeProduct[]> | null = null;
    currentRole: StripeRole | null = null;
    isLoading = false;
    loadingPriceId: string | null = null;
    activeSubscriptions$: Observable<StripeSubscription[]> | null = null;
    private readonly subscriptionSummarySubject = new BehaviorSubject<SubscriptionSummary | null>(null);
    subscriptionSummary$: Observable<SubscriptionSummary | null> = this.subscriptionSummarySubject.asObservable();
    hasPaidSubscriptionHistory: boolean | null = null;
    private readonly requiredPolicies = POLICY_CONTENT.filter((policy) => !!policy.checkboxLabel && !policy.isOptional);
    private subscriptionsListener: Subscription | null = null;
    private renewalSummarySequence = 0;

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
        this.subscriptionsListener?.unsubscribe();
        this.subscriptionsListener = subscriptions$.subscribe((subs) => {
            void this.refreshSubscriptionSummary(subs);
        });

        // Reset loading state if user returns to the tab (e.g. from Stripe Checkout via back button)
        if (isPlatformBrowser(this.platformId)) {
            document.addEventListener('visibilitychange', this.handleVisibilityChange);
        }
    }

    ngOnDestroy() {
        this.renewalSummarySequence++;
        this.subscriptionsListener?.unsubscribe();
        if (isPlatformBrowser(this.platformId)) {
            document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        }
    }

    private handleVisibilityChange = () => {
        if (isPlatformBrowser(this.platformId) && !document.hidden) {
            this.logger.log('Page became visible, resetting loading state');
            this.setLoadingState(false);
            this.loadingPriceId = null;
        }
    };

    private setLoadingState(isLoading: boolean): void {
        this.isLoading = isLoading;
        this.loadingStateChange.emit(isLoading);
    }

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

    shouldShowOnboardingFreeContinue(product: StripeProduct): boolean {
        return this.isOnboarding && product.metadata?.['role'] === 'free' && this.currentRole === null;
    }

    isCurrentPlan(product: StripeProduct): boolean {
        return (product.metadata?.['role'] === 'free' && (!this.currentRole || this.currentRole === 'free'))
            || (!!this.currentRole && product.metadata?.['role'] === this.currentRole);
    }

    getActivityLimitLabel(role: string | null | undefined): string {
        const resolvedRole = role ?? 'free';

        try {
            const limit = getUsageLimitForRole(resolvedRole);
            return limit === null ? 'Unlimited activities' : `Up to ${limit} activities`;
        } catch (error) {
            this.logger.error(`Unsupported pricing role '${resolvedRole}' in pricing UI`, error);
            return 'Activity limits unavailable';
        }
    }

    getAiInsightsLimitLabel(role: string | null | undefined): string {
        const resolvedRole = role ?? 'free';

        try {
            const limit = getAiInsightsRequestLimitForRole(resolvedRole);
            if (limit <= 0) {
                return 'AI Insights not included';
            }
            return `AI Insights up to ${limit} requests per billing period`;
        } catch (error) {
            this.logger.error(`Unsupported pricing role '${resolvedRole}' in AI insights pricing UI`, error);
            return 'AI Insights limits unavailable';
        }
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
        this.setLoadingState(true);

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
            this.setLoadingState(false);
            this.loadingPriceId = null;
        }
    }

    async manageSubscription() {
        if (this.currentRole === 'pro' || this.currentRole === 'basic') {
            const isPro = this.currentRole === 'pro';
            const message = `You will be redirected to our secure billing portal where you can manage your plan and payment methods.<br><br>` +
                `<span style="color: var(--mat-sys-error); font-weight: bold;">Important:</span> If you decide to downgrade your plan, you will keep your features for a 30-day grace period. ` +
                (isPro ? `After that, your device sync will be disconnected, and your new plan limits will apply to future uploads. Existing activities are not automatically deleted.` :
                    `After that, your new plan limits will apply to future uploads. Existing activities are not automatically deleted.`);

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
        this.setLoadingState(true);
        try {
            await this.paymentService.manageSubscriptions();
        } catch (error) {
            this.logger.error('Error managing subscription:', error);
            alert('Failed to redirect to subscription management. Please try again.');
            this.setLoadingState(false);
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
        this.setLoadingState(true);
        try {
            await this.paymentService.manageSubscriptions();
        } catch (error) {
            this.logger.error('Error redirecting to upgrade flow:', error);
            alert('Failed to open billing portal. Please try again.');
            this.setLoadingState(false);
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

        this.setLoadingState(true);
        try {
            this.analyticsService.logSelectFreeTier();
            await this.userService.setFreeTier(userWithRequiredPolicies);
            this.logger.log('Free tier selected. Waiting for reactive updates to handle navigation.');
            this.planSelected.emit();
        } catch (error) {
            this.logger.error('Error selecting free tier:', error);
            alert('Failed to select free tier. Please try again.');
        } finally {
            this.setLoadingState(false);
        }
    }

    async restorePurchases() {
        if (!this.auth.currentUser) {
            this.router.navigate(['/login'], { queryParams: { returnUrl: this.getReturnUrl() } });
            return;
        }

        this.analyticsService.logRestorePurchases('initiated');
        this.setLoadingState(true);
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
            this.setLoadingState(false);
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
            if (this.isOnboarding) {
                this.logger.log('[PricingComponent] App user is unavailable during onboarding. Staying on onboarding.');
                return null;
            }
            this.router.navigate(['/onboarding'], { queryParams: { returnUrl: '/subscriptions' } });
            return null;
        }

        if (this.isOnboarding && this.onboardingUser?.uid) {
            return user;
        }

        const termsAccepted = this.requiredPolicies.every((policy) => {
            const userProperty = this.mapFormControlNameToUserProperty(policy.formControlName || '');
            return (user as any)[userProperty] === true;
        });

        if (termsAccepted) {
            return user;
        }

        if (this.isOnboarding) {
            this.logger.log('[PricingComponent] Required legal policies are missing during onboarding. Staying on onboarding.');
            return null;
        }

        this.logger.log('[PricingComponent] Required legal policies are missing. Redirecting to onboarding.');
        this.router.navigate(['/onboarding'], { queryParams: { returnUrl: '/subscriptions' } });
        return null;
    }

    private async getCurrentAppUser() {
        if (this.isOnboarding && this.onboardingUser?.uid) {
            return this.onboardingUser as any;
        }

        const user = await firstValueFrom(this.authService.user$.pipe(take(1)));
        return user;
    }

    private mapFormControlNameToUserProperty(formControlName: string): string {
        if (!formControlName) {
            return '';
        }
        return formControlName.replace(/^accept/, 'accepted');
    }

    private buildBaseSubscriptionSummary(
        subscriptions: StripeSubscription[]
    ): Omit<SubscriptionSummary, 'renewalAmountDisplay'> | null {
        if (!subscriptions.length) {
            return null;
        }

        const withSortKeys = subscriptions.map(sub => ({
            sub,
            createdAt: this.normalizeToDate(sub.created),
            periodEnd: this.normalizeToDate(sub.current_period_end)
        }));

        const primary = withSortKeys.sort((a, b) => {
            const aCreated = a.createdAt ? a.createdAt.getTime() : Number.NEGATIVE_INFINITY;
            const bCreated = b.createdAt ? b.createdAt.getTime() : Number.NEGATIVE_INFINITY;
            if (aCreated !== bCreated) {
                return bCreated - aCreated;
            }

            const aPeriodEnd = a.periodEnd ? a.periodEnd.getTime() : 0;
            const bPeriodEnd = b.periodEnd ? b.periodEnd.getTime() : 0;
            if (aPeriodEnd !== bPeriodEnd) {
                return bPeriodEnd - aPeriodEnd;
            }

            return b.sub.id.localeCompare(a.sub.id);
        })[0];

        return {
            status: primary.sub.status,
            cancelAtPeriodEnd: !!primary.sub.cancel_at_period_end,
            currentPeriodEnd: primary.periodEnd,
            isTrialing: primary.sub.status === 'trialing'
        };
    }

    private async refreshSubscriptionSummary(subscriptions: StripeSubscription[]): Promise<void> {
        const requestId = ++this.renewalSummarySequence;
        const baseSummary = this.buildBaseSubscriptionSummary(subscriptions);
        if (!baseSummary) {
            this.subscriptionSummarySubject.next(null);
            return;
        }

        this.subscriptionSummarySubject.next({
            ...baseSummary,
            renewalAmountDisplay: 'Calculating…'
        });

        const renewalAmountResult = await this.paymentService.getUpcomingRenewalAmount();
        if (requestId !== this.renewalSummarySequence) {
            return;
        }

        this.subscriptionSummarySubject.next({
            ...baseSummary,
            renewalAmountDisplay: this.mapRenewalAmountDisplay(renewalAmountResult)
        });
    }

    private mapRenewalAmountDisplay(result: UpcomingRenewalAmountResult): string {
        if (result.status === 'ready') {
            return this.formatCurrencyFromMinor(result.amountMinor, result.currency);
        }

        if (result.status === 'no_upcoming_charge') {
            return 'No upcoming charge';
        }

        return 'Amount unavailable';
    }

    private formatCurrencyFromMinor(amountMinor: number, currencyCode: string): string {
        const amountMajor = amountMinor / 100;
        const hasNoCents = amountMinor % 100 === 0;
        const formatter = new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: currencyCode,
            minimumFractionDigits: hasNoCents ? 0 : 2,
            maximumFractionDigits: 2
        });

        return formatter.format(amountMajor);
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
