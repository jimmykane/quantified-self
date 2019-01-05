import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, Input, OnInit} from '@angular/core';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventService} from '../../services/app.event.service';
import {FormBuilder, FormControl, FormGroup, FormGroupDirective, NgForm, Validators} from '@angular/forms';
import {ErrorStateMatcher, MAT_DIALOG_DATA, MatDialogRef, MatSnackBar} from '@angular/material';
import * as Raven from 'raven-js';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';
import {User} from 'quantified-self-lib/lib/users/user';
import {UserService} from '../../services/app.user.service';
import {AppAuthService} from '../../authentication/app.auth.service';
import {Router} from '@angular/router';


@Component({
  selector: 'app-user-form',
  templateUrl: './user.form.component.html',
  styleUrls: ['./user.form.component.css'],
  providers: [],
  // changeDetection: ChangeDetectionStrategy.OnPush,

})


export class UserFormComponent implements OnInit {

  public privacy = Privacy;
  public showDelete: boolean;
  public consentToDelete: boolean;
  public user: User;
  public originalValues: {
    displayName: string;
  };

  public userFormGroup: FormGroup;

  constructor(
    public dialogRef: MatDialogRef<UserFormComponent>,
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
      displayName: new FormControl(this.user.displayName, [
        Validators.required,
        // Validators.minLength(4),
      ]),
      privacy: new FormControl(this.user.privacy, [
        Validators.required,
        // Validators.minLength(4),
      ]),
      description: new FormControl(this.user.description, [
        // Validators.required,
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
    // @todo fix this as delete enters here
    if (!this.userFormGroup.valid) {
      this.validateAllFormFields(this.userFormGroup);
      return;
    }
    try {
      await this.userService.updateUserProperties(this.user, {
        displayName: this.userFormGroup.get('displayName').value,
        privacy: this.userFormGroup.get('privacy').value,
        description: this.userFormGroup.get('description').value,
      });
      this.snackBar.open('User updated', null, {
        duration: 2000,
      });
    } catch (e) {
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

  public async deleteUser() {
    event.preventDefault();
    await this.router.navigate(['home']);
    await this.userService.deleteAllUserData(this.user);
    await this.authService.signOut();
    this.snackBar.open('Account deleted! You are now logged out.', null, {
      duration: 5000,
    });
    this.dialogRef.close();
  }

  close() {
    event.stopPropagation();
    event.preventDefault();
    this.dialogRef.close();
  }
}
