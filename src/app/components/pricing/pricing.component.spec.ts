import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PricingComponent } from './pricing.component';
import { AppUserService } from '../../services/app.user.service';
import { AppPaymentService, StripePrice, StripeProduct, StripeSubscription } from '../../services/app.payment.service';
import { AppAuthService } from '../../authentication/app.auth.service';
import { of } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import { Analytics } from '@angular/fire/analytics';
import { Router } from '@angular/router';

import { AppAnalyticsService } from '../../services/app.analytics.service';
import { USAGE_LIMITS } from '../../../../functions/src/shared/limits';

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

        vi.spyOn(userService, 'getSubscriptionRole').mockResolvedValue('pro');
        vi.spyOn(paymentService, 'getUserSubscriptions').mockReturnValue(of([subscription]));

        await component.ngOnInit();
        fixture.detectChanges();

        const content = fixture.nativeElement.textContent as string;
        expect(content).toContain('Pro Membership');
        expect(content).toContain('Renews on');
        expect(content).toContain('Manage Subscription');
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

        const content = fixture.nativeElement.textContent as string;
        expect(content).toContain('Basic Membership');
        expect(content).toContain('Trialing');
        expect(content).toContain('Ends on');
        expect(content).toContain('Ends at period end');
    });

});
