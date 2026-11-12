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
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { AppHapticsService } from '../../services/app.haptics.service';
import { FIELD_GUIDE_CHAPTERS } from './onboarding-tour';
import { POLICY_CONTENT, PolicyItem } from '../../shared/policies.content';
import { LoggerService } from '../../services/logger.service';
import { ShellNavigationEffectsService } from '../../services/shell-navigation-effects.service';
import { AppAnalyticsService, OnboardingDestination, OnboardingFlow } from '../../services/app.analytics.service';
import { AppUserInterface } from '../../models/app-user.interface';
import { onboardingReturnTarget, onboardingStart, OnboardingStart } from '../../helpers/onboarding-navigation.helper';
import { filter, firstValueFrom, of, take, timeout } from 'rxjs';
import { AppUserAccess } from '../../helpers/user-access.helper';
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
    readonly stage = signal<'intro' | 'start' | 'privacy'>('start');
    readonly chapterIndex = signal(0);
    readonly chapters = FIELD_GUIDE_CHAPTERS;
    readonly chapter = computed(() => this.chapters[this.chapterIndex()]);
    readonly startChoice = signal<OnboardingStart | null>(null);
    readonly visibleStartChoice = computed(() => this.startChoice() === 'upload' || this.startChoice() === 'connect' ? 'analyze' : this.startChoice());
    readonly errorMessage = signal('');
    readonly stepHeading = viewChild<ElementRef<HTMLElement>>('stepHeading');
    private readonly injector = inject(Injector);
    private readonly haptics = inject(AppHapticsService);
    private completing = false;
    private advancing = false;
    private hasNavigatedSetup = false;
    private formUserId: string | undefined;
    private savedConsent: { uid: string; values: Partial<AppUserInterface> } | null = null;
    private readonly trackedSelections = new Set<OnboardingFlow>();
    private readonly hasReturnDestination = computed(() => this.returnTarget().path !== '/dashboard');
    readonly isCompareFlow = computed(() => this.completionTarget().path === '/tools/compare' || this.completionTarget().path === '/tools/compare/saved');
    readonly setupProgress = computed(() => this.isCompareFlow() && this.stage() === 'privacy' ? 'Compare files' : this.stage() === 'start' ? '01 / Your starting point'
        : '02 / Policies and preferences');
    readonly heroTitle = computed(() => this.stage() === 'intro' ? this.chapter().hero
        : this.stage() === 'start' ? 'Analyze your training.'
        : 'Set up your account.');

    policies: PolicyItem[] = POLICY_CONTENT.filter(p => !!p.checkboxLabel)
        .map(policy => ({
            ...policy,
            // These canonical fragments live on Policies, not inside this setup screen.
            content: policy.content.map(item => item.replace(/href="#([^"]+)"/g,
                'href="/policies#$1" target="_blank" rel="noopener"')),
        }))
        .sort((a, b) => Number(!!a.isOptional) - Number(!!b.isOptional));
    termsFormGroup!: FormGroup;
    readonly hasProMembership = signal(false);
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

    private readonly completionTarget = computed(() => {
        const target = this.returnTarget();
        if (this.hasReturnDestination()) return target;
        if (this.startChoice() === 'compare') return { ...target, path: '/tools/compare', label: 'Compare' };
        if (this.startChoice() === 'sync') return { ...target, path: '/services', label: 'Connections', syncSetup: true };
        return this.startChoice() === 'connect'
            ? { ...target, path: '/services', label: 'Connections' } : target;
    });

    private readonly trackingFlow = computed<OnboardingFlow>(() => {
        const target = this.completionTarget();
        if (target.syncSetup) return 'sync';
        if (this.isCompareFlow()) return 'compare';
        if (this.hasReturnDestination()) return 'other';
        const choice = this.startChoice();
        if (choice === 'analyze' || choice === 'upload' || choice === 'connect') return 'analyze';
        return choice === 'explore' ? 'explore' : 'other';
    });

    readonly needsSyncPlan = computed(() => this.completionTarget().syncSetup && !this.hasProMembership());
    readonly continueLabel = computed(() => this.needsSyncPlan() ? 'Choose a Pro plan'
        : this.isCompareFlow() ? (this.hasPaidMembership() ? 'Open Compare' : 'Continue free')
            : 'Continue to ' + this.completionTarget().label);

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
            this.trackedSelections.clear();
            this.hasPaidMembership.set(false);
            this.canFinish = false;
            this.formUserId = user.uid;
        }
        this.hasProMembership.set(AppUserAccess.hasProAccess(user, (user as AppUserInterface).admin === true));
        this.hasPaidMembership.set(AppUserAccess.hasPaidAccessUser(user, (user as AppUserInterface).admin === true));
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
    expandedPolicyId: string | null = null;

    private async checkAndAdvance() {
        if (!this.user || this.isLoading || this.advancing) return;
        this.advancing = true;
        const user = this.user;
        try {
            const isSubscribed = this.hasPaidMembership();
            if (this.destroyRef.destroyed || this.user !== user || this.isLoading) return;
            const termsAccepted = this.policies.filter(p => !p.isOptional).every(policy =>
                (user as AppUserInterface)[this.mapFormControlNameToUserProperty(policy.formControlName || '')] === true);
            this.hasPaidMembership.set(isSubscribed);
            this.canFinish = isSubscribed || (user as AppUserInterface).onboardingCompleted === true;
            if (!termsAccepted) return;
            // Resume saved setup on arrival, but never interrupt a deliberate
            // step change or tour with a late/background account check.
            if (this.hasNavigatedSetup) return;
            if (this.canFinish) {
                await this.finishOnboarding();
            } else if (this.hasReturnDestination() || this.startChoice()) {
                this.moveTo('privacy');
            }
        } catch (error) {
            this.logger.error('Error checking onboarding status:', error);
            this.errorMessage.set('We couldn’t check your account. Continue to try again.');
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
        if (this.isLoading || this.startChoice() === choice) return;
        this.hasNavigatedSetup = true;
        this.startChoice.set(choice);
        this.trackSelection();
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

    lookAround() {
        if (this.isLoading) return;
        const alreadySelected = this.startChoice() === 'explore';
        this.chooseStart('explore');
        if (alreadySelected) this.haptics.selection();
        this.moveTo('privacy');
    }

    back() {
        if (this.isLoading) return;
        if (this.stage() === 'privacy' && this.hasReturnDestination() && this.isCompareFlow()) {
            void this.navigateAfterOnboarding();
            return;
        }
        this.haptics.selection();
        const previous = this.stage() === 'privacy' && !this.hasReturnDestination() ? 'start' : 'intro';
        this.moveTo(previous);
    }

    private moveTo(stage: 'intro' | 'start' | 'privacy') {
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

    private trackSelection(): void {
        const flow = this.trackingFlow();
        if (!this.trackedSelections.has(flow) && this.analyticsService.logOnboardingFlow(flow, 'selected')) {
            this.trackedSelections.add(flow);
        }
    }

    isLoading = false;
    readonly loadingLabel = signal('Saving your choices…');

    async onTermsSubmit() {
        if (this.isLoading || !this.user) return;
        if (!this.termsFormGroup.valid) {
            this.termsFormGroup.markAllAsTouched();
            return;
        }
        this.isLoading = true;
        this.loadingLabel.set('Saving your choices…');
        this.hasNavigatedSetup = true;
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
        let choicesSaved = false;
        try {
            await this.userService.createOrUpdateUser(user, { completeOnboarding: true });
            choicesSaved = true;
            if (this.destroyRef.destroyed || this.user?.uid !== user.uid) return;
            // Auth may emit an older profile while the consent write is in flight.
            // Keep the completed setup visible until the confirmed profile reaches this view.
            submittedValues.onboardingCompleted = true;
            this.savedConsent = Object.entries(submittedValues).every(([key, value]) =>
                (this.user as AppUserInterface)[key] === value) ? null : { uid: user.uid, values: submittedValues };
            this.user = Object.assign(Object.create(Object.getPrototypeOf(this.user)), this.user, submittedValues);
            this.termsFormGroup.markAsPristine();
            const navigated = await this.navigateAfterOnboarding(true, true);
            if (!navigated) throw new Error('Account setup saved but navigation was cancelled.');
            if (this.authService.currentUser?.uid === user.uid) this.haptics.success();
        } catch (error) {
            if (!this.isCurrentUser(user.uid)) return;
            if (!choicesSaved) this.analyticsService.logOnboardingFlow(this.trackingFlow(), 'failed', { failureStage: 'save' });
            this.logger.error('Error updating user terms:', error);
            this.errorMessage.set(choicesSaved
                ? 'Your choices are saved, but we couldn’t open the next page. Please try again.'
                : 'We couldn’t finish saving your choices. Please try again.');
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
        if (!this.user || this.isLoading || this.completing || this.destroyRef.destroyed) return;
        if (!this.policies.filter(policy => !policy.isOptional).every(policy =>
            (this.user as AppUserInterface)[this.mapFormControlNameToUserProperty(policy.formControlName || '')] === true)) return;
        this.completing = true;
        this.isLoading = true;
        this.errorMessage.set('');
        const user = this.user;
        let choicesSaved = false;
        try {
            // A recovered existing account may still be on /onboarding. Leave
            // without rewriting its profile or repeating completion analytics.
            if ((this.user as AppUserInterface).onboardingCompleted === true) {
                if (!await this.navigateAfterOnboarding()) throw new Error('Navigation was cancelled.');
                return;
            }
            // Mark onboarding as completed in the database (ensures consistency)
            if (!this.isCurrentUser(user.uid)) return;
            await this.userService.updateUserProperties(user, { onboardingCompleted: true });
            choicesSaved = true;
            if (!this.isCurrentUser(user.uid)) return;

            const navigated = await this.navigateAfterOnboarding(true, true);
            if (!navigated) throw new Error('Account setup saved but navigation was cancelled.');
            if (this.authService.currentUser?.uid === user.uid) this.haptics.success();
        } catch (error) {
            if (!this.isCurrentUser(user.uid)) return;
            if (!choicesSaved) this.analyticsService.logOnboardingFlow(this.trackingFlow(), 'failed', { failureStage: 'save' });
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

    private async navigateAfterOnboarding(waitForSavedProfile = false, recordCompletion = false): Promise<boolean> {
        const uid = this.user.uid;
        const flow = this.trackingFlow();
        let failureStage: 'profile' | 'navigation' = 'profile';
        try {
            if (waitForSavedProfile) {
                this.loadingLabel.set('Finishing setup…');
                // Firestore can acknowledge a write before the merged account stream publishes it.
                // The route guard consumes this same stream, so wait for it instead of navigating
                // against an older profile and bouncing back to onboarding.
                await firstValueFrom(this.userService.user$.pipe(
                    filter(profile => profile?.uid === uid && profile.onboardingCompleted === true
                        && this.policies.filter(policy => !policy.isOptional).every(policy =>
                            profile[this.mapFormControlNameToUserProperty(policy.formControlName || '')] === true)),
                    take(1),
                    timeout(10_000),
                    takeUntilDestroyed(this.destroyRef),
                ));
                if (!this.isCurrentUser(uid)) return false;
            }
            const target = this.completionTarget();
            this.loadingLabel.set(this.needsSyncPlan() ? 'Opening Pro plans…' : `Opening ${target.label}…`);
            let path = target.path;
            let destination: OnboardingDestination = this.isCompareFlow()
                ? target.path === '/tools/compare/saved' ? 'saved_comparisons' : 'compare' : 'dashboard';
            let queryParams: Record<string, string> | undefined;
            if (target.syncSetup && !AppUserAccess.hasProAccess(this.user, (this.user as AppUserInterface)?.admin === true)) {
                path = '/subscriptions';
                destination = 'pro_plans';
                queryParams = { setup: 'sync' };
            } else if (target.priceId || target.path === '/subscriptions') {
                destination = 'membership';
                if (target.priceId) queryParams = { priceId: target.priceId };
            } else if (target.path === '/mcp/authorize') {
                destination = 'assistant';
                queryParams = { request_id: target.requestId };
            } else if (target.path === '/services') {
                destination = 'connections';
                if (target.serviceName || target.syncSetup) queryParams = {
                    ...(target.serviceName ? { serviceName: target.serviceName } : {}),
                    ...(target.syncSetup ? { setup: 'sync' } : {}),
                };
            }
            if (recordCompletion) {
                // Retry the bounded choice only after the saved profile has established consent.
                // No events are queued or transmitted for people who decline analytics.
                this.trackSelection();
                this.analyticsService.logOnboardingFlow(flow, 'consent_saved', { destination });
                this.analyticsService.logEvent('onboarding_step', { step_index: 1, step_label: 'Legal consent',
                    onboarding_goal: flow, destination });
            }
            failureStage = 'navigation';
            const navigated = await (queryParams ? this.router.navigate([path], { queryParams }) : this.router.navigate([path]));
            if (this.authService.currentUser?.uid !== uid) return false;
            // A guard can resolve navigation successfully while redirecting back to setup or login.
            const actualUrl = new URL(this.router.url, 'https://onboarding.invalid');
            const reached = navigated && actualUrl.pathname === path
                && Object.entries(queryParams ?? {}).every(([key, value]) => actualUrl.searchParams.get(key) === value);
            if (recordCompletion) {
                this.analyticsService.logOnboardingFlow(flow, reached ? 'destination_reached' : 'failed', {
                    destination, ...(!reached ? { failureStage } : {}),
                });
                if (reached) this.analyticsService.logEvent('tutorial_complete', { onboarding_goal: flow, destination });
            }
            return reached;
        } catch (error) {
            if (recordCompletion && this.authService.currentUser?.uid === uid
                && !(failureStage === 'profile' && this.destroyRef.destroyed)) {
                this.analyticsService.logOnboardingFlow(flow, 'failed', { failureStage });
            }
            throw error;
        }
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

}
