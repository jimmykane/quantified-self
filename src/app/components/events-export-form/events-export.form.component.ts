import { Component, Inject, inject } from '@angular/core';
import { EventInterface } from '@sports-alliance/sports-lib';
import { UntypedFormControl, UntypedFormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FormsAbstract } from '../forms/forms.abstract';
import { User } from '@sports-alliance/sports-lib';
import { AppUserService } from '../../services/app.user.service';
import { AppFileService } from '../../services/app.file.service';
import { DataRPE } from '@sports-alliance/sports-lib';
import { DataAscent } from '@sports-alliance/sports-lib';
import { DataDescent } from '@sports-alliance/sports-lib';
import { DataEnergy } from '@sports-alliance/sports-lib';
import { DataFeeling } from '@sports-alliance/sports-lib';
import { DataSpeedAvg } from '@sports-alliance/sports-lib';
import { DataPaceAvg } from '@sports-alliance/sports-lib';
import { DataSwimPaceAvg } from '@sports-alliance/sports-lib';
import { DataGradeAdjustedPaceAvg } from '@sports-alliance/sports-lib';
import { DataHeartRateAvg } from '@sports-alliance/sports-lib';
import { DataPowerAvg } from '@sports-alliance/sports-lib';
import { DataPowerMax } from '@sports-alliance/sports-lib';
import { DataVO2Max } from '@sports-alliance/sports-lib';
import { AppSharingService } from '../../services/app.sharing.service';
import { DataActivityTypes } from '@sports-alliance/sports-lib';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { DataPace } from '@sports-alliance/sports-lib';
import { DynamicDataLoader } from '@sports-alliance/sports-lib';
import { DataSwimPace } from '@sports-alliance/sports-lib';
import { Analytics, logEvent } from '@angular/fire/analytics';


@Component({
  selector: 'app-export-events-form',
  templateUrl: './events-export.form.component.html',
  styleUrls: ['./events-export.form.component.css'],
  providers: [],
  standalone: false
})


export class EventsExportFormComponent extends FormsAbstract {

  public exportFromGroup: UntypedFormGroup;
  public user: User;
  public events: EventInterface[];
  public startDate: Date;
  public endDate: Date;
  public isLoading: boolean;
  private analytics = inject(Analytics);


