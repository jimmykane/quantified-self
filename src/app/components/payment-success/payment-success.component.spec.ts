import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaymentSuccessComponent } from './payment-success.component';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { Auth } from 'app/firebase/auth';
import { of } from 'rxjs';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { LoggerService } from '../../services/logger.service';

describe('PaymentSuccessComponent', () => {
    let component: PaymentSuccessComponent;
    let fixture: ComponentFixture<PaymentSuccessComponent>;
    let analyticsServiceMock: { logPurchaseOnce: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        analyticsServiceMock = {
            logPurchaseOnce: vi.fn()
        };

        await TestBed.configureTestingModule({
            imports: [PaymentSuccessComponent],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {
                        queryParams: of({ session_id: 'cs_test_123', purchase_context_id: 'purchase_ctx_123', trial_checkout: '0' }),
                        snapshot: {
                            queryParamMap: convertToParamMap({
                                session_id: 'cs_test_123',
                                purchase_context_id: 'purchase_ctx_123',
                                trial_checkout: '0'
                            })
                        }
                    }
                },
                {
                    provide: Auth,
                    useValue: {
                        currentUser: {
                            uid: 'test-uid',
                            getIdTokenResult: vi.fn().mockResolvedValue({ claims: { stripeRole: 'pro' } })
                        }
                    }
                },
                { provide: AppAnalyticsService, useValue: analyticsServiceMock },
                { provide: LoggerService, useValue: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(PaymentSuccessComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should use shared glass card styling conventions', () => {
        const card = fixture.nativeElement.querySelector('mat-card');
        expect(card).toBeTruthy();
        expect(card.classList.contains('qs-glass-card-panel')).toBe(true);
        expect(card.getAttribute('appearance')).toBe('outlined');
    });

    it('should log purchase analytics with the Stripe Checkout session id', () => {
        expect(analyticsServiceMock.logPurchaseOnce).toHaveBeenCalledWith({
            transactionId: 'cs_test_123',
            role: 'pro',
            contextId: 'purchase_ctx_123',
            isTrialCheckout: false,
            mode: 'subscription'
        });
    });

    it('should not treat a free role as paid payment success', () => {
        expect((component as any).isPaidRole('free')).toBe(false);
        expect((component as any).isPaidRole('basic')).toBe(true);
    });
});

describe('PaymentSuccessComponent payment-mode checkout', () => {
    it('should log purchase analytics without waiting for stripeRole', async () => {
        const analyticsServiceMock = {
            logPurchaseOnce: vi.fn()
        };
        const getIdTokenResult = vi.fn().mockResolvedValue({ claims: {} });

        TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
            imports: [PaymentSuccessComponent],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {
                        queryParams: of({
                            session_id: 'cs_one_time_123',
                            purchase_context_id: 'purchase_ctx_one_time',
                            trial_checkout: '0',
                            checkout_mode: 'payment'
                        }),
                        snapshot: {
                            queryParamMap: convertToParamMap({
                                session_id: 'cs_one_time_123',
                                purchase_context_id: 'purchase_ctx_one_time',
                                trial_checkout: '0',
                                checkout_mode: 'payment'
                            })
                        }
                    }
                },
                {
                    provide: Auth,
                    useValue: {
                        currentUser: {
                            uid: 'test-uid',
                            getIdTokenResult
                        }
                    }
                },
                { provide: AppAnalyticsService, useValue: analyticsServiceMock },
                { provide: LoggerService, useValue: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } }
            ]
        }).compileComponents();

        const fixture = TestBed.createComponent(PaymentSuccessComponent);
        fixture.detectChanges();
        await fixture.whenStable();

        expect(getIdTokenResult).not.toHaveBeenCalled();
        expect(analyticsServiceMock.logPurchaseOnce).toHaveBeenCalledWith({
            transactionId: 'cs_one_time_123',
            role: null,
            contextId: 'purchase_ctx_one_time',
            isTrialCheckout: false,
            mode: 'payment'
        });
    });
});
