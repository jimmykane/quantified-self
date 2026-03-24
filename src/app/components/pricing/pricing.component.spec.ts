import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PricingComponent } from './pricing.component';
import { AppUserService } from '../../services/app.user.service';
import { AppPaymentService, StripePrice, StripeProduct, StripeSubscription } from '../../services/app.payment.service';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Subject, of } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import { Analytics } from '@angular/fire/analytics';
import { Router } from '@angular/router';
import { By } from '@angular/platform-browser';

import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AI_INSIGHTS_REQUEST_LIMITS, USAGE_LIMITS } from '@shared/limits';
import { UpcomingRenewalAmountResult } from '@shared/stripe-renewal';

class MockAppPaymentService {
    getProducts() {
        return of([]);
    }
    getUserSubscriptions() {
        return of([]);
    }
    manageSubscriptions() {
        return Promise.resolve();
    }
    restorePurchases() {
        return Promise.resolve('pro');
    }
    appendCheckoutSession() {
        return Promise.resolve();
    }
    hasPaidSubscriptionHistory() {
        return Promise.resolve(false);
    }
    getUpcomingRenewalAmount(): Promise<UpcomingRenewalAmountResult> {
        return Promise.resolve({ status: 'unavailable' });
    }
}

class MockAppUserService {
    getSubscriptionRole() {
        return Promise.resolve('free');
    }
    getUserByID() {
        return of({});
    }
    setFreeTier() {
        return Promise.resolve();
    }
}

import { MatDialog } from '@angular/material/dialog';

