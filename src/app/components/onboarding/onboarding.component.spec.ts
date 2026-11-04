import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OnboardingComponent } from './onboarding.component';
import { AppUserService } from '../../services/app.user.service';
import { AppAuthService } from '../../authentication/app.auth.service';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { Auth } from 'app/firebase/auth';
import { LoggerService } from '../../services/logger.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppHapticsService } from '../../services/app.haptics.service';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Privacy } from '@sports-alliance/sports-lib';
import { Firestore } from 'app/firebase/firestore';
import { Functions } from 'app/firebase/functions';
import { AppPaymentService } from '../../services/app.payment.service';
import { MatDialog } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { PricingComponent } from '../pricing/pricing.component';
import { ShellNavigationEffectsService } from '../../services/shell-navigation-effects.service';

describe('OnboardingComponent', () => {
    let component: OnboardingComponent;
    let fixture: ComponentFixture<OnboardingComponent>;
    let mockUserService: any;
    let mockAuthService: any;
    let mockRouter: any;
    let mockLoggerService: any;
    let mockAnalyticsService: any;
    let mockPaymentService: any;
    let mockDialog: any;
    let navigationEffects: { scrollToTop: ReturnType<typeof vi.fn> };
    let routeSnapshot: { queryParamMap: ReturnType<typeof convertToParamMap> };
    let routeStub: { snapshot: typeof routeSnapshot; queryParamMap?: BehaviorSubject<ReturnType<typeof convertToParamMap>> };

    const mockUser = {
        uid: 'test-user-123',
        displayName: 'Test User',
        email: 'test@example.com',
        privacy: Privacy.Private,
        acceptedPrivacyPolicy: false,
        acceptedDataPolicy: false,
        acceptedTrackingPolicy: false,
        acceptedTos: false,
        acceptedMarketingPolicy: false,
        acceptedDiagnosticsPolicy: true,
        settings: {}
    };

    const setRequiredPoliciesAccepted = () => {
        component.termsFormGroup.get('acceptPrivacyPolicy')!.setValue(true);
        component.termsFormGroup.get('acceptDataPolicy')!.setValue(true);
        component.termsFormGroup.get('acceptTos')!.setValue(true);
    };

    beforeEach(async () => {
        routeSnapshot = { queryParamMap: convertToParamMap({}) };
        routeStub = { snapshot: routeSnapshot };
        mockUserService = {
            createOrUpdateUser: vi.fn().mockResolvedValue(undefined),
            isPro: vi.fn().mockResolvedValue(false),
            hasPaidAccess: vi.fn().mockResolvedValue(false),
            setFreeTier: vi.fn().mockResolvedValue(undefined),
            updateUserProperties: vi.fn().mockResolvedValue(undefined),
            getSubscriptionRole: vi.fn().mockResolvedValue(null)
        };

        mockAuthService = {
            user$: of(mockUser),
            currentUser: { uid: 'test-user-123' },
            signOut: vi.fn().mockResolvedValue(undefined)
        };

        mockRouter = {
            navigate: vi.fn().mockResolvedValue(true)
        };

        mockLoggerService = {
            log: vi.fn(),
            error: vi.fn()
        };

        mockAnalyticsService = {
            logEvent: vi.fn()
        };

        mockPaymentService = {
            getProducts: vi.fn().mockReturnValue(of([])),
            getUserSubscriptions: vi.fn().mockReturnValue(of([])),
            hasPaidSubscriptionHistory: vi.fn().mockResolvedValue(false)
        };

        mockDialog = {
            open: vi.fn()
        };
        navigationEffects = { scrollToTop: vi.fn() };

        await TestBed.configureTestingModule({
            imports: [
                OnboardingComponent,
                NoopAnimationsModule
            ],
            providers: [
                { provide: AppUserService, useValue: mockUserService },
                { provide: ShellNavigationEffectsService, useValue: navigationEffects },
                { provide: AppHapticsService, useValue: { selection: vi.fn(), success: vi.fn(), error: vi.fn() } },
                { provide: AppAuthService, useValue: mockAuthService },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: routeStub },
                { provide: LoggerService, useValue: mockLoggerService },
                { provide: AppAnalyticsService, useValue: mockAnalyticsService },
                { provide: AppPaymentService, useValue: mockPaymentService },
                { provide: MatDialog, useValue: mockDialog },
                { provide: Firestore, useValue: {} },
                { provide: Functions, useValue: {} },
                { provide: Auth, useValue: { currentUser: { uid: 'test-user-123' } } }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(OnboardingComponent);
        component = fixture.componentInstance;
        component.user = { ...mockUser } as any;
        fixture.detectChanges();
        await fixture.whenStable();

        vi.clearAllMocks();
    });

    it.each(['paid', 'free'])('uses the just-saved onboarding consent for the %s choice while the auth profile is stale', async choice => {
        const freshUser = { ...mockUser };
        const staleAuthUser = { ...mockUser };
        mockAuthService.user$ = of(staleAuthUser);
        mockPaymentService.getProducts.mockReturnValue(of([{
            id: 'prod_pro', name: 'Pro', role: 'pro', active: true, metadata: { role: 'pro' }, images: [],
            prices: [{ id: 'price_pro_monthly', active: true, currency: 'eur', unit_amount: 299,
                type: 'recurring', interval: 'month', interval_count: 1, recurring: { interval: 'month' } }],
        }]));
        mockPaymentService.appendCheckoutSession = vi.fn().mockResolvedValue(undefined);
        mockAnalyticsService.logBeginCheckout = vi.fn();
        mockAnalyticsService.logSelectFreeTier = vi.fn();
        const localFixture = TestBed.createComponent(OnboardingComponent);
        const local = localFixture.componentInstance;
        local.user = freshUser as unknown as typeof local.user;
        localFixture.detectChanges();
        await localFixture.whenStable();
        for (const name of ['acceptPrivacyPolicy', 'acceptDataPolicy', 'acceptTos']) {
            local.termsFormGroup.get(name)!.setValue(true);
        }
        await local.onTermsSubmit();
        localFixture.detectChanges();
        await localFixture.whenStable();
        expect(local.stepper.selectedIndex).toBe(1);
        expect(staleAuthUser.acceptedPrivacyPolicy).toBe(false);
        expect(mockPaymentService.appendCheckoutSession).not.toHaveBeenCalled();
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        const selector = choice === 'paid' ? '.pro-card .subscribe-btn' : '.continue-free-button';
        (localFixture.nativeElement.querySelector(selector) as HTMLButtonElement).click();
        await localFixture.whenStable();
        if (choice === 'paid') {
            expect(mockPaymentService.appendCheckoutSession).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'price_pro_monthly' }), undefined, undefined, expect.any(Function), expect.any(Function),
            );
            expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        } else {
            expect(mockUserService.setFreeTier).toHaveBeenCalledWith(freshUser);
            await vi.waitFor(() => expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']));
        }
        expect(mockLoggerService.error).not.toHaveBeenCalled();
        expect(freshUser.acceptedTrackingPolicy).toBe(false);
        expect(freshUser.acceptedMarketingPolicy).toBe(false);
    });

    it('resets scroll after advancing to Plan and returning to Legal consent', async () => {
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        fixture.detectChanges();
        await fixture.whenStable();
        expect(component.stepper.selectedIndex).toBe(1);
        expect(navigationEffects.scrollToTop).toHaveBeenCalledOnce();
        navigationEffects.scrollToTop.mockClear();

        component.onPricingLoadingChange(true);
        fixture.detectChanges();
        component.onPricingLoadingChange(false);
        fixture.detectChanges();
        await fixture.whenStable();
        expect(navigationEffects.scrollToTop).not.toHaveBeenCalled();

        const back = fixture.debugElement.query(By.css('button[matStepperPrevious]')).nativeElement as HTMLButtonElement;
        back.click();
        fixture.detectChanges();
        await fixture.whenStable();
        expect(component.stepper.selectedIndex).toBe(0);
        expect(navigationEffects.scrollToTop).toHaveBeenCalledOnce();
    });

    it('resets scroll on entry and when saved consent automatically advances to Plan', async () => {
        const localFixture = TestBed.createComponent(OnboardingComponent);
        localFixture.componentInstance.user = {
            ...mockUser, acceptedPrivacyPolicy: true, acceptedDataPolicy: true, acceptedTos: true,
        } as unknown as typeof component.user;
        localFixture.detectChanges();
        await localFixture.whenStable();

        await vi.waitFor(() => expect(localFixture.componentInstance.stepper.selectedIndex).toBe(1));
        expect(navigationEffects.scrollToTop).toHaveBeenCalledTimes(2);
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should initialize termsFormGroup with all policy controls', () => {
        expect(component.termsFormGroup).toBeTruthy();
        expect(component.termsFormGroup.get('acceptPrivacyPolicy')).toBeTruthy();
        expect(component.termsFormGroup.get('acceptDataPolicy')).toBeTruthy();
        expect(component.termsFormGroup.get('acceptTrackingPolicy')).toBeTruthy();
        expect(component.termsFormGroup.get('acceptTos')).toBeTruthy();
        expect(component.termsFormGroup.get('acceptMarketingPolicy')).toBeTruthy();
    });

    it('should disable stepper ripples on the onboarding stepper', () => {
        expect(component.stepper.disableRipple).toBe(true);
    });

    it('should render the legal consent form inside the centered onboarding form shell', () => {
        const onboardingForm = fixture.nativeElement.querySelector('form.onboarding-form');
        expect(onboardingForm).toBeTruthy();
    });

    it('should render the shared onboarding action bar for both steps', () => {
        const actionBars = fixture.nativeElement.querySelectorAll('.onboarding-actions');
        expect(actionBars.length).toBe(2);
    });

    it('should render pricing in onboarding mode for step 2', () => {
        const pricingComponent = fixture.debugElement.query(By.directive(PricingComponent))?.componentInstance as PricingComponent | undefined;

        expect(pricingComponent).toBeTruthy();
        expect(pricingComponent?.isOnboarding).toBe(true);
    });

    it('should disable step 2 footer actions while pricing is loading', () => {
        component.onPricingLoadingChange(true);
        fixture.detectChanges();

        const buttons = Array.from(fixture.nativeElement.querySelectorAll('.onboarding-actions button')) as HTMLButtonElement[];
        const backButton = buttons.find(button => button.textContent?.includes('Back')) ?? null;
        const continueButton = buttons.find(button => button.textContent?.includes('Continue to')) ?? null;

        expect(backButton?.disabled).toBe(true);
        expect(continueButton?.disabled).toBe(true);
    });

    it('should keep consent controls unchecked by default', () => {
        expect(component.termsFormGroup.get('acceptPrivacyPolicy')?.value).toBe(false);
        expect(component.termsFormGroup.get('acceptDataPolicy')?.value).toBe(false);
        expect(component.termsFormGroup.get('acceptTos')?.value).toBe(false);
        expect(component.termsFormGroup.get('acceptTrackingPolicy')?.value).toBe(false);
        expect(component.termsFormGroup.get('acceptMarketingPolicy')?.value).toBe(false);
    });

    it('should mark acceptMarketingPolicy as optional (no validators)', () => {
        const marketingControl = component.termsFormGroup.get('acceptMarketingPolicy');
        expect(marketingControl).toBeTruthy();

        marketingControl!.setValue(false);
        expect(marketingControl!.valid).toBe(true);

        marketingControl!.setValue(true);
        expect(marketingControl!.valid).toBe(true);
    });

    it('should mark acceptTrackingPolicy as optional (no validators)', () => {
        const trackingControl = component.termsFormGroup.get('acceptTrackingPolicy');
        expect(trackingControl).toBeTruthy();

        trackingControl!.setValue(false);
        expect(trackingControl!.valid).toBe(true);
    });

    it('should require acceptPrivacyPolicy to be true', () => {
        const privacyControl = component.termsFormGroup.get('acceptPrivacyPolicy');
        expect(privacyControl).toBeTruthy();

        privacyControl!.setValue(false);
        expect(privacyControl!.valid).toBe(false);

        privacyControl!.setValue(true);
        expect(privacyControl!.valid).toBe(true);
    });

    it('should use form value for optional policies on submit', async () => {
        setRequiredPoliciesAccepted();

        component.termsFormGroup.get('acceptTrackingPolicy')!.setValue(false);
        component.termsFormGroup.get('acceptMarketingPolicy')!.setValue(true);

        component.stepper = {
            selectedIndex: 0,
            next: vi.fn(),
            selected: { label: 'Legal consent' }
        } as any;

        await component.onTermsSubmit();

        expect(component.user.acceptedPrivacyPolicy).toBe(true);
        expect(component.user.acceptedDataPolicy).toBe(true);
        expect((component.user as any).acceptedTos).toBe(true);
        expect(component.user.acceptedTrackingPolicy).toBe(false);
        expect((component.user as any).acceptedMarketingPolicy).toBe(true);
    });

    it('should preserve false value for acceptMarketingPolicy when unchecked', async () => {
        setRequiredPoliciesAccepted();
        component.termsFormGroup.get('acceptTrackingPolicy')!.setValue(true);
        component.termsFormGroup.get('acceptMarketingPolicy')!.setValue(false);
        component.stepper = {
            selectedIndex: 0,
            next: vi.fn(),
            selected: { label: 'Legal consent' }
        } as any;

        await component.onTermsSubmit();

        expect((component.user as any).acceptedMarketingPolicy).toBe(false);
    });

    it('should call createOrUpdateUser on valid form submission', async () => {
        setRequiredPoliciesAccepted();
        component.stepper = {
            selectedIndex: 0,
            next: vi.fn(),
            selected: { label: 'Legal consent' }
        } as any;

        await component.onTermsSubmit();

        expect(mockUserService.createOrUpdateUser).toHaveBeenCalledWith(component.user);
    });

    it('should not submit if form is invalid', async () => {
        component.termsFormGroup.get('acceptPrivacyPolicy')!.setValue(false);

        await component.onTermsSubmit();

        expect(mockUserService.createOrUpdateUser).not.toHaveBeenCalled();
    });

    it('should mark all controls touched when submit is invalid', async () => {
        const markAllAsTouchedSpy = vi.spyOn(component.termsFormGroup, 'markAllAsTouched');

        await component.onTermsSubmit();

        expect(markAllAsTouchedSpy).toHaveBeenCalled();
    });

    it('should preserve the same FormGroup instance when user input changes', () => {
        const initialFormGroup = component.termsFormGroup;

        component.user = { ...mockUser, acceptedPrivacyPolicy: true } as any;
        component.ngOnChanges({
            user: {
                currentValue: component.user,
                previousValue: mockUser,
                firstChange: false,
                isFirstChange: () => false
            }
        });

        expect(component.termsFormGroup).toBe(initialFormGroup);
    });

    it('should NOT overwrite dirty form controls with incoming user data', () => {
        const privacyControl = component.termsFormGroup.get('acceptPrivacyPolicy');

        privacyControl!.setValue(true);
        privacyControl!.markAsDirty();

        component.user = { ...mockUser, acceptedPrivacyPolicy: false } as any;
        component.ngOnChanges({
            user: {
                currentValue: component.user,
                previousValue: mockUser,
                firstChange: false,
                isFirstChange: () => false
            }
        });

        expect(privacyControl!.value).toBe(true);
    });

    it('should patch non-dirty form controls on ngOnChanges', () => {
        const privacyControl = component.termsFormGroup.get('acceptPrivacyPolicy');
        expect(privacyControl!.dirty).toBe(false);

        component.user = { ...mockUser, acceptedPrivacyPolicy: true } as any;
        component.ngOnChanges({
            user: {
                currentValue: component.user,
                previousValue: mockUser,
                firstChange: false,
                isFirstChange: () => false
            }
        });

        expect(privacyControl!.value).toBe(true);
    });

    it('should call checkAndAdvance in ngOnChanges only after first change', () => {
        const checkAndAdvanceSpy = vi.spyOn(component as any, 'checkAndAdvance');

        component.ngOnChanges({
            user: {
                currentValue: component.user,
                previousValue: null,
                firstChange: true,
                isFirstChange: () => true
            }
        });

        expect(checkAndAdvanceSpy).not.toHaveBeenCalled();

        component.ngOnChanges({
            user: {
                currentValue: component.user,
                previousValue: null,
                firstChange: false,
                isFirstChange: () => false
            }
        });

        expect(checkAndAdvanceSpy).toHaveBeenCalled();
    });

    it('should populate user from auth stream when @Input user is missing', () => {
        const authUser = { ...mockUser, acceptedPrivacyPolicy: true };
        mockAuthService.user$ = of(authUser);

        const localFixture = TestBed.createComponent(OnboardingComponent);
        const localComponent = localFixture.componentInstance;

        localFixture.detectChanges();

        expect(localComponent.user).toEqual(authUser);
    });

    it('should patch non-dirty controls when auth stream emits after form creation', async () => {
        const userSubject = new Subject<any>();
        mockAuthService.user$ = userSubject.asObservable();

        const localFixture = TestBed.createComponent(OnboardingComponent);
        const localComponent = localFixture.componentInstance;

        localFixture.detectChanges();
        expect(localComponent.termsFormGroup.get('acceptPrivacyPolicy')?.value).toBe(false);

        userSubject.next({ ...mockUser, acceptedPrivacyPolicy: true });
        await localFixture.whenStable();

        expect(localComponent.termsFormGroup.get('acceptPrivacyPolicy')?.value).toBe(true);
    });

    it('should log tutorial_begin on init', () => {
        const localFixture = TestBed.createComponent(OnboardingComponent);
        const localComponent = localFixture.componentInstance;
        localComponent.user = { ...mockUser } as any;

        localFixture.detectChanges();

        expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('tutorial_begin');
    });

    it('should finish onboarding from checkAndAdvance when terms are accepted and user can finish', async () => {
        component.user = {
            ...mockUser,
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTos: true
        } as any;
        mockUserService.hasPaidAccess.mockResolvedValue(true);
        const finishSpy = vi.spyOn(component as any, 'finishOnboarding').mockResolvedValue(undefined);

        await (component as any).checkAndAdvance();

        expect(component.canFinish).toBe(true);
        expect(finishSpy).toHaveBeenCalled();
    });

    it('should auto-advance to pricing step when terms are accepted but onboarding is not finishable yet', async () => {
        vi.useFakeTimers();
        try {
            component.user = {
                ...mockUser,
                acceptedPrivacyPolicy: true,
                acceptedDataPolicy: true,
                acceptedTos: true
            } as any;
            component.stepper = { selectedIndex: 0 } as any;
            mockUserService.hasPaidAccess.mockResolvedValue(false);
            const finishSpy = vi.spyOn(component as any, 'finishOnboarding').mockResolvedValue(undefined);

            await (component as any).checkAndAdvance();

            expect(finishSpy).not.toHaveBeenCalled();
            expect(component.stepper.selectedIndex).toBe(0);
            vi.runAllTimers();
            expect(component.stepper.selectedIndex).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('should not advance or finish when required terms are not accepted', async () => {
        vi.useFakeTimers();
        try {
            component.user = {
                ...mockUser,
                acceptedPrivacyPolicy: true,
                acceptedDataPolicy: false,
                acceptedTos: true
            } as any;
            component.stepper = { selectedIndex: 0 } as any;
            mockUserService.hasPaidAccess.mockResolvedValue(true);
            const finishSpy = vi.spyOn(component as any, 'finishOnboarding').mockResolvedValue(undefined);

            await (component as any).checkAndAdvance();
            vi.runAllTimers();

            expect(finishSpy).not.toHaveBeenCalled();
            expect(component.stepper.selectedIndex).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('should no-op checkAndAdvance when user is missing', async () => {
        await fixture.whenStable();
        vi.clearAllMocks();
        component.user = undefined as any;

        await (component as any).checkAndAdvance();

        expect(mockUserService.isPro).not.toHaveBeenCalled();
        expect(mockUserService.hasPaidAccess).not.toHaveBeenCalled();
    });

    it('should call stepper.next on valid terms submit for non-subscribed users', async () => {
        setRequiredPoliciesAccepted();
        component.stepper = {
            selectedIndex: 0,
            next: vi.fn(),
            selected: { label: 'Legal consent' }
        } as any;
        mockUserService.hasPaidAccess.mockResolvedValue(false);

        await component.onTermsSubmit();

        expect(component.stepper.next).toHaveBeenCalled();
        expect(mockUserService.createOrUpdateUser).toHaveBeenCalled();
    });

    it('should log onboarding_step metadata when submitting from step index > 0', async () => {
        setRequiredPoliciesAccepted();
        component.stepper = {
            selectedIndex: 1,
            next: vi.fn(),
            selected: { label: 'Plan' }
        } as any;

        await component.onTermsSubmit();

        expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('onboarding_step', {
            step_index: 1,
            step_label: 'Plan'
        });
    });

    it('should finish onboarding on terms submit when user is already subscribed', async () => {
        setRequiredPoliciesAccepted();
        component.stepper = {
            selectedIndex: 0,
            next: vi.fn(),
            selected: { label: 'Legal consent' }
        } as any;
        mockUserService.hasPaidAccess.mockResolvedValue(true);
        const finishSpy = vi.spyOn(component as any, 'finishOnboarding').mockResolvedValue(undefined);

        await component.onTermsSubmit();

        expect(finishSpy).toHaveBeenCalled();
        expect(component.stepper.next).not.toHaveBeenCalled();
    });

    it('should log and recover when createOrUpdateUser fails on terms submit', async () => {
        setRequiredPoliciesAccepted();
        component.stepper = {
            selectedIndex: 0,
            next: vi.fn(),
            selected: { label: 'Legal consent' }
        } as any;
        mockUserService.createOrUpdateUser.mockRejectedValue(new Error('save failed'));

        await component.onTermsSubmit();

        expect(mockLoggerService.error).toHaveBeenCalledWith('Error updating user terms:', expect.any(Error));
        expect(component.isLoading).toBe(false);
        expect(component.stepper.next).not.toHaveBeenCalled();
    });

    it('should apply implicit free-tier in finishOnboarding when canFinish is false and user is not paid', async () => {
        component.canFinish = false;
        mockUserService.hasPaidAccess.mockResolvedValue(false);

        await component.finishOnboarding();

        expect(mockUserService.setFreeTier).toHaveBeenCalledWith(component.user);
        expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(component.user, { onboardingCompleted: true });
        expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('tutorial_complete');
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
        expect(component.isLoading).toBe(false);
    });

    it('should skip implicit free-tier when canFinish is false but user has paid access', async () => {
        component.canFinish = false;
        mockUserService.hasPaidAccess.mockResolvedValue(true);

        await component.finishOnboarding();

        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(component.user, { onboardingCompleted: true });
    });

    it.each([{ path: '/tools/compare', label: 'Compare' }, { path: '/services', label: 'Connections' }])(
        'returns to $label after required consent and free account setup complete', async ({ path, label }) => {
            routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: path });
            const returnFixture = TestBed.createComponent(OnboardingComponent);
            const returningComponent = returnFixture.componentInstance;
            returningComponent.user = { ...mockUser } as any;
            returnFixture.detectChanges();
            await returnFixture.whenStable();
            vi.clearAllMocks();

            for (const field of ['acceptPrivacyPolicy', 'acceptDataPolicy', 'acceptTos']) {
                returningComponent.termsFormGroup.get(field)!.setValue(true);
            }
            await returningComponent.onTermsSubmit();
            await returningComponent.finishOnboarding();

            expect(mockUserService.createOrUpdateUser).toHaveBeenCalledWith(returningComponent.user);
            expect(mockUserService.setFreeTier).toHaveBeenCalledWith(returningComponent.user);
            expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(returningComponent.user, { onboardingCompleted: true });
            expect(mockRouter.navigate).toHaveBeenCalledWith([path]);
            expect(returnFixture.nativeElement.textContent.replace(/\s+/g, ' ')).toContain(`Continue to ${label}`);
            expect(returningComponent.isLoading).toBe(false);
        },
    );

    it.each(['/tools/compare', '/services'])(
        'returns an already completed account to %s without rewriting its profile', async (path) => {
            routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: path });
            const returningComponent = TestBed.createComponent(OnboardingComponent).componentInstance;
            returningComponent.user = { ...mockUser, onboardingCompleted: true } as any;

            await returningComponent.finishOnboarding();

            expect(mockRouter.navigate).toHaveBeenCalledWith([path]);
            expect(mockUserService.createOrUpdateUser).not.toHaveBeenCalled();
            expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
            expect(mockAnalyticsService.logEvent).not.toHaveBeenCalled();
        },
    );

    it.each([
        { serviceName: 'Wahoo API', onboardingCompleted: false },
        { serviceName: 'Wahoo API', onboardingCompleted: true },
        { serviceName: 'COROS API', onboardingCompleted: false },
        { serviceName: 'COROS API', onboardingCompleted: true },
        { serviceName: 'Suunto app', onboardingCompleted: false },
        { serviceName: 'Suunto app', onboardingCompleted: true },
    ])('keeps $serviceName setup after required onboarding (previously complete: $onboardingCompleted)', async ({ serviceName, onboardingCompleted }) => {
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: `/services?serviceName=${encodeURIComponent(serviceName)}` });
        const returnFixture = TestBed.createComponent(OnboardingComponent);
        const returningComponent = returnFixture.componentInstance;
        returningComponent.user = { ...mockUser, onboardingCompleted } as any;
        returnFixture.detectChanges();
        await returnFixture.whenStable();
        if (!onboardingCompleted) {
            await returningComponent.onTermsSubmit();
            expect(mockUserService.createOrUpdateUser).not.toHaveBeenCalled();
            expect(mockRouter.navigate).not.toHaveBeenCalled();
            for (const field of ['acceptPrivacyPolicy', 'acceptDataPolicy', 'acceptTos']) {
                returningComponent.termsFormGroup.get(field)!.setValue(true);
            }
            await returningComponent.onTermsSubmit();
        }
        await returningComponent.finishOnboarding();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/services'], { queryParams: { serviceName } });
        expect(returningComponent.completionLabel).toBe('Connections');
        expect(mockDialog.open).not.toHaveBeenCalled();
    });

    it.each([false, true])('returns to the same MCP request after setup (previously complete: %s)', async (onboardingCompleted) => {
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/mcp/authorize', request_id: 'request-1' });
        const returnFixture = TestBed.createComponent(OnboardingComponent);
        const returningComponent = returnFixture.componentInstance;
        returningComponent.user = { ...mockUser, onboardingCompleted } as any;
        returnFixture.detectChanges();
        await returnFixture.whenStable();
        if (!onboardingCompleted) {
            for (const field of ['acceptPrivacyPolicy', 'acceptDataPolicy', 'acceptTos']) {
                returningComponent.termsFormGroup.get(field)!.setValue(true);
            }
            await returningComponent.onTermsSubmit();
        }

        await returningComponent.finishOnboarding();

        expect(mockRouter.navigate).toHaveBeenCalledWith(['/mcp/authorize'], { queryParams: { request_id: 'request-1' } });
        expect(returningComponent.completionLabel).toBe('MCP connection');
    });

    it('returns to Subscriptions after its existing account-setup handoff', async () => {
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/subscriptions' });
        const returningComponent = TestBed.createComponent(OnboardingComponent).componentInstance;
        returningComponent.user = { ...mockUser, onboardingCompleted: true } as any;

        await returningComponent.finishOnboarding();

        expect(mockRouter.navigate).toHaveBeenCalledWith(['/subscriptions']);
        expect(returningComponent.completionLabel).toBe('Subscriptions');
    });

    it('preserves the chosen membership price after account setup without starting checkout', async () => {
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/subscriptions?priceId=price_pro_yearly&ignored=value' });
        const returningComponent = TestBed.createComponent(OnboardingComponent).componentInstance;
        returningComponent.user = { ...mockUser, onboardingCompleted: true } as any;

        await returningComponent.finishOnboarding();

        expect(mockRouter.navigate).toHaveBeenCalledWith(['/subscriptions'], { queryParams: { priceId: 'price_pro_yearly' } });
        expect(returningComponent.completionLabel).toBe('Subscriptions');
        expect(mockPaymentService.getProducts).not.toHaveBeenCalled();
    });

    it.each([
        { returnUrl: '/subscriptions?priceId=price_pro_yearly', path: '/subscriptions', label: 'Subscriptions', queryParams: { priceId: 'price_pro_yearly' } },
        { returnUrl: '/subscriptions', path: '/subscriptions', label: 'Subscriptions', queryParams: null },
        { returnUrl: '//example.com/subscriptions?priceId=price_pro_yearly', path: '/dashboard', label: 'Dashboard', queryParams: null },
    ])('uses the latest safe membership return URL when onboarding is reused: $returnUrl', async ({ returnUrl, path, label, queryParams }) => {
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/subscriptions?priceId=price_pro_monthly' });
        routeStub.queryParamMap = new BehaviorSubject(routeSnapshot.queryParamMap);
        const returningComponent = TestBed.createComponent(OnboardingComponent).componentInstance;
        returningComponent.user = { ...mockUser, onboardingCompleted: true } as any;

        // Angular reuses the routed component when only query parameters change.
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl });
        routeStub.queryParamMap.next(routeSnapshot.queryParamMap);
        await returningComponent.finishOnboarding();

        if (queryParams) {
            expect(mockRouter.navigate).toHaveBeenCalledWith([path], { queryParams });
        } else {
            expect(mockRouter.navigate).toHaveBeenCalledWith([path]);
        }
        expect(returningComponent.completionLabel).toBe(label);
        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
    });

    it.each(['', 'request/other', 'request?scope=all', 'a'.repeat(257)])('rejects an invalid MCP return request ID: %s', async (request_id) => {
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/mcp/authorize', request_id });
        const returningComponent = TestBed.createComponent(OnboardingComponent).componentInstance;
        returningComponent.user = { ...mockUser, onboardingCompleted: true } as any;
        await returningComponent.finishOnboarding();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it.each(['https://example.com', '//example.com', '/login', '/onboarding', '/tools/compare?other=1', '/services?connect=1', '/services/garmin', '/mcp/authorize?request_id=request-1'])(
        'ignores unsupported onboarding return destinations: %s', async (returnUrl) => {
            routeSnapshot.queryParamMap = convertToParamMap({ returnUrl });
            const returningComponent = TestBed.createComponent(OnboardingComponent).componentInstance;
            returningComponent.user = { ...mockUser, onboardingCompleted: true } as any;

            await returningComponent.finishOnboarding();

            expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
        },
    );

    it('should skip hasPaidAccess and free-tier logic when canFinish is already true', async () => {
        await fixture.whenStable();
        vi.clearAllMocks();
        component.canFinish = true;

        await component.finishOnboarding();

        expect(mockUserService.hasPaidAccess).not.toHaveBeenCalled();
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(component.user, { onboardingCompleted: true });
    });

    it('should handle finishOnboarding errors and avoid dashboard navigation', async () => {
        component.canFinish = true;
        mockUserService.updateUserProperties.mockRejectedValue(new Error('update failed'));

        await component.finishOnboarding();

        expect(mockLoggerService.error).toHaveBeenCalledWith('Error completing onboarding:', expect.any(Error));
        expect(mockRouter.navigate).not.toHaveBeenCalledWith(['/dashboard']);
        expect(component.isLoading).toBe(false);
    });

    it('should leave onboarding without reads, writes or completion analytics when the account is already complete', async () => {
        await fixture.whenStable();
        vi.clearAllMocks();
        component.user = { ...component.user, onboardingCompleted: true } as any;
        component.canFinish = false;

        await component.finishOnboarding();

        expect(mockUserService.hasPaidAccess).not.toHaveBeenCalled();
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
        expect(mockAnalyticsService.logEvent).not.toHaveBeenCalled();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('should stop finishOnboarding when setFreeTier fails before updating onboarding flag', async () => {
        component.canFinish = false;
        mockUserService.hasPaidAccess.mockResolvedValue(false);
        mockUserService.setFreeTier.mockRejectedValue(new Error('free-tier failed'));

        await component.finishOnboarding();

        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
        expect(mockLoggerService.error).toHaveBeenCalledWith('Error completing onboarding:', expect.any(Error));
        expect(component.isLoading).toBe(false);
    });

    it('should sign out and navigate to login on logout', async () => {
        await component.logout();

        expect(mockAuthService.signOut).toHaveBeenCalled();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/login']);
    });

    it('should set canFinish and trigger finishOnboarding on plan selected', () => {
        const finishSpy = vi.spyOn(component as any, 'finishOnboarding').mockResolvedValue(undefined);

        component.onPlanSelected();

        expect(component.canFinish).toBe(true);
        expect(finishSpy).toHaveBeenCalled();
    });

    it('should not trigger finishOnboarding again when planSelected arrives during loading', () => {
        component.isLoading = true;
        const finishSpy = vi.spyOn(component as any, 'finishOnboarding').mockResolvedValue(undefined);

        component.onPlanSelected();

        expect(component.canFinish).toBe(true);
        expect(finishSpy).not.toHaveBeenCalled();
    });

    it('should set isPro in checkProStatus', async () => {
        mockUserService.isPro.mockResolvedValue(true);

        await component.checkProStatus();

        expect(component.isPro).toBe(true);
    });

    it('should return empty string for empty form control name mapping', () => {
        const mapped = (component as any).mapFormControlNameToUserProperty('');

        expect(mapped).toBe('');
    });

    it('should handle required policies without formControlName in checkAndAdvance', async () => {
        component.user = { ...mockUser } as any;
        component.policies = [{
            id: 'custom-required',
            title: 'Custom Required',
            icon: 'rule',
            content: ['x'],
            isOptional: false
        }] as any;
        const finishSpy = vi.spyOn(component as any, 'finishOnboarding').mockResolvedValue(undefined);

        await (component as any).checkAndAdvance();

        expect(finishSpy).not.toHaveBeenCalled();
    });

    it('should ignore policies without formControlName during submit mapping', async () => {
        component.policies = [
            ...component.policies,
            {
                id: 'custom-optional',
                title: 'Custom Optional',
                icon: 'rule',
                content: ['x'],
                isOptional: true
            } as any
        ];
        setRequiredPoliciesAccepted();
        component.stepper = {
            selectedIndex: 0,
            next: vi.fn(),
            selected: { label: 'Legal consent' }
        } as any;

        await component.onTermsSubmit();

        expect(mockUserService.createOrUpdateUser).toHaveBeenCalledWith(component.user);
    });

    it('should return false from getPolicyValue for unknown control mappings', () => {
        const result = (component as any).getPolicyValue({ formControlName: 'acceptUnknown' }, component.user);

        expect(result).toBe(false);
    });

    it('should toggle policy details panel on read more', () => {
        component.togglePolicyDetails('privacy');
        expect(component.expandedPolicyId).toBe('privacy');

        component.togglePolicyDetails('privacy');
        expect(component.expandedPolicyId).toBeNull();
    });

    it('should auto-close expanded details when policy is checked', () => {
        component.expandedPolicyId = 'privacy';

        component.onPolicyCheckboxChange('privacy', true);

        expect(component.expandedPolicyId).toBeNull();
    });

    it('should keep expanded details when policy is unchecked', () => {
        component.expandedPolicyId = 'privacy';

        component.onPolicyCheckboxChange('privacy', false);

        expect(component.expandedPolicyId).toBe('privacy');
    });

    it('should keep expanded details when a different policy is checked', () => {
        component.expandedPolicyId = 'privacy';

        component.onPolicyCheckboxChange('data', true);

        expect(component.expandedPolicyId).toBe('privacy');
    });
});
