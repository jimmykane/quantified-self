import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, Input, OnInit} from '@angular/core';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventService} from '../../services/app.event.service';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  FormGroupDirective,
  NgForm,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import {ErrorStateMatcher, MAT_DIALOG_DATA, MatDialogRef, MatSnackBar} from '@angular/material';
import * as Raven from 'raven-js';
import {User} from 'quantified-self-lib/lib/users/user';
import {Log} from 'ng2-logger/browser';
import {UserService} from '../../services/app.user.service';


@Component({
  selector: 'app-activity-form',
  templateUrl: './history-import.form.component.html',
  styleUrls: ['./history-import.form.component.css'],
  providers: [],
})


export class HistoryImportFormComponent implements OnInit {
  protected logger = Log.create('ActivityFormComponent');

  public user: User;

  public formGroup: FormGroup;


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
        startDate: new FormControl(new Date(), [
          Validators.required,
        ]),
        endDate: new FormControl(new Date(), [
          Validators.required,
        ]),
      });

    // Set this to done loading
    this.isLoading = false;
  }


  hasError(field?: string) {
    if (!field) {
      return !this.formGroup.valid;
    }
    return !(this.formGroup.get(field).valid && this.formGroup.get(field).touched);
  }

  async onSubmit() {
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
      await this.userService.importSuuntoAppHistory(this.formGroup.get('startDate').value, this.formGroup.get('endDate').value);

      this.snackBar.open('History import started', null, {
        duration: 2000,
      });
    } catch (e) {
      // debugger;
      Raven.captureException(e);
      this.logger.error(e);
      this.snackBar.open(`Could import history due to ${e.toString()}`, null, {
        duration: 2000,
      });
      Raven.captureException(e);
    } finally {
      this.isLoading = false;
      this.dialogRef.close();
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

  close(event) {
    event.stopPropagation();
    event.preventDefault();
    this.dialogRef.close();
  }
}

