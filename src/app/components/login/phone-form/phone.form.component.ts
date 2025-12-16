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
      ]),
      reCaptcha: new UntypedFormControl(null, [
        Validators.requiredTrue,
      ]),
    },
    );

    this.verificationCodeFormGroup = new UntypedFormGroup({
      verificationCode: new UntypedFormControl(null, [
        Validators.required,
      ]),
    },
    );
  }

  async ngAfterViewInit() {
    // @ts-ignore
    this.windowRef.recaptchaVerifier = new RecaptchaVerifier(this.auth, 'recaptcha-container', {
      'size': 'normal',
    });
    this.windowRef.recaptchaWidgetId = await this.windowRef.recaptchaVerifier.render();
    this.windowRef.recaptchaVerifier.verify().then(() => {
      this.phoneNumberFormGroup.get('reCaptcha').setValue(true);
      this.changeDetector.detectChanges(); // Needed for changes
    })
  }

  ngOnInit(): void {
    this.windowRef = this.windowService.windowRef;
  }

  async sendLoginCode(event) {
    event.preventDefault();
    if (!this.phoneNumberFormGroup.valid) {
      this.validateAllFormFields(this.phoneNumberFormGroup);
      return;
    }
    this.isLoading = true;
    this.changeDetector.detectChanges();
    try {
      const storedPhoneNumber = this.phoneNumberFormGroup.get('phoneNumber').value;
      const formattedPhoneNumber = storedPhoneNumber.startsWith('+')
        ? storedPhoneNumber
        : '+' + storedPhoneNumber;
      const cleanPhoneNumber = formattedPhoneNumber.replace(/\+{2,}/g, '+');

      this.windowRef.confirmationResult = await signInWithPhoneNumber(this.auth, cleanPhoneNumber, this.windowRef.recaptchaVerifier);
    } catch (e) {
      this.snackBar.open(`Could not verify login number due to ${e.message}`, null, {
        duration: 2000,
      });
    } finally {
      this.isLoading = false;
      this.changeDetector.detectChanges();
    }
  }

  async verifyLoginCode(event) {
    event.preventDefault();
    if (!this.verificationCodeFormGroup.valid) {
      this.validateAllFormFields(this.verificationCodeFormGroup);
      return;
    }
    this.isLoading = true;
    this.changeDetector.detectChanges();
    try {
      this.user = await this.windowRef.confirmationResult.confirm(this.verificationCodeFormGroup.get('verificationCode').value);
      this.dialogRef.close({ user: this.user });
    } catch (e) {
      this.snackBar.open(`Could not verify code due to ${e.message}`, null, {
        duration: 2000,
      });
    }
  }

  // @todo extract to abstract for all forms

  hasError(formGroup: UntypedFormGroup, field?: string) {
    if (!field) {
      return !formGroup.valid;
    }
    return !(formGroup.get(field).valid && formGroup.get(field).touched);
  }

  // @todo extract to abstract for all forms
  validateAllFormFields(formGroup: UntypedFormGroup) {
    Object.keys(formGroup.controls).forEach(field => {
      const control = formGroup.get(field);
      if (control instanceof UntypedFormControl) {
        control.markAsTouched({ onlySelf: true });
      } else if (control instanceof UntypedFormGroup) {
        this.validateAllFormFields(control);
      }
    });
  }

  // @todo extract to abstract for all forms
  close(event) {
    event.stopPropagation();
    event.preventDefault();
    this.dialogRef.close();
  }

  ngOnDestroy(): void {
    if (this.windowRef) {
      this.windowRef.confirmationResult = null;
      this.windowRef.recaptchaVerifier = null;
    }
  }

}