class MockMatDialog {
    open() {
        return {
            afterClosed: () => of(true)
        };
    }
}

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('PricingComponent', () => {
    let component: PricingComponent;
    let fixture: ComponentFixture<PricingComponent>;
    const acceptedPoliciesUser = {
        uid: 'test-uid',
        acceptedPrivacyPolicy: true,
        acceptedDataPolicy: true,
        acceptedTos: true
    };
    const authServiceMock = {
        user$: of(acceptedPoliciesUser as any),
        currentUser: { uid: 'test-uid' }
    };


    beforeEach(async () => {
        authServiceMock.user$ = of(acceptedPoliciesUser as any);
        authServiceMock.currentUser = { uid: 'test-uid' };

        await TestBed.configureTestingModule({
            imports: [PricingComponent],
            providers: [
                { provide: AppPaymentService, useClass: MockAppPaymentService },
                { provide: AppUserService, useClass: MockAppUserService },
                {
                    provide: AppAuthService,
                    useValue: authServiceMock
                },
                { provide: MatDialog, useClass: MockMatDialog },
                {
                    provide: Auth,
                    useValue: {
                        currentUser: { uid: 'test-uid' }
                    }
                },
                {
                    provide: Router,
                    useValue: {
                        navigate: vi.fn()
                    }
                },
                {
                    provide: Analytics,
                    useValue: null
                },
                {
                    provide: AppAnalyticsService,
                    useValue: {
                        logEvent: vi.fn(),
                        logBeginCheckout: vi.fn(),
                        logManageSubscription: vi.fn(),
                        logSelectFreeTier: vi.fn(),
                        logRestorePurchases: vi.fn()
                    }
                }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(PricingComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should derive activity limit labels from the shared limits map', () => {
        expect(component.getActivityLimitLabel('free')).toBe(`Up to ${USAGE_LIMITS.free} activities`);
        expect(component.getActivityLimitLabel('basic')).toBe(`Up to ${USAGE_LIMITS.basic} activities`);
        expect(component.getActivityLimitLabel('pro')).toBe('Unlimited activities');
    });

    it('should derive AI insights limit labels by plan role', () => {
        expect(component.getAiInsightsLimitLabel('free')).toBe('AI Insights not included');
        expect(component.getAiInsightsLimitLabel('basic')).toBe(`AI Insights up to ${AI_INSIGHTS_REQUEST_LIMITS.basic} requests per billing period`);
        expect(component.getAiInsightsLimitLabel('pro')).toBe(`AI Insights up to ${AI_INSIGHTS_REQUEST_LIMITS.pro} requests per billing period`);
    });

    it('should show downgrade warning for pro users', async () => {
        component.currentRole = 'pro';
        const dialog = TestBed.inject(MatDialog);
        const dialogSpy = vi.spyOn(dialog, 'open');

        await component.manageSubscription();

        expect(dialogSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            data: expect.objectContaining({
                title: 'Manage Subscription',
                message: expect.stringContaining('device sync will be disconnected')
            })
        }));
    });

    it('should show downgrade warning for basic users without sync mention', async () => {
        component.currentRole = 'basic';
        const dialog = TestBed.inject(MatDialog);
        const dialogSpy = vi.spyOn(dialog, 'open');

        await component.manageSubscription();

        expect(dialogSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            data: expect.objectContaining({
                title: 'Manage Subscription',
                message: expect.stringContaining('secure billing portal')
            })
        }));
        expect(dialogSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            data: expect.not.objectContaining({
                message: expect.stringContaining('device sync')
            })
        }));
    });

    it('should show error dialog with support link when restorePurchases fails', async () => {
        const paymentService = TestBed.inject(AppPaymentService);
        const dialog = TestBed.inject(MatDialog);
        const dialogSpy = vi.spyOn(dialog, 'open');

        vi.spyOn(paymentService, 'restorePurchases').mockRejectedValue(new Error('Stripe error'));

        await component.restorePurchases();

        expect(dialogSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            data: expect.objectContaining({
                title: 'Error',
                message: expect.stringContaining('mailto:support@quantified-self.io')
            })
        }));
        expect(component.isLoading).toBe(false);
    });

    it('should show success dialog when restorePurchases succeeds', async () => {
        const paymentService = TestBed.inject(AppPaymentService);
        const dialog = TestBed.inject(MatDialog);
        const dialogSpy = vi.spyOn(dialog, 'open');

        // Mock success with a specific role
        vi.spyOn(paymentService, 'restorePurchases').mockResolvedValue('pro');

        await component.restorePurchases();

        expect(dialogSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            data: expect.objectContaining({
                title: 'Subscription Restored!',
                message: expect.stringContaining('We found your existing pro subscription'),
                confirmText: 'OK'
            })
        }));
        expect(component.isLoading).toBe(false);
    });

    it('should show success dialog when subscribe fails with SUBSCRIPTION_RESTORED error', async () => {
        const paymentService = TestBed.inject(AppPaymentService);
        const dialog = TestBed.inject(MatDialog);
        const dialogSpy = vi.spyOn(dialog, 'open');

        vi.spyOn(paymentService, 'appendCheckoutSession').mockRejectedValue(new Error('SUBSCRIPTION_RESTORED:basic'));

        // Pass a mock price object
        await component.subscribe({ id: 'price_123' });

        expect(dialogSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            data: expect.objectContaining({
                title: 'Subscription Restored!',
                message: expect.stringContaining('We found your existing basic subscription'),
                confirmText: 'OK'
            })
        }));
        expect(component.isLoading).toBe(false);
    });

    it('should redirect to onboarding and skip checkout when required legal policies are missing', async () => {
        const paymentService = TestBed.inject(AppPaymentService);
        const router = TestBed.inject(Router);
        const navigateSpy = vi.spyOn(router, 'navigate');
        const checkoutSpy = vi.spyOn(paymentService, 'appendCheckoutSession');
        const analyticsService = TestBed.inject(AppAnalyticsService);
        const beginCheckoutSpy = vi.spyOn(analyticsService, 'logBeginCheckout');

        authServiceMock.user$ = of({
            uid: 'test-uid',
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: false,
            acceptedTos: true
        } as any);

        await component.subscribe({ id: 'price_123', currency: 'USD', unit_amount: 1000 });

        expect(navigateSpy).toHaveBeenCalledWith(
            ['/onboarding'],
            { queryParams: { returnUrl: '/subscriptions' } }
        );
        expect(checkoutSpy).not.toHaveBeenCalled();
        expect(beginCheckoutSpy).not.toHaveBeenCalled();
        expect(component.isLoading).toBe(false);
        expect(component.loadingPriceId).toBeNull();
    });

    it('should redirect to onboarding and skip free-tier selection when required legal policies are missing', async () => {
        const userService = TestBed.inject(AppUserService);
        const router = TestBed.inject(Router);
        const navigateSpy = vi.spyOn(router, 'navigate');
        const setFreeTierSpy = vi.spyOn(userService, 'setFreeTier');
        const analyticsService = TestBed.inject(AppAnalyticsService);
        const selectFreeTierSpy = vi.spyOn(analyticsService, 'logSelectFreeTier');

        authServiceMock.user$ = of({
            uid: 'test-uid',
            acceptedPrivacyPolicy: false,
            acceptedDataPolicy: true,
            acceptedTos: true
        } as any);

        await component.selectFreeTier();

        expect(navigateSpy).toHaveBeenCalledWith(
            ['/onboarding'],
            { queryParams: { returnUrl: '/subscriptions' } }
        );
        expect(setFreeTierSpy).not.toHaveBeenCalled();
        expect(selectFreeTierSpy).not.toHaveBeenCalled();
        expect(component.isLoading).toBe(false);
    });

    it('should stay on onboarding and skip free-tier selection when required legal policies are missing in onboarding mode', async () => {
        const userService = TestBed.inject(AppUserService);
        const router = TestBed.inject(Router);
        const navigateSpy = vi.spyOn(router, 'navigate');
        const setFreeTierSpy = vi.spyOn(userService, 'setFreeTier');
        const analyticsService = TestBed.inject(AppAnalyticsService);
        const selectFreeTierSpy = vi.spyOn(analyticsService, 'logSelectFreeTier');

        component.isOnboarding = true;
        authServiceMock.user$ = of({
            uid: 'test-uid',
            acceptedPrivacyPolicy: false,
            acceptedDataPolicy: true,
            acceptedTos: true
        } as any);

        await component.selectFreeTier();

        expect(navigateSpy).not.toHaveBeenCalledWith(
            ['/onboarding'],
            { queryParams: { returnUrl: '/subscriptions' } }
        );
        expect(setFreeTierSpy).not.toHaveBeenCalled();
        expect(selectFreeTierSpy).not.toHaveBeenCalled();
        expect(component.isLoading).toBe(false);
    });

    it('should reset loading state when document becomes visible', () => {
        // Set component to loading state
        component.isLoading = true;
        component.loadingPriceId = 'price_123';

        // Mock document visibility state to be visible (not hidden)
        Object.defineProperty(document, 'hidden', {
            configurable: true,
            get: () => false
        });

        // Trigger visibilitychange event
        document.dispatchEvent(new Event('visibilitychange'));

        expect(component.isLoading).toBe(false);
        expect(component.loadingPriceId).toBeNull();
    });


    it('should log begin_checkout event on subscribe', async () => {
        const analyticsService = TestBed.inject(AppAnalyticsService);
        const logSpy = vi.spyOn(analyticsService, 'logBeginCheckout');
        const price = { id: 'price_123', currency: 'USD', unit_amount: 1000 };

        authServiceMock.user$ = of(acceptedPoliciesUser as any);

        await component.subscribe(price);

        expect(logSpy).toHaveBeenCalledWith('price_123', 'USD', 10);
    });

    it('should log select_freetier event on selectFreeTier', async () => {
        const analyticsService = TestBed.inject(AppAnalyticsService);
        const logSpy = vi.spyOn(analyticsService, 'logSelectFreeTier');
        const userService = TestBed.inject(AppUserService);
        const setFreeTierSpy = vi.spyOn(userService, 'setFreeTier').mockResolvedValue();

        authServiceMock.user$ = of(acceptedPoliciesUser as any);

        await component.selectFreeTier();

        expect(logSpy).toHaveBeenCalled();
        expect(setFreeTierSpy).toHaveBeenCalled();
    });

    it('should emit loading state changes while selectFreeTier is running', async () => {
        const userService = TestBed.inject(AppUserService);
        vi.spyOn(userService, 'setFreeTier').mockResolvedValue(undefined);
        authServiceMock.user$ = of(acceptedPoliciesUser as any);
        const loadingStateSpy = vi.fn();
        component.loadingStateChange.subscribe(loadingStateSpy);

        await component.selectFreeTier();

        expect(loadingStateSpy).toHaveBeenNthCalledWith(1, true);
        expect(loadingStateSpy).toHaveBeenLastCalledWith(false);
    });

    it('should show an alert and avoid planSelected when selectFreeTier fails', async () => {
        const analyticsService = TestBed.inject(AppAnalyticsService);
        const logSpy = vi.spyOn(analyticsService, 'logSelectFreeTier');
        const userService = TestBed.inject(AppUserService);
        vi.spyOn(userService, 'setFreeTier').mockRejectedValue(new Error('free-tier failed'));
        const planSelectedSpy = vi.spyOn(component.planSelected, 'emit');
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);

        authServiceMock.user$ = of(acceptedPoliciesUser as any);

        await component.selectFreeTier();

        expect(logSpy).toHaveBeenCalled();
        expect(planSelectedSpy).not.toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalledWith('Failed to select free tier. Please try again.');
        expect(component.isLoading).toBe(false);
    });

    it('should log manage_subscription event on manageSubscription', async () => {
        const analyticsService = TestBed.inject(AppAnalyticsService);
        const logSpy = vi.spyOn(analyticsService, 'logManageSubscription');

        await component.manageSubscription();

        expect(logSpy).toHaveBeenCalled();
    });

    it('should log restore_purchases events on restorePurchases', async () => {
        const analyticsService = TestBed.inject(AppAnalyticsService);
        const logSpy = vi.spyOn(analyticsService, 'logRestorePurchases');
        const paymentService = TestBed.inject(AppPaymentService);
        vi.spyOn(paymentService, 'restorePurchases').mockResolvedValue('pro');

        await component.restorePurchases();

        expect(logSpy).toHaveBeenCalledWith('initiated');
        expect(logSpy).toHaveBeenCalledWith('success', 'pro');
    });

    it('should show first-month-free copy for recurring paid plans when user is free', () => {
        component.hasPaidSubscriptionHistory = false;
        component.currentRole = 'free';
        const product = {
            metadata: { role: 'basic' }
        } as StripeProduct;
        const price = {
            recurring: { interval: 'month' }
        } as StripePrice;

        expect(component.shouldShowFirstMonthFreeCopy(product, price)).toBe(true);
    });

    it('should not show first-month-free copy for one-time prices or paid users', () => {
        component.hasPaidSubscriptionHistory = false;
        const product = {
            metadata: { role: 'pro' }
        } as StripeProduct;
        const oneTimePrice = {
            recurring: null
        } as StripePrice;
        const recurringPrice = {
            recurring: { interval: 'month' }
        } as StripePrice;

        component.currentRole = 'free';
        expect(component.shouldShowFirstMonthFreeCopy(product, oneTimePrice)).toBe(false);

        component.currentRole = 'basic';
        expect(component.shouldShowFirstMonthFreeCopy(product, recurringPrice)).toBe(false);
    });

    it('should not show first-month-free copy when user has paid subscription history', () => {
        component.hasPaidSubscriptionHistory = true;
        component.currentRole = 'free';
        const product = {
            metadata: { role: 'pro' }
        } as StripeProduct;
        const recurringPrice = {
            recurring: { interval: 'month' }
        } as StripePrice;

        expect(component.shouldShowFirstMonthFreeCopy(product, recurringPrice)).toBe(false);
    });

    it('should render first-month-free copy on paid plans for eligible users', async () => {
        const paymentService = TestBed.inject(AppPaymentService);
        const userService = TestBed.inject(AppUserService);
        const recurringPaidProduct: StripeProduct = {
            id: 'prod_basic',
            active: true,
            name: 'Basic',
            description: 'Basic plan',
            role: 'basic',
            images: [],
            metadata: { role: 'basic' },
            prices: [{
                id: 'price_basic',
                active: true,
                currency: 'usd',
                unit_amount: 1000,
                description: 'Monthly basic',
                type: 'recurring',
                interval: 'month',
                interval_count: 1,
                trial_period_days: null,
                recurring: { interval: 'month' }
            }]
        };

        vi.spyOn(userService, 'getSubscriptionRole').mockResolvedValue('free');
        vi.spyOn(paymentService, 'getProducts').mockReturnValue(of([recurringPaidProduct]));
        vi.spyOn(paymentService, 'hasPaidSubscriptionHistory').mockResolvedValue(false);

        await component.ngOnInit();
        fixture.detectChanges();

        const content = fixture.nativeElement.textContent as string;
        expect(content).toContain('your first month is free for new members');
    });

    it('should not render first-month-free copy for returning users with paid history', async () => {
        const paymentService = TestBed.inject(AppPaymentService);
        const userService = TestBed.inject(AppUserService);
        const recurringPaidProduct: StripeProduct = {
            id: 'prod_pro',
            active: true,
            name: 'Pro',
            description: 'Pro plan',
            role: 'pro',
            images: [],
            metadata: { role: 'pro' },
            prices: [{
                id: 'price_pro',
                active: true,
                currency: 'usd',
                unit_amount: 2000,
                description: 'Monthly pro',
                type: 'recurring',
                interval: 'month',
                interval_count: 1,
                trial_period_days: null,
                recurring: { interval: 'month' }
            }]
        };

        vi.spyOn(userService, 'getSubscriptionRole').mockResolvedValue('free');
        vi.spyOn(paymentService, 'getProducts').mockReturnValue(of([recurringPaidProduct]));
        vi.spyOn(paymentService, 'hasPaidSubscriptionHistory').mockResolvedValue(true);

        await component.ngOnInit();
        fixture.detectChanges();

        const content = fixture.nativeElement.textContent as string;
        expect(content).not.toContain('your first month is free for new members');
    });

    it('should render the current free plan state as a disabled button', async () => {
        const paymentService = TestBed.inject(AppPaymentService);
        const userService = TestBed.inject(AppUserService);
        const recurringPaidProduct: StripeProduct = {
            id: 'prod_basic',
            active: true,
            name: 'Basic',
            description: 'Basic plan',
            role: 'basic',
            images: [],
            metadata: { role: 'basic' },
            prices: [{
                id: 'price_basic',
                active: true,
                currency: 'usd',
                unit_amount: 1000,
                description: 'Monthly basic',
                type: 'recurring',
                interval: 'month',
                interval_count: 1,
                trial_period_days: null,
                recurring: { interval: 'month' }
            }]
        };

        vi.spyOn(userService, 'getSubscriptionRole').mockResolvedValue('free');
        vi.spyOn(paymentService, 'getProducts').mockReturnValue(of([recurringPaidProduct]));
        vi.spyOn(paymentService, 'hasPaidSubscriptionHistory').mockResolvedValue(false);

        await component.ngOnInit();
        fixture.detectChanges();

        const currentPlanButton = fixture.nativeElement.querySelector('button.current-plan-button') as HTMLButtonElement | null;

        expect(currentPlanButton).toBeTruthy();
        expect(currentPlanButton?.disabled).toBe(true);
        expect(currentPlanButton?.textContent).toContain('Current Plan');
        expect(fixture.nativeElement.querySelector('.current-plan-chip')).toBeNull();
    });

    it('should render an enabled Continue for Free CTA in onboarding when the role is still null', async () => {
        const paymentService = TestBed.inject(AppPaymentService);
        const userService = TestBed.inject(AppUserService);
        const recurringPaidProduct: StripeProduct = {
            id: 'prod_basic',
            active: true,
            name: 'Basic',
            description: 'Basic plan',
            role: 'basic',
            images: [],
            metadata: { role: 'basic' },
            prices: [{
                id: 'price_basic',
                active: true,
                currency: 'usd',
                unit_amount: 1000,
                description: 'Monthly basic',
                type: 'recurring',
                interval: 'month',
                interval_count: 1,
                trial_period_days: null,
                recurring: { interval: 'month' }
            }]
        };

        component.isOnboarding = true;
        vi.spyOn(userService, 'getSubscriptionRole').mockResolvedValue(null);
        vi.spyOn(paymentService, 'getProducts').mockReturnValue(of([recurringPaidProduct]));
        vi.spyOn(paymentService, 'hasPaidSubscriptionHistory').mockResolvedValue(false);

        await component.ngOnInit();
        fixture.detectChanges();

        const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
        const continueForFreeButton = buttons.find(button => button.textContent?.includes('Continue for Free')) ?? null;

        expect(continueForFreeButton).toBeTruthy();
        expect(continueForFreeButton?.disabled).toBe(false);
        expect(fixture.nativeElement.textContent).not.toContain('Current Plan');
    });

    it('should render the onboarding Continue for Free CTA only once even when the free product has multiple prices', () => {
        const freeProductWithMultiplePrices = {
            id: 'free_tier',
            active: true,
            name: 'Free Forever',
            description: 'The essentials to get started',
            role: 'free',
            images: [],
            metadata: { role: 'free' },
            prices: [
                {
                    id: 'free_monthly',
                    active: true,
                    currency: 'usd',
                    unit_amount: 0,
                    description: 'Monthly free',
                    type: 'recurring',
                    interval: 'month',
                    interval_count: 1,
                    trial_period_days: null,
                    recurring: { interval: 'month' }
                },
                {
                    id: 'free_yearly',
                    active: true,
                    currency: 'usd',
                    unit_amount: 0,
                    description: 'Yearly free',
                    type: 'recurring',
                    interval: 'year',
                    interval_count: 1,
                    trial_period_days: null,
                    recurring: { interval: 'year' }
                }
            ]
        } as StripeProduct;

        component.isOnboarding = true;
        component.currentRole = null;
        component.isLoadingRole = false;
        component.products$ = of([freeProductWithMultiplePrices]);

        fixture.detectChanges();

        const continueForFreeButtons = fixture.debugElement
            .queryAll(By.css('button.continue-free-button'))
            .map(button => button.nativeElement as HTMLButtonElement);

        expect(continueForFreeButtons.length).toBe(1);
    });

    it('should show a spinner inside the onboarding Continue for Free CTA while loading', () => {
        const freeProduct = {
            id: 'free_tier',
            active: true,
            name: 'Free Forever',
            description: 'The essentials to get started',
            role: 'free',
            images: [],
            metadata: { role: 'free' },
            prices: [{
                id: 'free_price',
                active: true,
                currency: 'usd',
                unit_amount: 0,
                description: 'Free forever',
                type: 'recurring',
                interval: 'year',
                interval_count: 1,
                trial_period_days: null,
                recurring: { interval: 'forever' }
            }]
        } as StripeProduct;

        component.isOnboarding = true;
        component.currentRole = null;
        component.isLoadingRole = false;
        component.isLoading = true;
        component.products$ = of([freeProduct]);

        fixture.detectChanges();

        const continueForFreeButton = fixture.nativeElement.querySelector('button.continue-free-button') as HTMLButtonElement | null;

        expect(continueForFreeButton).toBeTruthy();
        expect(continueForFreeButton?.disabled).toBe(true);
        expect(continueForFreeButton?.querySelector('mat-spinner')).toBeTruthy();
        expect(continueForFreeButton?.textContent).not.toContain('Continue for Free');
    });

    it('should call selectFreeTier when the onboarding Continue for Free CTA is clicked', async () => {
        const paymentService = TestBed.inject(AppPaymentService);
        const userService = TestBed.inject(AppUserService);
        const recurringPaidProduct: StripeProduct = {
            id: 'prod_basic',
            active: true,
            name: 'Basic',
            description: 'Basic plan',
            role: 'basic',
            images: [],
            metadata: { role: 'basic' },
            prices: [{
                id: 'price_basic',
                active: true,
                currency: 'usd',
                unit_amount: 1000,
                description: 'Monthly basic',
                type: 'recurring',
                interval: 'month',
                interval_count: 1,
                trial_period_days: null,
                recurring: { interval: 'month' }
            }]
        };

        component.isOnboarding = true;
        vi.spyOn(userService, 'getSubscriptionRole').mockResolvedValue(null);
        vi.spyOn(paymentService, 'getProducts').mockReturnValue(of([recurringPaidProduct]));
        vi.spyOn(paymentService, 'hasPaidSubscriptionHistory').mockResolvedValue(false);
        const selectFreeTierSpy = vi.spyOn(component, 'selectFreeTier').mockResolvedValue(undefined);

        await component.ngOnInit();
        fixture.detectChanges();

        const continueForFreeButton = fixture.debugElement
            .queryAll(By.css('button'))
            .map(button => button.nativeElement as HTMLButtonElement)
            .find(button => button.textContent?.includes('Continue for Free'));

        continueForFreeButton?.click();
        await fixture.whenStable();

        expect(selectFreeTierSpy).toHaveBeenCalled();
    });

    it('should keep showing the disabled Current Plan button outside onboarding when the role is null', async () => {
        const paymentService = TestBed.inject(AppPaymentService);
        const userService = TestBed.inject(AppUserService);
        const recurringPaidProduct: StripeProduct = {
            id: 'prod_basic',
            active: true,
            name: 'Basic',
            description: 'Basic plan',
            role: 'basic',
            images: [],
            metadata: { role: 'basic' },
            prices: [{
                id: 'price_basic',
                active: true,
                currency: 'usd',
                unit_amount: 1000,
                description: 'Monthly basic',
                type: 'recurring',
                interval: 'month',
                interval_count: 1,
                trial_period_days: null,
                recurring: { interval: 'month' }
            }]
        };

        component.isOnboarding = false;
        vi.spyOn(userService, 'getSubscriptionRole').mockResolvedValue(null);
        vi.spyOn(paymentService, 'getProducts').mockReturnValue(of([recurringPaidProduct]));
        vi.spyOn(paymentService, 'hasPaidSubscriptionHistory').mockResolvedValue(false);

        await component.ngOnInit();
        fixture.detectChanges();

        const currentPlanButton = fixture.nativeElement.querySelector('button.current-plan-button') as HTMLButtonElement | null;

        expect(currentPlanButton).toBeTruthy();
        expect(currentPlanButton?.disabled).toBe(true);
        expect(currentPlanButton?.textContent).toContain('Current Plan');
        expect(fixture.nativeElement.textContent).not.toContain('Continue for Free');
    });

    it('should render pro subscription details inside manage container', async () => {
        const paymentService = TestBed.inject(AppPaymentService);
        const userService = TestBed.inject(AppUserService);
        const subscription: StripeSubscription = {
            id: 'sub_123',
            status: 'active',
            current_period_end: new Date('2026-01-01T00:00:00Z'),
            current_period_start: new Date('2025-01-01T00:00:00Z'),
            cancel_at_period_end: false
        };
        (subscription as any).items = {
            data: [{
                price: {
                    unit_amount: 1200,
                    currency: 'usd'
                }
            }]
        };

        vi.spyOn(userService, 'getSubscriptionRole').mockResolvedValue('pro');
        vi.spyOn(paymentService, 'getUserSubscriptions').mockReturnValue(of([subscription]));

        await component.ngOnInit();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const content = fixture.nativeElement.textContent as string;
        expect(content).toContain('Pro Membership');
        expect(content).toContain('Renews on');
        expect(content).toContain('Manage Subscription');
        expect(content).toContain('Next renewal');
        expect(content).toContain('Amount unavailable');
    });

    it('should render basic subscription details inside manage container', async () => {
        const paymentService = TestBed.inject(AppPaymentService);
        const userService = TestBed.inject(AppUserService);
        const subscription: StripeSubscription = {
            id: 'sub_trial',
            status: 'trialing',
            current_period_end: { seconds: 1767225600, nanoseconds: 0 },
            current_period_start: { seconds: 1735689600, nanoseconds: 0 },
            cancel_at_period_end: true
        };

        vi.spyOn(userService, 'getSubscriptionRole').mockResolvedValue('basic');
        vi.spyOn(paymentService, 'getUserSubscriptions').mockReturnValue(of([subscription]));

        await component.ngOnInit();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const content = fixture.nativeElement.textContent as string;
        expect(content).toContain('Basic Membership');
        expect(content).toContain('Trialing');
        expect(content).toContain('Ends on');
        expect(content).toContain('Ends at period end');
        expect(content).toContain('Amount unavailable');
    });

    it('should render Calculating… while renewal callable is pending, then render exact amount', async () => {
        const paymentService = TestBed.inject(AppPaymentService);
        const userService = TestBed.inject(AppUserService);
        let resolveRenewalAmount: ((value: UpcomingRenewalAmountResult) => void) | null = null;
        const renewalPromise = new Promise<UpcomingRenewalAmountResult>((resolve) => {
            resolveRenewalAmount = resolve;
        });
        const subscription: StripeSubscription = {
            id: 'sub_invoice',
            status: 'active',
            current_period_end: new Date('2026-02-01T00:00:00Z'),
            current_period_start: new Date('2026-01-01T00:00:00Z'),
            cancel_at_period_end: false
        };

        vi.spyOn(userService, 'getSubscriptionRole').mockResolvedValue('pro');
        vi.spyOn(paymentService, 'getUserSubscriptions').mockReturnValue(of([subscription]));
        vi.spyOn(paymentService, 'getUpcomingRenewalAmount').mockReturnValue(renewalPromise);

        await component.ngOnInit();
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent as string).toContain('Calculating…');

        resolveRenewalAmount?.({
            status: 'ready',
            amountMinor: 2000,
            currency: 'USD'
        });
        await fixture.whenStable();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent as string).toContain('$20');
    });

    it('should render No upcoming charge when callable returns no_upcoming_charge', async () => {
        const paymentService = TestBed.inject(AppPaymentService);
        const userService = TestBed.inject(AppUserService);
        const subscription: StripeSubscription = {
            id: 'sub_discounted',
            status: 'active',
            current_period_end: new Date('2026-02-01T00:00:00Z'),
            current_period_start: new Date('2026-01-01T00:00:00Z'),
            cancel_at_period_end: false
        };
        vi.spyOn(userService, 'getSubscriptionRole').mockResolvedValue('pro');
        vi.spyOn(paymentService, 'getUserSubscriptions').mockReturnValue(of([subscription]));
        vi.spyOn(paymentService, 'getUpcomingRenewalAmount').mockResolvedValue({ status: 'no_upcoming_charge' });

        await component.ngOnInit();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const content = fixture.nativeElement.textContent as string;
        expect(content).toContain('No upcoming charge');
    });

    it('should render Amount unavailable when callable returns unavailable', async () => {
        const paymentService = TestBed.inject(AppPaymentService);
        const userService = TestBed.inject(AppUserService);
        const subscription: StripeSubscription = {
            id: 'sub_unavailable',
            status: 'active',
            current_period_end: new Date('2026-02-01T00:00:00Z'),
            current_period_start: new Date('2026-01-01T00:00:00Z'),
            cancel_at_period_end: false
        };
        vi.spyOn(userService, 'getSubscriptionRole').mockResolvedValue('pro');
        vi.spyOn(paymentService, 'getUserSubscriptions').mockReturnValue(of([subscription]));
        vi.spyOn(paymentService, 'getUpcomingRenewalAmount').mockResolvedValue({ status: 'unavailable' });

        await component.ngOnInit();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent as string).toContain('Amount unavailable');
    });

    it('should ignore stale renewal result after subscriptions become empty', async () => {
        const paymentService = TestBed.inject(AppPaymentService);
        const userService = TestBed.inject(AppUserService);
        let resolveRenewalAmount: ((value: UpcomingRenewalAmountResult) => void) | null = null;
        const renewalPromise = new Promise<UpcomingRenewalAmountResult>((resolve) => {
            resolveRenewalAmount = resolve;
        });
        const subscriptions$ = new Subject<StripeSubscription[]>();

        vi.spyOn(userService, 'getSubscriptionRole').mockResolvedValue('pro');
        vi.spyOn(paymentService, 'getUserSubscriptions').mockReturnValue(subscriptions$.asObservable());
        vi.spyOn(paymentService, 'getUpcomingRenewalAmount').mockReturnValue(renewalPromise);

        await component.ngOnInit();
        subscriptions$.next([{
            id: 'sub_pending',
            status: 'active',
            current_period_end: new Date('2026-06-15T12:00:00Z'),
            current_period_start: new Date('2026-05-15T12:00:00Z'),
            cancel_at_period_end: false
        }]);
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent as string).toContain('Calculating…');

        subscriptions$.next([]);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent as string).toContain('Subscription details are syncing. Refresh in a moment.');

        resolveRenewalAmount?.({
            status: 'ready',
            amountMinor: 2500,
            currency: 'USD'
        });
        await fixture.whenStable();
        fixture.detectChanges();

        const content = fixture.nativeElement.textContent as string;
        expect(content).toContain('Subscription details are syncing. Refresh in a moment.');
        expect(content).not.toContain('$25');
    });

    it('should select summary using latest created timestamp before period-end fallback', async () => {
        const paymentService = TestBed.inject(AppPaymentService);
        const userService = TestBed.inject(AppUserService);

        vi.spyOn(userService, 'getSubscriptionRole').mockResolvedValue('pro');
        vi.spyOn(paymentService, 'getUserSubscriptions').mockReturnValue(of([
            {
                id: 'sub_older_created_later_period',
                status: 'active',
                created: new Date('2026-01-01T12:00:00Z'),
                current_period_end: new Date('2026-12-31T12:00:00Z'),
                current_period_start: new Date('2026-12-01T12:00:00Z'),
                cancel_at_period_end: false
            },
            {
                id: 'sub_newer_created_earlier_period',
                status: 'active',
                created: new Date('2026-02-01T12:00:00Z'),
                current_period_end: new Date('2026-06-15T12:00:00Z'),
                current_period_start: new Date('2026-05-15T12:00:00Z'),
                cancel_at_period_end: false
            }
        ] as StripeSubscription[]));
        vi.spyOn(paymentService, 'getUpcomingRenewalAmount').mockResolvedValue({
            status: 'ready',
            amountMinor: 2000,
            currency: 'USD'
        });

        await component.ngOnInit();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const content = fixture.nativeElement.textContent as string;
        expect(content).toContain('Jun 15, 2026');
        expect(content).not.toContain('Dec 31, 2026');
    });

    it('should use latest period end when created timestamps are tied', async () => {
        const paymentService = TestBed.inject(AppPaymentService);
        const userService = TestBed.inject(AppUserService);

        vi.spyOn(userService, 'getSubscriptionRole').mockResolvedValue('pro');
        vi.spyOn(paymentService, 'getUserSubscriptions').mockReturnValue(of([
            {
                id: 'sub_lower_period',
                status: 'active',
                created: new Date('2026-02-01T12:00:00Z'),
                current_period_end: new Date('2026-06-01T12:00:00Z'),
                current_period_start: new Date('2026-05-01T12:00:00Z'),
                cancel_at_period_end: false
            },
            {
                id: 'sub_higher_period',
                status: 'active',
                created: new Date('2026-02-01T12:00:00Z'),
                current_period_end: new Date('2026-07-01T12:00:00Z'),
                current_period_start: new Date('2026-06-01T12:00:00Z'),
                cancel_at_period_end: false
            }
        ] as StripeSubscription[]));
        vi.spyOn(paymentService, 'getUpcomingRenewalAmount').mockResolvedValue({
            status: 'ready',
            amountMinor: 2000,
            currency: 'USD'
        });

        await component.ngOnInit();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const content = fixture.nativeElement.textContent as string;
        expect(content).toContain('Jul 1, 2026');
        expect(content).not.toContain('Jun 1, 2026');
    });

});
