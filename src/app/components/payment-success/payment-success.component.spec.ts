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
                        queryParams: of({ session_id: 'cs_test_123' }),
                        snapshot: {
                            queryParamMap: convertToParamMap({ session_id: 'cs_test_123' })
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
            role: 'pro'
        });
    });
});
