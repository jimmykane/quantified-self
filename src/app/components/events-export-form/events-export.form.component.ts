import {Component, Inject} from '@angular/core';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {FormControl, FormGroup, Validators} from '@angular/forms';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import {FormsAbstract} from '../forms/forms.abstract';
import {User} from 'quantified-self-lib/lib/users/user';
import {UserService} from '../../services/app.user.service';
import {FileService} from '../../services/app.file.service';
import {DataRPE} from 'quantified-self-lib/lib/data/data.rpe';
import {DataAscent} from 'quantified-self-lib/lib/data/data.ascent';
import {DataDescent} from 'quantified-self-lib/lib/data/data.descent';
import {DataEnergy} from 'quantified-self-lib/lib/data/data.energy';
import {DataFeeling} from 'quantified-self-lib/lib/data/data.feeling';
import {DataSpeedAvg} from 'quantified-self-lib/lib/data/data.speed-avg';
import {DataPaceAvg} from 'quantified-self-lib/lib/data/data.pace-avg';
import {DataSwimPaceAvg} from 'quantified-self-lib/lib/data/data.swim-pace-avg';
import {DataHeartRateAvg} from 'quantified-self-lib/lib/data/data.heart-rate-avg';
import {DataPowerAvg} from 'quantified-self-lib/lib/data/data.power-avg';
import {DataPowerMax} from 'quantified-self-lib/lib/data/data.power-max';
import {DataVO2Max} from 'quantified-self-lib/lib/data/data.vo2-max';
import {SharingService} from '../../services/app.sharing.service';
import {DataActivityTypes} from 'quantified-self-lib/lib/data/data.activity-types';
import {ActivityTypes} from 'quantified-self-lib/lib/activities/activity.types';
import {DataPace} from 'quantified-self-lib/lib/data/data.pace';
import {DynamicDataLoader} from 'quantified-self-lib/lib/data/data.store';
import {DataSpeed} from 'quantified-self-lib/lib/data/data.speed';
import {DataSwimPace} from 'quantified-self-lib/lib/data/data.swim-pace';
import * as firebase from 'firebase/app';
import {AngularFireAnalytics} from '@angular/fire/analytics';


@Component({
  selector: 'app-phone-form',
  templateUrl: './events-export.form.component.html',
  styleUrls: ['./events-export.form.component.css'],
  providers: [],
})


export class EventsExportFormComponent extends FormsAbstract {

  public exportFromGroup: FormGroup;
  public user: User;
  public events: EventInterface[];
  public startDate: Date;
  public endDate: Date;
  public isLoading: boolean;


  constructor(
    public dialogRef: MatDialogRef<any>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    protected snackBar: MatSnackBar,
    private userService: UserService,
    private fileService: FileService,
    private sharingService: SharingService,
    private afa: AngularFireAnalytics,
  ) {
    super(dialogRef, data, snackBar);
    this.user = data.user;
    this.events = data.events;
    if (!this.user || !this.events) {
      throw new Error('Component needs events, user, start date and end date')
    }

    this.events.sort((eventA: EventInterface, eventB: EventInterface) => {
      return +eventA.startDate - +eventB.startDate;
    });

    this.startDate = this.events[0].startDate;
    this.endDate = this.events[this.events.length - 1].endDate;

    this.exportFromGroup = new FormGroup({
        startDate: new FormControl(this.user.settings.exportToCSVSettings.startDate, [
          Validators.required
        ]),
        name: new FormControl(this.user.settings.exportToCSVSettings.name, []),
        description: new FormControl(this.user.settings.exportToCSVSettings.description, []),
        activityTypes: new FormControl(this.user.settings.exportToCSVSettings.activityTypes, []),
        distance: new FormControl(this.user.settings.exportToCSVSettings.distance, []),
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
        includeLink: new FormControl(this.user.settings.exportToCSVSettings.includeLink, []),
      }
    );
  }


