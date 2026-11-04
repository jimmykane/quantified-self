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
import { membershipPriceIdFromReturnUrl } from '../../helpers/membership-selection.helper';
import { serviceSetupFromReturnUrl } from '../../helpers/service-setup-redirect.helper';
import { of } from 'rxjs';

@Component({
    selector: 'app-onboarding',
    standalone: true,
    imports: [
        CommonModule,
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
    readonly stage = signal<'intro' | 'start' | 'privacy' | 'plan'>('intro');
    readonly chapterIndex = signal(0);
    readonly chapters = FIELD_GUIDE_CHAPTERS;
    readonly chapter = computed(() => this.chapters[this.chapterIndex()]);
    readonly startChoice = signal<'connect' | 'upload' | 'explore' | null>(null);
    readonly errorMessage = signal('');
    readonly stepHeading = viewChild<ElementRef<HTMLElement>>('stepHeading');
    private readonly injector = inject(Injector);
    private readonly haptics = inject(AppHapticsService);
    private completing = false;
    private advancing = false;
    private savedConsent: { uid: string; values: Partial<AppUserInterface> } | null = null;
    private readonly hasReturnDestination = computed(() => this.returnTarget().path !== '/dashboard');
    readonly setupProgress = computed(() => this.stage() === 'start' ? '01 / Your starting point'
        : this.stage() === 'privacy' ? '02 / Your privacy' : '03 / Your membership');
    readonly heroTitle = computed(() => this.stage() === 'intro' ? this.chapter().hero
        : this.stage() === 'start' ? 'Every journey starts somewhere.'
        : this.stage() === 'privacy' ? 'Your story. Your data.' : 'Room to go further.');
    readonly completionHint = computed(() => this.hasReturnDestination()
        ? `After setup, you’ll return to ${this.returnTarget().label}.`
        : this.startChoice() === 'connect'
            ? 'Provider connections require Pro. Choose and authorize your provider in Connections after setup.'
            : this.startChoice() === 'upload'
                ? 'Starter includes manual uploads. Choose Upload on your Dashboard to add your first activity.'
                : 'Start with Starter and explore your Dashboard. You can add activities or change your plan later.');

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
    private readonly returnTarget = computed(() => {
        const params = this.completionQueryParams();
        const returnUrl = params.get('returnUrl');
        const priceId = membershipPriceIdFromReturnUrl(returnUrl);
        const serviceSetup = serviceSetupFromReturnUrl(returnUrl);
        const requestId = params.get('request_id') || '';
        // Keep destinations explicit; never accept an external/client OAuth callback here.
        const path = priceId ? '/subscriptions'
            : serviceSetup ? '/services'
            : returnUrl === '/tools/compare' || returnUrl === '/subscriptions'
                ? returnUrl
                : returnUrl === '/mcp/authorize' && /^[A-Za-z0-9_-]{1,256}$/.test(requestId)
                    ? '/mcp/authorize' : '/dashboard';
        const label = path === '/tools/compare' ? 'Compare'
            : path === '/subscriptions' ? 'Subscriptions'
                : path === '/services' ? 'Connections'
                    : path === '/mcp/authorize' ? 'MCP connection' : 'Dashboard';
        return { path, label, priceId, requestId, serviceName: serviceSetup?.serviceName ?? null };
    });

    private readonly completionTarget = computed(() => {
        const target = this.returnTarget();
        return !this.hasReturnDestination() && this.startChoice() === 'connect'
            ? { ...target, path: '/services', label: 'Connections' } : target;
    });

    get completionPath(): string { return this.completionTarget().path; }
    get completionLabel(): string { return this.completionTarget().label; }

    ngOnInit() {
        // Log onboarding start
        this.analyticsService.logEvent('tutorial_begin');

        // If user wasn't passed via Input (routing), get it from service
        if (!this.user) {
            this.authService.user$
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe(user => {
                    if (user) {
                        this.user = user;
                        this.updateForm();
                        this.checkAndAdvance();
                    }
                });
        }

        this.updateForm();
        void this.checkAndAdvance();
    }

    private updateForm() {
        const user = this.user || {} as User;
        if (this.savedConsent && this.savedConsent.uid === user.uid) Object.assign(user, this.savedConsent.values);

        if (!this.termsFormGroup) {
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
            this.canFinish = isSubscribed || (user as AppUserInterface).onboardingCompleted === true;
            if (!termsAccepted) return;
            if (this.canFinish) {
                await this.finishOnboarding();
            } else if (this.stage() === 'intro') {
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

    chooseStart(choice: 'connect' | 'upload' | 'explore') {
        if (this.startChoice() === choice) return;
        this.startChoice.set(choice);
        this.haptics.selection();
    }

    continueFromStart() {
        if (!this.startChoice()) return;
        this.haptics.selection();
        this.moveTo('privacy');
    }

    back() {
        if (this.isLoading || this.isPricingLoading) return;
        this.haptics.selection();
        const previous = this.stage() === 'plan' ? 'privacy'
            : this.stage() === 'privacy' && !this.hasReturnDestination() ? 'start' : 'intro';
        this.moveTo(previous);
    }

    private moveTo(stage: 'intro' | 'start' | 'privacy' | 'plan') {
        if (this.stage() === stage) return;
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
        const user = this.user as AppUserInterface;
        const previousValues: Partial<AppUserInterface> = {};
        const submittedValues: Partial<AppUserInterface> = {};
        this.policies.forEach(policy => {
            if (!policy.formControlName) return;
            const property = this.mapFormControlNameToUserProperty(policy.formControlName);
            previousValues[property] = user[property];
            submittedValues[property] = !!this.termsFormGroup.get(policy.formControlName)?.value;
            user[property] = submittedValues[property];
        });
        this.termsFormGroup.disable({ emitEvent: false });
        let consentSaved = false;
        try {
            await this.userService.createOrUpdateUser(user);
            consentSaved = true;
            if (this.destroyRef.destroyed || this.user?.uid !== user.uid) return;
            // Auth may emit an older profile while the consent write is in flight.
            // Pricing must receive the choices that have just been saved.
            this.savedConsent = { uid: user.uid, values: submittedValues };
            Object.assign(this.user, submittedValues);
            this.analyticsService.logEvent('onboarding_step', { step_index: 1, step_label: 'Legal consent' });
            const isSubscribed = await this.userService.hasPaidAccess();
            if (this.destroyRef.destroyed || this.user?.uid !== user.uid) return;
            this.haptics.success();
            this.isLoading = false;
            if (isSubscribed) {
                await this.finishOnboarding();
            } else {
                this.moveTo('plan');
            }
        } catch (error) {
            if (!consentSaved) Object.assign(user, previousValues);
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
        if (!this.user || this.completing) return;
        this.completing = true;
        this.isLoading = true;
        this.errorMessage.set('');
        try {
            // A recovered existing account may still be on /onboarding. Leave
            // without rewriting its profile or repeating completion analytics.
            if ((this.user as AppUserInterface).onboardingCompleted === true) {
                await this.navigateAfterOnboarding();
                return;
            }
            // Implicit Free Tier Selection:
            // If the user clicks continue but hasn't explicitly selected a plan (canFinish is false),
            // and they don't have paid access, we assume they want the Free Tier.
            if (!this.canFinish) {
                const isPro = await this.userService.hasPaidAccess();
                if (!isPro) {
                    this.logger.log('[OnboardingComponent] Implicitly selecting Free Tier via Continue button.');
                    await this.userService.setFreeTier(this.user);
                }
            }

            // Mark onboarding as completed in the database (ensures consistency)
            await this.userService.updateUserProperties(this.user, { onboardingCompleted: true });

            // Log onboarding completion
            this.analyticsService.logEvent('tutorial_complete');

            await this.navigateAfterOnboarding();
        } catch (error) {
            this.logger.error('Error completing onboarding:', error);
            this.errorMessage.set('We couldn’t finish setting up your account. Please try again.');
            this.haptics.error();
        } finally {
            this.completing = false;
            this.isLoading = false;
        }
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
