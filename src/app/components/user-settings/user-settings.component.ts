import {Component, Inject, Input, OnDestroy, OnInit} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';
import {User} from 'quantified-self-lib/lib/users/user';
import {AppAuthService} from '../../authentication/app.auth.service';
import {UserService} from '../../services/app.user.service';
import {MatDialog, MatDialogRef, MatSnackBar} from '@angular/material';
import {FormControl, FormGroup, Validators} from "@angular/forms";
import * as Raven from "raven-js";
import {DataHeartRate} from "quantified-self-lib/lib/data/data.heart-rate";
import {DataAltitude} from "quantified-self-lib/lib/data/data.altitude";
import {DataCadence} from "quantified-self-lib/lib/data/data.cadence";
import {DataPower} from "quantified-self-lib/lib/data/data.power";
import {DataSpeed} from "quantified-self-lib/lib/data/data.speed";
import {DataVO2Max} from "quantified-self-lib/lib/data/data.vo2-max";
import {DataPace} from "quantified-self-lib/lib/data/data.pace";
import {DataGPSAltitude} from "quantified-self-lib/lib/data/data.altitude-gps";
import {DataTemperature} from "quantified-self-lib/lib/data/data.temperature";
import {DataNumberOfSatellites} from "quantified-self-lib/lib/data/data.number-of-satellites";
import {DataSatellite5BestSNR} from "quantified-self-lib/lib/data/data.satellite-5-best-snr";
import {DataEVPE} from "quantified-self-lib/lib/data/data.evpe";
import {DataEHPE} from "quantified-self-lib/lib/data/data.ehpe";
import {DataAbsolutePressure} from "quantified-self-lib/lib/data/data.absolute-pressure";
import {DataPeakTrainingEffect} from "quantified-self-lib/lib/data/data.peak-training-effect";
import {DataEPOC} from "quantified-self-lib/lib/data/data.epoc";
import {DataEnergy} from "quantified-self-lib/lib/data/data.energy";
import {DataNumberOfSamples} from "quantified-self-lib/lib/data/data-number-of.samples";
import {DataBatteryCharge} from "quantified-self-lib/lib/data/data.battery-charge";
import {DataBatteryCurrent} from "quantified-self-lib/lib/data/data.battery-current";
import {DataBatteryVoltage} from "quantified-self-lib/lib/data/data.battery-voltage";
import {DataBatteryConsumption} from "quantified-self-lib/lib/data/data.battery-consumption";
import {DataFormPower} from "quantified-self-lib/lib/data/data.form-power";
import {DataLegStiffness} from "quantified-self-lib/lib/data/data.leg-stiffness";
import {DataVerticalOscillation} from "quantified-self-lib/lib/data/data.vertical-oscillation";
import {DataTotalTrainingEffect} from "quantified-self-lib/lib/data/data.total-training-effect";
import {DataSeaLevelPressure} from "quantified-self-lib/lib/data/data.sea-level-pressure";
import {DataDistance} from "quantified-self-lib/lib/data/data.distance";
import {UserSettingsInterface} from "quantified-self-lib/lib/users/user.settings.interface";
import {UserChartSettingsInterface} from "quantified-self-lib/lib/users/user.chart.settings.interface";
import {Log} from "ng2-logger/browser";

@Component({
  selector: 'app-user-settings',
  templateUrl: './user-settings.component.html',
  styleUrls: ['./user-settings.component.css'],
})
export class UserSettingsComponent implements OnInit {

  @Input() user: User;
  public currentUser: User;
  public isSaving: boolean;
  public errorSaving;

  private logger = Log.create('UserSettingsComponent');


  // public selectedDataToUse = [];

  private basicData = [
    DataHeartRate.type,
    DataAltitude.type,
    DataCadence.type,
    DataPower.type,
    DataPace.type,
    DataSpeed.type,
  ];

  private advancedData = [
    DataGPSAltitude.type,
    DataTemperature.type,
    DataSeaLevelPressure.type,
    DataSatellite5BestSNR.type,
    DataNumberOfSatellites.type,
    DataEVPE.type,
    DataEHPE.type,
    DataDistance.type,
    DataAbsolutePressure.type,
    DataPeakTrainingEffect.type,
    DataEPOC.type,
    DataEnergy.type,
    DataNumberOfSamples.type,
    DataBatteryCharge.type,
    DataBatteryCurrent.type,
    DataBatteryVoltage.type,
    DataBatteryConsumption.type,
    DataFormPower.type,
    DataLegStiffness.type,
    DataVerticalOscillation.type,
  ];

  public dataGroups = [
    {
      name: 'Basic Data',
      data: this.basicData
    },
    {
      name: 'Advanced Data',
      data: this.advancedData
    },
  ];

  // private allChartStats = this.basicData.concat(this.advancedData);

  public userSettingsFormGroup: FormGroup;

  constructor(private authService: AppAuthService, private route: ActivatedRoute, private userService: UserService, private router: Router, private snackBar: MatSnackBar, private dialog: MatDialog,) {
  }

  ngOnInit(): void {

    // Initialize the user settings and get the enabled ones
    let dataTypesToUse:string[] = [];
    if (this.user.settings && this.user.settings.chartSettings){
      dataTypesToUse = Object.keys(this.user.settings.chartSettings.dataTypeSettings).filter((dataTypeSettingKey) => {
        return this.user.settings.chartSettings.dataTypeSettings[dataTypeSettingKey].enabled === true;
      })
    }

    if (!dataTypesToUse.length){
      dataTypesToUse = this.basicData
    }

    // debugger;

    this.userSettingsFormGroup = new FormGroup({
      dataTypesToUse: new FormControl(dataTypesToUse, [
        Validators.required,
        // Validators.minLength(1),
      ]),
    });
  }

  hasError(field?: string) {
    if (!field) {
      return !this.userSettingsFormGroup.valid;
    }
    return !(this.userSettingsFormGroup.get(field).valid && this.userSettingsFormGroup.get(field).touched);
  }

  async onSubmit() {
    if (!this.userSettingsFormGroup.valid) {
      this.validateAllFormFields(this.userSettingsFormGroup);
      return;
    }

    this.isSaving = true;
    try {
      const userChartSettings = Array.from(this.userSettingsFormGroup.get('dataTypesToUse').value).reduce((userChartSettings: UserChartSettingsInterface, dataTypeToUse: string) => {
        userChartSettings.dataTypeSettings[dataTypeToUse] = {enabled: true};
        return userChartSettings
      }, {dataTypeSettings: {}});
      debugger;
      await this.userService.updateUserProperties(this.user, {
        settings: {chartSettings: userChartSettings}
      });
      this.snackBar.open('User updated', null, {
        duration: 2000,
      });
    } catch (e) {
      this.logger.error(e);
      this.snackBar.open('Could not update user', null, {
        duration: 2000,
      });
      Raven.captureException(e);
      // @todo add logging
    } finally {
      this.isSaving = false;
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
}
