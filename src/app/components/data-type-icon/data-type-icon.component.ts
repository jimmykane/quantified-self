import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { Privacy } from '@sports-alliance/sports-lib';
import { DataDistance } from '@sports-alliance/sports-lib';
import { DataDuration } from '@sports-alliance/sports-lib';
import { DataVO2Max } from '@sports-alliance/sports-lib';
import { DataDeviceNames } from '@sports-alliance/sports-lib';
import { DataActivityTypes } from '@sports-alliance/sports-lib';
import { DataPowerAvg } from '@sports-alliance/sports-lib';
import { DataPowerMax } from '@sports-alliance/sports-lib';
import { DataPowerMin } from '@sports-alliance/sports-lib';
import { DataPower } from '@sports-alliance/sports-lib';
import { DataPowerLeft } from '@sports-alliance/sports-lib';
import { DataPowerRight } from '@sports-alliance/sports-lib';
import { DataAccumulatedPower } from '@sports-alliance/sports-lib';
import { DataAirPower } from '@sports-alliance/sports-lib';
import { DataCadenceAvg } from '@sports-alliance/sports-lib';
import { DataCadenceMax } from '@sports-alliance/sports-lib';
import { DataCadenceMin } from '@sports-alliance/sports-lib';
import {
  DataSpeedAvg, DataSpeedAvgFeetPerMinute, DataSpeedAvgFeetPerSecond,
  DataSpeedAvgKilometersPerHour, DataSpeedAvgKnots, DataSpeedAvgMetersPerMinute,
  DataSpeedAvgMilesPerHour
} from '@sports-alliance/sports-lib';
import { DataPaceAvg, DataPaceAvgMinutesPerMile } from '@sports-alliance/sports-lib';
import { DataSwimPaceAvg, DataSwimPaceAvgMinutesPer100Yard } from '@sports-alliance/sports-lib';
import { DataTemperatureAvg } from '@sports-alliance/sports-lib';
import { DataTemperatureMax } from '@sports-alliance/sports-lib';
import { DataTemperatureMin } from '@sports-alliance/sports-lib';
import { DataAscent } from '@sports-alliance/sports-lib';
import { DataDescent } from '@sports-alliance/sports-lib';
import { DataHeartRateAvg } from '@sports-alliance/sports-lib';
import { DataEnergy } from '@sports-alliance/sports-lib';
import { DataAltitudeMax } from '@sports-alliance/sports-lib';
import { DataAltitudeMin } from '@sports-alliance/sports-lib';
import { DataAltitudeAvg } from '@sports-alliance/sports-lib';
import {
  DataVerticalSpeedAvg,
  DataVerticalSpeedAvgFeetPerHour,
  DataVerticalSpeedAvgFeetPerMinute,
  DataVerticalSpeedAvgFeetPerSecond,
  DataVerticalSpeedAvgKilometerPerHour,
  DataVerticalSpeedAvgMetersPerHour,
  DataVerticalSpeedAvgMetersPerMinute,
  DataVerticalSpeedAvgMilesPerHour,
  DataVerticalSpeedMax
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
import { DataFeeling } from '@sports-alliance/sports-lib';
import { DataRPE } from '@sports-alliance/sports-lib';
import { DataJumpCount } from '@sports-alliance/sports-lib';
import { DataJumpDistance } from '@sports-alliance/sports-lib';
import { DataJumpDistanceAvg } from '@sports-alliance/sports-lib';
import { DataJumpDistanceMax } from '@sports-alliance/sports-lib';
import { DataJumpDistanceMin } from '@sports-alliance/sports-lib';
import { DataJumpHangTimeAvg } from '@sports-alliance/sports-lib';
import { DataJumpHangTimeMax } from '@sports-alliance/sports-lib';
import { DataJumpHangTimeMin } from '@sports-alliance/sports-lib';
import { DataJumpHeightAvg } from '@sports-alliance/sports-lib';
import { DataJumpHeightMax } from '@sports-alliance/sports-lib';
import { DataJumpHeightMin } from '@sports-alliance/sports-lib';
import { DataJumpRotationsAvg } from '@sports-alliance/sports-lib';
import { DataJumpRotationsMax } from '@sports-alliance/sports-lib';
import { DataJumpRotationsMin } from '@sports-alliance/sports-lib';
import { DataJumpScoreAvg } from '@sports-alliance/sports-lib';
import { DataJumpScoreMax } from '@sports-alliance/sports-lib';
import { DataJumpScoreMin } from '@sports-alliance/sports-lib';
import { DataJumpSpeedAvg } from '@sports-alliance/sports-lib';
import { DataJumpSpeedAvgFeetPerMinute } from '@sports-alliance/sports-lib';
import { DataJumpSpeedAvgFeetPerSecond } from '@sports-alliance/sports-lib';
import { DataJumpSpeedAvgKilometersPerHour } from '@sports-alliance/sports-lib';
import { DataJumpSpeedAvgKnots } from '@sports-alliance/sports-lib';
import { DataJumpSpeedAvgMetersPerMinute } from '@sports-alliance/sports-lib';
import { DataJumpSpeedAvgMilesPerHour } from '@sports-alliance/sports-lib';
import { DataJumpSpeedMax } from '@sports-alliance/sports-lib';
import { DataJumpSpeedMaxFeetPerMinute } from '@sports-alliance/sports-lib';
import { DataJumpSpeedMaxFeetPerSecond } from '@sports-alliance/sports-lib';
import { DataJumpSpeedMaxKilometersPerHour } from '@sports-alliance/sports-lib';
import { DataJumpSpeedMaxKnots } from '@sports-alliance/sports-lib';
import { DataJumpSpeedMaxMetersPerMinute } from '@sports-alliance/sports-lib';
import { DataJumpSpeedMaxMilesPerHour } from '@sports-alliance/sports-lib';
import { DataJumpSpeedMin } from '@sports-alliance/sports-lib';
import { DataJumpSpeedMinFeetPerMinute } from '@sports-alliance/sports-lib';
import { DataJumpSpeedMinFeetPerSecond } from '@sports-alliance/sports-lib';
import { DataJumpSpeedMinKilometersPerHour } from '@sports-alliance/sports-lib';
import { DataJumpSpeedMinKnots } from '@sports-alliance/sports-lib';
import { DataJumpSpeedMinMetersPerMinute } from '@sports-alliance/sports-lib';
import { DataJumpSpeedMinMilesPerHour } from '@sports-alliance/sports-lib';
import { DataVerticalOscillation } from '@sports-alliance/sports-lib';
import { DataVerticalOscillationAvg } from '@sports-alliance/sports-lib';
import { DataVerticalOscillationMax } from '@sports-alliance/sports-lib';
import { DataVerticalOscillationMin } from '@sports-alliance/sports-lib';

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

  getColumnHeaderIconClass(statName: string): string | null {
    if (statName === DataDescent.type) {
      return 'icon-mirror-x';
    }

    return null;
  }

  getColumnHeaderIcon(statName): string {
    switch (statName) {
      case DataDistance.type:
        return 'route';
      case DataDuration.type:
        return 'timer';
      case 'Start Date':
        return 'date_range';
      case DataDeviceNames.type:
        return 'watch';
      case DataActivityTypes.type:
        return 'filter_none';
      case 'privacy':
        return 'visibility';
      case DataPowerAvg.type:
      case DataPowerMax.type:
      case DataPowerMin.type:
      case DataPower.type:
      case 'Form Power':
        return 'bolt';
      case 'FTP':
        return 'recent_patient';
      case 'CriticalPower':
        return 'offline_bolt';
      case DataPowerLeft.type:
      case 'Power Pedal Smoothness Left':
      case 'Power Torque Effectiveness Left':
        return 'keyboard_double_arrow_left';
      case DataPowerRight.type:
      case 'Power Pedal Smoothness Right':
      case 'Power Torque Effectiveness Right':
        return 'keyboard_double_arrow_right';
      case DataAccumulatedPower.type:
      case 'Power Work':
        return 'stacked_bar_chart';
      case DataAirPower.type:
      case 'Average Air Power':
      case 'Maximum Air Power':
      case 'Minimum Air Power':
        return 'air';
      case 'Power Normalized':
        return 'electric_bolt';
      case 'Power Intensity Factor':
        return 'multiline_chart';
      case 'Power Training Stress Score':
        return 'monitor_heart';
      case 'PowerWattsPerKg':
        return 'monitor_weight';
      case 'WPrime':
        return 'battery_charging_full';
      case 'Power Pod':
        return 'sensors';
      case 'Power Zone Target':
        return 'track_changes';
      case DataCadenceAvg.type:
      case DataCadenceMax.type:
      case DataCadenceMin.type:
        return 'cadence';
      case DataAltitudeMax.type:
        return 'landscape';
      case DataAltitudeMin.type:
        return 'landscape';
      case DataAltitudeAvg.type:
        return 'landscape';
      case DataVerticalSpeedAvg.type:
      case DataVerticalSpeedAvgFeetPerHour.type:
      case DataVerticalSpeedAvgFeetPerMinute.type:
      case DataVerticalSpeedAvgFeetPerSecond.type:
      case DataVerticalSpeedAvgKilometerPerHour.type:
      case DataVerticalSpeedAvgMilesPerHour.type:
      case DataVerticalSpeedAvgMetersPerHour.type:
      case DataVerticalSpeedAvgMetersPerMinute.type:
      case DataVerticalSpeedMax.type:
        return 'unfold_more_double';
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
      case 'Effort Pace':
        return 'steps';
      case 'Average VAM':
      case 'Avg VAM':
        return 'trending_up';
      case DataTemperatureAvg.type:
      case DataTemperatureMax.type:
      case DataTemperatureMin.type:
        return 'device_thermostat';
      case 'Absolute Pressure':
      case 'Average Absolute Pressure':
      case 'Minimum Absolute Pressure':
      case 'Maximum Absolute Pressure':
        return 'compress';
      case 'Grade':
      case 'Average Grade':
      case 'Minimum Grade':
      case 'Maximum Grade':
        return 'tools_level';
      case DataRecoveryTime.type:
        return 'update';
      case DataVO2Max.type:
        return 'vo2_max';
      case 'Type':
        return 'assignment';
      case 'Description':
      case 'description':
        return 'font_download';
      case 'Name':
      case 'name':
        return 'badge';
      case 'Battery Status':
        return 'battery_unknown';
      case 'Manufacturer':
        return 'business';
      case 'Software Info':
        return 'system_update_alt';
      case 'Battery Level':
      case 'Battery Charge':
        return 'battery_full';
      case 'Battery Consumption':
        return 'battery_alert';
      case 'Battery Current':
        return 'electric_bolt';
      case 'Battery Voltage':
        return 'bolt';
      case 'Product I. D.':
      case 'Product ID':
        return 'fingerprint';
      case 'Serial Number':
        return 'numbers';
      case 'Hardware Info':
        return 'memory';
      case 'Ant Device Number':
        return 'settings_input_antenna';
      case 'Ant Network':
        return 'hub';
      case 'Ant Transmission Type':
        return 'router';
      case 'Source Type':
        return 'input';
      case 'Cumulative Operating Time':
        return 'timer';
      case DataAscent.type:
      case 'Ascent Time':
        return 'elevation';
      case DataDescent.type:
      case 'Descent Time':
        return 'elevation';
      case DataHeartRateAvg.type:
      case DataHeartRateMax.type:
      case DataHeartRateMin.type:
        return 'ecg_heart';
      case 'Average Respiration Rate':
      case 'Minimum Respiration Rate':
      case 'Maximum Respiration Rate':
      case 'Avg Respiration Rate':
      case 'Min Respiration Rate':
      case 'Max Respiration Rate':
        return 'pulmonology';
      case DataFeeling.type:
        return 'mood';
      case DataRPE.type:
        return 'fitness_center';
      case 'Weight':
        return 'monitor_weight';
      case 'Height':
        return 'height';
      case 'Gender':
        return 'wc';
      case 'Fitness Age':
      case 'Age':
        return 'cake';
      case DataEnergy.type:
        return 'metabolism';
      case DataSwimPaceAvg.type:
      case DataSwimPaceAvgMinutesPer100Yard.type:
        return 'pool';
      case DataAerobicTrainingEffect.type:
      case 'Anaerobic Training Effect':
        return 'cardio_load';
      case DataMovingTime.type:
        return 'pace';
      case DataPeakEPOC.type:
        return null;
      case 'EPOC':
      case 'EVPE':
      case 'Average EVPE':
      case 'Minimum EVPE':
      case 'Maximum EVPE':
      case 'EHPE':
      case 'Average EHPE':
      case 'Minimum EHPE':
      case 'Maximum EHPE':
        return 'monitor_heart';
      case 'Flow':
      case 'Avg Flow':
      case 'Total Flow':
        return 'water';
      case 'Average Flow':
        return 'automation';
      case 'Grit':
      case 'Average Grit':
      case 'Avg Grit':
      case 'Total Grit':
        return 'cheer';
      case DataJumpCount.type:
        return '123';
      case DataJumpDistance.type:
      case DataJumpDistanceAvg.type:
      case DataJumpDistanceMin.type:
      case DataJumpDistanceMax.type:
        return 'straighten';
      case DataJumpHangTimeAvg.type:
      case DataJumpHangTimeMin.type:
      case DataJumpHangTimeMax.type:
        return 'timer_arrow_up';
      case DataJumpHeightAvg.type:
      case DataJumpHeightMin.type:
      case DataJumpHeightMax.type:
        return 'height';
      case DataJumpSpeedAvg.type:
      case DataJumpSpeedMin.type:
      case DataJumpSpeedMax.type:
      case DataJumpSpeedAvgKilometersPerHour.type:
      case DataJumpSpeedAvgMilesPerHour.type:
      case DataJumpSpeedAvgFeetPerSecond.type:
      case DataJumpSpeedAvgMetersPerMinute.type:
      case DataJumpSpeedAvgFeetPerMinute.type:
      case DataJumpSpeedAvgKnots.type:
      case DataJumpSpeedMinKilometersPerHour.type:
      case DataJumpSpeedMinMilesPerHour.type:
      case DataJumpSpeedMinFeetPerSecond.type:
      case DataJumpSpeedMinMetersPerMinute.type:
      case DataJumpSpeedMinFeetPerMinute.type:
      case DataJumpSpeedMinKnots.type:
      case DataJumpSpeedMaxKilometersPerHour.type:
      case DataJumpSpeedMaxMilesPerHour.type:
      case DataJumpSpeedMaxFeetPerSecond.type:
      case DataJumpSpeedMaxMetersPerMinute.type:
      case DataJumpSpeedMaxFeetPerMinute.type:
      case DataJumpSpeedMaxKnots.type:
        return 'speed';
      case DataJumpRotationsAvg.type:
      case DataJumpRotationsMin.type:
      case DataJumpRotationsMax.type:
        return 'autorenew';
      case DataJumpScoreAvg.type:
      case DataJumpScoreMin.type:
      case DataJumpScoreMax.type:
        return 'military_tech';
      case 'At':
        return 'schedule';
      case 'Jump Distance':
        return 'straighten';
      case 'Jump Height':
        return 'height';
      case 'Jump Hang Time':
        return 'timer_arrow_up';
      case 'Jump Speed':
        return 'speed';
      case 'Jump Rotations':
        return 'autorenew';
      case 'Jump Score':
        return 'military_tech';
      case 'Jump Latitude':
      case 'Jump Longitude':
        return 'place';
      case 'Distance (Stryd)':
        return 'route';
      case 'GNSS Distance':
        return 'satellite_alt';
      case 'Average Ground Contact Time':
      case 'Minimum Ground Contact Time':
      case 'Maximum Ground Contact Time':
      case 'Stance Time':
      case 'Stance Time Balance Left':
      case 'Stance Time Balance Right':
      case 'Ground Contact Time Balance Left':
      case 'Ground Contact Time Balance Right':
        return 'step_over';
      case DataVerticalOscillation.type:
      case DataVerticalOscillationAvg.type:
      case DataVerticalOscillationMin.type:
      case DataVerticalOscillationMax.type:
      case 'Vertical Oscillation':
        return 'swap_vert';
      case 'Vertical Ratio':
      case 'Average Vertical Ratio':
      case 'Minimum Vertical Ratio':
      case 'Maximum Vertical Ratio':
        return 'arrows_outward';
      case 'Leg Stiffness':
      case 'Average Leg Stiffness':
      case 'Minimum Leg Stiffness':
      case 'Maximum Leg Stiffness':
        return 'accessibility_new';
      case 'Satellite 5 Best SNR':
      case 'Average Satellite 5 Best SNR':
      case 'Minimum Satellite 5 Best SNR':
      case 'Maximum Satellite 5 Best SNR':
      case 'Number of Satellites':
      case 'Average Number of Satellites':
      case 'Minimum Number of Satellites':
      case 'Maximum Number of Satellites':
        return 'satellite_alt';
      case DataGradeAdjustedPaceAvg.type:
      case DataGradeAdjustedPaceAvgMinutesPerMile.type:
      case 'Minimum Grade Adjusted Pace':
      case 'Maximum Grade Adjusted Pace':
        return 'steps';
      case DataGradeAdjustedSpeedAvg.type:
      case DataGradeAdjustedSpeedAvgFeetPerMinute.type:
      case DataGradeAdjustedSpeedAvgFeetPerSecond.type:
      case DataGradeAdjustedSpeedAvgKilometersPerHour.type:
      case DataGradeAdjustedSpeedAvgMetersPerMinute.type:
      case DataGradeAdjustedSpeedAvgMilesPerHour.type:
      case DataGradeAdjustedSpeedAvgKnots.type:
      case 'Minimum Grade Adjusted Speed':
      case 'Maximum Grade Adjusted Speed':
        return 'speed';
      default:
        return null;
    }
  }

  getColumnHeaderSVGIcon(statName): string {
    switch (statName) {
      case DataPeakEPOC.type:
        return 'epoc';
      default:
        return null;
    }
  }

  getColumnHeaderTextInitials(statName): string {
    return statName.split(' ').map(i => i.charAt(0).toUpperCase()).join('')
  }
}
