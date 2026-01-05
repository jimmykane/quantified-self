import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { Privacy } from '@sports-alliance/sports-lib';
import { DataDistance } from '@sports-alliance/sports-lib';
import { DataDuration } from '@sports-alliance/sports-lib';
import { DataVO2Max } from '@sports-alliance/sports-lib';
import { DataDeviceNames } from '@sports-alliance/sports-lib';
import { DataActivityTypes } from '@sports-alliance/sports-lib';
import { DataPowerAvg } from '@sports-alliance/sports-lib';
import { DataCadenceAvg } from '@sports-alliance/sports-lib';
import {
  DataSpeedAvg, DataSpeedAvgFeetPerMinute, DataSpeedAvgFeetPerSecond,
  DataSpeedAvgKilometersPerHour, DataSpeedAvgKnots, DataSpeedAvgMetersPerMinute,
  DataSpeedAvgMilesPerHour
} from '@sports-alliance/sports-lib';
import { DataPaceAvg, DataPaceAvgMinutesPerMile } from '@sports-alliance/sports-lib';
import { DataSwimPaceAvg, DataSwimPaceAvgMinutesPer100Yard } from '@sports-alliance/sports-lib';
import { DataTemperatureAvg } from '@sports-alliance/sports-lib';
import { DataAscent } from '@sports-alliance/sports-lib';
import { DataDescent } from '@sports-alliance/sports-lib';
import { DataHeartRateAvg } from '@sports-alliance/sports-lib';
import { DataEnergy } from '@sports-alliance/sports-lib';
import { DataAltitudeMax } from '@sports-alliance/sports-lib';
import { DataAltitudeMin } from '@sports-alliance/sports-lib';
import {
  DataVerticalSpeedAvg,
  DataVerticalSpeedAvgFeetPerHour,
  DataVerticalSpeedAvgFeetPerMinute,
  DataVerticalSpeedAvgFeetPerSecond,
  DataVerticalSpeedAvgKilometerPerHour,
  DataVerticalSpeedAvgMetersPerHour,
  DataVerticalSpeedAvgMetersPerMinute,
  DataVerticalSpeedAvgMilesPerHour
} from '@sports-alliance/sports-lib';
import { DataAerobicTrainingEffect } from '@sports-alliance/sports-lib';
import { DataPeakEPOC } from '@sports-alliance/sports-lib';
import {
  DataGradeAdjustedPaceAvg,
  DataGradeAdjustedPaceAvgMinutesPerMile
} from '@sports-alliance/sports-lib';
import {
  DataGradeAdjustedSpeedAvg,
  DataGradeAdjustedSpeedAvgFeetPerMinute,
  DataGradeAdjustedSpeedAvgFeetPerSecond,
  DataGradeAdjustedSpeedAvgKilometersPerHour, DataGradeAdjustedSpeedAvgKnots,
  DataGradeAdjustedSpeedAvgMetersPerMinute,
  DataGradeAdjustedSpeedAvgMilesPerHour
} from '@sports-alliance/sports-lib';
import { DataMovingTime } from '@sports-alliance/sports-lib';
import { DataRecoveryTime } from '@sports-alliance/sports-lib';
import { DataHeartRateMin } from '@sports-alliance/sports-lib';
import { DataHeartRateMax } from '@sports-alliance/sports-lib';

@Component({
  selector: 'app-data-type-icon',
  templateUrl: './data-type-icon.component.html',
  styleUrls: ['./data-type-icon.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class DataTypeIconComponent {
  @Input() dataType: string;
  @Input() size: string;
  @Input() vAlign: string;

  getColumnHeaderIcon(statName): string {
    switch (statName) {
      case DataDistance.type:
        return 'trending_flat';
      case DataDuration.type:
        return 'access_time';
      case 'Start Date':
        return 'date_range';
      case DataDeviceNames.type:
        return 'watch';
      case DataActivityTypes.type:
        return 'filter_none';
      case 'privacy':
        return 'visibility';
      case DataPowerAvg.type:
        return 'bolt';
      case DataCadenceAvg.type:
        return 'cached';
      case DataAltitudeMax.type:
        return 'vertical_align_top';
      case DataAltitudeMin.type:
        return 'vertical_align_bottom';
      case DataVerticalSpeedAvg.type:
      case DataVerticalSpeedAvgFeetPerHour.type:
      case DataVerticalSpeedAvgFeetPerMinute.type:
      case DataVerticalSpeedAvgFeetPerSecond.type:
      case DataVerticalSpeedAvgKilometerPerHour.type:
      case DataVerticalSpeedAvgMilesPerHour.type:
      case DataVerticalSpeedAvgMetersPerHour.type:
      case DataVerticalSpeedAvgMetersPerMinute.type:
        return 'vertical_align_center';
      case DataSpeedAvg.type:
      case DataSpeedAvgKilometersPerHour.type:
      case DataSpeedAvgMilesPerHour.type:
      case DataSpeedAvgFeetPerSecond.type:
      case DataSpeedAvgMetersPerMinute.type:
      case DataSpeedAvgFeetPerMinute.type:
      case DataSpeedAvgKnots.type:
        return 'speed';
      case DataPaceAvg.type:
      case DataPaceAvgMinutesPerMile.type:
        return 'directions_run';
      case DataTemperatureAvg.type:
        return 'device_thermostat';
      case DataRecoveryTime.type:
        return 'update';
      case DataVO2Max.type:
        return 'trending_up';
      case 'Type':
        return 'assignment';
      case 'Description':
      case 'description':
        return 'font_download';
      case 'Name':
      case 'name':
        return 'title';
      case 'Battery Status':
        return 'battery_unknown';
      case 'Manufacturer':
        return 'business';
      case 'Software Info':
        return 'system_update_alt';
      default:
        return null;
    }
  }

  getColumnHeaderSVGIcon(statName): string {
    switch (statName) {
      case DataAscent.type:
        return 'arrow_up_right';
      case DataDescent.type:
        return 'arrow_down_right';
      case DataHeartRateAvg.type:
      case DataHeartRateMax.type:
      case DataHeartRateMin.type:
        return 'heart_pulse';
      case DataEnergy.type:
        return 'energy';
      case DataSwimPaceAvg.type:
      case DataSwimPaceAvgMinutesPer100Yard.type:
        return 'swimmer';
      case DataAerobicTrainingEffect.type:
        return 'tte';
      case DataMovingTime.type:
        return 'moving-time';
      case DataPeakEPOC.type:
        return 'epoc';
      case DataGradeAdjustedPaceAvg.type:
      case DataGradeAdjustedPaceAvgMinutesPerMile.type:
        return 'gap';
      case DataGradeAdjustedSpeedAvg.type:
      case DataGradeAdjustedSpeedAvgFeetPerMinute.type:
      case DataGradeAdjustedSpeedAvgFeetPerSecond.type:
      case DataGradeAdjustedSpeedAvgKilometersPerHour.type:
      case DataGradeAdjustedSpeedAvgMetersPerMinute.type:
      case DataGradeAdjustedSpeedAvgMilesPerHour.type:
      case DataGradeAdjustedSpeedAvgKnots.type:
        return 'gas';
      default:
        return null;
    }
  }

  getColumnHeaderTextInitials(statName): string {
    return statName.split(' ').map(i => i.charAt(0).toUpperCase()).join('')
  }
}
