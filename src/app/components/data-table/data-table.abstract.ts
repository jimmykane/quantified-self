import {
  ChangeDetectorRef,
} from '@angular/core';
import {ScreenSizeAbstract} from '../screen-size/sreen-size.abstract';
import {EventInterface} from '@sports-alliance/sports-lib/lib/events/event.interface';
import {DataRPE, RPEBorgCR10SCale} from '@sports-alliance/sports-lib/lib/data/data.rpe';
import {DataFeeling, Feelings} from '@sports-alliance/sports-lib/lib/data/data.feeling';
import {Privacy} from '@sports-alliance/sports-lib/lib/privacy/privacy.class.interface';
import {DataInterface} from '@sports-alliance/sports-lib/lib/data/data.interface';
import {DataAscent} from '@sports-alliance/sports-lib/lib/data/data.ascent';
import {DataDescent} from '@sports-alliance/sports-lib/lib/data/data.descent';
import {DataEnergy} from '@sports-alliance/sports-lib/lib/data/data.energy';
import {DataPowerAvg} from '@sports-alliance/sports-lib/lib/data/data.power-avg';
import {DataSpeedAvg} from '@sports-alliance/sports-lib/lib/data/data.speed-avg';
import {DataHeartRateAvg} from '@sports-alliance/sports-lib/lib/data/data.heart-rate-avg';
import {DataDistance} from '@sports-alliance/sports-lib/lib/data/data.distance';
import {ActivityTypes, ActivityTypesHelper} from '@sports-alliance/sports-lib/lib/activities/activity.types';
import {DynamicDataLoader} from '@sports-alliance/sports-lib/lib/data/data.store';
import {UserUnitSettingsInterface} from '@sports-alliance/sports-lib/lib/users/settings/user.unit.settings.interface';
import {DataDuration} from '@sports-alliance/sports-lib/lib/data/data.duration';
import {DataVO2Max} from '@sports-alliance/sports-lib/lib/data/data.vo2-max';

export abstract class DataTableAbstract extends ScreenSizeAbstract {


  constructor(changeDetector: ChangeDetectorRef) {
    super(changeDetector);
  }

  abstract getColumnsToDisplayDependingOnScreenSize();

  isColumnHeaderSortable(columnName): boolean {
    return ['Start Date', 'Distance', 'Activity Types', 'Description', 'Average Power', 'Average Speed', 'Duration', 'Ascent', 'Descent', 'Average Heart Rate', 'VO2 Max', 'Energy', 'Device Names'].indexOf(columnName) !== -1;
  }

