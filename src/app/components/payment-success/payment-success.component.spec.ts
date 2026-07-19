import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaymentSuccessComponent } from './payment-success.component';
import { ActivatedRoute } from '@angular/router';
import { Auth } from 'app/firebase/auth';
import { of } from 'rxjs';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppPaymentService } from '../../services/app.payment.service';

describe('PaymentSuccessComponent', () => {
    let component: PaymentSuccessComponent;
    let fixture: ComponentFixture<PaymentSuccessComponent>;
    let analyticsService: { logSubscriptionStarted: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        analyticsService = {
            logSubscriptionStarted: vi.fn(),
        };
        await TestBed.configureTestingModule({
            imports: [PaymentSuccessComponent],
            providers: [
                {
                    provide: ActivatedRoute,
                    useValue: { queryParams: of({}) }
                },
                {
                    provide: Auth,
                    useValue: { currentUser: { uid: 'test-uid', getIdTokenResult: () => Promise.resolve({ claims: { stripeRole: 'pro' } }) } }
                },
                {
                    provide: AppPaymentService,
                    useValue: {
                        getUserSubscriptions: () => of([{ id: 'sub_123', role: 'pro', status: 'trialing' }]),
                    }
                },
                { provide: AppAnalyticsService, useValue: analyticsService },
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(PaymentSuccessComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should log the completed trial with the assigned paid plan', async () => {
        await fixture.whenStable();

        expect(analyticsService.logSubscriptionStarted).toHaveBeenCalledWith('sub_123', 'pro', 'trialing');
    });

    it('should use shared glass card styling conventions', () => {
        const card = fixture.nativeElement.querySelector('mat-card');
        expect(card).toBeTruthy();
        expect(card.classList.contains('qs-glass-card-panel')).toBe(true);
        expect(card.getAttribute('appearance')).toBe('outlined');
    });
});
