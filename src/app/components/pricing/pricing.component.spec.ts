import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PricingComponent } from './pricing.component';
import { AppUserService } from '../../services/app.user.service';
import { AppPaymentService } from '../../services/app.payment.service';
import { AppAuthService } from '../../authentication/app.auth.service';
import { of } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import { Analytics } from '@angular/fire/analytics';
import { Router } from '@angular/router';

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
        return Promise.resolve();
    }
}

class MockAppUserService {
    getSubscriptionRole() {
        return Promise.resolve('free');
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
                { provide: AppAuthService, useValue: { user$: of(null) } },
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
                    useValue: {}
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
                title: 'Downgrade Warning',
                message: expect.stringContaining('30-day grace period')
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
});
