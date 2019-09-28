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
  FormControl,
  FormGroup,
  NgForm,
  Validators
} from '@angular/forms';
import {ErrorStateMatcher} from '@angular/material/core';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import * as Sentry from '@sentry/browser';
import {AngularFireAuth} from '@angular/fire/auth';
import * as firebase from 'firebase/app';
import {FormsAbstract} from '../forms/forms.abstract';
import {User} from 'quantified-self-lib/lib/users/user';


@Component({
  selector: 'app-phone-form',
  templateUrl: './events-export.form.component.html',
  styleUrls: ['./events-export.form.component.css'],
  providers: [],
})


export class EventsExportFormComponent extends FormsAbstract {

  public exportFromGroup: FormGroup;
  public user: User;
  public isLoading: boolean;


  constructor(
    public dialogRef: MatDialogRef<any>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    protected snackBar: MatSnackBar,
  ) {
    super(dialogRef, data, snackBar);
    this.user = data.user;
    if (!this.user) {
      throw new Error('Component needs event and user')
    }

    this.exportFromGroup = new FormGroup({
        startDate: new FormControl(this.user.settings.exportToCSVSettings.startDate, [
          Validators.required
        ]),
        name: new FormControl(this.user.settings.exportToCSVSettings.name, []),
        description: new FormControl(this.user.settings.exportToCSVSettings.description, []),
        duration: new FormControl(this.user.settings.exportToCSVSettings.duration, []),
        ascent: new FormControl(this.user.settings.exportToCSVSettings.ascent, []),
        descent: new FormControl(this.user.settings.exportToCSVSettings.descent, []),
        calories: new FormControl(this.user.settings.exportToCSVSettings.calories, []),
        feeling: new FormControl(this.user.settings.exportToCSVSettings.feeling, []),
        rpe: new FormControl(this.user.settings.exportToCSVSettings.rpe, []),
        averageSpeed: new FormControl(this.user.settings.exportToCSVSettings.averageSpeed, []),
        averagePace: new FormControl(this.user.settings.exportToCSVSettings.averagePace, []),
        averageSwimPace: new FormControl(this.user.settings.exportToCSVSettings.averageSwimPace, []),
        averageHeartRate: new FormControl(this.user.settings.exportToCSVSettings.averageHeartRate, []),
        maximumHeartRate: new FormControl(this.user.settings.exportToCSVSettings.maximumHeartRate, []),
        averagePower: new FormControl(this.user.settings.exportToCSVSettings.averagePower, []),
        maximumPower: new FormControl(this.user.settings.exportToCSVSettings.maximumPower, []),
        vO2Max: new FormControl(this.user.settings.exportToCSVSettings.vO2Max, []),
      }
    );
  }

}
