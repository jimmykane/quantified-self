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
import {ErrorStateMatcher} from '@angular/material/core';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import * as Sentry from '@sentry/browser';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {EventUtilities} from 'quantified-self-lib/lib/events/utilities/event.utilities';
import {User} from 'quantified-self-lib/lib/users/user';
import {take} from 'rxjs/operators';
import {Log} from 'ng2-logger/browser';
import {DataDistance} from 'quantified-self-lib/lib/data/data.distance';
import {DataDeviceNames} from 'quantified-self-lib/lib/data/data.device-names';
import {DataAscent} from 'quantified-self-lib/lib/data/data.ascent';
import {DataDescent} from 'quantified-self-lib/lib/data/data.descent';


@Component({
  selector: 'app-activity-form',
  templateUrl: './activity.form.component.html',
  styleUrls: ['./activity.form.component.css'],
  providers: [],
})


export class ActivityFormComponent implements OnInit {
  protected logger = Log.create('ActivityFormComponent');

  public activity: ActivityInterface;
  public event: EventInterface;
  public user: User;

  public activityFormGroup: FormGroup;

  public isLoading: boolean;

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
      throw new Error('Component needs event and user')
    }

    // Set this to loading
    this.isLoading = true;

    // To use this component we need the full hydrated object and we might not have it
    this.activity.clearStreams();
    this.activity.addStreams(await this.eventService.getAllStreams(this.user, this.event.getID(), this.activity.getID()).pipe(take(1)).toPromise());
    // Now build the controls
    this.activityFormGroup = new FormGroup({
        activity: new FormControl(this.activity),
        creatorName: new FormControl(this.activity.creator.name, [
          Validators.required,
        ]),
        startDate: new FormControl(this.activity.startDate, [
          Validators.required,
        ]),
        endDate: new FormControl({value: this.activity.endDate, disabled: true}, [
          Validators.required,
        ]),
        startTime: new FormControl(this.getTimeFromDateAsString(this.activity.startDate), [
          Validators.required,
        ]),
        endTime: new FormControl({
          value: this.getTimeFromDateAsString(this.activity.endDate),
          disabled: true
        }, [
          Validators.required,
        ]),
      }
    );

    const ascent = this.activity.getStat(DataAscent.type);
    if (ascent) {
      this.activityFormGroup.addControl('ascent', new FormControl(ascent.getValue(), [
        Validators.required,
      ]))
    }

    const descent = this.activity.getStat(DataDescent.type);
    if (descent) {
      this.activityFormGroup.addControl('descent', new FormControl(descent.getValue(), [
        Validators.required,
      ]))
    }

    const distance = this.activity.getStat(DataDistance.type);
    if (distance) {
      this.activityFormGroup.addControl('descent', new FormControl(distance.getValue(), [
        Validators.required,
      ]))
    }

    // Find the starting distance for this activity
    if (this.hasDistance()) {
      this.activityFormGroup.addControl('startDistance', new FormControl(0, [
        Validators.required,
        Validators.min(0),
        Validators.max(this.activity.getSquashedStreamData(DataDistance.type)[this.activity.getSquashedStreamData(DataDistance.type).length - 1]),
      ]));
      this.activityFormGroup.addControl('endDistance', new FormControl(this.activity.getSquashedStreamData(DataDistance.type)[this.activity.getSquashedStreamData(DataDistance.type).length - 1], [
        Validators.required,
        Validators.min(0),
        Validators.max(this.activity.getSquashedStreamData(DataDistance.type)[this.activity.getSquashedStreamData(DataDistance.type).length - 1]),
      ]));

      this.activityFormGroup.setValidators([activityDistanceValidator]);
    }
    // Set this to done loading
    this.isLoading = false;
  }

  onStartDateAndStartTimeChange(event) {
    const starDate = this.activityFormGroup.get('startDate').value;
    if (!starDate) {
      return;
    }
    starDate.setHours(this.activityFormGroup.get('startTime').value.split(':')[0]);
    starDate.setMinutes(this.activityFormGroup.get('startTime').value.split(':')[1]);
    starDate.setSeconds(this.activityFormGroup.get('startTime').value.split(':')[2]);
    const endDate = new Date(starDate.getTime() + this.activity.getDuration().getValue() * 1000 + this.activity.getPause().getValue() * 1000);
    this.activityFormGroup.get('endDate').setValue(endDate);
    this.activityFormGroup.get('endTime').setValue(this.getTimeFromDateAsString(endDate))
  }

  hasDistance() {
    return this.activity.hasStreamData(DataDistance.type) && this.activity.getSquashedStreamData(DataDistance.type)[this.activity.getSquashedStreamData(DataDistance.type).length - 1] !== 0;
  }

  hasError(field?: string) {
    if (!field) {
      return !this.activityFormGroup.valid;
    }
    return !(this.activityFormGroup.get(field).valid && this.activityFormGroup.get(field).touched);
  }

  async onSubmit(event) {
    event.preventDefault();
    if (!this.activityFormGroup.valid) {
      this.validateAllFormFields(this.activityFormGroup);
      return;
    }
    this.isLoading = true;

    try {
      // this saves 2 entities
      if (this.activityFormGroup.get('creatorName').dirty) {
        this.activity.creator.name = this.activityFormGroup.get('creatorName').value;
        this.event.addStat(new DataDeviceNames(this.event.getActivities().map(eventActivities => eventActivities.creator.name)));
      }
      if (this.activityFormGroup.get('startDate') && (this.activityFormGroup.get('startDate').dirty || this.activityFormGroup.get('startTime').dirty)) {
        this.activity.startDate = this.activityFormGroup.get('startDate').value;
        this.activity.startDate.setHours(this.activityFormGroup.get('startTime').value.split(':')[0]);
        this.activity.startDate.setMinutes(this.activityFormGroup.get('startTime').value.split(':')[1]);
        this.activity.startDate.setSeconds(this.activityFormGroup.get('startTime').value.split(':')[2]);
        this.activity.startDate.setMilliseconds(0);
        this.activity.endDate = new Date(this.activity.startDate.getTime() + this.activity.getDuration().getValue() * 1000 + this.activity.getPause().getValue() * 1000);
        if (this.activity === this.event.getFirstActivity()) {
          this.event.startDate = this.activity.startDate;
        }
        if (this.activity === this.event.getLastActivity()) {
          this.event.endDate = this.activity.endDate;
        }
      }

      if (this.activityFormGroup.get('ascent').dirty) {
        this.activity.addStat(new DataAscent(this.activityFormGroup.get('ascent').value));
        this.event.addStat(new DataAscent(this.event.getActivities().reduce((ascent, activity) => {
          const activityAscent = activity.getStat(DataAscent.type);
          if (activityAscent) {
            ascent += <number>activityAscent.getValue();
          }
          return ascent;
        }, 0)));
      }

      if (this.activityFormGroup.get('descent').dirty) {
        this.activity.addStat(new DataDescent(this.activityFormGroup.get('descent').value));
        this.event.addStat(new DataDescent(this.event.getActivities().reduce((descent, activity) => {
          const activityDescent = activity.getStat(DataDescent.type);
          if (activityDescent) {
            descent += <number>activityDescent.getValue();
          }
          return descent;
        }, 0)));
      }

      if (this.activityFormGroup.get('descent').dirty) {
        this.activity.addStat(new DataDescent(this.activityFormGroup.get('descent').value));
        this.event.addStat(new DataDistance(this.event.getActivities().reduce((descent, activity) => {
          const activityDescent = activity.getStat(DataDescent.type);
          if (activityDescent) {
            descent += <number>activityDescent.getValue();
          }
          return descent;
        }, 0)));
      }

      if (this.activity.hasStreamData(DataDistance.type) && (this.activityFormGroup.get('startDistance').dirty || this.activityFormGroup.get('endDistance').dirty)) {
        EventUtilities.cropDistance(Number(this.activityFormGroup.get('startDistance').value), Number(this.activityFormGroup.get('endDistance').value), this.activity);
        this.activity.clearStats();
        EventUtilities.generateMissingStreamsAndStatsForActivity(this.activity);
        EventUtilities.reGenerateStatsForEvent(this.event);
      }


      await this.eventService.setEvent(this.user, this.event);

      this.snackBar.open('Activity saved', null, {
        duration: 2000,
      });
    } catch (e) {
      // debugger;
      Sentry.captureException(e);
      this.logger.error(e);
      this.snackBar.open('Could not save activity', null, {
        duration: 2000,
      });
      Sentry.captureException(e);
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

  private getTimeFromDateAsString(date: Date): string {
    return `${('0' + date.getHours()).slice(-2)}:${('0' + date.getMinutes()).slice(-2)}:${('0' + date.getSeconds()).slice(-2)}`
  }
}


export const activityDistanceValidator: ValidatorFn = (control: FormGroup): ValidationErrors | null => {
  const startDistance = control.get('startDistance');
  const endDistance = control.get('endDistance');

  if (endDistance.value <= startDistance.value) {
    return {'endDistanceSmallerThanStartDistance': true};
  }
  return null;
};
