import { Component, Input, ViewChild, inject, OnInit } from '@angular/core';
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
        MatCardModule
    ],
    templateUrl: './onboarding.component.html',
    styleUrls: ['./onboarding.component.scss']
})
export class OnboardingComponent implements OnInit {
    @Input() user: User;
    @ViewChild('stepper') stepper: MatStepper;

    termsFormGroup: FormGroup;
    isPremium = false;

    private userService = inject(AppUserService);
    private _formBuilder = inject(FormBuilder);

    ngOnInit() {
        this.termsFormGroup = this._formBuilder.group({
            acceptPrivacyPolicy: [this.user.acceptedPrivacyPolicy, Validators.requiredTrue],
            acceptDataPolicy: [this.user.acceptedDataPolicy, Validators.requiredTrue],
            acceptTrackingPolicy: [this.user.acceptedTrackingPolicy, Validators.requiredTrue],
            acceptDiagnosticsPolicy: [this.user.acceptedDiagnosticsPolicy, Validators.requiredTrue],
        });

        this.checkPremiumStatus();
    }

    async checkPremiumStatus() {
        this.isPremium = await this.userService.isPremium();
        // If user has already accepted terms but is here (maybe due to reload or partial state),
        // and we want to enforce pricing check, we can auto-advance or let them see terms again.
        // For now, let's respect the form state.
    }

    async onTermsSubmit() {
        if (this.termsFormGroup.valid) {
            this.user.acceptedPrivacyPolicy = true;
            this.user.acceptedDataPolicy = true;
            this.user.acceptedTrackingPolicy = true;
            this.user.acceptedDiagnosticsPolicy = true;

            try {
                await this.userService.updateUser(this.user);
                this.stepper.next();
            } catch (error) {
                console.error('Error updating user terms:', error);
                // Handle error (maybe show snackbar, but sticking to basics for now)
            }
        } else {
            this.termsFormGroup.markAllAsTouched();
        }
    }

    finishOnboarding() {
        // We can rely on AppComponent to check the state again, or emit an event.
        // Since AppComponent checks 'acceptedPrivacyPolicy' etc., and we just saved it,
        // we need a way to tell AppComponent to re-evaluate or "un-show" this component.
        // However, AppComponent likely uses an observable or simple *ngIf. 
        // If it's *ngIf="!showOnboarding", we need to signal completion.
        // Actually, simply reloading the page or triggering a user emission would work.
        // But better: we set a local "completed" flag on user if we added one, 
        // OR just rely on the fact that once 'acceptedPrivacyPolicy' is true, 
        // the condition in AppComponent (if reactive) will hide this.
        // BUT we want to show Pricing step AFTER terms.

        // So AppComponent logic will be: 
        // showOnboarding = !user.acceptedPrivacyPolicy || (!user.isPremium && !user.onboardingCompleted) ??
        // actually, let's just reload for now to keep it robust, OR we can inject a service to signal.
        window.location.reload();
    }
}
