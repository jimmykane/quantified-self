import { Component, Input, ViewChild, inject, OnInit, AfterViewInit, OnChanges, SimpleChanges } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatStepperModule, MatStepper } from '@angular/material/stepper';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup, FormControl } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { User, Privacy } from '@sports-alliance/sports-lib';
import { AppUserService } from '../../services/app.user.service';
import { AppAuthService } from '../../authentication/app.auth.service';
import { PricingComponent } from '../pricing/pricing.component';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { POLICY_CONTENT, PolicyItem } from '../../shared/policies.content';
import { LoggerService } from '../../services/logger.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';

@Component({
    selector: 'app-onboarding',
    standalone: true,
    imports: [
        CommonModule,
        MatStepperModule,
        MatButtonModule,
        ReactiveFormsModule,
        MatFormFieldModule,
        MatInputModule,
        MatCheckboxModule,
        PricingComponent,
        MatIconModule,
        MatCardModule,
        MatCardModule,
        MatDividerModule,
        MatProgressSpinnerModule
    ],
    templateUrl: './onboarding.component.html',
    styleUrls: ['./onboarding.component.scss']
})
export class OnboardingComponent implements OnInit, AfterViewInit {
    @Input() user!: User;
    @ViewChild('stepper') stepper!: MatStepper;

    policies: PolicyItem[] = POLICY_CONTENT.filter(p => !!p.checkboxLabel);
    termsFormGroup!: FormGroup;
    isPro = false;

    private authService = inject(AppAuthService);
    private userService = inject(AppUserService);
    private router = inject(Router);
    private _formBuilder = inject(FormBuilder);
    private logger = inject(LoggerService);
    private analyticsService = inject(AppAnalyticsService);

    ngOnInit() {
        // Log onboarding start
        this.analyticsService.logEvent('tutorial_begin');

        // If user wasn't passed via Input (routing), get it from service
        if (!this.user) {
            this.authService.user$.subscribe(user => {
                if (user) {
                    this.user = user;
                    this.initForm();
                    this.checkAndAdvance();
                }
            });
        }

        this.initForm();
        this.checkProStatus();
    }

    private initForm() {
        const user = this.user || {} as User;
        const group: any = {};

        this.policies.forEach(policy => {
            if (policy.formControlName) {
                // Determine initial value from user object dynamically if possible, or default to false.
                // Since user properties match formControlName map (e.g. acceptPrivacyPolicy -> acceptedPrivacyPolicy),
                // mapping is: acceptX -> acceptedX.
                // Let's rely on manual mapping or just use the known keys if we want to be safe, 
                // OR just loop. For now, let's look at the property mapping:
                // formControlName: 'acceptPrivacyPolicy' -> user.acceptedPrivacyPolicy
                // So replacing 'accept' with 'accepted' seems to be the pattern.
                // But honestly, explicit is safer given the small number.
                // However, for strict reusability, let's try to find the key.

                // Let's stick to the previous hardcoded initial values logic BUT loop for creation if we want dynamic,
                // or just leave initForm hardcoded if we don't assume the keys change often.
                // User asked for text reusability.
                // But if I loop in HTML, I must have controls in FormGroup.
                // Creating controls dynamically ensures they exist.

                let initialValue = false;
                if (policy.formControlName === 'acceptPrivacyPolicy') initialValue = user.acceptedPrivacyPolicy;
                else if (policy.formControlName === 'acceptDataPolicy') initialValue = user.acceptedDataPolicy;
                else if (policy.formControlName === 'acceptTrackingPolicy') initialValue = user.acceptedTrackingPolicy;
                else if (policy.formControlName === 'acceptTos') initialValue = (user as any).acceptedTos;

                if (policy.isOptional) {
                    group[policy.formControlName] = [initialValue || false];
                } else {
                    group[policy.formControlName] = [initialValue || false, Validators.requiredTrue];
                }
            }
        });

        this.termsFormGroup = this._formBuilder.group(group);
    }

