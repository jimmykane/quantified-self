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
        component.chapterIndex.set(chapter);
        fixture.detectChanges();
        clickButton('Skip the intro');
        expect(component.stage()).toBe('start');
        expect(component.termsFormGroup.invalid).toBe(true);
        expect(mockUserService.createOrUpdateUser).not.toHaveBeenCalled();
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        expect(mockPaymentService.getProducts).not.toHaveBeenCalled();
    });

    it('takes the full tour forward and back with focus on the new heading', async () => {
        await setupComponent(true);
        clickButton('Next');
        expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Track your training');
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
        { choice: 'connect', path: '/services' },
        { choice: 'upload', path: '/dashboard' },
        { choice: 'explore', path: '/dashboard' },
    ] as const)('completes $choice through existing pricing and the $path workspace', async ({ choice, path }) => {
        await setupComponent(true);
        clickButton('Skip the intro');
        expect((fixture.nativeElement.querySelector('.onboarding-actions button[mat-flat-button]') as HTMLButtonElement).disabled).toBe(true);
        const radio = fixture.nativeElement.querySelector(`mat-radio-button[value="${choice}"] input`) as HTMLInputElement;
        radio.click();
        fixture.detectChanges();
        clickButton('Continue');
        expect(component.stage()).toBe('privacy');
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(fixture.debugElement.query(By.directive(PricingComponent)).componentInstance.onboardingUser).toBe(component.user);
        await component.finishOnboarding();
        expect(mockRouter.navigate).toHaveBeenCalledWith([path]);
        expect(mockDialog.open).not.toHaveBeenCalled();
    });

    it('keeps the starting point and consent choices when moving back', async () => {
        await setupComponent(false);
        component.skipIntro();
        component.chooseStart('upload');
        component.continueFromStart();
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        component.back();
        expect(component.stage()).toBe('privacy');
        expect(component.termsFormGroup.valid).toBe(true);
        component.back();
        expect(component.startChoice()).toBe('upload');
        expect(component.stage()).toBe('start');
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
        component.skipIntro();
        component.skipIntro();
        expect(haptics.selection).toHaveBeenCalledTimes(2);
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
        expect(component.stage()).toBe('plan');
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
        expect(component.stage()).toBe('plan');
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
        expect(local.stage()).toBe('plan');
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
        component.stage.set('plan');
        component.termsFormGroup.markAsDirty();
        component.termsFormGroup.get('acceptPrivacyPolicy')!.markAsDirty();
        component.user = { ...mockUser, uid: 'another-account' } as any;
        component.ngOnChanges({ user: { firstChange: false } as any });
        expect(component.termsFormGroup.valid).toBe(false);
        expect(component.stage()).toBe('intro');
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

    it('does not undo a deliberate Back to privacy on a background profile update', async () => {
        await setupComponent(false);
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        component.back();
        await (component as any).checkAndAdvance();
        expect(component.stage()).toBe('privacy');
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

    it.each(['paid', 'free'])('uses the just-saved onboarding consent for the %s choice while the auth profile is stale', async choice => {
        await setupComponent(false);
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
        localFixture.detectChanges();
        expect(local.stage()).toBe('plan');
        expect(staleAuthUser.acceptedPrivacyPolicy).toBe(false);
        expect(mockPaymentService.appendCheckoutSession).not.toHaveBeenCalled();
        expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        const selector = choice === 'paid' ? '.pro-card .subscribe-btn' : '.continue-free-button';
        (localFixture.nativeElement.querySelector(selector) as HTMLButtonElement).click();
        await localFixture.whenStable();
        if (choice === 'paid') {
            expect(mockPaymentService.appendCheckoutSession).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'price_pro_monthly' }),
                expect.stringContaining('/payment/success?onboarding=%2Fonboarding'),
                expect.stringMatching(/\/onboarding$/), expect.any(Function), expect.any(Function),
            );
            expect(mockUserService.setFreeTier).not.toHaveBeenCalled();
        } else {
            expect(mockUserService.setFreeTier).toHaveBeenCalledWith(expect.objectContaining({
                uid: freshUser.uid, acceptedPrivacyPolicy: true, acceptedDataPolicy: true, acceptedTos: true,
            }));
            await vi.waitFor(() => expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']));
        }
        expect(mockLoggerService.error).not.toHaveBeenCalled();
        expect(freshUser.acceptedTrackingPolicy).toBe(false);
        expect(freshUser.acceptedMarketingPolicy).toBe(false);
    });

    it('resets scroll after advancing to Plan and returning to Legal consent', async () => {
        await setupComponent(true);
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        fixture.detectChanges();
        await fixture.whenStable();
        expect(component.stage()).toBe('plan');
        expect(navigationEffects.scrollToTop).toHaveBeenCalledOnce();
        navigationEffects.scrollToTop.mockClear();

        component.onPricingLoadingChange(true);
        fixture.detectChanges();
        component.onPricingLoadingChange(false);
        fixture.detectChanges();
        await fixture.whenStable();
        expect(navigationEffects.scrollToTop).not.toHaveBeenCalled();

        const back = Array.from(fixture.nativeElement.querySelectorAll('button')).find((button: HTMLButtonElement) => button.textContent?.trim() === 'Back') as HTMLButtonElement;
        back.click();
        fixture.detectChanges();
        await fixture.whenStable();
        expect(component.stage()).toBe('privacy');
        expect(navigationEffects.scrollToTop).toHaveBeenCalledOnce();
    });

    it('resets scroll on entry and when saved consent automatically advances to Plan', async () => {
        await setupComponent(false);
        const localFixture = TestBed.createComponent(OnboardingComponent);
        localFixture.componentInstance.user = {
            ...mockUser, acceptedPrivacyPolicy: true, acceptedDataPolicy: true, acceptedTos: true,
        } as unknown as typeof component.user;
        localFixture.detectChanges();
        await localFixture.whenStable();

        await vi.waitFor(() => expect(localFixture.componentInstance.stage()).toBe('plan'));
        localFixture.detectChanges();
        await localFixture.whenStable();
        expect(navigationEffects.scrollToTop).toHaveBeenCalledOnce();
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

    it('starts with an optional intro without loading prices or saving consent', async () => {
        await setupComponent(false);
        expect(component.stage()).toBe('intro');
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

    it('should render pricing in onboarding mode for step 2', async () => {
        await setupComponent(true);
        component.stage.set('plan');
        fixture.detectChanges();
        const pricingComponent = fixture.debugElement.query(By.directive(PricingComponent))?.componentInstance as PricingComponent | undefined;

        expect(pricingComponent).toBeTruthy();
        expect(pricingComponent?.isOnboarding).toBe(true);
    });

    it('should disable plan footer actions while pricing is loading', async () => {
        await setupComponent(true);
        component.stage.set('plan');
        fixture.detectChanges();
        component.onPricingLoadingChange(true);
        fixture.detectChanges();

        const buttons = Array.from(fixture.nativeElement.querySelectorAll('.onboarding-actions button')) as HTMLButtonElement[];
        const backButton = buttons.find(button => button.textContent?.includes('Back')) ?? null;
        const continueButton = buttons.find(button => button.textContent?.includes('Continue to')) ?? null;

        expect(backButton?.disabled).toBe(true);
        expect(continueButton?.disabled).toBe(true);
    });

    it('disables every pricing action while account completion is pending', async () => {
        await setupComponent(true);
        mockPaymentService.getProducts.mockReturnValue(of([{
            id: 'prod_pro', name: 'Pro', role: 'pro', active: true, metadata: { role: 'pro' }, images: [],
            prices: [{ id: 'price_pro_monthly', active: true, currency: 'eur', unit_amount: 299,
                type: 'recurring', recurring: { interval: 'month' } }],
        }]));
        component.stage.set('plan');
        fixture.detectChanges();
        await fixture.whenStable();
        component.canFinish = true;
        let resolveWrite!: () => void;
        mockUserService.updateUserProperties.mockReturnValue(new Promise<void>(resolve => resolveWrite = resolve));
        const finishing = component.finishOnboarding();
        fixture.detectChanges();
        const pricing = fixture.debugElement.query(By.directive(PricingComponent)).componentInstance as PricingComponent;
        expect(pricing.onboardingBusy).toBe(true);
        const buttons = fixture.nativeElement.querySelectorAll('app-pricing .continue-free-button, app-pricing .subscribe-btn');
        expect(buttons.length).toBe(2);
        for (const button of buttons) expect(button.disabled).toBe(true);
        resolveWrite();
        await finishing;
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

    it('resumes membership when required consent is already saved', async () => {
        await setupComponent(false);
        component.user = { ...mockUser, acceptedPrivacyPolicy: true, acceptedDataPolicy: true, acceptedTos: true } as any;
        const finish = vi.spyOn(component, 'finishOnboarding');
        await (component as any).checkAndAdvance();
        expect(component.stage()).toBe('plan');
        expect(finish).not.toHaveBeenCalled();
    });

    it('does not advance or finish with missing required consent even for paid accounts', async () => {
        await setupComponent(false);
        component.user = { ...mockUser, acceptedPrivacyPolicy: true, acceptedDataPolicy: false, acceptedTos: true } as any;
        mockUserService.hasPaidAccess.mockResolvedValue(true);
        const finish = vi.spyOn(component, 'finishOnboarding');
        await (component as any).checkAndAdvance();
        expect(component.stage()).toBe('intro');
        expect(finish).not.toHaveBeenCalled();
    });

    it('does not check membership before the user is available', async () => {
        await setupComponent(false);
        component.user = undefined as any;
        await (component as any).checkAndAdvance();
        expect(mockUserService.isPro).not.toHaveBeenCalled();
        expect(mockUserService.hasPaidAccess).not.toHaveBeenCalled();
    });

    it('advances to membership after saving valid consent for non-subscribed users', async () => {
        await setupComponent(false);
        setRequiredPoliciesAccepted();
        await component.onTermsSubmit();
        expect(component.stage()).toBe('plan');
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
        expect(component.stage()).not.toBe('plan');
    });

    it('should log and recover when createOrUpdateUser fails on terms submit', async () => {
        await setupComponent(false);
        setRequiredPoliciesAccepted();
        mockUserService.createOrUpdateUser.mockRejectedValue(new Error('save failed'));

        await component.onTermsSubmit();

        expect(mockLoggerService.error).toHaveBeenCalledWith('Error updating user terms:', expect.any(Error));
        expect(component.isLoading).toBe(false);
        expect(component.stage()).not.toBe('plan');
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
            expect(returnFixture.nativeElement.textContent.replace(/\s+/g, ' ')).toContain(`Continue to ${label}`);
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
        expect(returningComponent.completionLabel).toBe('Subscriptions');
    });

    it('preserves the chosen membership price after account setup without starting checkout', async () => {
        await setupComponent(false);
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

    it('should set canFinish and trigger finishOnboarding on plan selected', async () => {
        await setupComponent(false);
        const finishSpy = vi.spyOn(component as any, 'finishOnboarding').mockResolvedValue(undefined);

        component.onPlanSelected();

        expect(component.canFinish).toBe(true);
        expect(finishSpy).toHaveBeenCalled();
    });

    it('should not trigger finishOnboarding again when planSelected arrives during loading', async () => {
        await setupComponent(false);
        component.isLoading = true;
        const finishSpy = vi.spyOn(component as any, 'finishOnboarding').mockResolvedValue(undefined);

        component.onPlanSelected();

        expect(component.canFinish).toBe(true);
        expect(finishSpy).not.toHaveBeenCalled();
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
