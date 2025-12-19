import { Component, Input, ViewChild, inject, OnInit, AfterViewInit, OnChanges, SimpleChanges } from '@angular/core';
import { Auth } from '@angular/fire/auth';
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

    termsFormGroup: FormGroup;
    isPro = false;

    private authService = inject(AppAuthService);
    private userService = inject(AppUserService);
    private auth = inject(Auth);
    private router = inject(Router);
    private _formBuilder = inject(FormBuilder);

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
        this.termsFormGroup = this._formBuilder.group({
            acceptPrivacyPolicy: [user.acceptedPrivacyPolicy || false, Validators.requiredTrue],
            acceptDataPolicy: [user.acceptedDataPolicy || false, Validators.requiredTrue],
            acceptTrackingPolicy: [user.acceptedTrackingPolicy || false, Validators.requiredTrue],
            acceptDiagnosticsPolicy: [user.acceptedDiagnosticsPolicy || false, Validators.requiredTrue],
        });
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

            const termsAccepted = this.user.acceptedPrivacyPolicy === true &&
                this.user.acceptedDataPolicy === true &&
                this.user.acceptedTrackingPolicy === true &&
                this.user.acceptedDiagnosticsPolicy === true;

            console.log('[OnboardingComponent] checkAndAdvance:', {
                termsAccepted,
                isPro: this.isPro,
                selectedIndex: this.stepper?.selectedIndex
            });

            if (termsAccepted && this.stepper && this.stepper.selectedIndex === 0) {
                console.log('[OnboardingComponent] Terms accepted, auto-advancing to pricing step.');
                // Use setTimeout to avoid ExpressionChangedAfterItHasBeenCheckedError
                setTimeout(() => {
                    this.stepper.selectedIndex = 1;
                });
            }
        }
    }

    async checkProStatus() {
        this.isPro = await this.userService.isPro();
    }

    async onTermsSubmit() {
        if (this.termsFormGroup.valid) {
            this.user.acceptedPrivacyPolicy = true;
            this.user.acceptedDataPolicy = true;
            this.user.acceptedTrackingPolicy = true;
            this.user.acceptedDiagnosticsPolicy = true;

            // Don't save to DB yet, just update local state and move to next step.
            // If we save now, AppComponent might hide the onboarding flow prematurely
            // depending on the exact logic. However, since we added 'onboardingCompleted' check,
            // we COULD save here, but let's save everything at the end for atomicity/clarity if desired.
            // ACTUALLY: We MUST save terms if we want them persisted even if user drops off.
            // But we do NOT set 'onboardingCompleted' yet.

            try {
                // Determine if we should save now or later. 
                // Let's save now to be safe, so terms are recorded. 
                // Because we updated AppComponent to check for 'onboardingCompleted', 
                // this save will NOT cause the component to disappear.
                await this.userService.updateUser(this.user);
                this.stepper.next();
            } catch (error) {
                console.error('Error updating user terms:', error);
            }
        } else {
            this.termsFormGroup.markAllAsTouched();
        }
    }

    async logout() {
        await this.auth.signOut();
        this.router.navigate(['/login']);
    }

    async finishOnboarding() {
        try {
            // Mark onboarding as completed in the database
            await this.userService.updateUserProperties(this.user, { onboardingCompleted: true });

            // Navigate to dashboard. The OnboardingGuard will now allow this.
            console.log('[OnboardingComponent] Finishing onboarding, navigating to dashboard');
            this.router.navigate(['/dashboard']);
        } catch (error) {
            console.error('Error completing onboarding:', error);
        }
    }
}
