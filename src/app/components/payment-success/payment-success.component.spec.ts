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
    let analyticsServiceMock: { logPurchase: ReturnType<typeof vi.fn> };
    let loggerMock: { log: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        TestBed.resetTestingModule();
    });

    async function createComponent(options: {
        queryParams?: Record<string, string>;
        getIdTokenResult?: ReturnType<typeof vi.fn>;
    } = {}): Promise<void> {
        const queryParams = options.queryParams ?? {
            session_id: 'cs_test_123',
            checkout_mode: 'subscription',
        };
        const getIdTokenResult = options.getIdTokenResult
            ?? vi.fn().mockResolvedValue({ claims: { stripeRole: 'pro' } });

        analyticsServiceMock = {
            logPurchase: vi.fn(),
        };
        loggerMock = {
            log: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [PaymentSuccessComponent],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: {
                        queryParams: of(queryParams),
                        snapshot: {
                            queryParamMap: convertToParamMap(queryParams),
                        },
                    },
                },
                {
                    provide: Auth,
                    useValue: {
                        currentUser: {
                            uid: 'test-uid',
                            getIdTokenResult,
                        },
                    },
                },
                { provide: AppAnalyticsService, useValue: analyticsServiceMock },
                { provide: LoggerService, useValue: loggerMock },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(PaymentSuccessComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    }

    it('should create', async () => {
        await createComponent();

        expect(component).toBeTruthy();
    });

    it('should log subscription purchase analytics when paid stripeRole arrives', async () => {
        await createComponent();

        expect(analyticsServiceMock.logPurchase).toHaveBeenCalledTimes(1);
        expect(analyticsServiceMock.logPurchase).toHaveBeenCalledWith({
            transactionId: 'cs_test_123',
            role: 'pro',
            mode: 'subscription',
        });
        expect(component.assignedRole).toBe('pro');
        expect(component.isRefreshing).toBe(false);
    });

    it('should log payment-mode purchase analytics without waiting for stripeRole', async () => {
        const getIdTokenResult = vi.fn();

        await createComponent({
            queryParams: {
                session_id: 'cs_one_time_123',
                checkout_mode: 'payment',
            },
            getIdTokenResult,
        });

        expect(getIdTokenResult).not.toHaveBeenCalled();
        expect(analyticsServiceMock.logPurchase).toHaveBeenCalledTimes(1);
        expect(analyticsServiceMock.logPurchase).toHaveBeenCalledWith({
            transactionId: 'cs_one_time_123',
            role: null,
            mode: 'payment',
        });
        expect(component.isRefreshing).toBe(false);
    });

    it('should skip purchase analytics when checkout session id is missing', async () => {
        const getIdTokenResult = vi.fn();

        await createComponent({
            queryParams: {
                checkout_mode: 'payment',
            },
            getIdTokenResult,
        });

        expect(analyticsServiceMock.logPurchase).not.toHaveBeenCalled();
        expect(loggerMock.warn).toHaveBeenCalledWith('PaymentSuccess: Missing checkout session id; skipping purchase analytics.');
    });

    it('should not treat free role as paid payment success', async () => {
        await createComponent();

        expect((component as any).isPaidRole('free')).toBe(false);
        expect((component as any).isPaidRole('basic')).toBe(true);
    });
});
