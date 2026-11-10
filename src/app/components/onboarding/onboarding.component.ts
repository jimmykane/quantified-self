import { Component, DestroyRef, ElementRef, Injector, Input, OnChanges, OnInit, SimpleChanges, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { User } from '@sports-alliance/sports-lib';
import { AppUserService } from '../../services/app.user.service';
import { AppAuthService } from '../../authentication/app.auth.service';
import { PricingComponent } from '../pricing/pricing.component';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { AppHapticsService } from '../../services/app.haptics.service';
import { FIELD_GUIDE_CHAPTERS } from './onboarding-tour';
import { POLICY_CONTENT, PolicyItem } from '../../shared/policies.content';
import { LoggerService } from '../../services/logger.service';
import { ShellNavigationEffectsService } from '../../services/shell-navigation-effects.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppUserInterface } from '../../models/app-user.interface';
import { onboardingResumeUrl, onboardingReturnTarget, onboardingStart, OnboardingStart } from '../../helpers/onboarding-navigation.helper';
import { of } from 'rxjs';
import { OnboardingTerrainComponent } from './terrain/onboarding-terrain.component';

@Component({
    selector: 'app-onboarding',
    standalone: true,
    imports: [
        CommonModule,
        OnboardingTerrainComponent,
        MatButtonModule,
        ReactiveFormsModule,
        MatCheckboxModule,
        PricingComponent,
        MatCardModule,
        MatDividerModule,
        MatIconModule,
        MatRadioModule,
        MatProgressSpinnerModule
    ],
    templateUrl: './onboarding.component.html',
    styleUrls: ['./onboarding.component.scss']
})
export class OnboardingComponent implements OnInit, OnChanges {
    @Input() user!: User;
    readonly stage = signal<'intro' | 'start' | 'privacy' | 'plan'>('start');
    readonly chapterIndex = signal(0);
    readonly chapters = FIELD_GUIDE_CHAPTERS;
    readonly chapter = computed(() => this.chapters[this.chapterIndex()]);
    readonly startChoice = signal<OnboardingStart | null>(null);
    readonly errorMessage = signal('');
    readonly stepHeading = viewChild<ElementRef<HTMLElement>>('stepHeading');
    private readonly injector = inject(Injector);
    private readonly haptics = inject(AppHapticsService);
    private completing = false;
    private advancing = false;
    private hasNavigatedSetup = false;
    private formUserId: string | undefined;
    private savedConsent: { uid: string; values: Partial<AppUserInterface> } | null = null;
    private readonly hasReturnDestination = computed(() => this.returnTarget().path !== '/dashboard');
    readonly isCompareFlow = computed(() => this.completionTarget().path === '/tools/compare' || this.completionTarget().path === '/tools/compare/saved');
    readonly setupProgress = computed(() => this.isCompareFlow() && this.stage() === 'privacy' ? 'Compare files' : this.stage() === 'start' ? '01 / Your starting point'
        : this.stage() === 'privacy' ? '02 / Policies and preferences' : '03 / Your plan');
    readonly heroTitle = computed(() => this.stage() === 'intro' ? this.chapter().hero
        : this.stage() === 'start' ? 'Choose your first step.'
        : this.stage() === 'privacy' ? 'Set up your account.' : 'Start free or connect with Pro.');
    readonly completionHint = computed(() => this.hasReturnDestination()
        ? `After setup, you’ll return to ${this.returnTarget().label}.`
        : this.startChoice() === 'connect'
            ? 'Automatic imports require Pro. After setup, choose Garmin, Suunto, COROS or Wahoo in Connections.'
            : this.startChoice() === 'upload'
                ? 'Starter includes file uploads. After setup, select Upload in Dashboard to add an activity.'
                : 'Start with the free Starter plan. You can upload activities from Dashboard later.');

    policies: PolicyItem[] = POLICY_CONTENT.filter(p => !!p.checkboxLabel)
        .map(policy => ({
            ...policy,
            // These canonical fragments live on Policies, not inside this setup screen.
            content: policy.content.map(item => item.replace(/href="#([^"]+)"/g,
                'href="/policies#$1" target="_blank" rel="noopener"')),
        }))
        .sort((a, b) => Number(!!a.isOptional) - Number(!!b.isOptional));
    termsFormGroup!: FormGroup;
    isPro = false;
    readonly hasPaidMembership = signal(false);

    protected readonly navigationEffects = inject(ShellNavigationEffectsService);
    private authService = inject(AppAuthService);
    private userService = inject(AppUserService);
    private router = inject(Router);
    private route = inject(ActivatedRoute);
    private _formBuilder = inject(FormBuilder);
    private logger = inject(LoggerService);
    private analyticsService = inject(AppAnalyticsService);
    private destroyRef = inject(DestroyRef);
    private readonly completionQueryParams = toSignal(
        this.route.queryParamMap ?? of(this.route.snapshot.queryParamMap),
        { initialValue: this.route.snapshot.queryParamMap },
    );
    private readonly returnTarget = computed(() => onboardingReturnTarget(this.completionQueryParams()));
    readonly checkoutResumeUrl = computed(() => onboardingResumeUrl(this.completionQueryParams(), this.startChoice()));

    private readonly completionTarget = computed(() => {
        const target = this.returnTarget();
        if (this.hasReturnDestination()) return target;
        if (this.startChoice() === 'compare') return { ...target, path: '/tools/compare', label: 'Compare' };
        return this.startChoice() === 'connect'
            ? { ...target, path: '/services', label: 'Connections' } : target;
    });

    get completionPath(): string { return this.completionTarget().path; }
    get completionLabel(): string { return this.completionTarget().label; }

    ngOnInit() {
        this.startChoice.set(onboardingStart(this.completionQueryParams().get('start')));
        this.stage.set(this.hasReturnDestination() || this.isCompareFlow() ? 'privacy' : 'start');
        // Log onboarding start
        this.analyticsService.logEvent('tutorial_begin');

        // If user wasn't passed via Input (routing), get it from service
        if (!this.user) {
            this.authService.user$
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe(user => {
                    this.user = user ?? undefined!;
                    this.updateForm();
                    void this.checkAndAdvance();
                });
        }

        this.updateForm();
        void this.checkAndAdvance();
    }

    private updateForm() {
        let user = this.user || {} as User;
        const accountChanged = this.formUserId !== user.uid;
        if (accountChanged) {
            if (this.formUserId) {
                this.hasNavigatedSetup = false;
                this.stage.set(this.hasReturnDestination() || this.isCompareFlow() ? 'privacy' : 'start');
                this.chapterIndex.set(0);
                this.errorMessage.set('');
                this.expandedPolicyId = null;
            }
            this.savedConsent = null;
            this.hasPaidMembership.set(false);
            this.canFinish = false;
            this.formUserId = user.uid;
        }
        if (this.savedConsent) {
            const acknowledged = Object.entries(this.savedConsent.values).every(([key, value]) =>
                (user as AppUserInterface)[key] === value);
            if (acknowledged) this.savedConsent = null;
            else {
                // Overlay only until the saved values arrive. Never mutate the shared auth snapshot.
                user = Object.assign(Object.create(Object.getPrototypeOf(user)), user, this.savedConsent.values);
                this.user = user;
            }
        }

        if (!this.termsFormGroup || accountChanged) {
            const group: any = {};
            this.policies.forEach(policy => {
                if (policy.formControlName) {
                    const initialValue = this.getPolicyValue(policy, user) === true;
                    if (policy.isOptional) {
                        group[policy.formControlName] = [initialValue];
                    } else {
                        group[policy.formControlName] = [initialValue, Validators.requiredTrue];
                    }
                }
            });
            this.termsFormGroup = this._formBuilder.group(group);
        } else {
            this.policies.forEach(policy => {
                if (policy.formControlName) {
                    const newValue = this.getPolicyValue(policy, user) === true;
                    const control = this.termsFormGroup.get(policy.formControlName);
                    // Only update if value is different AND control is not dirty (user hasn't touched it)
                    // This prevents backend latency from reverting user selection
                    if (control && !control.dirty && control.value !== newValue) {
                        control.setValue(newValue, { emitEvent: false });
                    }
                }
            });
        }
    }

    private getPolicyValue(policy: PolicyItem, user: User): boolean {
        if (policy.formControlName === 'acceptPrivacyPolicy') return user.acceptedPrivacyPolicy;
        else if (policy.formControlName === 'acceptDataPolicy') return user.acceptedDataPolicy;
        else if (policy.formControlName === 'acceptTrackingPolicy') return user.acceptedTrackingPolicy;
        else if (policy.formControlName === 'acceptTos') return (user as any).acceptedTos;
        else if (policy.formControlName === 'acceptMarketingPolicy') return (user as any).acceptedMarketingPolicy;
        return false;
    }

    ngOnChanges(changes: SimpleChanges) {
        if (changes['user'] && !changes['user'].firstChange) {
            this.updateForm();
            this.checkAndAdvance();
        }
    }

    canFinish = false;
    isPricingLoading = false;
    expandedPolicyId: string | null = null;

    private async checkAndAdvance() {
        if (!this.user || this.isLoading || this.advancing) return;
        this.advancing = true;
        const user = this.user;
        try {
            this.isPro = await this.userService.isPro();
            const isSubscribed = await this.userService.hasPaidAccess();
            if (this.destroyRef.destroyed || this.user !== user || this.isLoading) return;
            const termsAccepted = this.policies.filter(p => !p.isOptional).every(policy =>
                (user as AppUserInterface)[this.mapFormControlNameToUserProperty(policy.formControlName || '')] === true);
            this.hasPaidMembership.set(isSubscribed);
            this.canFinish = isSubscribed || (user as AppUserInterface).onboardingCompleted === true;
            if (!termsAccepted) return;
            // Resume saved setup on arrival, but never interrupt a deliberate
            // step change or tour with a late/background account check.
            if (this.hasNavigatedSetup && this.stage() !== 'plan') return;
            if (this.canFinish) {
                await this.finishOnboarding();
            } else if (!this.isCompareFlow()) {
                this.moveTo('plan');
            }
        } catch (error) {
            this.logger.error('Error checking onboarding status:', error);
            this.errorMessage.set('We couldn’t check your membership. You can retry when you choose your plan.');
        } finally {
            this.advancing = false;
            if (!this.destroyRef.destroyed && this.user !== user) void this.checkAndAdvance();
        }
    }

    showIntro() {
        if (this.isLoading || this.stage() !== 'start') return;
        this.haptics.selection();
        this.chapterIndex.set(0);
        this.moveTo('intro');
    }

    nextChapter() {
        if (this.isLoading) return;
        this.haptics.selection();
        if (this.chapterIndex() < this.chapters.length - 1) {
            this.chapterIndex.update(index => index + 1);
            this.focusStep();
        } else {
            this.moveTo(this.hasReturnDestination() ? 'privacy' : 'start');
        }
    }

    previousChapter() {
        if (this.chapterIndex() === 0) return;
        this.haptics.selection();
        this.chapterIndex.update(index => index - 1);
        this.focusStep();
    }

    skipIntro() {
        if (this.stage() !== 'intro') return;
        this.haptics.selection();
        this.moveTo(this.hasReturnDestination() ? 'privacy' : 'start');
    }

    chooseStart(choice: OnboardingStart) {
        if (this.startChoice() === choice) return;
        this.hasNavigatedSetup = true;
        this.startChoice.set(choice);
        void this.router.navigate([], {
            relativeTo: this.route, queryParams: { start: choice }, queryParamsHandling: 'merge', replaceUrl: true,
        });
        this.haptics.selection();
    }

    continueFromStart() {
        if (this.isLoading || !this.startChoice()) return;
        this.haptics.selection();
        this.moveTo('privacy');
    }

    back() {
        if (this.isLoading || this.isPricingLoading) return;
        if (this.stage() === 'privacy' && this.hasReturnDestination() && this.isCompareFlow()) {
            void this.navigateAfterOnboarding();
            return;
        }
        this.haptics.selection();
        const previous = this.stage() === 'plan' ? 'privacy'
            : this.stage() === 'privacy' && !this.hasReturnDestination() ? 'start' : 'intro';
        this.moveTo(previous);
    }

    private moveTo(stage: 'intro' | 'start' | 'privacy' | 'plan') {
        if (this.stage() === stage) return;
        this.hasNavigatedSetup = true;
        this.errorMessage.set('');
        this.stage.set(stage);
        this.focusStep();
    }

    private focusStep() {
        afterNextRender(() => {
            this.navigationEffects.scrollToTop();
            this.stepHeading()?.nativeElement.focus({ preventScroll: true });
        }, { injector: this.injector });
    }

    private mapFormControlNameToUserProperty(formControlName: string): string {
        // e.g. acceptPrivacyPolicy -> acceptedPrivacyPolicy
        // e.g. acceptTos -> acceptedTos
        if (!formControlName) return '';
        return formControlName.replace(/^accept/, 'accepted');
    }

    async checkProStatus() {
        this.isPro = await this.userService.isPro();
    }

    isLoading = false;

    async onTermsSubmit() {
        if (this.isLoading || !this.user) return;
        if (!this.termsFormGroup.valid) {
            this.termsFormGroup.markAllAsTouched();
            return;
        }
        this.isLoading = true;
        this.errorMessage.set('');
        this.haptics.selection();
        const user = Object.assign(Object.create(Object.getPrototypeOf(this.user)), this.user) as AppUserInterface;
        const submittedValues: Partial<AppUserInterface> = {};
        this.policies.forEach(policy => {
            if (!policy.formControlName) return;
            const property = this.mapFormControlNameToUserProperty(policy.formControlName);
            submittedValues[property] = !!this.termsFormGroup.get(policy.formControlName)?.value;
            user[property] = submittedValues[property];
        });
        this.termsFormGroup.disable({ emitEvent: false });
        try {
            await this.userService.createOrUpdateUser(user);
            if (this.destroyRef.destroyed || this.user?.uid !== user.uid) return;
            // Auth may emit an older profile while the consent write is in flight.
            // Pricing must receive the choices that have just been saved.
            this.savedConsent = Object.entries(submittedValues).every(([key, value]) =>
                (this.user as AppUserInterface)[key] === value) ? null : { uid: user.uid, values: submittedValues };
            this.user = Object.assign(Object.create(Object.getPrototypeOf(this.user)), this.user, submittedValues);
            this.termsFormGroup.markAsPristine();
            this.analyticsService.logEvent('onboarding_step', { step_index: 1, step_label: 'Legal consent' });
            const isSubscribed = await this.userService.hasPaidAccess();
            if (this.destroyRef.destroyed || this.user?.uid !== user.uid) return;
            this.hasPaidMembership.set(isSubscribed);
            if (!this.isCompareFlow()) this.haptics.success();
            this.isLoading = false;
            if (isSubscribed || this.isCompareFlow()) {
                await this.finishOnboarding();
            } else {
                this.moveTo('plan');
            }
        } catch (error) {
            if (!this.isCurrentUser(user.uid)) return;
            this.logger.error('Error updating user terms:', error);
            this.errorMessage.set('We couldn’t finish saving your choices. Please try again.');
            this.haptics.error();
        } finally {
            this.isLoading = false;
            this.termsFormGroup.enable({ emitEvent: false });
        }
    }

    async logout() {
        await this.authService.signOut();
        this.router.navigate(['/login']);
    }

    async finishOnboarding() {
        if (!this.user || this.completing || this.destroyRef.destroyed) return;
        this.completing = true;
        this.isLoading = true;
        this.errorMessage.set('');
        const user = this.user;
        try {
            // A recovered existing account may still be on /onboarding. Leave
            // without rewriting its profile or repeating completion analytics.
            if ((this.user as AppUserInterface).onboardingCompleted === true) {
                await this.navigateAfterOnboarding();
                return;
            }
            // Reuse Starter setup for either the explicit Compare action or
            // Continue on pricing. Existing paid membership always takes precedence.
            if (!this.canFinish) {
                const isPro = await this.userService.hasPaidAccess();
                if (!this.isCurrentUser(user.uid)) return;
                if (!isPro) {
                    this.logger.log('[OnboardingComponent] Implicitly selecting Free Tier via Continue button.');
                    await this.userService.setFreeTier(user);
                }
            }

            // Mark onboarding as completed in the database (ensures consistency)
            if (!this.isCurrentUser(user.uid)) return;
            await this.userService.updateUserProperties(user, { onboardingCompleted: true });
            if (!this.isCurrentUser(user.uid)) return;

            // Log onboarding completion
            this.analyticsService.logEvent('tutorial_complete');

            const navigated = await this.navigateAfterOnboarding();
            if (navigated && this.isCompareFlow()) this.haptics.success();
        } catch (error) {
            if (!this.isCurrentUser(user.uid)) return;
            this.logger.error('Error completing onboarding:', error);
            this.errorMessage.set('We couldn’t finish setting up your account. Please try again.');
            this.haptics.error();
        } finally {
            this.completing = false;
            this.isLoading = false;
        }
    }

    private isCurrentUser(uid: string): boolean {
        return !this.destroyRef.destroyed && this.user?.uid === uid;
    }

    private navigateAfterOnboarding(): Promise<boolean> {
        const target = this.completionTarget();
        if (target.priceId) {
            return this.router.navigate(['/subscriptions'], { queryParams: { priceId: target.priceId } });
        }
        if (target.path === '/mcp/authorize') {
            return this.router.navigate([target.path], { queryParams: { request_id: target.requestId } });
        }
        if (target.serviceName) {
            return this.router.navigate(['/services'], { queryParams: { serviceName: target.serviceName } });
        }
        return this.router.navigate([target.path]);
    }

    togglePolicyDetails(policyId: string) {
        this.haptics.selection();
        if (this.expandedPolicyId === policyId) {
            this.expandedPolicyId = null;
            return;
        }
        this.expandedPolicyId = policyId;
    }

    onPolicyCheckboxChange(policyId: string, checked: boolean) {
        this.haptics.selection();
        if (!checked) {
            return;
        }
        if (this.expandedPolicyId === policyId) {
            this.expandedPolicyId = null;
        }
    }

    onPricingLoadingChange(isLoading: boolean) {
        this.isPricingLoading = isLoading;
    }

    onPlanSelected() {
        this.logger.log('[OnboardingComponent] Plan selected event received from child component.');
        this.canFinish = true;
        if (this.isLoading) {
            this.logger.log('[OnboardingComponent] Ignoring plan selected event because onboarding completion is already in progress.');
            return;
        }
        // Attempt to finish immediately if on the right step
        this.finishOnboarding();
    }
}
