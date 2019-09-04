import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Inject,
  Input, OnDestroy,
  OnInit
} from '@angular/core';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  FormGroupDirective,
  NgForm,
  ValidationErrors,
  ValidatorFn,
  Validators
} from '@angular/forms';
import {ErrorStateMatcher} from '@angular/material/core';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import * as Sentry from '@sentry/browser';
import {WindowService} from '../../../services/app.window.service';
import {AngularFireAuth} from '@angular/fire/auth';
import * as firebase from 'firebase/app';


@Component({
  selector: 'app-phone-form',
  templateUrl: './phone.form.component.html',
  styleUrls: ['./phone.form.component.css'],
  providers: [],
})


export class PhoneFormComponent implements OnInit, AfterViewInit, OnDestroy {

  isLoading = false;

  windowRef: any;

  user: any;
  public phoneNumberFormGroup: FormGroup;
  public verificationCodeFormGroup: FormGroup;

  constructor(
    public dialogRef: MatDialogRef<PhoneFormComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private snackBar: MatSnackBar,
    private windowService: WindowService,
    private afAuth: AngularFireAuth,
    private  changeDetector: ChangeDetectorRef,
  ) {
    this.phoneNumberFormGroup = new FormGroup({
        phoneNumber: new FormControl(null, [
          Validators.required,
        ]),
        reCaptcha: new FormControl(null, [
          Validators.requiredTrue,
        ]),
      },
    );

    this.verificationCodeFormGroup = new FormGroup({
        verificationCode: new FormControl(null, [
          Validators.required,
        ]),
      },
    );
  }

  async ngAfterViewInit() {
    this.windowRef.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container');
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
      this.windowRef.confirmationResult = await this.afAuth.auth.signInWithPhoneNumber(this.phoneNumberFormGroup.get('phoneNumber').value, this.windowRef.recaptchaVerifier);
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
      this.dialogRef.close({user: this.user});
    } catch (e) {
      this.snackBar.open(`Could not verify code due to ${e.message}`, null, {
        duration: 2000,
      });
    }
  }

  // @todo extract to abstract for all forms

  hasError(formGroup: FormGroup, field?: string) {
    if (!field) {
      return !formGroup.valid;
    }
    return !(formGroup.get(field).valid && formGroup.get(field).touched);
  }

  // @todo extract to abstract for all forms
  validateAllFormFields(formGroup: FormGroup) {
    Object.keys(formGroup.controls).forEach(field => {
      const control = formGroup.get(field);
      if (control instanceof FormControl) {
        control.markAsTouched({onlySelf: true});
      } else if (control instanceof FormGroup) {
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
    this.windowRef.confirmationResult = null;
    this.windowRef.recaptchaVerifier = null;
  }

}
