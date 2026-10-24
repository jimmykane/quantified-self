import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PaymentSuccessComponent } from './payment-success.component';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Auth } from 'app/firebase/auth';
import { of } from 'rxjs';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppPaymentService } from '../../services/app.payment.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { LoggerService } from '../../services/logger.service';
import { ShellNavigationEffectsService } from '../../services/shell-navigation-effects.service';

@Component({ standalone: true, template: '<p>Destination</p>' })
class MembershipDestinationStub {}

describe('PaymentSuccessComponent', () => {
    let fixture: ComponentFixture<PaymentSuccessComponent>;
    let analyticsService: { logSubscriptionStarted: ReturnType<typeof vi.fn> };
    let paymentService: { getUserSubscriptions: ReturnType<typeof vi.fn> };
    let haptics: { selection: ReturnType<typeof vi.fn> };
    let authUser: { uid: string; getIdTokenResult: ReturnType<typeof vi.fn> };
    let auth: { currentUser: typeof authUser | null };
    let navigationAllowed: boolean;

    beforeEach(async () => {
        analyticsService = { logSubscriptionStarted: vi.fn() };
        paymentService = { getUserSubscriptions: vi.fn().mockReturnValue(of([
            { id: 'sub_123', role: 'pro', status: 'trialing' },
        ])) };
        haptics = { selection: vi.fn() };
        authUser = {
            uid: 'test-uid',
            getIdTokenResult: vi.fn().mockResolvedValue({ claims: { stripeRole: 'pro' } }),
        };
        auth = { currentUser: authUser };
        navigationAllowed = true;
        vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
        await TestBed.configureTestingModule({
            imports: [PaymentSuccessComponent],
            providers: [
                provideRouter([
                    { path: 'payment/success', component: PaymentSuccessComponent },
                    ...['services', 'subscriptions', 'dashboard', 'help'].map(path => ({
                        path, component: MembershipDestinationStub, canActivate: [() => navigationAllowed],
                    })),
                ]),
                { provide: Auth, useValue: auth },
                { provide: AppPaymentService, useValue: paymentService },
                { provide: AppAnalyticsService, useValue: analyticsService },
                { provide: AppHapticsService, useValue: haptics },
                { provide: LoggerService, useValue: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } },
            ],
        }).compileComponents();
    });

    afterEach(() => { vi.useRealTimers(); });

    function render(): void {
        fixture = TestBed.createComponent(PaymentSuccessComponent);
        fixture.detectChanges();
    }

    async function settle(): Promise<void> {
        await fixture.whenStable();
        fixture.detectChanges();
    }

    it('shows pending verification without a success claim or enabled primary action', () => {
        render();
        const primary = fixture.nativeElement.querySelector('button[mat-flat-button]') as HTMLButtonElement;
        expect(fixture.nativeElement.textContent).toContain('Confirming your membership');
        expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('Checking your plan access');
        expect(primary.disabled).toBe(true);
        expect(fixture.nativeElement.querySelector('.checkmark')).toBeNull();
        expect(fixture.nativeElement.textContent).not.toContain('Payment Successful');
        expect(haptics.selection).not.toHaveBeenCalled();
    });

    it('offers confirmed Pro members a direct connection step and membership management', async () => {
        render();
        await settle();
        expect(fixture.componentInstance.assignedRole).toBe('pro');
        expect(fixture.nativeElement.textContent).toContain('Welcome to Pro!');
        expect(fixture.nativeElement.textContent).toContain('review its permissions in Connections');
        expect(fixture.nativeElement.textContent).toContain('trial dates, renewal terms, and invoices');
        expect(fixture.nativeElement.querySelector('.checkmark')).toBeTruthy();
        const buttons = fixture.nativeElement.querySelectorAll('mat-card-actions button');
        expect(buttons[0].textContent).toContain('Connect your devices');
        expect(buttons[1].textContent).toContain('Manage membership');
        expect(fixture.nativeElement.textContent).not.toContain('purchase');
        expect(haptics.selection).not.toHaveBeenCalled();
    });

    it('preserves the existing completed-trial event', async () => {
        render();
        await settle();
        await vi.waitFor(() => expect(analyticsService.logSubscriptionStarted)
            .toHaveBeenCalledExactlyOnceWith('sub_123', 'pro', 'trialing'));
    });

    it.each([undefined, 'free', 'unknown', { role: 'pro' }])('waits past a non-paid claim (%j) for Pro access', async role => {
        vi.useFakeTimers();
        authUser.getIdTokenResult.mockResolvedValueOnce({ claims: { stripeRole: role } });
        render();
        await vi.advanceTimersByTimeAsync(0);
        fixture.detectChanges();
        expect(authUser.getIdTokenResult).toHaveBeenCalledExactlyOnceWith(true);
        expect(fixture.componentInstance.assignedRole).toBeNull();
        expect(fixture.nativeElement.textContent).toContain('Confirming your membership');
        expect(paymentService.getUserSubscriptions).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(2000);
        fixture.detectChanges();
        expect(authUser.getIdTokenResult).toHaveBeenCalledTimes(2);
        expect(fixture.nativeElement.textContent).toContain('Welcome to Pro!');
    });

    it('recovers from a token-refresh failure and gives Basic members a Dashboard action', async () => {
        vi.useFakeTimers();
        authUser.getIdTokenResult.mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue({ claims: { stripeRole: 'basic' } });
        paymentService.getUserSubscriptions.mockReturnValue(of([{ id: 'sub_basic', role: 'basic', status: 'active' }]));
        render();
        await vi.advanceTimersByTimeAsync(0);
        expect(authUser.getIdTokenResult).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(2000);
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Welcome to Basic!');
        expect(fixture.nativeElement.querySelector('button[mat-flat-button]').textContent).toContain('Go to Dashboard');
        expect(fixture.nativeElement.textContent).not.toContain('Connect your devices');
    });

    it('stops after ten unconfirmed checks and offers recovery without asserting payment success', async () => {
        vi.useFakeTimers();
        authUser.getIdTokenResult.mockResolvedValue({ claims: { stripeRole: 'free' } });
        render();
        await vi.advanceTimersByTimeAsync(18_000);
        fixture.detectChanges();
        expect(authUser.getIdTokenResult).toHaveBeenCalledTimes(10);
        expect(fixture.nativeElement.textContent).toContain('Membership still syncing');
        expect(fixture.nativeElement.textContent).toContain('before starting another checkout');
        expect(fixture.nativeElement.querySelector('button[mat-flat-button]').disabled).toBe(false);
        expect(fixture.nativeElement.querySelector('.checkmark')).toBeNull();
        expect(fixture.nativeElement.textContent).not.toMatch(/Successful|Welcome|purchase/);
        expect(paymentService.getUserSubscriptions).not.toHaveBeenCalled();
        expect(haptics.selection).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(authUser.getIdTokenResult).toHaveBeenCalledTimes(10);
    });

    it('shows recovery when no current account is available', async () => {
        auth.currentUser = null;
        render();
        await settle();
        expect(fixture.nativeElement.textContent).toContain('Membership still syncing');
        expect(authUser.getIdTokenResult).not.toHaveBeenCalled();
        expect(fixture.nativeElement.querySelector('.checkmark')).toBeNull();
    });

    it.each(['account changed', 'page destroyed'])('ignores a late claim when the %s', async scenario => {
        let resolveToken!: (value: { claims: { stripeRole: string } }) => void;
        authUser.getIdTokenResult.mockReturnValue(new Promise(resolve => { resolveToken = resolve; }));
        render();
        if (scenario === 'account changed') {
            auth.currentUser = { ...authUser, uid: 'other-uid' };
        } else {
            fixture.destroy();
        }
        resolveToken({ claims: { stripeRole: 'pro' } });
        await fixture.whenStable();
        expect(fixture.componentInstance.assignedRole).toBeNull();
        expect(paymentService.getUserSubscriptions).not.toHaveBeenCalled();
    });

    it('stops polling when the page is destroyed during the wait', async () => {
        vi.useFakeTimers();
        authUser.getIdTokenResult.mockResolvedValue({ claims: { stripeRole: 'free' } });
        render();
        await vi.advanceTimersByTimeAsync(0);
        fixture.destroy();
        await vi.advanceTimersByTimeAsync(2000);
        expect(authUser.getIdTokenResult).toHaveBeenCalledTimes(1);
        expect(paymentService.getUserSubscriptions).not.toHaveBeenCalled();
    });

    it('uses the shared workspace and glass-card styling', () => {
        render();
        const card = fixture.nativeElement.querySelector('mat-card');
        expect(fixture.nativeElement.querySelector('main.qs-workspace-page')).toBeTruthy();
        expect(card.classList.contains('qs-glass-card-panel')).toBe(true);
        expect(card.getAttribute('appearance')).toBe('outlined');
    });

    it.each([
        { role: 'pro', action: 0, destination: '/services' },
        { role: 'pro', action: 1, destination: '/subscriptions' },
        { role: 'basic', action: 0, destination: '/dashboard' },
        { role: 'basic', action: 1, destination: '/subscriptions' },
        { role: null, action: 0, destination: '/subscriptions' },
        { role: null, action: 1, destination: '/help#plans-and-billing' },
    ])('navigates $role action $action to $destination with one shell-owned haptic', async ({ role, action, destination }) => {
        if (role === null) {
            auth.currentUser = null;
        } else {
            authUser.getIdTokenResult.mockResolvedValue({ claims: { stripeRole: role } });
            paymentService.getUserSubscriptions.mockReturnValue(of([{ id: 'sub_ready', role, status: 'active' }]));
        }
        TestBed.inject(ShellNavigationEffectsService);
        const harness = await RouterTestingHarness.create('/payment/success');
        await harness.fixture.whenStable();
        harness.detectChanges();
        expect(haptics.selection).not.toHaveBeenCalled();
        harness.routeNativeElement!.querySelectorAll<HTMLButtonElement>('mat-card-actions button')[action].click();
        await harness.fixture.whenStable();
        expect(TestBed.inject(Router).url).toBe(destination);
        expect(haptics.selection).toHaveBeenCalledTimes(1);
    });

    it('does not emit feedback when connection navigation is canceled', async () => {
        TestBed.inject(ShellNavigationEffectsService);
        const harness = await RouterTestingHarness.create('/payment/success');
        await harness.fixture.whenStable();
        harness.detectChanges();
        navigationAllowed = false;
        harness.routeNativeElement!.querySelector<HTMLButtonElement>('button[mat-flat-button]')!.click();
        await harness.fixture.whenStable();
        expect(TestBed.inject(Router).url).toBe('/payment/success');
        expect(haptics.selection).not.toHaveBeenCalled();
    });
});
