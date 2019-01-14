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
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {EventUtilities} from 'quantified-self-lib/lib/events/utilities/event.utilities';
import {activityDistanceValidator} from './activity.form.distance.validator';
import {User} from 'quantified-self-lib/lib/users/user';
import {take} from "rxjs/operators";
import {Log} from "ng2-logger/browser";


@Component({
  selector: 'app-activity-form',
  templateUrl: './activity.form.component.html',
  styleUrls: ['./activity.form.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,

})


export class ActivityFormComponent implements OnInit {
  protected logger = Log.create('ActivityFormComponent');

  public activity: ActivityInterface;
  public event: EventInterface;
  public user: User;

  public activityFormGroup: FormGroup;

  public isSaving: boolean;

  constructor(
    public dialogRef: MatDialogRef<ActivityFormComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private eventService: EventService,
    private snackBar: MatSnackBar,
    private formBuilder: FormBuilder,
  ) {
    this.activity = data.activity;
    this.event = data.event;
    this.user = data.user;
  }

  async ngOnInit() {
    if (!this.user || !this.event) {
      throw 'Component needs event and user'
    }


    this.activityFormGroup = new FormGroup({
        activity: new FormControl(this.activity),
        startDate: new FormControl(this.activity.startDate, [
          Validators.required,
        ]),
        endDate: new FormControl(this.activity.endDate, [
          Validators.required,
        ]),
        startDistance: new FormControl(0, [
          Validators.required,
        ]),
        endDistance: new FormControl(this.activity.getDistance().getValue(), [
          Validators.required,
        ]),
      },
      {validators: activityDistanceValidator});

    // To use this component we need the full hydrated object and we might not have it
    this.activity.clearStreams();
    this.activity.addStreams(await this.eventService.getAllStreams(this.user, this.event.getID(), this.activity.getID()).pipe(take(1)).toPromise());
  }


  hasError(field?: string) {
    if (!field) {
      return !this.activityFormGroup.valid;
    }
    return !this.activityFormGroup.get(field).valid;
  }

  async onSubmit() {
    event.preventDefault();
    if (!this.activityFormGroup.valid) {
      this.validateAllFormFields(this.activityFormGroup);
      return;
    }
    this.isSaving = true;
    if (this.activity.startDate < this.event.startDate) {
      this.event.startDate = this.activity.startDate;
    }
    if (this.activity.endDate > this.event.endDate) {
      this.event.endDate = this.activity.endDate;
    }

    try {
      EventUtilities.cropDistance(Number(this.activityFormGroup.get('startDistance').value), Number(this.activityFormGroup.get('endDistance').value), this.activity);
      EventUtilities.generateActivityStats(this.event);
      await this.eventService.setEvent(this.user, this.event);
      this.snackBar.open('Activity saved', null, {
        duration: 2000,
      });
    } catch (e) {
      // debugger;
      Raven.captureException(e);
      this.logger.error(e);
      this.snackBar.open('Could not save activity', null, {
        duration: 2000,
      });
      Raven.captureException(e);
    } finally {
      this.isSaving = false;
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

