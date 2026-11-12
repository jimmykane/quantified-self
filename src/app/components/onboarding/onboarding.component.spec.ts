import { signal } from '@angular/core';
import { AppThemeService } from '../../services/app.theme.service';
import { ONBOARDING_TERRAIN_LOADER } from './terrain/onboarding-terrain.component';
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

    const savedConsent = { acceptedPrivacyPolicy: true, acceptedDataPolicy: true, acceptedTos: true };

    const setRequiredPoliciesAccepted = () => {
        component.termsFormGroup.get('acceptPrivacyPolicy')!.setValue(true);
        component.termsFormGroup.get('acceptDataPolicy')!.setValue(true);
        component.termsFormGroup.get('acceptTos')!.setValue(true);
    };

    beforeEach(async () => {
        routeSnapshot = { queryParamMap: convertToParamMap({}) };
        routeStub = { snapshot: routeSnapshot };
        const savedProfile$ = new BehaviorSubject({ ...mockUser, ...savedConsent, onboardingCompleted: true });
        mockUserService = {
            user$: savedProfile$,
            createOrUpdateUser: vi.fn().mockImplementation(async user => {
                savedProfile$.next({ ...user, onboardingCompleted: true });
            }),
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
            url: '/onboarding',
            navigate: vi.fn().mockImplementation(async (commands: string[], options?: { queryParams?: Record<string, string> }) => {
                if (commands.length) {
                    mockRouter.url = commands.join('/') + (options?.queryParams ? '?' + new URLSearchParams(options.queryParams) : '');
                }
                return true;
            })
        };

        mockLoggerService = {
            log: vi.fn(),
            error: vi.fn()
        };

        mockAnalyticsService = {
            logEvent: vi.fn(),
            logOnboardingFlow: vi.fn().mockReturnValue(true)
        };

        mockPaymentService = {
            appendCheckoutSession: vi.fn(),
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
                { provide: AppThemeService, useValue: { appTheme: signal('normal') } },
                { provide: ONBOARDING_TERRAIN_LOADER, useValue: () => Promise.reject(new Error('Static artwork in onboarding tests')) },
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

    });

    // Logic cases initialize the component without rendering its template; UI cases opt in.
    const setupComponent = async (render = false, userOverrides = {}) => {
        fixture = TestBed.createComponent(OnboardingComponent);
        component = fixture.componentInstance;
        component.user = { ...mockUser, ...userOverrides } as any;
        if (render) fixture.detectChanges();
        else component.ngOnInit();
        await fixture.whenStable();
        await vi.waitFor(() => expect((component as any).advancing).toBe(false));
        vi.clearAllMocks();
    };

    const clickButton = (label: string) => {
        const button = Array.from(fixture.nativeElement.querySelectorAll('button')).find((item: HTMLButtonElement) =>
            item.textContent?.includes(label)) as HTMLButtonElement;
        expect(button).toBeTruthy();
        button.click();
        fixture.detectChanges();
    };

    it.each([0, 1, 2])('can skip intro chapter %s without accepting consent or choosing a plan', async chapter => {
        await setupComponent(true);
        component.showIntro();
        component.chapterIndex.set(chapter);
        fixture.detectChanges();
        clickButton('Skip tour');
        expect(component.stage()).toBe('start');
        expect(component.termsFormGroup.invalid).toBe(true);
        expect(mockUserService.createOrUpdateUser).not.toHaveBeenCalled();
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockPaymentService.getProducts).not.toHaveBeenCalled();
    });

    it('takes the full tour forward and back with focus on the new heading', async () => {
        await setupComponent(true);
        clickButton('Take a quick tour');
        clickButton('Next');
        expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Ask questions. Build workouts.');
        await fixture.whenStable();
        expect(document.activeElement).toBe(fixture.nativeElement.querySelector('h1'));
        clickButton('Back');
        expect(component.chapterIndex()).toBe(0);
        clickButton('Next');
        clickButton('Next');
        clickButton('Continue setup');
        expect(component.stage()).toBe('start');
        expect(mockUserService.createOrUpdateUser).not.toHaveBeenCalled();
    });

    it.each([
        { choice: 'analyze', path: '/dashboard' },
        { choice: 'sync', path: '/subscriptions' },
        { choice: 'compare', path: '/tools/compare' },
    ] as const)('completes $choice directly into $path without loading prices or checkout', async ({ choice, path }) => {
        await setupComponent(true);
        expect((fixture.nativeElement.querySelector('.onboarding-actions button[mat-flat-button]') as HTMLButtonElement).disabled).toBe(true);
        expect(Array.from(fixture.nativeElement.querySelectorAll('mat-radio-button')).map((radio: Element) => radio.getAttribute('value')))
            .toEqual(['analyze', 'sync', 'compare']);
        (fixture.nativeElement.querySelector(`mat-radio-button[value="${choice}"] input`) as HTMLInputElement).click();
        fixture.detectChanges();
        clickButton('Continue');
        expect(component.stage()).toBe('privacy');
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        fixture.detectChanges();
        if (choice === 'sync') expect(mockRouter.navigate).toHaveBeenCalledWith([path], { queryParams: { setup: 'sync' } });
        else expect(mockRouter.navigate).toHaveBeenCalledWith([path]);
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockUserService.createOrUpdateUser).toHaveBeenCalledWith(expect.objectContaining(savedConsent), { completeOnboarding: true });
        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
        expect(mockUserService.hasPaidAccess).not.toHaveBeenCalled();
        expect(fixture.nativeElement.querySelector('app-pricing')).toBeNull();
        expect(mockPaymentService.getProducts).not.toHaveBeenCalled();
        expect(mockPaymentService.appendCheckoutSession).not.toHaveBeenCalled();
        expect(TestBed.inject(AppHapticsService).success).toHaveBeenCalledOnce();
        expect(mockDialog.open).not.toHaveBeenCalled();
    });

    it('offers exploration as a secondary action while retaining required consent', async () => {
        await setupComponent(true);
        clickButton('Let me look around');
        expect(component.stage()).toBe('privacy');
        expect(component.startChoice()).toBe('explore');
        expect(component.termsFormGroup.invalid).toBe(true);
        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
        expect(TestBed.inject(AppHapticsService).selection).toHaveBeenCalledOnce();
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
        expect(mockPaymentService.getProducts).not.toHaveBeenCalled();
    });

    it.each(['analyze', 'sync', 'compare'] as const)('keeps paid access on the %s path without selecting Starter', async choice => {
        await setupComponent(false, { stripeRole: 'pro' });
        component.chooseStart(choice);
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockUserService.createOrUpdateUser).toHaveBeenCalledOnce();
        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
        expect(mockPaymentService.getProducts).not.toHaveBeenCalled();
    });

    it.each([{start:'connect', path:'/services'}, {start:'upload', path:'/dashboard'}])('keeps legacy $start links usable without pricing', async ({start, path}) => {
        routeSnapshot.queryParamMap = convertToParamMap({start});
        await setupComponent(true);
        expect(component.visibleStartChoice()).toBe('analyze');
        expect(fixture.nativeElement.querySelector('mat-radio-button[value="analyze"] input').checked).toBe(true);
        component.continueFromStart();
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        expect(mockRouter.navigate).toHaveBeenCalledWith([path]);
        expect(mockPaymentService.getProducts).not.toHaveBeenCalled();
    });

    it('returns a sync deep link to Pro selection without granting provider access', async () => {
        routeSnapshot.queryParamMap = convertToParamMap({returnUrl:'/services?setup=sync'});
        await setupComponent();
        expect(component.stage()).toBe('privacy');
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/subscriptions'], {queryParams:{setup:'sync'}});
        expect(mockPaymentService.getProducts).not.toHaveBeenCalled();
    });

    it.each(['/tools/compare', '/tools/compare/saved'])('opens compact account setup directly for %s and finishes without pricing', async path => {
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: path });
        await setupComponent(true);
        expect(component.stage()).toBe('privacy');
        expect(component.isCompareFlow()).toBe(true);
        expect(fixture.nativeElement.querySelector('.field-guide-hero')).toBeNull();
        expect(fixture.nativeElement.querySelector('.starting-points')).toBeNull();
        expect(fixture.debugElement.query(By.directive(PricingComponent))).toBeNull();
        expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
        expect(component.termsFormGroup.get('acceptTrackingPolicy')!.value).toBe(false);
        expect(component.termsFormGroup.get('acceptMarketingPolicy')!.value).toBe(false);
        setRequiredPoliciesAccepted();
        fixture.detectChanges();
        clickButton('Continue free');
        await vi.waitFor(() => expect(mockRouter.navigate).toHaveBeenCalledWith([path]));
        expect(mockUserService.createOrUpdateUser).toHaveBeenCalledOnce();
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockRouter.navigate).toHaveBeenCalledWith([path]);
        expect(mockPaymentService.getProducts).not.toHaveBeenCalled();
        expect(TestBed.inject(AppHapticsService).success).toHaveBeenCalledOnce();
    });

    it('lets a general signup choose Compare and change their starting point before saving', async () => {
        await setupComponent(true);
        const radio = fixture.nativeElement.querySelector('mat-radio-button[value="compare"] input') as HTMLInputElement;
        radio.click();
        fixture.detectChanges();
        // The choice does not shift the starting-point layout mid-interaction.
        expect(fixture.nativeElement.querySelector('.field-guide-hero')).toBeTruthy();
        clickButton('Continue');
        expect(component.stage()).toBe('privacy');
        expect(fixture.nativeElement.querySelector('.field-guide-hero')).toBeNull();
        clickButton('Back');
        expect(component.stage()).toBe('start');
        expect(component.startChoice()).toBe('compare');
        expect(mockUserService.createOrUpdateUser).not.toHaveBeenCalled();
        component.chooseStart('upload');
        expect(component.isCompareFlow()).toBe(false);
        expect(component.completionPath).toBe('/dashboard');
    });

    it('resumes Compare with saved consent but waits for the explicit Starter action', async () => {
        routeSnapshot.queryParamMap = convertToParamMap({ start: 'compare' });
        await setupComponent();
        component.user = { ...mockUser, acceptedPrivacyPolicy: true, acceptedDataPolicy: true, acceptedTos: true } as any;
        component.ngOnChanges({ user: { firstChange: false } as any });
        await fixture.whenStable();
        expect(component.stage()).toBe('privacy');
        expect(component.termsFormGroup.valid).toBe(true);
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockRouter.navigate).not.toHaveBeenCalled();
        await component.onTermsSubmit();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/tools/compare']);
    });

    it('keeps an existing paid membership when the Compare user accepts missing policies', async () => {
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/tools/compare' });
        await setupComponent(true, { stripeRole: 'basic' });
        expect(component.hasPaidMembership()).toBe(true);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('button[type="submit"]').textContent).toContain('Open Compare');
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockPaymentService.getProducts).not.toHaveBeenCalled();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/tools/compare']);
    });

    it('keeps the compact form retryable when the combined consent and setup save fails', async () => {
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/tools/compare' });
        await setupComponent(true);
        setRequiredPoliciesAccepted();
        mockUserService.createOrUpdateUser.mockRejectedValueOnce(new Error('offline'));
        await component.onTermsSubmit();
        expect(component.stage()).toBe('privacy');
        expect(component.termsFormGroup.enabled).toBe(true);
        expect(component.termsFormGroup.valid).toBe(true);
        expect(mockRouter.navigate).not.toHaveBeenCalled();
        expect(TestBed.inject(AppHapticsService).success).not.toHaveBeenCalled();
        expect(TestBed.inject(AppHapticsService).error).toHaveBeenCalledOnce();
        await component.onTermsSubmit();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/tools/compare']);
    });

    it('does not allow Compare setup to bypass missing required consent', async () => {
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/tools/compare' });
        await setupComponent();
        await component.onTermsSubmit();
        expect(mockUserService.createOrUpdateUser).not.toHaveBeenCalled();
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('preserves an explicit membership destination over a remembered Compare choice', async () => {
        routeSnapshot.queryParamMap = convertToParamMap({ start: 'compare', returnUrl: '/subscriptions?priceId=price_pro_monthly' });
        await setupComponent();
        expect(component.isCompareFlow()).toBe(false);
        expect(component.completionPath).toBe('/subscriptions');
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/subscriptions'], {queryParams:{priceId:'price_pro_monthly'}});
        expect(mockPaymentService.appendCheckoutSession).not.toHaveBeenCalled();
    });

    it('lets a direct Compare visitor go back without saving any account choices', async () => {
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/tools/compare/saved' });
        await setupComponent(true);
        clickButton('Back');
        await fixture.whenStable();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/tools/compare/saved']);
        // Route changes get their selection feedback from the shell.
        expect(TestBed.inject(AppHapticsService).selection).not.toHaveBeenCalled();
        expect(mockUserService.createOrUpdateUser).not.toHaveBeenCalled();
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
    });

    it('keeps the starting point and unsaved consent choices when moving back', async () => {
        await setupComponent();
        component.chooseStart('analyze');
        component.continueFromStart();
        setRequiredPoliciesAccepted();
        component.back();
        expect(component.stage()).toBe('start');
        expect(component.startChoice()).toBe('analyze');
        component.continueFromStart();
        expect(component.termsFormGroup.valid).toBe(true);
        expect(mockUserService.createOrUpdateUser).not.toHaveBeenCalled();
    });

    it('skips the starting-point question for an existing connection return', async () => {
        await setupComponent(false);
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/services?serviceName=Suunto%20app' });
        const localFixture = TestBed.createComponent(OnboardingComponent);
        const local = localFixture.componentInstance;
        local.user = { ...mockUser } as any;
        localFixture.detectChanges();
        await localFixture.whenStable();
        local.skipIntro();
        expect(local.stage()).toBe('privacy');
        // A previous choice never replaces an explicit deep link.
        local.chooseStart('upload');
        expect(local.completionLabel).toBe('Connections');
    });

    it('keeps disclosure buttons associated with their hidden policy text', async () => {
        await setupComponent(true);
        component.stage.set('privacy');
        fixture.detectChanges();
        const button = fixture.nativeElement.querySelector('.policy-read-more') as HTMLButtonElement;
        const region = fixture.nativeElement.querySelector(`#${button.getAttribute('aria-controls')}`) as HTMLElement;
        expect(region.hidden).toBe(true);
        button.click();
        fixture.detectChanges();
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(region.hidden).toBe(false);
        const link = region.querySelector('a')!;
        expect(link.getAttribute('href')).toBe('/policies#connected-services-data');
        expect(link.getAttribute('target')).toBe('_blank');
    });

    it('has silent initialization and no-op selections, with one haptic for each accepted choice', async () => {
        await setupComponent(false);
        const haptics = TestBed.inject(AppHapticsService);
        const initial = TestBed.createComponent(OnboardingComponent);
        initial.componentInstance.user = { ...mockUser } as any;
        initial.detectChanges();
        await initial.whenStable();
        expect(haptics.selection).not.toHaveBeenCalled();
        component.previousChapter();
        component.continueFromStart();
        expect(haptics.selection).not.toHaveBeenCalled();
        component.chooseStart('upload');
        component.chooseStart('upload');
        expect(haptics.selection).toHaveBeenCalledOnce();
        component.showIntro();
        component.showIntro();
        component.skipIntro();
        component.skipIntro();
        expect(haptics.selection).toHaveBeenCalledTimes(3);
    });

    it('shows a recoverable save error, retains form choices and signals failure only after rejection', async () => {
        await setupComponent(true);
        const haptics = TestBed.inject(AppHapticsService);
        component.stage.set('privacy');
        setRequiredPoliciesAccepted();
        mockUserService.createOrUpdateUser.mockRejectedValueOnce(new Error('offline'));
        await component.onTermsSubmit();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('try again');
        expect(component.user.acceptedPrivacyPolicy).toBe(false);
        expect(component.termsFormGroup.valid).toBe(true);
        expect(haptics.success).not.toHaveBeenCalled();
        expect(haptics.error).toHaveBeenCalledOnce();
        await component.onTermsSubmit();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
        expect(component.errorMessage()).toBe('');
        expect(haptics.success).toHaveBeenCalledOnce();
    });

    it('blocks duplicate consent saves and back navigation while a save is pending', async () => {
        await setupComponent(true);
        component.stage.set('privacy');
        setRequiredPoliciesAccepted();
        let resolveSave!: () => void;
        mockUserService.createOrUpdateUser.mockReturnValue(new Promise<void>(resolve => resolveSave = resolve));
        const saving = component.onTermsSubmit();
        await component.onTermsSubmit();
        component.back();
        expect(component.stage()).toBe('privacy');
        expect(mockUserService.createOrUpdateUser).toHaveBeenCalledOnce();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
        expect(fixture.nativeElement.querySelector('mat-spinner')).toBeTruthy();
        expect(component.termsFormGroup.disabled).toBe(true);
        resolveSave();
        await saving;
        expect(component.termsFormGroup.enabled).toBe(true);
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('waits for the authoritative completed profile before opening a guarded workspace', async () => {
        await setupComponent(true);
        component.stage.set('privacy');
        setRequiredPoliciesAccepted();
        const profile$ = new BehaviorSubject({ ...mockUser, ...savedConsent, onboardingCompleted: false });
        mockUserService.user$ = profile$;
        const saving = component.onTermsSubmit();
        await vi.waitFor(() => expect(component.loadingLabel()).toBe('Finishing setup…'));
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);
        expect(mockRouter.navigate).not.toHaveBeenCalled();
        profile$.next({ ...mockUser, ...savedConsent, onboardingCompleted: true, acceptedTos: false });
        expect(mockRouter.navigate).not.toHaveBeenCalled();
        profile$.next({ ...mockUser, ...savedConsent, onboardingCompleted: true });
        await saving;
        expect(mockRouter.navigate).toHaveBeenCalledExactlyOnceWith(['/dashboard']);
        expect(mockUserService.createOrUpdateUser).toHaveBeenCalledOnce();
        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
    });

    it.each(['destroy', 'account change'])('does not navigate after %s while awaiting the saved profile', async change => {
        await setupComponent();
        setRequiredPoliciesAccepted();
        const profile$ = new Subject<any>();
        mockUserService.user$ = profile$;
        const saving = component.onTermsSubmit();
        await vi.waitFor(() => expect(component.loadingLabel()).toBe('Finishing setup…'));
        if (change === 'destroy') fixture.destroy();
        else component.user = { ...mockUser, uid: 'another-account' } as any;
        profile$.next({ ...mockUser, ...savedConsent, onboardingCompleted: true });
        await saving;
        expect(mockRouter.navigate).not.toHaveBeenCalled();
        expect(TestBed.inject(AppHapticsService).success).not.toHaveBeenCalled();
        expect(profile$.observed).toBe(false);
    });

    it.each([true, false])('waits for the submitted analytics preference (%s) before recording setup', async acceptedTrackingPolicy => {
        await setupComponent();
        component.chooseStart('analyze');
        mockRouter.navigate.mockClear();
        mockAnalyticsService.logOnboardingFlow.mockClear();
        setRequiredPoliciesAccepted();
        component.termsFormGroup.get('acceptTrackingPolicy')!.setValue(acceptedTrackingPolicy);
        const profile$ = new BehaviorSubject({ ...mockUser, ...savedConsent, onboardingCompleted: true,
            acceptedTrackingPolicy: !acceptedTrackingPolicy });
        mockUserService.user$ = profile$;
        const saving = component.onTermsSubmit();
        await vi.waitFor(() => expect(component.loadingLabel()).toBe('Finishing setup…'));
        expect(mockRouter.navigate).not.toHaveBeenCalled();
        expect(mockAnalyticsService.logOnboardingFlow).not.toHaveBeenCalled();
        profile$.next({ ...profile$.value, acceptedTrackingPolicy });
        await saving;
        expect(mockRouter.navigate).toHaveBeenCalledExactlyOnceWith(['/dashboard']);
    });

    it('does not record a failure under old consent if an analytics opt-out acknowledgement times out', async () => {
        await setupComponent(false, { acceptedTrackingPolicy: true });
        setRequiredPoliciesAccepted();
        component.termsFormGroup.get('acceptTrackingPolicy')!.setValue(false);
        mockUserService.user$ = new BehaviorSubject({ ...mockUser, ...savedConsent, onboardingCompleted: true,
            acceptedTrackingPolicy: true });
        vi.useFakeTimers();
        try {
            const saving = component.onTermsSubmit();
            await vi.advanceTimersByTimeAsync(10_001);
            await saving;
            expect(mockAnalyticsService.logOnboardingFlow).not.toHaveBeenCalled();
            expect(mockAnalyticsService.logEvent).not.toHaveBeenCalled();
            expect(mockRouter.navigate).not.toHaveBeenCalled();
            expect(component.errorMessage()).toContain('Your choices are saved');
        } finally { vi.useRealTimers(); }
    });

    it('does not record a failed consent save using the analytics preference the user is opting out of', async () => {
        await setupComponent(false, { acceptedTrackingPolicy: true });
        setRequiredPoliciesAccepted();
        component.termsFormGroup.get('acceptTrackingPolicy')!.setValue(false);
        mockUserService.createOrUpdateUser.mockRejectedValueOnce(new Error('Save failed'));
        await component.onTermsSubmit();
        expect(mockAnalyticsService.logOnboardingFlow).not.toHaveBeenCalled();
        expect(mockAnalyticsService.logEvent).not.toHaveBeenCalled();
        expect(component.errorMessage()).toContain('saving your choices');
    });

    it('does not record or navigate for the previous account while the component input is stale', async () => {
        await setupComponent();
        component.chooseStart('sync');
        setRequiredPoliciesAccepted();
        const profile$ = new Subject<any>();
        mockUserService.user$ = profile$;
        mockRouter.navigate.mockClear();
        mockAnalyticsService.logOnboardingFlow.mockClear();
        const saving = component.onTermsSubmit();
        await vi.waitFor(() => expect(component.loadingLabel()).toBe('Finishing setup…'));
        mockAuthService.currentUser = { uid: 'another-account' };
        profile$.next({ ...mockUser, ...savedConsent, onboardingCompleted: true });
        await saving;
        expect(mockRouter.navigate).not.toHaveBeenCalled();
        expect(mockAnalyticsService.logOnboardingFlow).not.toHaveBeenCalled();
        expect(mockAnalyticsService.logEvent).not.toHaveBeenCalled();
    });

    it('keeps setup retryable if the authoritative completion snapshot never arrives', async () => {
        await setupComponent();
        setRequiredPoliciesAccepted();
        mockUserService.user$ = new Subject();
        vi.useFakeTimers();
        try {
            const saving = component.onTermsSubmit();
            await vi.advanceTimersByTimeAsync(10_001);
            await saving;
            expect(mockRouter.navigate).not.toHaveBeenCalled();
            expect(component.isLoading).toBe(false);
            expect(component.termsFormGroup.enabled).toBe(true);
            expect(component.errorMessage()).toContain('Your choices are saved');
            expect(component.errorMessage()).toContain('try again');
            expect(TestBed.inject(AppHapticsService).error).toHaveBeenCalledOnce();
        } finally { vi.useRealTimers(); }
    });

    it('keeps just-saved consent when the auth stream emits an older profile during the save', async () => {
        await setupComponent(false);
        const user$ = new Subject<any>();
        mockAuthService.user$ = user$;
        const localFixture = TestBed.createComponent(OnboardingComponent);
        const local = localFixture.componentInstance;
        localFixture.detectChanges();
        user$.next({ ...mockUser });
        await localFixture.whenStable();
        for (const field of ['acceptPrivacyPolicy', 'acceptDataPolicy', 'acceptTos']) {
            local.termsFormGroup.get(field)!.setValue(true);
            local.termsFormGroup.get(field)!.markAsDirty();
        }
        let resolveSave!: () => void;
        mockUserService.createOrUpdateUser.mockReturnValue(new Promise<void>(resolve => resolveSave = resolve));
        const saving = local.onTermsSubmit();
        user$.next({ ...mockUser });
        resolveSave();
        await saving;
        expect(local.user.acceptedPrivacyPolicy).toBe(true);
        expect((local.user as any).acceptedTos).toBe(true);
        expect(local.user.acceptedTrackingPolicy).toBe(false);
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
        user$.next({ ...mockUser });
        await localFixture.whenStable();
        expect(local.user.acceptedPrivacyPolicy).toBe(true);
        expect((local.user as any).acceptedTos).toBe(true);
        expect(local.user.acceptedTrackingPolicy).toBe(false);
    });

    it('restores the starting point after reloading saved consent', async () => {
        routeSnapshot.queryParamMap = convertToParamMap({ start: 'connect' });
        await setupComponent();
        expect(component.startChoice()).toBe('connect');
        component.canFinish = true;
        component.user = { ...component.user, ...savedConsent } as any;
        await component.finishOnboarding();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/services']);
    });

    it('persists a chosen starting point without adding browser history entries', async () => {
        await setupComponent();
        component.chooseStart('upload');
        expect(mockRouter.navigate).toHaveBeenCalledWith([], expect.objectContaining({
            relativeTo: routeStub, queryParams: { start: 'upload' }, queryParamsHandling: 'merge', replaceUrl: true,
        }));
    });

    it('releases saved consent after acknowledgement so later privacy changes are respected', async () => {
        await setupComponent();
        const original = component.user;
        setRequiredPoliciesAccepted();
        const tracking = component.termsFormGroup.get('acceptTrackingPolicy')!;
        tracking.setValue(true);
        tracking.markAsDirty();
        await component.onTermsSubmit();
        expect(original.acceptedPrivacyPolicy).toBe(false);
        expect(original.acceptedTrackingPolicy).toBe(false);
        const acknowledged = { ...component.user };
        component.user = acknowledged;
        component.ngOnChanges({ user: { firstChange: false } as any });
        const revoked = { ...acknowledged, acceptedTrackingPolicy: false };
        component.user = revoked;
        component.ngOnChanges({ user: { firstChange: false } as any });
        expect(component.user.acceptedTrackingPolicy).toBe(false);
        expect(tracking.value).toBe(false);
        expect(revoked.acceptedTrackingPolicy).toBe(false);
        await fixture.whenStable();
    });

    it('does not carry dirty consent into a different account', async () => {
        await setupComponent();
        setRequiredPoliciesAccepted();
        component.stage.set('privacy');
        component.termsFormGroup.markAsDirty();
        component.termsFormGroup.get('acceptPrivacyPolicy')!.markAsDirty();
        component.user = { ...mockUser, uid: 'another-account' } as any;
        component.ngOnChanges({ user: { firstChange: false } as any });
        expect(component.termsFormGroup.valid).toBe(false);
        expect(component.stage()).toBe('start');
        expect(component.termsFormGroup.get('acceptPrivacyPolicy')!.value).toBe(false);
        await fixture.whenStable();
    });

    it.each(['destroy', 'account change'])('stops completion after %s during a save', async change => {
        await setupComponent();
        component.user = { ...component.user, ...savedConsent } as any;
        let resolveSave!: () => void;
        mockUserService.updateUserProperties.mockReturnValue(new Promise<void>(resolve => resolveSave = resolve));
        const finishing = component.finishOnboarding();
        if (change === 'destroy') fixture.destroy();
        else component.user = { ...mockUser, uid: 'another-account' } as any;
        resolveSave();
        await finishing;
        expect(mockUserService.updateUserProperties).toHaveBeenCalledOnce();
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockRouter.navigate).not.toHaveBeenCalled();
        expect(TestBed.inject(AppHapticsService).success).not.toHaveBeenCalled();
    });

    it.each([
        { step: 'privacy', paid: false }, { step: 'start', paid: false }, { step: 'intro', paid: false },
        { step: 'privacy', paid: true }, { step: 'start', paid: true }, { step: 'intro', paid: true },
    ])('keeps the chosen $step step on a background profile update (paid: $paid)', async ({ step, paid }) => {
        await setupComponent();
        component.chooseStart('analyze');
        component.continueFromStart();
        if (step !== 'privacy') component.back();
        if (step === 'intro') component.showIntro();
        mockRouter.navigate.mockClear();
        component.user = { ...component.user, stripeRole: paid ? 'pro' : 'free', acceptedPrivacyPolicy:true, acceptedDataPolicy:true, acceptedTos:true } as any;
        component.ngOnChanges({ user: { firstChange: false } as any });
        await fixture.whenStable();
        expect(component.stage()).toBe(step);
        expect(mockRouter.navigate).not.toHaveBeenCalled();
        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
    });

    it.each([false, true])('keeps an explicitly opened tour when a complete profile arrives (paid: %s)', async paid => {
        await setupComponent();
        component.showIntro();
        component.user = { ...mockUser, ...savedConsent, stripeRole: paid ? 'pro' : 'free' } as any;
        component.ngOnChanges({ user: { firstChange: false } as any });
        await fixture.whenStable();
        expect(component.stage()).toBe('intro');
        expect(mockRouter.navigate).not.toHaveBeenCalled();
        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
    });

    it('coalesces concurrent completion calls into one account write', async () => {
        await setupComponent(false);
        let resolveSave!: () => void;
        component.canFinish = true;
        component.user = { ...component.user, ...savedConsent } as any;
        mockUserService.updateUserProperties.mockReturnValue(new Promise<void>(resolve => resolveSave = resolve));
        const finishing = component.finishOnboarding();
        await component.finishOnboarding();
        expect(mockUserService.updateUserProperties).toHaveBeenCalledOnce();
        resolveSave();
        await finishing;
        expect(mockRouter.navigate).toHaveBeenCalledOnce();
    });

    it.each(['paid', 'free'])('completes a %s account using saved consent while the auth profile is stale', async choice => {
        await setupComponent();
        const original = {...mockUser, stripeRole: choice === 'paid' ? 'pro' : 'free'};
        component.user = original as any;
        component.ngOnChanges({ user: { firstChange: false } as any });
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        expect(original.acceptedPrivacyPolicy).toBe(false);
        expect(mockUserService.createOrUpdateUser).toHaveBeenCalledWith(expect.objectContaining({
            ...savedConsent, acceptedTrackingPolicy:false, acceptedMarketingPolicy:false,
        }), {completeOnboarding:true});
        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
        expect(mockPaymentService.getProducts).not.toHaveBeenCalled();
        expect(mockPaymentService.appendCheckoutSession).not.toHaveBeenCalled();
    });

    it('resets scroll and focus between intent selection and required consent', async () => {
        await setupComponent(true);
        component.chooseStart('analyze');
        fixture.detectChanges();
        clickButton('Continue');
        await fixture.whenStable();
        expect(component.stage()).toBe('privacy');
        expect(navigationEffects.scrollToTop).toHaveBeenCalledOnce();
        expect(document.activeElement).toBe(fixture.nativeElement.querySelector('h1'));
        navigationEffects.scrollToTop.mockClear();
        clickButton('Back');
        await fixture.whenStable();
        expect(component.stage()).toBe('start');
        expect(navigationEffects.scrollToTop).toHaveBeenCalledOnce();
    });

    it('resumes a saved intent at consent without initializing Starter automatically', async () => {
        routeSnapshot.queryParamMap = convertToParamMap({start:'analyze'});
        const localFixture = TestBed.createComponent(OnboardingComponent);
        localFixture.componentInstance.user = {...mockUser, acceptedPrivacyPolicy:true, acceptedDataPolicy:true, acceptedTos:true} as any;
        localFixture.detectChanges();
        await localFixture.whenStable();
        await vi.waitFor(() => expect(localFixture.componentInstance.stage()).toBe('privacy'));
        localFixture.detectChanges();
        await localFixture.whenStable();
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
        expect(mockPaymentService.getProducts).not.toHaveBeenCalled();
    });

    it('should create', async () => {
        await setupComponent(false);
        expect(component).toBeTruthy();
    });

    it('should initialize termsFormGroup with all policy controls', async () => {
        await setupComponent(false);
        expect(component.termsFormGroup).toBeTruthy();
        expect(component.termsFormGroup.get('acceptPrivacyPolicy')).toBeTruthy();
        expect(component.termsFormGroup.get('acceptDataPolicy')).toBeTruthy();
        expect(component.termsFormGroup.get('acceptTrackingPolicy')).toBeTruthy();
        expect(component.termsFormGroup.get('acceptTos')).toBeTruthy();
        expect(component.termsFormGroup.get('acceptMarketingPolicy')).toBeTruthy();
    });

    it('starts with the starting-point choice without loading prices or saving consent', async () => {
        await setupComponent(false);
        expect(component.stage()).toBe('start');
        expect(mockPaymentService.getProducts).not.toHaveBeenCalled();
        expect(mockUserService.createOrUpdateUser).not.toHaveBeenCalled();
    });

    it('should render the legal consent form inside the centered onboarding form shell', async () => {
        await setupComponent(true);
        component.stage.set('privacy');
        fixture.detectChanges();
        const onboardingForm = fixture.nativeElement.querySelector('form.onboarding-form');
        expect(onboardingForm).toBeTruthy();
    });

    it('renders only the current stage action bar', async () => {
        await setupComponent(true);
        const actionBars = fixture.nativeElement.querySelectorAll('.onboarding-actions');
        expect(actionBars.length).toBe(1);
    });







    it('should keep consent controls unchecked by default', async () => {
        await setupComponent(false);
        expect(component.termsFormGroup.get('acceptPrivacyPolicy')?.value).toBe(false);
        expect(component.termsFormGroup.get('acceptDataPolicy')?.value).toBe(false);
        expect(component.termsFormGroup.get('acceptTos')?.value).toBe(false);
        expect(component.termsFormGroup.get('acceptTrackingPolicy')?.value).toBe(false);
        expect(component.termsFormGroup.get('acceptMarketingPolicy')?.value).toBe(false);
    });

    it('should mark acceptMarketingPolicy as optional (no validators)', async () => {
        await setupComponent(false);
        const marketingControl = component.termsFormGroup.get('acceptMarketingPolicy');
        expect(marketingControl).toBeTruthy();

        marketingControl!.setValue(false);
        expect(marketingControl!.valid).toBe(true);

        marketingControl!.setValue(true);
        expect(marketingControl!.valid).toBe(true);
    });

    it('should mark acceptTrackingPolicy as optional (no validators)', async () => {
        await setupComponent(false);
        const trackingControl = component.termsFormGroup.get('acceptTrackingPolicy');
        expect(trackingControl).toBeTruthy();

        trackingControl!.setValue(false);
        expect(trackingControl!.valid).toBe(true);
    });

    it('should require acceptPrivacyPolicy to be true', async () => {
        await setupComponent(false);
        const privacyControl = component.termsFormGroup.get('acceptPrivacyPolicy');
        expect(privacyControl).toBeTruthy();

        privacyControl!.setValue(false);
        expect(privacyControl!.valid).toBe(false);

        privacyControl!.setValue(true);
        expect(privacyControl!.valid).toBe(true);
    });

    it('should use form value for optional policies on submit', async () => {
        await setupComponent(false);
        setRequiredPoliciesAccepted();

        component.termsFormGroup.get('acceptTrackingPolicy')!.setValue(false);
        component.termsFormGroup.get('acceptMarketingPolicy')!.setValue(true);

        await component.onTermsSubmit();

        expect(component.user.acceptedPrivacyPolicy).toBe(true);
        expect(component.user.acceptedDataPolicy).toBe(true);
        expect((component.user as any).acceptedTos).toBe(true);
        expect(component.user.acceptedTrackingPolicy).toBe(false);
        expect((component.user as any).acceptedMarketingPolicy).toBe(true);
    });

    it('should preserve false value for acceptMarketingPolicy when unchecked', async () => {
        await setupComponent(false);
        setRequiredPoliciesAccepted();
        component.termsFormGroup.get('acceptTrackingPolicy')!.setValue(true);
        component.termsFormGroup.get('acceptMarketingPolicy')!.setValue(false);

        await component.onTermsSubmit();

        expect((component.user as any).acceptedMarketingPolicy).toBe(false);
    });

    it('should call createOrUpdateUser on valid form submission', async () => {
        await setupComponent(false);
        setRequiredPoliciesAccepted();

        await component.onTermsSubmit();

        expect(mockUserService.createOrUpdateUser).toHaveBeenCalledWith(expect.objectContaining(savedConsent), { completeOnboarding: true });
    });

    it('should not submit if form is invalid', async () => {
        await setupComponent(false);
        component.termsFormGroup.get('acceptPrivacyPolicy')!.setValue(false);

        await component.onTermsSubmit();

        expect(mockUserService.createOrUpdateUser).not.toHaveBeenCalled();
    });

    it('should mark all controls touched when submit is invalid', async () => {
        await setupComponent(false);
        const markAllAsTouchedSpy = vi.spyOn(component.termsFormGroup, 'markAllAsTouched');

        await component.onTermsSubmit();

        expect(markAllAsTouchedSpy).toHaveBeenCalled();
    });

    it('should preserve the same FormGroup instance when user input changes', async () => {
        await setupComponent(false);
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

    it('should NOT overwrite dirty form controls with incoming user data', async () => {
        await setupComponent(false);
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

    it('should patch non-dirty form controls on ngOnChanges', async () => {
        await setupComponent(false);
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

    it('should call checkAndAdvance in ngOnChanges only after first change', async () => {
        await setupComponent(false);
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

    it('should populate user from auth stream when @Input user is missing', async () => {
        await setupComponent(false);
        const authUser = { ...mockUser, acceptedPrivacyPolicy: true };
        mockAuthService.user$ = of(authUser);

        const localFixture = TestBed.createComponent(OnboardingComponent);
        const localComponent = localFixture.componentInstance;

        localFixture.detectChanges();

        expect(localComponent.user).toEqual(authUser);
    });

    it('should patch non-dirty controls when auth stream emits after form creation', async () => {
        await setupComponent(false);
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

    it('should log tutorial_begin on init', async () => {
        await setupComponent(false);
        const localFixture = TestBed.createComponent(OnboardingComponent);
        const localComponent = localFixture.componentInstance;
        localComponent.user = { ...mockUser } as any;

        localFixture.detectChanges();

        expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('tutorial_begin');
    });

    it('should finish onboarding from checkAndAdvance when terms are accepted and user can finish', async () => {
        await setupComponent(false);
        component.user = {
            ...mockUser,
            acceptedPrivacyPolicy: true,
            acceptedDataPolicy: true,
            acceptedTos: true
        } as any;
        component.user = { ...component.user, stripeRole: 'pro' } as any;
        const finishSpy = vi.spyOn(component as any, 'finishOnboarding').mockResolvedValue(undefined);
        component.ngOnChanges({ user: { firstChange: false } as any });
        await fixture.whenStable();

        expect(component.canFinish).toBe(true);
        expect(finishSpy).toHaveBeenCalled();
    });

    it('keeps the goal choice for saved consent without a remembered intent', async () => {
        await setupComponent();
        component.user = {...mockUser, acceptedPrivacyPolicy:true, acceptedDataPolicy:true, acceptedTos:true} as any;
        await (component as any).checkAndAdvance();
        expect(component.stage()).toBe('start');
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('does not advance or finish with missing required consent even for paid accounts', async () => {
        await setupComponent(false);
        component.user = { ...mockUser, acceptedPrivacyPolicy: true, acceptedDataPolicy: false, acceptedTos: true } as any;
        mockUserService.hasPaidAccess.mockResolvedValue(true);
        const finish = vi.spyOn(component, 'finishOnboarding');
        await (component as any).checkAndAdvance();
        expect(component.stage()).toBe('start');
        expect(finish).not.toHaveBeenCalled();
    });

    it('does not check membership before the user is available', async () => {
        await setupComponent(false);
        component.user = undefined as any;
        await (component as any).checkAndAdvance();
        expect(mockUserService.isPro).not.toHaveBeenCalled();
        expect(mockUserService.hasPaidAccess).not.toHaveBeenCalled();
    });

    it('completes Starter after saving valid consent without a plan step', async () => {
        await setupComponent(false);
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
        expect(mockUserService.createOrUpdateUser).toHaveBeenCalled();
    });

    it('logs the saved legal consent step', async () => {
        await setupComponent(false);
        setRequiredPoliciesAccepted();

        await component.onTermsSubmit();

        expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('onboarding_step', {
            step_index: 1,
            step_label: 'Legal consent',
            onboarding_goal: 'other',
            destination: 'dashboard',
        });
    });

    it('should finish onboarding on terms submit when user is already subscribed', async () => {
        await setupComponent(false);
        setRequiredPoliciesAccepted();
        component.user = { ...component.user, stripeRole: 'pro' } as any;
        await component.onTermsSubmit();
        expect(mockUserService.createOrUpdateUser).toHaveBeenCalledWith(expect.objectContaining(savedConsent), { completeOnboarding: true });
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
        expect(mockPaymentService.getProducts).not.toHaveBeenCalled();
    });

    it('should log and recover when createOrUpdateUser fails on terms submit', async () => {
        await setupComponent(false);
        setRequiredPoliciesAccepted();
        mockUserService.createOrUpdateUser.mockRejectedValue(new Error('save failed'));

        await component.onTermsSubmit();

        expect(mockLoggerService.error).toHaveBeenCalledWith('Error updating user terms:', expect.any(Error));
        expect(component.isLoading).toBe(false);
        expect(mockPaymentService.getProducts).not.toHaveBeenCalled();
    });

    it('completes a returning free account with one write and no membership read', async () => {
        await setupComponent(false);
        component.canFinish = false;
        component.user = { ...component.user, ...savedConsent } as any;

        await component.finishOnboarding();

        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockUserService.hasPaidAccess).not.toHaveBeenCalled();
        expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(component.user, { onboardingCompleted: true });
        expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('tutorial_complete', { onboarding_goal: 'other', destination: 'dashboard' });
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
        expect(component.isLoading).toBe(false);
    });

    it('completes a returning paid account without changing its plan', async () => {
        await setupComponent(false);
        component.canFinish = false;
        component.user = { ...component.user, ...savedConsent, stripeRole: 'pro' } as any;

        await component.finishOnboarding();

        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(component.user, { onboardingCompleted: true });
    });

    it.each([{ path: '/tools/compare', label: 'Compare' }, { path: '/services', label: 'Connections' }])(
        'returns to $label after required consent and free account setup complete', async ({ path, label }) => {
        await setupComponent(false);
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

            expect(mockUserService.createOrUpdateUser).toHaveBeenCalledWith(expect.objectContaining(savedConsent), { completeOnboarding: true });
            expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
            expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
            expect(mockRouter.navigate).toHaveBeenCalledWith([path]);
            returnFixture.detectChanges();
            expect(returnFixture.nativeElement.textContent.replace(/\s+/g, ' ')).toContain(path === '/tools/compare' ? 'Continue free' : `Continue to ${label}`);
            expect(returningComponent.isLoading).toBe(false);
        },
    );

    it.each(['/tools/compare', '/services'])(
        'returns an already completed account to %s without rewriting its profile', async (path) => {
        await setupComponent(false);
            routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: path });
            const returningComponent = TestBed.createComponent(OnboardingComponent).componentInstance;
            returningComponent.user = { ...mockUser, ...savedConsent, onboardingCompleted: true } as any;

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
        await setupComponent(false);
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: `/services?serviceName=${encodeURIComponent(serviceName)}` });
        const returnFixture = TestBed.createComponent(OnboardingComponent);
        const returningComponent = returnFixture.componentInstance;
        returningComponent.user = { ...mockUser, ...(onboardingCompleted ? savedConsent : {}), onboardingCompleted } as any;
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
        await setupComponent(false);
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/mcp/authorize', request_id: 'request-1' });
        const returnFixture = TestBed.createComponent(OnboardingComponent);
        const returningComponent = returnFixture.componentInstance;
        returningComponent.user = { ...mockUser, ...(onboardingCompleted ? savedConsent : {}), onboardingCompleted } as any;
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
        await setupComponent(false);
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/subscriptions' });
        const returningComponent = TestBed.createComponent(OnboardingComponent).componentInstance;
        returningComponent.user = { ...mockUser, ...savedConsent, onboardingCompleted: true } as any;

        await returningComponent.finishOnboarding();

        expect(mockRouter.navigate).toHaveBeenCalledWith(['/subscriptions']);
        expect(returningComponent.completionLabel).toBe('Membership');
    });

    it('preserves the chosen membership price after account setup without starting checkout', async () => {
        await setupComponent(false);
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/subscriptions?priceId=price_pro_yearly&ignored=value' });
        const returningComponent = TestBed.createComponent(OnboardingComponent).componentInstance;
        returningComponent.user = { ...mockUser, ...savedConsent, onboardingCompleted: true } as any;

        await returningComponent.finishOnboarding();

        expect(mockRouter.navigate).toHaveBeenCalledWith(['/subscriptions'], { queryParams: { priceId: 'price_pro_yearly' } });
        expect(returningComponent.completionLabel).toBe('Membership');
        expect(mockPaymentService.getProducts).not.toHaveBeenCalled();
    });

    it.each([
        { returnUrl: '/subscriptions?priceId=price_pro_yearly', path: '/subscriptions', label: 'Membership', queryParams: { priceId: 'price_pro_yearly' } },
        { returnUrl: '/subscriptions', path: '/subscriptions', label: 'Membership', queryParams: null },
        { returnUrl: '//example.com/subscriptions?priceId=price_pro_yearly', path: '/dashboard', label: 'Dashboard', queryParams: null },
    ])('uses the latest safe membership return URL when onboarding is reused: $returnUrl', async ({ returnUrl, path, label, queryParams }) => {
        await setupComponent(false);
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/subscriptions?priceId=price_pro_monthly' });
        routeStub.queryParamMap = new BehaviorSubject(routeSnapshot.queryParamMap);
        const returningComponent = TestBed.createComponent(OnboardingComponent).componentInstance;
        returningComponent.user = { ...mockUser, ...savedConsent, onboardingCompleted: true } as any;

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
        await setupComponent(false);
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/mcp/authorize', request_id });
        const returningComponent = TestBed.createComponent(OnboardingComponent).componentInstance;
        returningComponent.user = { ...mockUser, ...savedConsent, onboardingCompleted: true } as any;
        await returningComponent.finishOnboarding();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it.each(['https://example.com', '//example.com', '/login', '/onboarding', '/tools/compare?other=1', '/services?connect=1', '/services/garmin', '/mcp/authorize?request_id=request-1'])(
        'ignores unsupported onboarding return destinations: %s', async (returnUrl) => {
        await setupComponent(false);
            routeSnapshot.queryParamMap = convertToParamMap({ returnUrl });
            const returningComponent = TestBed.createComponent(OnboardingComponent).componentInstance;
            returningComponent.user = { ...mockUser, ...savedConsent, onboardingCompleted: true } as any;

            await returningComponent.finishOnboarding();

            expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
        },
    );

    it('should skip hasPaidAccess and free-tier logic when canFinish is already true', async () => {
        await setupComponent(false);
        await fixture.whenStable();
        vi.clearAllMocks();
        component.canFinish = true;
        component.user = { ...component.user, ...savedConsent } as any;

        await component.finishOnboarding();

        expect(mockUserService.hasPaidAccess).not.toHaveBeenCalled();
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(component.user, { onboardingCompleted: true });
    });

    it('should handle finishOnboarding errors and avoid dashboard navigation', async () => {
        await setupComponent(false);
        component.canFinish = true;
        component.user = { ...component.user, ...savedConsent } as any;
        mockUserService.updateUserProperties.mockRejectedValue(new Error('update failed'));

        await component.finishOnboarding();

        expect(mockLoggerService.error).toHaveBeenCalledWith('Error completing onboarding:', expect.any(Error));
        expect(mockRouter.navigate).not.toHaveBeenCalledWith(['/dashboard']);
        expect(component.isLoading).toBe(false);
    });

    it('should leave onboarding without reads, writes or completion analytics when the account is already complete', async () => {
        await setupComponent(false);
        await fixture.whenStable();
        vi.clearAllMocks();
        component.user = { ...component.user, ...savedConsent, onboardingCompleted: true } as any;
        component.canFinish = false;

        await component.finishOnboarding();

        expect(mockUserService.hasPaidAccess).not.toHaveBeenCalled();
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
        expect(mockAnalyticsService.logEvent).not.toHaveBeenCalled();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it.each(['cancel', 'throw'])('does not label an already completed account redirect failure as a consent-save failure (%s)', async failure => {
        await setupComponent(false, { acceptedTrackingPolicy: true });
        component.user = { ...component.user, ...savedConsent, onboardingCompleted: true } as any;
        if (failure === 'cancel') mockRouter.navigate.mockResolvedValueOnce(false);
        else mockRouter.navigate.mockRejectedValueOnce(new Error('Navigation failed'));
        await component.finishOnboarding();
        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
        expect(mockAnalyticsService.logEvent).not.toHaveBeenCalled();
        expect(mockAnalyticsService.logOnboardingFlow).not.toHaveBeenCalled();
        expect(component.errorMessage()).toContain('try again');
    });

    it('does not let a direct completion call bypass required consent', async () => {
        await setupComponent();
        await component.finishOnboarding();
        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
        expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('shows a retryable navigation error after the setup write succeeds', async () => {
        await setupComponent();
        component.user = { ...component.user, ...savedConsent } as any;
        mockRouter.navigate.mockResolvedValueOnce(false);
        await component.finishOnboarding();
        expect(component.errorMessage()).toContain('try again');
        expect(component.isLoading).toBe(false);
        expect(TestBed.inject(AppHapticsService).success).not.toHaveBeenCalled();
        expect(TestBed.inject(AppHapticsService).error).toHaveBeenCalledOnce();
        expect(mockAnalyticsService.logEvent).not.toHaveBeenCalledWith('tutorial_complete', expect.anything());
        expect(mockAnalyticsService.logOnboardingFlow).toHaveBeenCalledWith('other', 'failed', {
            destination: 'dashboard', failureStage: 'navigation',
        });
    });

    it.each([
        { flow: 'analyze', destination: 'dashboard', path: '/dashboard', role: null },
        { flow: 'compare', destination: 'compare', path: '/tools/compare', role: null },
        { flow: 'sync', destination: 'pro_plans', path: '/subscriptions?setup=sync', role: null },
        { flow: 'sync', destination: 'pro_plans', path: '/subscriptions?setup=sync', role: 'basic' },
        { flow: 'sync', destination: 'connections', path: '/services?setup=sync', role: 'pro' },
    ] as const)('records $flow reaching $destination only after navigation finishes ($role)', async ({ flow, destination, path, role }) => {
        await setupComponent(false, { stripeRole: role });
        component.chooseStart(flow);
        setRequiredPoliciesAccepted();
        let finishNavigation!: (result: boolean) => void;
        mockRouter.navigate.mockImplementationOnce(() => new Promise<boolean>(resolve => { finishNavigation = resolve; }));
        const submission = component.onTermsSubmit();
        await vi.waitFor(() => expect(finishNavigation).toBeTypeOf('function'));
        expect(mockAnalyticsService.logOnboardingFlow).toHaveBeenCalledWith(flow, 'consent_saved', { destination });
        expect(mockAnalyticsService.logOnboardingFlow).not.toHaveBeenCalledWith(flow, 'destination_reached', expect.anything());
        expect(mockAnalyticsService.logEvent).not.toHaveBeenCalledWith('tutorial_complete', expect.anything());
        mockRouter.url = path;
        finishNavigation(true);
        await submission;
        expect(mockAnalyticsService.logOnboardingFlow).toHaveBeenCalledWith(flow, 'destination_reached', { destination });
        expect(mockAnalyticsService.logEvent).toHaveBeenCalledWith('tutorial_complete', { onboarding_goal: flow, destination });
    });

    it('does not count a successful guard redirect back to setup as reaching the destination', async () => {
        await setupComponent();
        component.chooseStart('sync');
        setRequiredPoliciesAccepted();
        mockRouter.navigate.mockImplementationOnce(async () => { mockRouter.url = '/onboarding'; return true; });
        await component.onTermsSubmit();
        expect(mockAnalyticsService.logOnboardingFlow).toHaveBeenCalledWith('sync', 'failed', {
            destination: 'pro_plans', failureStage: 'navigation',
        });
        expect(mockAnalyticsService.logEvent).not.toHaveBeenCalledWith('tutorial_complete', expect.anything());
    });

    it('does not attribute a pending navigation result to a different signed-in account', async () => {
        await setupComponent();
        component.chooseStart('analyze');
        setRequiredPoliciesAccepted();
        let finishNavigation!: (result: boolean) => void;
        mockRouter.navigate.mockImplementationOnce(() => new Promise<boolean>(resolve => { finishNavigation = resolve; }));
        const submission = component.onTermsSubmit();
        await vi.waitFor(() => expect(finishNavigation).toBeTypeOf('function'));
        mockAuthService.currentUser = { uid: 'another-account' };
        mockRouter.url = '/dashboard';
        finishNavigation(true);
        await submission;
        expect(mockAnalyticsService.logOnboardingFlow).not.toHaveBeenCalledWith('analyze', 'destination_reached', expect.anything());
        expect(mockAnalyticsService.logOnboardingFlow).not.toHaveBeenCalledWith('analyze', 'failed', expect.anything());
        expect(mockAnalyticsService.logEvent).not.toHaveBeenCalledWith('tutorial_complete', expect.anything());
    });

    it('retries a suppressed choice after consent saves, without duplicating an already tracked selection', async () => {
        await setupComponent();
        mockAnalyticsService.logOnboardingFlow.mockReturnValueOnce(false);
        component.chooseStart('analyze');
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        expect(mockAnalyticsService.logOnboardingFlow.mock.calls.filter(call => call[1] === 'selected')).toHaveLength(2);
    });

    it('does not label generic membership as the Sync Pro-plan destination when its setup hint is lost', async () => {
        await setupComponent();
        component.chooseStart('sync');
        setRequiredPoliciesAccepted();
        mockRouter.navigate.mockImplementationOnce(async () => { mockRouter.url = '/subscriptions'; return true; });
        await component.onTermsSubmit();
        expect(mockAnalyticsService.logOnboardingFlow).toHaveBeenCalledWith('sync', 'failed', {
            destination: 'pro_plans', failureStage: 'navigation',
        });
        expect(mockAnalyticsService.logEvent).not.toHaveBeenCalledWith('tutorial_complete', expect.anything());
    });

    it('should sign out and navigate to login on logout', async () => {
        await setupComponent(false);
        await component.logout();

        expect(mockAuthService.signOut).toHaveBeenCalled();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/login']);
    });





    it.each([
        { access: {}, plans: true },
        { access: { stripeRole: 'basic' }, plans: true },
        { access: { stripeRole: 'pro' }, plans: false },
        { access: { admin: true }, plans: false },
        { access: { isPro: true }, plans: false },
        { access: { gracePeriodUntil: new Date(Date.now() + 60_000) }, plans: false },
    ])('routes sync according to existing access: $access', async ({ access, plans }) => {
        routeSnapshot.queryParamMap = convertToParamMap({ start: 'sync' });
        await setupComponent(true, access);
        component.continueFromStart();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('button[type="submit"]').textContent)
            .toContain(plans ? 'Choose a Pro plan' : 'Continue to Connections');
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        expect(mockRouter.navigate).toHaveBeenCalledWith([plans ? '/subscriptions' : '/services'], { queryParams: { setup: 'sync' } });
        expect(mockUserService.hasPaidAccess).not.toHaveBeenCalled();
        expect(mockUserService.isPro).not.toHaveBeenCalled();
        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
        expect(mockPaymentService.appendCheckoutSession).not.toHaveBeenCalled();
    });

    it('should return empty string for empty form control name mapping', async () => {
        await setupComponent(false);
        const mapped = (component as any).mapFormControlNameToUserProperty('');

        expect(mapped).toBe('');
    });

    it('should handle required policies without formControlName in checkAndAdvance', async () => {
        await setupComponent(false);
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
        await setupComponent(false);
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

        await component.onTermsSubmit();

        expect(mockUserService.createOrUpdateUser).toHaveBeenCalledWith(expect.objectContaining(savedConsent), { completeOnboarding: true });
    });

    it('should return false from getPolicyValue for unknown control mappings', async () => {
        await setupComponent(false);
        const result = (component as any).getPolicyValue({ formControlName: 'acceptUnknown' }, component.user);

        expect(result).toBe(false);
    });

    it('should toggle policy details panel on read more', async () => {
        await setupComponent(false);
        component.togglePolicyDetails('privacy');
        expect(component.expandedPolicyId).toBe('privacy');

        component.togglePolicyDetails('privacy');
        expect(component.expandedPolicyId).toBeNull();
    });

    it('should auto-close expanded details when policy is checked', async () => {
        await setupComponent(false);
        component.expandedPolicyId = 'privacy';

        component.onPolicyCheckboxChange('privacy', true);

        expect(component.expandedPolicyId).toBeNull();
    });

    it('should keep expanded details when policy is unchecked', async () => {
        await setupComponent(false);
        component.expandedPolicyId = 'privacy';

        component.onPolicyCheckboxChange('privacy', false);

        expect(component.expandedPolicyId).toBe('privacy');
    });

    it('should keep expanded details when a different policy is checked', async () => {
        await setupComponent(false);
        component.expandedPolicyId = 'privacy';

        component.onPolicyCheckboxChange('data', true);

        expect(component.expandedPolicyId).toBe('privacy');
    });
});
