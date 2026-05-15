import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaymentSuccessComponent } from './payment-success.component';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { Auth } from 'app/firebase/auth';
import { of } from 'rxjs';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { LoggerService } from '../../services/logger.service';
import { AppFunctionsService } from '../../services/app.functions.service';

describe('PaymentSuccessComponent', () => {
    let component: PaymentSuccessComponent;
    let fixture: ComponentFixture<PaymentSuccessComponent>;
    let analyticsServiceMock: { logPurchaseOnce: ReturnType<typeof vi.fn> };
    let functionsServiceMock: { call: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        analyticsServiceMock = {
            logPurchaseOnce: vi.fn()
        };
        functionsServiceMock = {
            call: vi.fn().mockResolvedValue({
                data: {
                    verified: true,
                    transactionId: 'cs_test_123',
                    mode: 'subscription',
                    isTrialCheckout: false,
                    priceId: 'price_pro_monthly',
                    currency: 'EUR',
                    value: 9.99,
                    role: 'pro',
                }
            })
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
                { provide: AppFunctionsService, useValue: functionsServiceMock },
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
        expect(functionsServiceMock.call).toHaveBeenCalledWith('verifyCheckoutSession', {
            sessionId: 'cs_test_123'
        });
        expect(analyticsServiceMock.logPurchaseOnce).toHaveBeenCalledTimes(1);
        expect(analyticsServiceMock.logPurchaseOnce).toHaveBeenCalledWith({
            transactionId: 'cs_test_123',
            role: 'pro',
            contextId: 'purchase_ctx_123',
            isTrialCheckout: false,
            mode: 'subscription',
            priceId: 'price_pro_monthly',
            currency: 'EUR',
            value: 9.99,
            isVerifiedCheckout: true
        });
    });

    it('should not treat a free role as paid payment success', () => {
        expect((component as any).isPaidRole('free')).toBe(false);
        expect((component as any).isPaidRole('basic')).toBe(true);
    });

    it('should log the verified subscription purchase even when paid claims never arrive', async () => {
        const analyticsServiceMock = {
            logPurchaseOnce: vi.fn()
        };
        const functionsServiceMock = {
            call: vi.fn().mockResolvedValue({
                data: {
                    verified: true,
                    transactionId: 'cs_slow_claims_123',
                    mode: 'subscription',
                    isTrialCheckout: false,
                    priceId: 'price_pro_yearly',
                    currency: 'EUR',
                    value: 99,
                    role: 'pro',
                }
            })
        };
        const getIdTokenResult = vi.fn().mockResolvedValue({ claims: {} });
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler: TimerHandler) => {
            if (typeof handler === 'function') {
                handler();
            }

            return 0 as unknown as ReturnType<typeof setTimeout>;
        });

        try {
            TestBed.resetTestingModule();
            await TestBed.configureTestingModule({
                imports: [PaymentSuccessComponent],
                providers: [
                    {
                        provide: ActivatedRoute,
                        useValue: {
                            queryParams: of({
                                session_id: 'cs_slow_claims_123',
                                purchase_context_id: 'purchase_ctx_slow_claims'
                            }),
                            snapshot: {
                                queryParamMap: convertToParamMap({
                                    session_id: 'cs_slow_claims_123',
                                    purchase_context_id: 'purchase_ctx_slow_claims'
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
                    { provide: AppFunctionsService, useValue: functionsServiceMock },
                    { provide: LoggerService, useValue: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } }
                ]
            }).compileComponents();

            const fixture = TestBed.createComponent(PaymentSuccessComponent);
            fixture.detectChanges();
            await fixture.whenStable();
            for (let i = 0; i < 25; i++) {
                await Promise.resolve();
            }

            expect(functionsServiceMock.call).toHaveBeenCalledWith('verifyCheckoutSession', {
                sessionId: 'cs_slow_claims_123'
            });
            expect(getIdTokenResult).toHaveBeenCalledTimes(10);
            expect(analyticsServiceMock.logPurchaseOnce).toHaveBeenCalledTimes(1);
            expect(analyticsServiceMock.logPurchaseOnce).toHaveBeenCalledWith({
                transactionId: 'cs_slow_claims_123',
                role: 'pro',
                contextId: 'purchase_ctx_slow_claims',
                isTrialCheckout: false,
                mode: 'subscription',
                priceId: 'price_pro_yearly',
                currency: 'EUR',
                value: 99,
                isVerifiedCheckout: true
            });
        } finally {
            setTimeoutSpy.mockRestore();
        }
    });
});

describe('PaymentSuccessComponent payment-mode checkout', () => {
    it('should log purchase analytics without waiting for stripeRole', async () => {
        const analyticsServiceMock = {
            logPurchaseOnce: vi.fn()
        };
        const functionsServiceMock = {
            call: vi.fn().mockResolvedValue({
                data: {
                    verified: true,
                    transactionId: 'cs_one_time_123',
                    mode: 'payment',
                    isTrialCheckout: false,
                    priceId: 'price_lifetime',
                    currency: 'EUR',
                    value: 49,
                    role: null,
                }
            })
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
                { provide: AppFunctionsService, useValue: functionsServiceMock },
                { provide: LoggerService, useValue: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } }
            ]
        }).compileComponents();

        const fixture = TestBed.createComponent(PaymentSuccessComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        await Promise.resolve();

        expect(getIdTokenResult).not.toHaveBeenCalled();
        expect(functionsServiceMock.call).toHaveBeenCalledWith('verifyCheckoutSession', {
            sessionId: 'cs_one_time_123'
        });
        expect(analyticsServiceMock.logPurchaseOnce).toHaveBeenCalledWith({
            transactionId: 'cs_one_time_123',
            role: null,
            contextId: 'purchase_ctx_one_time',
            isTrialCheckout: false,
            mode: 'payment',
            priceId: 'price_lifetime',
            currency: 'EUR',
            value: 49,
            isVerifiedCheckout: true
        });
    });

    it('should not log purchase analytics when checkout session verification fails', async () => {
        const analyticsServiceMock = {
            logPurchaseOnce: vi.fn()
        };
        const functionsServiceMock = {
            call: vi.fn().mockRejectedValue(new Error('forged session'))
        };

        TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
            imports: [PaymentSuccessComponent],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {
                        queryParams: of({
                            session_id: 'cs_forged_123',
                            trial_checkout: '0',
                            checkout_mode: 'payment'
                        }),
                        snapshot: {
                            queryParamMap: convertToParamMap({
                                session_id: 'cs_forged_123',
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
                            getIdTokenResult: vi.fn()
                        }
                    }
                },
                { provide: AppAnalyticsService, useValue: analyticsServiceMock },
                { provide: AppFunctionsService, useValue: functionsServiceMock },
                { provide: LoggerService, useValue: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } }
            ]
        }).compileComponents();

        const fixture = TestBed.createComponent(PaymentSuccessComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        await Promise.resolve();
        fixture.detectChanges();

        expect(functionsServiceMock.call).toHaveBeenCalledWith('verifyCheckoutSession', {
            sessionId: 'cs_forged_123'
        });
        expect(analyticsServiceMock.logPurchaseOnce).not.toHaveBeenCalled();
        const renderedText = fixture.nativeElement.textContent;
        expect(renderedText).toContain('Payment Verification Failed');
        expect(renderedText).toContain('Payment could not be verified');
        expect(renderedText).toContain('Back to Pricing');
        expect(renderedText).not.toContain('Purchase Successful!');
    });
});
