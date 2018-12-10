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


@Component({
  selector: 'app-activity-form',
  templateUrl: './activity.form.component.html',
  styleUrls: ['./activity.form.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,

})


export class ActivityFormComponent implements OnInit {

  public activity: ActivityInterface;
  public event: EventInterface;
  public originalValues: {
    activityStartDate: Date;
    activityEndDate: Date;
  };

  public activityFormGroup: FormGroup;

  constructor(
    public dialogRef: MatDialogRef<ActivityFormComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private eventService: EventService,
    private snackBar: MatSnackBar,
    private formBuilder: FormBuilder,
  ) {
    this.activity = data.activity;
    this.event = data.event;
    this.originalValues = {
      activityStartDate: this.activity.startDate,
      activityEndDate: this.activity.endDate,
    };
  }

  ngOnInit(): void {
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
        // 'alterEgo': new FormControl(this.hero.alterEgo),
        // 'power': new FormControl(this.hero.power, Validators.required)
      },
      {validators: activityDistanceValidator});
  }


  hasError(field?: string) {
    if (!field) {
      return !this.activityFormGroup.valid;
    }
    return !this.activityFormGroup.get(field).valid;
  }

  async onSubmit() {
    if (!this.activityFormGroup.valid) {
      this.validateAllFormFields(this.activityFormGroup);
      return;
    }
    if (this.activity.startDate < this.event.startDate) {
      this.event.startDate = this.activity.startDate;
    }
    if (this.activity.endDate > this.event.endDate) {
      this.event.endDate = this.activity.endDate;
    }
    // Should trim distance
    EventUtilities.cropDistance(Number(this.activityFormGroup.get('startDistance').value), Number(this.activityFormGroup.get('endDistance').value), this.activity);
    // Regenerate stats
    EventUtilities.generateStats(this.event);
    debugger;
    try {
      await this.eventService.setEvent(this.event);
      this.snackBar.open('Activity saved', null, {
        duration: 5000,
      });
    } catch (e) {
      debugger;
      this.snackBar.open('Could not save activity', null, {
        duration: 5000,
      });
      Raven.captureException(e);
    } finally {
      this.dialogRef.close();
      // @todo reload the event as it should be done in the card component
      location.reload();
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
    this.activity.startDate = this.originalValues.activityStartDate;
    this.activity.endDate = this.originalValues.activityEndDate;
  }
}

