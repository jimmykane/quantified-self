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
    const setupComponent = async (render = false) => {
        fixture = TestBed.createComponent(OnboardingComponent);
        component = fixture.componentInstance;
        component.user = { ...mockUser } as any;
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
        { choice: 'sync', path: '/services' },
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
        expect(mockUserService.setFreeTier).toHaveBeenCalledOnce();
        expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(component.user, { onboardingCompleted: true });
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
        mockUserService.hasPaidAccess.mockResolvedValue(true);
        await setupComponent();
        component.chooseStart(choice);
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockUserService.updateUserProperties).toHaveBeenCalledOnce();
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

    it('returns a sync deep link to Connections without granting provider access', async () => {
        routeSnapshot.queryParamMap = convertToParamMap({returnUrl:'/services?setup=sync'});
        await setupComponent();
        expect(component.stage()).toBe('privacy');
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/services'], {queryParams:{setup:'sync'}});
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
        expect(mockUserService.setFreeTier).toHaveBeenCalledOnce();
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
        mockUserService.hasPaidAccess.mockResolvedValue(true);
        await setupComponent(true);
        expect(component.hasPaidMembership()).toBe(true);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('button[type="submit"]').textContent).toContain('Open Compare');
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockPaymentService.getProducts).not.toHaveBeenCalled();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/tools/compare']);
    });

    it('keeps the compact form retryable when Starter setup fails', async () => {
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/tools/compare' });
        await setupComponent(true);
        setRequiredPoliciesAccepted();
        mockUserService.setFreeTier.mockRejectedValueOnce(new Error('offline'));
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

    it.each(['destroy', 'account change'])('stops completion after %s during a membership read', async change => {
        await setupComponent();
        let resolveAccess!: (value: boolean) => void;
        mockUserService.hasPaidAccess.mockReturnValue(new Promise<boolean>(resolve => resolveAccess = resolve));
        const finishing = component.finishOnboarding();
        if (change === 'destroy') fixture.destroy();
        else component.user = { ...mockUser, uid: 'another-account' } as any;
        resolveAccess(false);
        await finishing;
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
        expect(mockRouter.navigate).not.toHaveBeenCalled();
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
        mockUserService.hasPaidAccess.mockResolvedValue(paid);
        component.user = { ...component.user, acceptedPrivacyPolicy:true, acceptedDataPolicy:true, acceptedTos:true } as any;
        await (component as any).checkAndAdvance();
        expect(component.stage()).toBe(step);
        expect(mockRouter.navigate).not.toHaveBeenCalled();
        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
    });

    it.each([false, true])('keeps an explicitly opened tour when the initial membership check resolves (paid: %s)', async paid => {
        let resolveAccess!: (value: boolean) => void;
        mockUserService.hasPaidAccess.mockReturnValue(new Promise<boolean>(resolve => resolveAccess = resolve));
        fixture = TestBed.createComponent(OnboardingComponent);
        component = fixture.componentInstance;
        component.user = { ...mockUser, acceptedPrivacyPolicy: true, acceptedDataPolicy: true, acceptedTos: true } as any;
        component.ngOnInit();
        await vi.waitFor(() => expect(mockUserService.hasPaidAccess).toHaveBeenCalled());
        component.showIntro();
        resolveAccess(paid);
        await vi.waitFor(() => expect((component as any).advancing).toBe(false));
        expect(component.stage()).toBe('intro');
        expect(mockRouter.navigate).not.toHaveBeenCalled();
        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
    });

    it('coalesces concurrent completion calls into one account write', async () => {
        await setupComponent(false);
        let resolveSave!: () => void;
        component.canFinish = true;
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
        const original = {...mockUser};
        component.user = original as any;
        mockUserService.hasPaidAccess.mockResolvedValue(choice === 'paid');
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        expect(original.acceptedPrivacyPolicy).toBe(false);
        expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(expect.objectContaining({
            acceptedPrivacyPolicy:true, acceptedDataPolicy:true, acceptedTos:true,
            acceptedTrackingPolicy:false, acceptedMarketingPolicy:false,
        }), {onboardingCompleted:true});
        if (choice === 'free') expect(mockUserService.setFreeTier).toHaveBeenCalledWith(expect.objectContaining({acceptedTos:true}));
        else expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
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

        expect(mockUserService.createOrUpdateUser).toHaveBeenCalledWith(component.user);
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
        mockUserService.hasPaidAccess.mockResolvedValue(true);
        const finishSpy = vi.spyOn(component as any, 'finishOnboarding').mockResolvedValue(undefined);

        await (component as any).checkAndAdvance();

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
            step_label: 'Legal consent'
        });
    });

    it('should finish onboarding on terms submit when user is already subscribed', async () => {
        await setupComponent(false);
        setRequiredPoliciesAccepted();
        mockUserService.hasPaidAccess.mockResolvedValue(true);
        const finishSpy = vi.spyOn(component as any, 'finishOnboarding').mockResolvedValue(undefined);

        await component.onTermsSubmit();

        expect(finishSpy).toHaveBeenCalled();
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

    it('should apply implicit free-tier in finishOnboarding when canFinish is false and user is not paid', async () => {
        await setupComponent(false);
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
        await setupComponent(false);
        component.canFinish = false;
        mockUserService.hasPaidAccess.mockResolvedValue(true);

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

            expect(mockUserService.createOrUpdateUser).toHaveBeenCalledWith(returningComponent.user);
            expect(mockUserService.setFreeTier).toHaveBeenCalledWith(returningComponent.user);
            expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(returningComponent.user, { onboardingCompleted: true });
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
        await setupComponent(false);
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
        await setupComponent(false);
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
        await setupComponent(false);
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/subscriptions' });
        const returningComponent = TestBed.createComponent(OnboardingComponent).componentInstance;
        returningComponent.user = { ...mockUser, onboardingCompleted: true } as any;

        await returningComponent.finishOnboarding();

        expect(mockRouter.navigate).toHaveBeenCalledWith(['/subscriptions']);
        expect(returningComponent.completionLabel).toBe('Membership');
    });

    it('preserves the chosen membership price after account setup without starting checkout', async () => {
        await setupComponent(false);
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/subscriptions?priceId=price_pro_yearly&ignored=value' });
        const returningComponent = TestBed.createComponent(OnboardingComponent).componentInstance;
        returningComponent.user = { ...mockUser, onboardingCompleted: true } as any;

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
        await setupComponent(false);
        routeSnapshot.queryParamMap = convertToParamMap({ returnUrl: '/mcp/authorize', request_id });
        const returningComponent = TestBed.createComponent(OnboardingComponent).componentInstance;
        returningComponent.user = { ...mockUser, onboardingCompleted: true } as any;
        await returningComponent.finishOnboarding();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it.each(['https://example.com', '//example.com', '/login', '/onboarding', '/tools/compare?other=1', '/services?connect=1', '/services/garmin', '/mcp/authorize?request_id=request-1'])(
        'ignores unsupported onboarding return destinations: %s', async (returnUrl) => {
        await setupComponent(false);
            routeSnapshot.queryParamMap = convertToParamMap({ returnUrl });
            const returningComponent = TestBed.createComponent(OnboardingComponent).componentInstance;
            returningComponent.user = { ...mockUser, onboardingCompleted: true } as any;

            await returningComponent.finishOnboarding();

            expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
        },
    );

    it('should skip hasPaidAccess and free-tier logic when canFinish is already true', async () => {
        await setupComponent(false);
        await fixture.whenStable();
        vi.clearAllMocks();
        component.canFinish = true;

        await component.finishOnboarding();

        expect(mockUserService.hasPaidAccess).not.toHaveBeenCalled();
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockUserService.updateUserProperties).toHaveBeenCalledWith(component.user, { onboardingCompleted: true });
    });

    it('should handle finishOnboarding errors and avoid dashboard navigation', async () => {
        await setupComponent(false);
        component.canFinish = true;
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
        await setupComponent(false);
        component.canFinish = false;
        mockUserService.hasPaidAccess.mockResolvedValue(false);
        mockUserService.setFreeTier.mockRejectedValue(new Error('free-tier failed'));

        await component.finishOnboarding();

        expect(mockUserService.updateUserProperties).not.toHaveBeenCalled();
        expect(mockLoggerService.error).toHaveBeenCalledWith('Error completing onboarding:', expect.any(Error));
        expect(component.isLoading).toBe(false);
    });

    it('should sign out and navigate to login on logout', async () => {
        await setupComponent(false);
        await component.logout();

        expect(mockAuthService.signOut).toHaveBeenCalled();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/login']);
    });





    it('should set isPro in checkProStatus', async () => {
        await setupComponent(false);
        mockUserService.isPro.mockResolvedValue(true);

        await component.checkProStatus();

        expect(component.isPro).toBe(true);
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

        expect(mockUserService.createOrUpdateUser).toHaveBeenCalledWith(component.user);
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
