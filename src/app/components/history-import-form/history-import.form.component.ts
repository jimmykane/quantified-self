import {Component, Inject, OnDestroy, OnInit} from '@angular/core';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  Validators,
} from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import * as Sentry from '@sentry/browser';
import {User} from 'quantified-self-lib/lib/users/user';
import {Log} from 'ng2-logger/browser';
import {UserService} from '../../services/app.user.service';
import {UserServiceMetaInterface} from 'quantified-self-lib/lib/users/user.service.meta.interface';
import {Subscription} from 'rxjs';
import {ServiceNames} from "quantified-self-lib/lib/meta-data/meta-data.interface";


@Component({
  selector: 'app-activity-form',
  templateUrl: './history-import.form.component.html',
  styleUrls: ['./history-import.form.component.css'],
  providers: [],
})


export class HistoryImportFormComponent implements OnInit, OnDestroy {
  protected logger = Log.create('ActivityFormComponent');

  public user: User;

  public formGroup: FormGroup;

  public userMetaForService: UserServiceMetaInterface;
  public userMetaForServiceSubscription: Subscription;

  public isAllowedToDoHistoryImport = false;

  public nextImportAvailableDate: Date;

  public isLoading: boolean;

  constructor(
    public dialogRef: MatDialogRef<HistoryImportFormComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private userService: UserService,
    private snackBar: MatSnackBar,
  ) {
    this.user = data.user;
  }

  async ngOnInit() {
    if (!this.user) {
      throw new Error('Component needs a user')
    }
    // Set this to loading
    this.isLoading = true;

    // Now build the controls
    this.formGroup = new FormGroup({
      formArray: new FormArray([
        new FormGroup({
          startDate: new FormControl(new Date(new Date().setHours(0, 0, 0, 0)), [
            Validators.required,
          ]),
          endDate: new FormControl(new Date(new Date().setHours(24, 0, 0, 0)), [
            Validators.required,
          ])
        }),
        new FormGroup({
          accepted: new FormControl(false, [
            Validators.requiredTrue,
            // Validators.minLength(4),
          ]),
        })
      ])
    });


    this.userMetaForServiceSubscription = await this.userService
      .getUserMetaForService(this.user, ServiceNames.SuuntoApp)
      .subscribe((userMetaForService) => {
        if (!userMetaForService) {
          this.isAllowedToDoHistoryImport = true;
          return;
        }
        this.nextImportAvailableDate = new Date(userMetaForService.didLastHistoryImport + ((userMetaForService.processedActivities / 100) * 24 * 60 * 60 * 1000)) // 7 days for  285,7142857143 per day
        this.userMetaForService = userMetaForService;

        // He is only allowed if he did it about 7 days ago
        this.isAllowedToDoHistoryImport =
          this.nextImportAvailableDate < (new Date())
          || this.userMetaForService.processedActivities === 0;
      });

    // Set this to done loading
    this.isLoading = false;
  }

  /** Returns a FormArray with the name 'formArray'. */
  get formArray(): AbstractControl | null {
    return this.formGroup.get('formArray');
  }

  hasError(formGroupIndex?: number, field?: string) {
    if (!field) {
      return !this.formGroup.valid;
    }
    const formArray = <FormArray>this.formGroup.get('formArray');
    return !(formArray.controls[formGroupIndex].get(field).valid && formArray.controls[formGroupIndex].get(field).touched);
  }

  async onSubmit(event) {
    event.preventDefault();
    if (!this.formGroup.valid) {
      this.validateAllFormFields(this.formGroup);
      return;
    }

    if (this.isLoading) {
      return;
    }

    this.isLoading = true;

    try {
      await this.userService.importSuuntoAppHistory(this.formGroup.get('formArray')['controls'][0].get('startDate').value, this.formGroup.get('formArray')['controls'][0].get('endDate').value);

      this.snackBar.open('History import started', null, {
        duration: 2000,
      });
      this.dialogRef.close();
    } catch (e) {
      // debugger;
      Sentry.captureException(e);
      this.logger.error(e);
      this.snackBar.open(`Could import history due to ${e.error}`, null, {
        duration: 2000,
      });
      Sentry.captureException(e);
    } finally {
      this.isLoading = false;
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

  ngOnDestroy(): void {
    if (this.userMetaForServiceSubscription) {
      this.userMetaForServiceSubscription.unsubscribe();
    }
  }

  close(event) {
    if (this.userMetaForServiceSubscription) {
      this.userMetaForServiceSubscription.unsubscribe();
    }
    event.stopPropagation();
    event.preventDefault();
    this.dialogRef.close();
  }
}

