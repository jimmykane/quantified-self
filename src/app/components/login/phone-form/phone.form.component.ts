import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  Inject,
  OnDestroy,
  OnInit,
  inject
} from '@angular/core';
import {
  UntypedFormControl,
  UntypedFormGroup,
  Validators
} from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppWindowService } from '../../../services/app.window.service';
import { Auth, RecaptchaVerifier, signInWithPhoneNumber } from '@angular/fire/auth';
import { environment } from '../../../../environments/environment';


@Component({
  selector: 'app-phone-form',
  templateUrl: './phone.form.component.html',
  styleUrls: ['./phone.form.component.css'],
  providers: [],
  standalone: false
})
export class PhoneFormComponent implements OnInit, AfterViewInit, OnDestroy {

  isLoading = false;
  windowRef: any;
  user: any;
  public phoneNumberFormGroup: UntypedFormGroup;
  public verificationCodeFormGroup: UntypedFormGroup;
  private auth: Auth = inject(Auth);
  private recaptchaVerifier: RecaptchaVerifier | undefined;

  constructor(
    public dialogRef: MatDialogRef<PhoneFormComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private snackBar: MatSnackBar,
    private windowService: AppWindowService,
    private changeDetector: ChangeDetectorRef,
  ) {
    this.phoneNumberFormGroup = new UntypedFormGroup({
      phoneNumber: new UntypedFormControl(null, [
        Validators.required,
        Validators.minLength(5)
      ]),
      // reCaptcha control is managed manually via the verifier
      reCaptcha: new UntypedFormControl(null, [
        // Validators.requiredTrue, // Removed to allow manual setting
      ]),
    });

    this.verificationCodeFormGroup = new UntypedFormGroup({
      verificationCode: new UntypedFormControl(null, [
        Validators.required,
        Validators.minLength(6)
      ]),
    });
  }

  ngOnInit(): void {
    this.windowRef = this.windowService.windowRef;
  }

  async ngAfterViewInit() {
    this.clearExistingRecaptcha();

    try {
      // Use environment key if available, otherwise defaults to Firebase managed key
      // @ts-ignore
      const siteKey = environment.firebase.recaptchaSiteKey;
      console.log('Initializing reCAPTCHA with siteKey:', siteKey || 'DEFAULT (Internal)');

      const config: any = {
        'size': 'normal',
        'callback': (response) => {
          console.log('reCAPTCHA solved');
          this.phoneNumberFormGroup.get('reCaptcha').setValue(true);
          this.changeDetector.detectChanges();
        },
        'expired-callback': () => {
          console.log('reCAPTCHA expired');
          this.phoneNumberFormGroup.get('reCaptcha').setValue(null);
          this.changeDetector.detectChanges();
        }
      };

      if (siteKey) {
        config['siteKey'] = siteKey;
      }

      this.recaptchaVerifier = new RecaptchaVerifier(this.auth, 'recaptcha-container', config);
      this.windowRef.recaptchaVerifier = this.recaptchaVerifier; // Keep window ref for compatibility if needed

      await this.recaptchaVerifier.render();
    } catch (error) {
      console.error('Error initializing reCAPTCHA:', error);
      this.snackBar.open('Error loading security check. Please refresh.', 'Close');
    }
  }

  private clearExistingRecaptcha() {
    try {
      if (this.recaptchaVerifier) {
        this.recaptchaVerifier.clear();
      }
      const container = document.getElementById('recaptcha-container');
      if (container) {
        container.innerHTML = '';
      }
    } catch (e) {
      console.warn('Error clearing reCAPTCHA:', e);
    }
  }

  async sendLoginCode(event: Event) {
    event.preventDefault();

    // Check form validity but ignore reCaptcha control state for a moment as it's handled by callback
    if (this.phoneNumberFormGroup.get('phoneNumber').invalid) {
      this.phoneNumberFormGroup.get('phoneNumber').markAsTouched();
      return;
    }

    // Explicitly check if reCAPTCHA is solved if we are using the form control for it
    if (!this.phoneNumberFormGroup.get('reCaptcha').value && !this.recaptchaVerifier) {
      this.snackBar.open('Please complete the captcha.', 'OK', { duration: 3000 });
      return;
    }

    this.isLoading = true;
    this.changeDetector.detectChanges();

    try {
      const rawNumber = this.phoneNumberFormGroup.get('phoneNumber').value;
      const formattedNumber = this.formatPhoneNumber(rawNumber);
      console.log('Sending SMS to:', formattedNumber);

      this.windowRef.confirmationResult = await signInWithPhoneNumber(
        this.auth,
        formattedNumber,
        this.recaptchaVerifier
      );

      this.snackBar.open('SMS sent! Please check your phone.', 'OK', { duration: 3000 });

    } catch (e: any) {
      console.error('SMS Send Error:', e);
      let msg = 'Could not send SMS.';
      if (e.code === 'auth/invalid-phone-number') msg = 'Invalid phone number format.';
      if (e.code === 'auth/too-many-requests') msg = 'Too many attempts. Please try again later.';
      if (e.code === 'auth/invalid-app-credential') msg = 'Security check failed. Please refresh and try again.';

      this.snackBar.open(msg, 'Close', { duration: 5000 });
    } finally {
      this.isLoading = false;
      this.changeDetector.detectChanges();
    }
  }

  formatPhoneNumber(raw: string): string {
    if (!raw) return '';

    // Remove all non-digit and non-plus characters
    let cleaned = raw.replace(/[^0-9+]/g, '');

    // Ensure it starts with +
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }

    // Ensure single + at start
    return '+' + cleaned.replace(/\+/g, '');
  }

  async verifyLoginCode(event: Event) {
    event.preventDefault();
    if (!this.verificationCodeFormGroup.valid) {
      this.verificationCodeFormGroup.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    this.changeDetector.detectChanges();

    try {
      const code = this.verificationCodeFormGroup.get('verificationCode').value;
      const result = await this.windowRef.confirmationResult.confirm(code);
      this.user = result.user;
      this.dialogRef.close({ user: this.user });
    } catch (e: any) {
      console.error('Verification Error:', e);
      let msg = 'Verification failed.';
      if (e.code === 'auth/invalid-verification-code') msg = 'Invalid code. Please try again.';

      this.snackBar.open(msg, 'Close', { duration: 4000 });
    } finally {
      this.isLoading = false;
      this.changeDetector.detectChanges();
    }
  }

  // @todo extract to abstract for all forms

  hasError(formGroup: UntypedFormGroup, field?: string) {
    if (!field) return !formGroup.valid;
    return !(formGroup.get(field).valid && formGroup.get(field).touched);
  }

  // @todo extract to abstract for all forms
  close(event: Event) {
    event.stopPropagation();
    event.preventDefault();
    this.dialogRef.close();
  }

  ngOnDestroy(): void {
    if (this.recaptchaVerifier) {
      try { // Use try-catch for clear() as it might throw if not rendered
        this.recaptchaVerifier.clear();
      } catch (e) { }
    }
    if (this.windowRef) {
      // Don't fully nullify windowRef properties as they might be shared, 
      // strictly clean up what this component created.
      this.windowRef.confirmationResult = null;
    }
  }

}
