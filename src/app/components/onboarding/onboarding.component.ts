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
    isPremium = false;

    private userService = inject(AppUserService);
    private auth = inject(Auth);
    private router = inject(Router);
    private _formBuilder = inject(FormBuilder);

    ngOnInit() {
        // Guard against null user input
        const user = this.user || {} as User;

        this.termsFormGroup = this._formBuilder.group({
            acceptPrivacyPolicy: [user.acceptedPrivacyPolicy || false, Validators.requiredTrue],
            acceptDataPolicy: [user.acceptedDataPolicy || false, Validators.requiredTrue],
            acceptTrackingPolicy: [user.acceptedTrackingPolicy || false, Validators.requiredTrue],
            acceptDiagnosticsPolicy: [user.acceptedDiagnosticsPolicy || false, Validators.requiredTrue],
        });

        this.checkPremiumStatus();
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
            // Re-check premium status whenever user data changes
            this.isPremium = await this.userService.isPremium();

            const termsAccepted = this.user.acceptedPrivacyPolicy === true &&
                this.user.acceptedDataPolicy === true &&
                this.user.acceptedTrackingPolicy === true &&
                this.user.acceptedDiagnosticsPolicy === true;

            if (termsAccepted && this.stepper && this.stepper.selectedIndex === 0) {
                // Use setTimeout to avoid ExpressionChangedAfterItHasBeenCheckedError
                setTimeout(() => {
                    this.stepper.selectedIndex = 1;
                });
            }
        }
    }

    async checkPremiumStatus() {
        this.isPremium = await this.userService.isPremium();
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
        // Mark onboarding as completed
        (this.user as any).onboardingCompleted = true;

        try {
            await this.userService.updateUser(this.user);
            // The AppComponent listener will detect the change and hide the onboarding.
            // We don't need to reload or navigate manually necessarily, but let's be safe.
        } catch (error) {
            console.error('Error completing onboarding:', error);
        }
    }
}