  async onSubmit(someEvent) {
    super.onSubmit(someEvent);
    // create csv header
    this.user.settings.exportToCSVSettings.startDate = this.exportFromGroup.get('startDate').value;
    this.user.settings.exportToCSVSettings.name = this.exportFromGroup.get('name').value;
    this.user.settings.exportToCSVSettings.description = this.exportFromGroup.get('description').value;
    this.user.settings.exportToCSVSettings.activityTypes = this.exportFromGroup.get('activityTypes').value;
    this.user.settings.exportToCSVSettings.distance = this.exportFromGroup.get('distance').value;
    this.user.settings.exportToCSVSettings.duration = this.exportFromGroup.get('duration').value;
    this.user.settings.exportToCSVSettings.ascent = this.exportFromGroup.get('ascent').value;
    this.user.settings.exportToCSVSettings.descent = this.exportFromGroup.get('descent').value;
    this.user.settings.exportToCSVSettings.calories = this.exportFromGroup.get('calories').value;

    this.user.settings.exportToCSVSettings.feeling = this.exportFromGroup.get('feeling').value;
    this.user.settings.exportToCSVSettings.rpe = this.exportFromGroup.get('rpe').value;
    this.user.settings.exportToCSVSettings.averageSpeed = this.exportFromGroup.get('averageSpeed').value;
    this.user.settings.exportToCSVSettings.averagePace = this.exportFromGroup.get('averagePace').value;
    this.user.settings.exportToCSVSettings.averageSwimPace = this.exportFromGroup.get('averageSwimPace').value;
    this.user.settings.exportToCSVSettings.averageHeartRate = this.exportFromGroup.get('averageHeartRate').value;
    this.user.settings.exportToCSVSettings.averagePower = this.exportFromGroup.get('averagePower').value;
    this.user.settings.exportToCSVSettings.maximumPower = this.exportFromGroup.get('maximumPower').value;
    this.user.settings.exportToCSVSettings.vO2Max = this.exportFromGroup.get('vO2Max').value;
    this.user.settings.exportToCSVSettings.includeLink = this.exportFromGroup.get('includeLink').value;

    let csvString = ``;
    // Create a csv header
    const headers = [];
    const rows = [];

    if (this.user.settings.exportToCSVSettings.startDate) {
      headers.push(`Date`);
    }
    if (this.user.settings.exportToCSVSettings.name) {
      headers.push(`Name`);
    }
    if (this.user.settings.exportToCSVSettings.description) {
      headers.push(`Description`);
    }
    if (this.user.settings.exportToCSVSettings.description) {
      headers.push(`Activity Types`);
    }
    if (this.user.settings.exportToCSVSettings.distance) {
      headers.push(`Distance`);
    }
    if (this.user.settings.exportToCSVSettings.duration) {
      headers.push(`Duration`);
    }
    if (this.user.settings.exportToCSVSettings.ascent) {
      headers.push(`Ascent`);
    }
    if (this.user.settings.exportToCSVSettings.descent) {
      headers.push(`Descent`);
    }

    if (this.user.settings.exportToCSVSettings.calories) {
      headers.push(`Calories`);
    }

    if (this.user.settings.exportToCSVSettings.feeling) {
      headers.push(`Feeling`);
    }

    if (this.user.settings.exportToCSVSettings.rpe) {
      headers.push('RPE');
    }

    if (this.user.settings.exportToCSVSettings.averageSpeed) {
      headers.push(`Average Speed`);
    }

    if (this.user.settings.exportToCSVSettings.averagePace) {
      headers.push(`Average Pace`);
    }

    if (this.user.settings.exportToCSVSettings.averageSwimPace) {
      headers.push(`Average Swim Pace`);
    }

    if (this.user.settings.exportToCSVSettings.averageHeartRate) {
      headers.push(`Average Heart Rate`);
    }

    if (this.user.settings.exportToCSVSettings.averagePower) {
      headers.push(`Average Power`);
    }
    if (this.user.settings.exportToCSVSettings.maximumPower) {
      headers.push(`Maximum Power`);
    }
    if (this.user.settings.exportToCSVSettings.vO2Max) {
      headers.push(`VO2Max`);
    }

    if (this.user.settings.exportToCSVSettings.includeLink) {
      headers.push(`Link`);
    }

    csvString += headers.join(',');
    csvString += `\r\n`;

    // Go over the events
    this.events.forEach((event) => {
      const activityTypes = <DataActivityTypes>event.getStat(DataActivityTypes.type);
      const isRunning = activityTypes && [<string>ActivityTypes.running, <string>ActivityTypes.trail_running, <string>ActivityTypes.treadmill].indexOf(activityTypes.getValue()[0]) !== -1;
      const isSwimming = activityTypes && [<string>ActivityTypes.swimming, <string>ActivityTypes['open water swimming']].indexOf(activityTypes.getValue()[0]) !== -1;


      const row = [];
      if (this.user.settings.exportToCSVSettings.startDate) {
        row.push(event.startDate.toLocaleDateString());
      }
      if (this.user.settings.exportToCSVSettings.name) {
        row.push(event.name);
      }
      if (this.user.settings.exportToCSVSettings.description) {
        row.push(event.description);
      }
      if (this.user.settings.exportToCSVSettings.activityTypes) {
        const stat = event.getStat(DataActivityTypes.type);
        if (!stat) {
          row.push('');
        }
        row.push(event.getActivityTypesAsString());
      }
      if (this.user.settings.exportToCSVSettings.distance) {
        row.push(`${event.getDistance().getDisplayValue()} ${event.getDistance().getDisplayUnit()}`);
      }
      if (this.user.settings.exportToCSVSettings.duration) {
        row.push(event.getDuration().getDisplayValue());
      }
      if (this.user.settings.exportToCSVSettings.ascent) {
        const stat = event.getStat(DataAscent.type);
        row.push(stat ? `${stat.getDisplayValue()} ${stat.getDisplayUnit()}` : '');
      }
      if (this.user.settings.exportToCSVSettings.descent) {
        const stat = event.getStat(DataDescent.type);
        row.push(stat ? `${stat.getDisplayValue()} ${stat.getDisplayUnit()}` : '');
      }

      if (this.user.settings.exportToCSVSettings.calories) {
        const stat = event.getStat(DataEnergy.type);
        row.push(stat ? `${stat.getDisplayValue()} ${stat.getDisplayUnit()}` : '');
      }

      if (this.user.settings.exportToCSVSettings.feeling) {
        const stat = event.getStat(DataFeeling.type);
        row.push(stat ? `${stat.getDisplayValue()} ${stat.getDisplayUnit()}` : '');
      }

      if (this.user.settings.exportToCSVSettings.rpe) {
        const stat = event.getStat(DataRPE.type);
        row.push(stat ? `${stat.getDisplayValue()} ${stat.getDisplayUnit()}` : '');
      }

      if (this.user.settings.exportToCSVSettings.averageSpeed) {
        const stat = event.getStat(DataSpeedAvg.type);
        if (!stat) {
          row.push('');
        } else {
          row.push(`"` + this.getUnitBasedDataTypesFromDataType(DataSpeed.type, this.user.settings.unitSettings).reduce((innerRows: string[], dataType) => {
            innerRows.push(`${DynamicDataLoader.getDataInstanceFromDataType(dataType, stat.getValue(dataType)).getDisplayValue()} ${DynamicDataLoader.getDataClassFromDataType(dataType).unit}`)
            return innerRows
          }, []).join('\n') + `"`);
        }
      }

      if (this.user.settings.exportToCSVSettings.averagePace) {
        const stat = event.getStat(DataPaceAvg.type) || event.getStat(DataSpeedAvg.type);
        if (!stat || !isRunning) {
          row.push('');
        } else {
          row.push(`"` + this.getUnitBasedDataTypesFromDataType(DataPace.type, this.user.settings.unitSettings).reduce((innerRows: string[], dataType) => {
            innerRows.push(`${DynamicDataLoader.getDataInstanceFromDataType(dataType, stat.getValue(dataType)).getDisplayValue()} ${DynamicDataLoader.getDataClassFromDataType(dataType).unit}`)
            return innerRows
          }, []).join('\n') + `"`);
        }
      }

      if (this.user.settings.exportToCSVSettings.averageSwimPace) {
        const stat = event.getStat(DataSwimPaceAvg.type) || event.getStat(DataSpeedAvg.type);
        if (!stat || !isSwimming) {
          row.push('');
        } else {
          row.push(`"` + this.getUnitBasedDataTypesFromDataType(DataSwimPace.type, this.user.settings.unitSettings).reduce((innerRows: string[], dataType) => {
            innerRows.push(`${DynamicDataLoader.getDataInstanceFromDataType(dataType, stat.getValue(dataType)).getDisplayValue()} ${DynamicDataLoader.getDataClassFromDataType(dataType).unit}`)
            return innerRows
          }, []).join('\n') + `"`);
        }
      }

      if (this.user.settings.exportToCSVSettings.averageHeartRate) {
        const stat = event.getStat(DataHeartRateAvg.type);
        row.push(stat ? `${stat.getDisplayValue()} ${stat.getDisplayUnit()}` : '');
      }

      if (this.user.settings.exportToCSVSettings.averagePower) {
        const stat = event.getStat(DataPowerAvg.type);
        row.push(stat ? `${stat.getDisplayValue()} ${stat.getDisplayUnit()}` : '');
      }
      if (this.user.settings.exportToCSVSettings.maximumPower) {
        const stat = event.getStat(DataPowerMax.type);
        row.push(stat ? `${stat.getDisplayValue()} ${stat.getDisplayUnit()}` : '');
      }
      if (this.user.settings.exportToCSVSettings.vO2Max) {
        const stat = event.getStat(DataVO2Max.type);
        row.push(stat ? `${stat.getDisplayValue()} ${stat.getDisplayUnit()}` : '');
      }

      if (this.user.settings.exportToCSVSettings.includeLink) {
        row.push(this.sharingService.getShareURLForEvent(this.user.uid, event.getID()));
      }

      rows.push(row);
    });

    rows.forEach((row) => {
      csvString += row.join(',');
      csvString += `\r\n`;
    });

    this.fileService.downloadFile((new Blob(
      [csvString],
      {type: 'data:text/csv;charset=utf-8'},
    )), `${this.startDate.toLocaleDateString()}-${this.endDate.toLocaleDateString()}`, 'csv');

    this.close(new Event('Done')).then(() => {
      this.userService.updateUserProperties(this.user, {
        settings: this.user.settings
      });
      this.afa.logEvent('download_csv', {});
    })
  }
}