  constructor(
    public dialogRef: MatDialogRef<any>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    protected snackBar: MatSnackBar,
    private userService: AppUserService,
    private fileService: AppFileService,
    private sharingService: AppSharingService,
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

    this.exportFromGroup = new UntypedFormGroup({
      startDate: new UntypedFormControl(this.user.settings.exportToCSVSettings.startDate, [
        Validators.required
      ]),
      name: new UntypedFormControl(this.user.settings.exportToCSVSettings.name, []),
      description: new UntypedFormControl(this.user.settings.exportToCSVSettings.description, []),
      activityTypes: new UntypedFormControl(this.user.settings.exportToCSVSettings.activityTypes, []),
      distance: new UntypedFormControl(this.user.settings.exportToCSVSettings.distance, []),
      duration: new UntypedFormControl(this.user.settings.exportToCSVSettings.duration, []),
      ascent: new UntypedFormControl(this.user.settings.exportToCSVSettings.ascent, []),
      descent: new UntypedFormControl(this.user.settings.exportToCSVSettings.descent, []),
      calories: new UntypedFormControl(this.user.settings.exportToCSVSettings.calories, []),
      feeling: new UntypedFormControl(this.user.settings.exportToCSVSettings.feeling, []),
      rpe: new UntypedFormControl(this.user.settings.exportToCSVSettings.rpe, []),
      averageSpeed: new UntypedFormControl(this.user.settings.exportToCSVSettings.averageSpeed, []),
      averagePace: new UntypedFormControl(this.user.settings.exportToCSVSettings.averagePace, []),
      averageSwimPace: new UntypedFormControl(this.user.settings.exportToCSVSettings.averageSwimPace, []),
      averageGradeAdjustedPace: new UntypedFormControl(this.user.settings.exportToCSVSettings.avgGradeAdjustedPace, []),
      averageHeartRate: new UntypedFormControl(this.user.settings.exportToCSVSettings.averageHeartRate, []),
      maximumHeartRate: new UntypedFormControl(this.user.settings.exportToCSVSettings.maximumHeartRate, []),
      averagePower: new UntypedFormControl(this.user.settings.exportToCSVSettings.averagePower, []),
      maximumPower: new UntypedFormControl(this.user.settings.exportToCSVSettings.maximumPower, []),
      vO2Max: new UntypedFormControl(this.user.settings.exportToCSVSettings.vO2Max, []),
      includeLink: new UntypedFormControl(this.user.settings.exportToCSVSettings.includeLink, []),
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
    this.user.settings.exportToCSVSettings.averageGradeAdjustedPace = this.exportFromGroup.get('averageGradeAdjustedPace').value;
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

    if (this.user.settings.exportToCSVSettings.averageGradeAdjustedPace) {
      headers.push(`Average Grade Adjusted Pace`);
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
        row.push(`"${event.startDate.toLocaleDateString()}"`);
      }
      if (this.user.settings.exportToCSVSettings.name) {
        row.push(`"${event.name}"`);
      }
      if (this.user.settings.exportToCSVSettings.description) {
        row.push(`"${event.description || ''}"`);
      }
      if (this.user.settings.exportToCSVSettings.activityTypes) {
        const stat = event.getStat(DataActivityTypes.type);
        if (!stat) {
          row.push(`""`);
        }
        row.push(`"${event.getActivityTypesAsString()}"`);
      }
      if (this.user.settings.exportToCSVSettings.distance) {
        row.push(`"${event.getDistance().getDisplayValue()} ${event.getDistance().getDisplayUnit()}"`);
      }
      if (this.user.settings.exportToCSVSettings.duration) {
        row.push(`"${event.getDuration().getDisplayValue()}"`);
      }
      if (this.user.settings.exportToCSVSettings.ascent) {
        const stat = event.getStat(DataAscent.type);
        row.push(stat ? `"${stat.getDisplayValue()} ${stat.getDisplayUnit()}"` : '""');
      }
      if (this.user.settings.exportToCSVSettings.descent) {
        const stat = event.getStat(DataDescent.type);
        row.push(stat ? `"${stat.getDisplayValue()} ${stat.getDisplayUnit()}"` : '""');
      }

      if (this.user.settings.exportToCSVSettings.calories) {
        const stat = event.getStat(DataEnergy.type);
        row.push(stat ? `"${stat.getDisplayValue()} ${stat.getDisplayUnit()}"` : '""');
      }

      if (this.user.settings.exportToCSVSettings.feeling) {
        const stat = event.getStat(DataFeeling.type);
        row.push(stat ? `"${stat.getDisplayValue()} ${stat.getDisplayUnit()}"` : '""');
      }

      if (this.user.settings.exportToCSVSettings.rpe) {
        const stat = event.getStat(DataRPE.type);
        row.push(stat ? `"${stat.getDisplayValue()} ${stat.getDisplayUnit()}"` : '""');
      }

      if (this.user.settings.exportToCSVSettings.averageSpeed) {
        const stat = event.getStat(DataSpeedAvg.type);
        if (!stat) {
          row.push('""');
        } else {
          row.push(`"${DynamicDataLoader.getUnitBasedDataFromDataInstance(stat, this.user.settings.unitSettings)
            .reduce((array, data) => {
              array.push(`${data.getDisplayValue()} ${data.getDisplayUnit()}`);
              return array
            }, []).join('\n')}"`);
        }
      }

      if (this.user.settings.exportToCSVSettings.averagePace) {
        const speedAvg = event.getStat(DataSpeedAvg.type);
        const stat = event.getStat(DataPaceAvg.type) || (speedAvg && new DataPaceAvg(<number>speedAvg.getValue(DataPace.type)));
        if (!stat || !isRunning) {
          row.push('""');
        } else {
          row.push(`"${DynamicDataLoader.getUnitBasedDataFromDataInstance(stat, this.user.settings.unitSettings)
            .reduce((array, data) => {
              array.push(`${data.getDisplayValue()} ${data.getDisplayUnit()}`);
              return array
            }, []).join('\n')}"`);
        }
      }

      if (this.user.settings.exportToCSVSettings.averageSwimPace) {
        const speedAvg = event.getStat(DataSpeedAvg.type);
        const stat = event.getStat(DataSwimPaceAvg.type) || (speedAvg && new DataSwimPaceAvg(<number>speedAvg.getValue(DataSwimPace.type)));
        if (!stat || !isSwimming) {
          row.push('""');
        } else {
          row.push(`"${DynamicDataLoader.getUnitBasedDataFromDataInstance(stat, this.user.settings.unitSettings)
            .reduce((array, data) => {
              array.push(`${data.getDisplayValue()} ${data.getDisplayUnit()}`);
              return array
            }, []).join('\n')}"`);
        }
      }

      if (this.user.settings.exportToCSVSettings.averageGradeAdjustedPace) {
        const speedAvg = event.getStat(DataSpeedAvg.type);
        const stat = event.getStat(DataGradeAdjustedPaceAvg.type) || (speedAvg && new DataGradeAdjustedPaceAvg(<number>speedAvg.getValue(DataGradeAdjustedPaceAvg.type)));
        if (!stat) {
          row.push('""');
        } else {
          row.push(`"${DynamicDataLoader.getUnitBasedDataFromDataInstance(stat, this.user.settings.unitSettings)
            .reduce((array, data) => {
              array.push(`${data.getDisplayValue()} ${data.getDisplayUnit()}`);
              return array
            }, []).join('\n')}"`);
        }
      } /** need to see if this works **/




      if (this.user.settings.exportToCSVSettings.averageHeartRate) {
        const stat = event.getStat(DataHeartRateAvg.type);
        row.push(stat ? `"${stat.getDisplayValue()} ${stat.getDisplayUnit()}"` : '""');
      }

      if (this.user.settings.exportToCSVSettings.averagePower) {
        const stat = event.getStat(DataPowerAvg.type);
        row.push(stat ? `"${stat.getDisplayValue()} ${stat.getDisplayUnit()}"` : '""');
      }
      if (this.user.settings.exportToCSVSettings.maximumPower) {
        const stat = event.getStat(DataPowerMax.type);
        row.push(stat ? `"${stat.getDisplayValue()} ${stat.getDisplayUnit()}"` : '""');
      }
      if (this.user.settings.exportToCSVSettings.vO2Max) {
        const stat = event.getStat(DataVO2Max.type);
        row.push(stat ? `"${stat.getDisplayValue()} ${stat.getDisplayUnit()}"` : '""');
      }

      if (this.user.settings.exportToCSVSettings.includeLink) {
        row.push(`"${this.sharingService.getShareURLForEvent(this.user.uid, event.getID())}"`);
      }

      rows.push(row);
    });

    rows.forEach((row) => {
      csvString += row.join(',');
      csvString += `\r\n`;
    });

    this.fileService.downloadFile((new Blob(
      [csvString],
      { type: 'data:text/csv;charset=utf-8' },
    )), `${this.startDate.toLocaleDateString()}-${this.endDate.toLocaleDateString()}`, 'csv');

    this.close(new Event('Done')).then(() => {
      this.userService.updateUserProperties(this.user, {
        settings: this.user.settings
      });
      logEvent(this.analytics, 'download_csv', {});
    })
  }
}