  getStatsRowElement(stats: DataInterface[], activityTypes: string[], unitSettings?: UserUnitSettingsInterface): StatRowElement {
    const statRowElement: StatRowElement = <StatRowElement>{};

    const distance = stats.find(stat => stat.getType() === DataDistance.type);
    const duration = stats.find(stat => stat.getType() === DataDuration.type);
    const ascent = stats.find(stat => stat.getType() === DataAscent.type);
    const descent = stats.find(stat => stat.getType() === DataDescent.type);
    const energy = stats.find(stat => stat.getType() === DataEnergy.type);
    const avgPower = stats.find(stat => stat.getType() === DataPowerAvg.type);
    const avgSpeed = stats.find(stat => stat.getType() === DataSpeedAvg.type);
    const heartRateAverage = stats.find(stat => stat.getType() === DataHeartRateAvg.type);
    const rpe = stats.find(stat => stat.getType() === DataRPE.type);
    const feeling = stats.find(stat => stat.getType() === DataFeeling.type);
    const vO2Max = stats.find(stat => stat.getType() === DataVO2Max.type);

    statRowElement['Duration'] = duration ? `${duration.getDisplayValue()}` : '';
    statRowElement['Distance'] = distance ? `${distance.getDisplayValue()} ${distance.getDisplayUnit()}` : '';
    statRowElement['Ascent'] = ascent ? `${ascent.getDisplayValue()} ${ascent.getDisplayUnit()}` : '';
    statRowElement['Descent'] = descent ? `${descent.getDisplayValue()} ${descent.getDisplayUnit()}` : '';
    statRowElement['Energy'] = energy ? `${energy.getDisplayValue()} ${energy.getDisplayUnit()}` : '';
    statRowElement['VO2 Max'] = vO2Max ? `${vO2Max.getDisplayValue()} ${vO2Max.getDisplayUnit()}` : '';
    statRowElement['Average Power'] = avgPower ? `${avgPower.getDisplayValue()} ${avgPower.getDisplayUnit()}` : '';
    statRowElement['Average Heart Rate'] = heartRateAverage ? `${heartRateAverage.getDisplayValue()} ${heartRateAverage.getDisplayUnit()}` : '';
    statRowElement['RPE'] = rpe ? <RPEBorgCR10SCale>rpe.getValue() : undefined;
    statRowElement['Feeling'] = feeling ? <Feelings>feeling.getValue() : undefined;
    statRowElement['Average Speed'] = activityTypes.reduce((accu, activityType) => {
      return [...accu, ...ActivityTypesHelper.averageSpeedDerivedDataTypesToUseForActivityType(ActivityTypes[activityType])]
    }, []).reduce((accu, dataType) => {
      const stat = stats.find(iStat => iStat.getType() === dataType);
      return stat ?
        [...accu, ...DynamicDataLoader.getUnitBasedDataFromDataInstance(stat, unitSettings)]
        : accu
    }, []).reduce((avs, data) => {
      avs.push(`${data.getDisplayValue()}${data.getDisplayUnit()}`);
      return avs;
    }, []).join(', ');

    // Add the sorts
    statRowElement['sort.Distance'] = distance ? <number>distance.getValue() : 0;
    statRowElement['sort.Duration'] = duration ? <number>duration.getValue() : 0;
    statRowElement['sort.Ascent'] = ascent ? <number>ascent.getValue() : 0;
    statRowElement['sort.Descent'] = descent ? <number>descent.getValue() : 0;
    statRowElement['sort.Energy'] = energy ? <number>energy.getValue() : 0;
    statRowElement['sort.VO2 Max'] = vO2Max ? <number>vO2Max.getValue() : 0;
    statRowElement['sort.Average Speed'] = avgSpeed ? <number>avgSpeed.getValue() : 0;
    statRowElement['sort.Average Power'] = avgPower ? <number>avgPower.getValue() : 0;
    statRowElement['sort.Average Heart Rate'] = heartRateAverage ? <number>heartRateAverage.getValue() : 0; // Check for null if better

    return statRowElement;
  }
}

export interface StatRowElement {
  Event?: EventInterface,
  Privacy?: Privacy,
  Name?: string,
  'Start Date'?: string,
  'Activity Types'?: string,
  'Distance'?: string,
  'Ascent'?: string,
  'Descent'?: string,
  'Duration'?: string,
  'Energy'?: string,
  'VO2 Max'?: string,
  'Average Heart Rate'?: string,
  'Average Speed'?: string,
  'Average Cadence'?: string,
  'Average Power'?: string,
  'Device Names'?: string,
  'Merged Event': boolean,
  'Actions': boolean,
  Description?: string,
  RPE?: RPEBorgCR10SCale,
  Feeling?: Feelings,
  // And their sortable data
  'sort.Start Date'?: number,
  'sort.Activity Types'?: string,
  'sort.Distance'?: number,
  'sort.Ascent'?: number,
  'sort.Descent'?: number,
  'sort.Energy': number,
  'sort.VO2 Max': number,
  'sort.Average Power'?: number,
  'sort.Average Heart Rate'?: number,
  'sort.Duration': number,
  'sort.Device Names'?: string,
  'sort.Description'?: string,
}
