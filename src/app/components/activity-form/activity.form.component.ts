import {ChangeDetectionStrategy, Component, Inject, OnInit} from '@angular/core';
import {EventService} from '../../services/app.event.service';
import {FormBuilder, FormControl, FormGroup, Validators} from '@angular/forms';
import {MAT_DIALOG_DATA, MatDialogRef, MatSnackBar} from '@angular/material';
import * as Raven from 'raven-js';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';


@Component({
  selector: 'app-activity-form-actions-menu',
  templateUrl: './activity.form.component.html',
  styleUrls: ['./activity.form.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,

})


export class ActivityFormComponent implements OnInit {

  public activity: ActivityInterface;
  public originalValues: {
    name: string;
  };

  public activityFormGroup: FormGroup;

  constructor(
    public dialogRef: MatDialogRef<ActivityFormComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private eventService: EventService,
    private snackBar: MatSnackBar,
    private formBuilder: FormBuilder
  ) {
    this.activity = data.activity;
    this.originalValues = {name: this.event.name};
  }

  ngOnInit(): void {
    this.activityFormGroup = new FormGroup({
      name: new FormControl(this.event.name, [
        Validators.required,
        Validators.minLength(4),
      ]),
    });
  }

  hasError(field: string) {
    return !(this.activityFormGroup.get(field).valid && this.activityFormGroup.get(field).touched);
  }

  async onSubmit() {
    if (!this.activityFormGroup.valid) {
      this.validateAllFormFields(this.activityFormGroup);
    }
    try {
      await this.eventService.addAndReplace(this.event);
      this.snackBar.open('Event saved', null, {
        duration: 5000,
      });
    } catch (e) {
      this.snackBar.open('Could not save event', null, {
        duration: 5000,
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
    this.restoreOriginalValues();
    this.dialogRef.close();
  }

  restoreOriginalValues() {
    this.event.name = this.originalValues.name;
  }
}
