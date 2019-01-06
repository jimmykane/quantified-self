import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, Input, OnInit} from '@angular/core';
import {FormBuilder, FormControl, FormGroup, FormGroupDirective, NgForm, Validators} from '@angular/forms';
import {ErrorStateMatcher, MAT_DIALOG_DATA, MatDialogRef, MatSnackBar} from '@angular/material';
import * as Raven from 'raven-js';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';
import {User} from 'quantified-self-lib/lib/users/user';
import {UserService} from '../../services/app.user.service';
import {AppAuthService} from '../../authentication/app.auth.service';
import {Router} from '@angular/router';


@Component({
  selector: 'app-user-agreement-form',
  templateUrl: './user-agreement.form.component.html',
  styleUrls: ['./user-agreement.form.component.css'],
  providers: [],
})


export class UserAgreementFormComponent implements OnInit {

  public privacy = Privacy;
  public consentToDelete: boolean;
  public user: User;
  public originalValues: {
    displayName: string;
  };

  public userFormGroup: FormGroup;

  constructor(
    public dialogRef: MatDialogRef<UserAgreementFormComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private userService: UserService,
    private authService: AppAuthService,
    private snackBar: MatSnackBar,
    private router: Router,
    private formBuilder: FormBuilder,
  ) {
    this.user = data.user; // Perhaps move to service?
    if (!this.user) {
      throw  'Component needs user'
    }
  }

  ngOnInit(): void {
    this.userFormGroup = new FormGroup({
      acceptPrivacyPolicy: new FormControl(this.user.acceptedPrivacyPolicy, [
        Validators.requiredTrue,
        // Validators.minLength(4),
      ]),
      acceptDataPolicy: new FormControl(this.user.acceptedDataPolicy, [
        Validators.requiredTrue,
        // Validators.minLength(4),
      ]),
      // 'alterEgo': new FormControl(this.hero.alterEgo),
      // 'power': new FormControl(this.hero.power, Validators.required)
    });
  }

  hasError(field: string) {
    return !(this.userFormGroup.get(field).valid && this.userFormGroup.get(field).touched);
  }

  async onSubmit() {
    if (!this.userFormGroup.valid) {
      this.validateAllFormFields(this.userFormGroup);
      return;
    }
    try {
      this.user.acceptedDataPolicy = true;
      this.user.acceptedPrivacyPolicy = true;
      const dbUser = await this.userService.createOrUpdateUser(this.user);
      this.snackBar.open('User updated', null, {
        duration: 2000,
      });
      await this.router.navigate(['dashboard']);
      this.snackBar.open(`Thanks for registering ${dbUser.displayName || 'Anonymous'}`, null, {
        duration: 2000,
      });
    } catch (e) {
      debugger;
      this.snackBar.open('Could not update user', null, {
        duration: 2000,
      });
      Raven.captureException(e);
    } finally {
      this.dialogRef.close()
    }
  }

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

  close() {
    event.stopPropagation();
    event.preventDefault();
    this.dialogRef.close();
  }
}
