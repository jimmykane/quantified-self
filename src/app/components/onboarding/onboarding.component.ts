import { Component, Input, ViewChild, inject, OnInit, AfterViewInit, OnChanges, SimpleChanges } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatStepperModule, MatStepper } from '@angular/material/stepper';
import { MatButtonModule } from '@angular/material/button';
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
        MatDividerModule
    ],
    templateUrl: './onboarding.component.html',
    styleUrls: ['./onboarding.component.scss']
})
export class OnboardingComponent implements OnInit, AfterViewInit {
    @Input() user: User;
    @ViewChild('stepper') stepper: MatStepper;

    policies: PolicyItem[] = POLICY_CONTENT.filter(p => !!p.checkboxLabel);
    termsFormGroup: FormGroup;
    isPro = false;

    private authService = inject(AppAuthService);
    private userService = inject(AppUserService);
    private router = inject(Router);
    private _formBuilder = inject(FormBuilder);
    private logger = inject(LoggerService);

    ngOnInit() {
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
                else if (policy.formControlName === 'acceptDiagnosticsPolicy') initialValue = user.acceptedDiagnosticsPolicy;
                else if (policy.formControlName === 'acceptTos') initialValue = (user as any).acceptedTos;

                group[policy.formControlName] = [initialValue || false, Validators.requiredTrue];
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

    private async checkAndAdvance() {
        if (this.user) {
            // Re-check pro status whenever user data changes
            this.isPro = await this.userService.isPro();

            const termsAccepted = this.policies.every(policy => {
                const userProperty = this.mapFormControlNameToUserProperty(policy.formControlName);
                return (this.user as any)[userProperty] === true;
            });

            this.logger.log('[OnboardingComponent] checkAndAdvance:', {
                termsAccepted,
                isPro: this.isPro,
                selectedIndex: this.stepper?.selectedIndex
            });

            if (termsAccepted && this.stepper && this.stepper.selectedIndex === 0) {
                const isSubscribed = await this.userService.hasPaidAccess();
                if (isSubscribed) {
                    this.logger.log('[OnboardingComponent] Terms accepted and user is subscribed, finishing onboarding.');
                    this.finishOnboarding();
                } else {
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

    async onTermsSubmit() {
        if (this.termsFormGroup.valid) {
            this.policies.forEach(policy => {
                const userProperty = this.mapFormControlNameToUserProperty(policy.formControlName);
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
                // Determine if we should save now or later. 
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
        try {
            // Mark onboarding as completed in the database
            await this.userService.updateUserProperties(this.user, { onboardingCompleted: true });

            // Navigate to dashboard. The OnboardingGuard will now allow this.
            this.logger.log('[OnboardingComponent] Finishing onboarding, navigating to dashboard');
            this.router.navigate(['/dashboard']);
        } catch (error) {
            this.logger.error('Error completing onboarding:', error);
        }
    }
}