    ngAfterViewInit() {
        this.checkAndAdvance();
    }

    ngOnChanges(changes: SimpleChanges) {
        if (changes['user'] && !changes['user'].firstChange) {
            this.checkAndAdvance();
        }
    }

    canFinish = false;

    private async checkAndAdvance() {
        if (this.user) {
            // Re-check pro status whenever user data changes
            this.isPro = await this.userService.isPro();

            const termsAccepted = this.policies.every(policy => {
                const userProperty = this.mapFormControlNameToUserProperty(policy.formControlName || '');
                return (this.user as any)[userProperty] === true;
            });

            const isSubscribed = await this.userService.hasPaidAccess();
            const isFreeCompleted = (this.user as any).onboardingCompleted === true;
            this.canFinish = isSubscribed || isFreeCompleted;

            this.logger.log('[OnboardingComponent] checkAndAdvance:', {
                termsAccepted,
                isPro: this.isPro,
                selectedIndex: this.stepper?.selectedIndex,
                canFinish: this.canFinish
            });

            if (termsAccepted) {
                if (this.canFinish) {
                    this.logger.log('[OnboardingComponent] User setup complete (paid or free), finishing onboarding.');
                    this.finishOnboarding();
                } else if (this.stepper && this.stepper.selectedIndex === 0) {
                    this.logger.log('[OnboardingComponent] Terms accepted, auto-advancing to pricing step.');
                    // Use setTimeout to avoid ExpressionChangedAfterItHasBeenCheckedError
                    setTimeout(() => {
                        this.stepper.selectedIndex = 1;
                    });
                }
            }
        }
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
        if (this.termsFormGroup.valid) {
            this.isLoading = true;
            this.policies.forEach(policy => {
                const userProperty = this.mapFormControlNameToUserProperty(policy.formControlName || '');
                if (userProperty) {
                    (this.user as any)[userProperty] = true;
                }
            });

            // Don't save to DB yet, just update local state and move to next step.
            // If we save now, AppComponent might hide the onboarding flow prematurely
            // depending on the exact logic. However, since we added 'onboardingCompleted' check,
            // we COULD save here, but let's save everything at the end for atomicity/clarity if desired.
            // ACTUALLY: We MUST save terms if we want them persisted even if user drops off.
            // But we do NOT set 'onboardingCompleted' yet.

            try {
                if (this.stepper.selectedIndex > 0) {
                    this.analyticsService.logEvent('onboarding_step', { step_index: this.stepper.selectedIndex, step_label: this.stepper.selected?.label });
                }         // Determine if we should save now or later. 
                // We MUST save terms if we want them persisted even if user drops off.
                // We use createOrUpdateUser to ensure legal policies are saved to the correct subcollection.
                await this.userService.createOrUpdateUser(this.user);

                const isSubscribed = await this.userService.hasPaidAccess();
                if (isSubscribed) {
                    this.logger.log('[OnboardingComponent] User is subscribed, finishing onboarding directly.');
                    this.finishOnboarding();
                } else {
                    this.stepper.next();
                }
            } catch (error) {
                this.logger.error('Error updating user terms:', error);
            } finally {
                this.isLoading = false;
            }
        } else {
            this.termsFormGroup.markAllAsTouched();
        }
    }

    async logout() {
        await this.authService.signOut();
        this.router.navigate(['/login']);
    }

    async finishOnboarding() {
        this.isLoading = true;
        try {
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

            // Navigate to dashboard. The OnboardingGuard will now allow this.
            this.logger.log('[OnboardingComponent] Finishing onboarding, navigating to dashboard');
            this.router.navigate(['/dashboard']);
        } catch (error) {
            this.logger.error('Error completing onboarding:', error);
        } finally {
            this.isLoading = false;
        }
    }

    onPlanSelected() {
        this.logger.log('[OnboardingComponent] Plan selected event received from child component.');
        this.canFinish = true;
        // Attempt to finish immediately if on the right step
        this.finishOnboarding();
    }
}
