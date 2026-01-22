import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PricingComponent } from './pricing.component';
import { AppUserService } from '../../services/app.user.service';
import { AppPaymentService } from '../../services/app.payment.service';
import { AppAuthService } from '../../authentication/app.auth.service';
import { of } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import { Analytics } from '@angular/fire/analytics';
import { Router } from '@angular/router';

import { AppAnalyticsService } from '../../services/app.analytics.service';

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
}

class MockAppUserService {
    getSubscriptionRole() {
        return Promise.resolve('free');
    }
    getUserByID() {
        return of({});
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



    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [PricingComponent],
            providers: [
                { provide: AppPaymentService, useClass: MockAppPaymentService },
                { provide: AppUserService, useClass: MockAppUserService },
                {
                    provide: AppAuthService,
                    useValue: {
                        user$: of(null),
                        currentUser: { uid: 'test-uid' }
                    }
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
                        logEvent: vi.fn()
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
        const logSpy = vi.spyOn(analyticsService, 'logEvent');
        const price = { id: 'price_123', currency: 'USD', unit_amount: 1000 };

        await component.subscribe(price);

        expect(logSpy).toHaveBeenCalledWith('begin_checkout', {
            price_id: 'price_123',
            currency: 'USD',
            value: 10
        });
    });

    it('should log select_freetier event on selectFreeTier', async () => {
        const analyticsService = TestBed.inject(AppAnalyticsService);
        const logSpy = vi.spyOn(analyticsService, 'logEvent');
        // Mock user existing
        const userService = TestBed.inject(AppUserService);
        vi.spyOn(userService, 'getUserByID').mockReturnValue(of({ uid: 'test-uid' } as any));

        await component.selectFreeTier();

        expect(logSpy).toHaveBeenCalledWith('select_freetier');
    });

    it('should log manage_subscription event on manageSubscription', async () => {
        const analyticsService = TestBed.inject(AppAnalyticsService);
        const logSpy = vi.spyOn(analyticsService, 'logEvent');

        await component.manageSubscription();

        expect(logSpy).toHaveBeenCalledWith('manage_subscription');
    });

    it('should log restore_purchases events on restorePurchases', async () => {
        const analyticsService = TestBed.inject(AppAnalyticsService);
        const logSpy = vi.spyOn(analyticsService, 'logEvent');
        const paymentService = TestBed.inject(AppPaymentService);
        vi.spyOn(paymentService, 'restorePurchases').mockResolvedValue('pro');

        await component.restorePurchases();

        expect(logSpy).toHaveBeenCalledWith('restore_purchases', { status: 'initiated' });
        expect(logSpy).toHaveBeenCalledWith('restore_purchases', { status: 'success', role: 'pro' });
    });

});
