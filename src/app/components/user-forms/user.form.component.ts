import { Component, Inject, Input, OnInit, inject } from '@angular/core';
import { UntypedFormControl, UntypedFormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import * as Sentry from '@sentry/browser';
import { Privacy } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
import { AppUserService } from '../../services/app.user.service';
import { AppAuthService } from '../../authentication/app.auth.service';
import { Router } from '@angular/router';
import { AppWindowService } from '../../services/app.window.service';
import { Analytics, logEvent } from '@angular/fire/analytics';


@Component({
  selector: 'app-user-form',
  templateUrl: './user.form.component.html',
  styleUrls: ['./user.form.component.css'],
  providers: [],
  standalone: false
})


export class UserFormComponent implements OnInit {

  public privacy = Privacy;
  public showDelete: boolean;
  public consentToDelete: boolean;
  public user: User;
  public isDeleting: boolean;
  public errorDeleting;
  public isLoading: boolean;
  public isUserBranded: boolean;

  public userFormGroup: UntypedFormGroup;

  private analytics = inject(Analytics);

  constructor(
    public dialogRef: MatDialogRef<UserFormComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private userService: AppUserService,
    private authService: AppAuthService,
    private snackBar: MatSnackBar,
    private router: Router,
    private windowService: AppWindowService,
  ) {
    this.user = data.user; // Perhaps move to service?
    if (!this.user) {
      throw new Error('Component needs user')
    }
  }

  async ngOnInit() {
    // Set this to loading
    this.isLoading = true;

    this.userFormGroup = new UntypedFormGroup({
      displayName: new UntypedFormControl(this.user.displayName, [
        Validators.required,
        // Validators.minLength(4),
      ]),
      privacy: new UntypedFormControl(this.user.privacy, [
        Validators.required,
        // Validators.minLength(4),
      ]),
      description: new UntypedFormControl(this.user.description, [
        // Validators.required,
        // Validators.minLength(4),
      ]),
      brandText: new UntypedFormControl({ value: this.user.brandText, disabled: !(await this.userService.isBranded(this.user)) }, [
      ]),
    });

    this.userFormGroup.addControl('brandText', new UntypedFormControl(0, []));
    // Set this to done loading
    this.isLoading = false;
  }

  hasError(field: string) {
    return (!this.userFormGroup.get(field).valid && this.userFormGroup.get(field).touched);
  }

  async onSubmit(event) {
    event.preventDefault();
    if (!this.userFormGroup.valid) {
      this.validateAllFormFields(this.userFormGroup);
      return;
    }
    try {
      await this.userService.updateUserProperties(this.user, {
        displayName: this.userFormGroup.get('displayName').value,
        privacy: this.userFormGroup.get('privacy').value,
        description: this.userFormGroup.get('description').value,
        brandText: this.userFormGroup.get('brandText').value || null,
      });
      this.snackBar.open('User updated', null, {
        duration: 2000,
      });
    } catch (e) {
      this.snackBar.open('Could not update user', null, {
        duration: 2000,
      });
      Sentry.captureException(e);
    } finally {
      this.dialogRef.close()
    }
  }

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

  public async deleteUser(event) {
    event.preventDefault();
    this.dialogRef.disableClose = true;
    this.isDeleting = true;
    try {
      await this.userService.deleteAllUserData(this.user);
      logEvent(this.analytics, 'user_delete', {});
      await this.authService.signOut();
      await this.router.navigate(['/']);
      this.snackBar.open('Account deleted! You are now logged out.', null, {
        duration: 5000,
      });
      this.dialogRef.close(); // Not sure if needed
      localStorage.clear();
      this.windowService.windowRef.location.reload();
    } catch (e) {
      Sentry.captureException(e);
      this.errorDeleting = e;
      this.dialogRef.disableClose = false;
      this.isDeleting = false;
    }
  }

  close(event) {
    event.stopPropagation();
    event.preventDefault();
    this.dialogRef.close();
  }
}
