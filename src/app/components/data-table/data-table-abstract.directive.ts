import { ChangeDetectorRef, Directive, } from '@angular/core';
import { EventInterface } from '@sports-alliance/sports-lib';
import { DataRPE, RPEBorgCR10SCale } from '@sports-alliance/sports-lib';
import { DataFeeling, Feelings } from '@sports-alliance/sports-lib';
import { Privacy } from '@sports-alliance/sports-lib';
import { DataInterface } from '@sports-alliance/sports-lib';
import { DataAscent } from '@sports-alliance/sports-lib';
import { DataDescent } from '@sports-alliance/sports-lib';
import { DataEnergy } from '@sports-alliance/sports-lib';
import { DataPowerAvg } from '@sports-alliance/sports-lib';
import { DataSpeedAvg } from '@sports-alliance/sports-lib';
import { DataHeartRateAvg } from '@sports-alliance/sports-lib';
import { DataDistance } from '@sports-alliance/sports-lib';
import { ActivityTypes, ActivityTypesHelper } from '@sports-alliance/sports-lib';
import { DynamicDataLoader } from '@sports-alliance/sports-lib';
import { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { DataDuration } from '@sports-alliance/sports-lib';
import { DataVO2Max } from '@sports-alliance/sports-lib';
import { DataPowerMax } from '@sports-alliance/sports-lib';
import { DataPeakEPOC } from '@sports-alliance/sports-lib';
import { DataAerobicTrainingEffect } from '@sports-alliance/sports-lib';
import { DataRecoveryTime } from '@sports-alliance/sports-lib';
import { DataGradeAdjustedPace } from '@sports-alliance/sports-lib';
import { LoadingAbstractDirective } from '../loading/loading-abstract.directive';

@Directive()
export abstract class DataTableAbstractDirective extends LoadingAbstractDirective {

  constructor(changeDetector: ChangeDetectorRef) {
    super(changeDetector);
  }

  abstract getColumnsToDisplay(): string[];

  isColumnHeaderSortable(columnName): boolean {
    return [
      'Start Date',
      'Distance',
      'Activity Types',
      'Description',
      'Average Power',
      'Average Speed',
      'Duration',
      'Ascent',
      'Descent',
      'Average Heart Rate',
      'VO2 Max',
      'Energy',
      'Device Names',
      DataPeakEPOC.type,
      DataRecoveryTime.type,
      DataAerobicTrainingEffect.type,
    ].indexOf(columnName) !== -1;
  }

  getStatsRowElement(stats: DataInterface[], activityTypes: string[], unitSettings?: UserUnitSettingsInterface, isMerge: boolean = false): StatRowElement {
    const statRowElement: StatRowElement = <StatRowElement>{};
    const statsByType = new Map<string, DataInterface>();
    for (const stat of stats) {
      const type = stat.getType();
      if (!statsByType.has(type)) {
        statsByType.set(type, stat);
      }
    }
    const getStat = (type: string) => statsByType.get(type);

    const distance = getStat(DataDistance.type);
    const duration = getStat(DataDuration.type);
    const ascent = getStat(DataAscent.type);
    const descent = getStat(DataDescent.type);
    const energy = getStat(DataEnergy.type);
    const avgPower = getStat(DataPowerAvg.type);
    const maxPower = getStat(DataPowerMax.type);
    const avgSpeed = getStat(DataSpeedAvg.type);
    const heartRateAverage = getStat(DataHeartRateAvg.type);
    const rpe = getStat(DataRPE.type);
    const feeling = getStat(DataFeeling.type);
    const vO2Max = getStat(DataVO2Max.type);
    const TTE = getStat(DataAerobicTrainingEffect.type);
    const EPOC = getStat(DataPeakEPOC.type);
    const recoveryTime = getStat(DataRecoveryTime.type);

    statRowElement[DataDuration.type] = duration ? `${duration.getDisplayValue()}` : '';
    statRowElement[DataDistance.type] = distance ? `${distance.getDisplayValue()} ${distance.getDisplayUnit()}` : '';
    statRowElement[DataAscent.type] = ascent ? `${ascent.getDisplayValue()} ${ascent.getDisplayUnit()}` : '';
    statRowElement[DataDescent.type] = descent ? `${descent.getDisplayValue()} ${descent.getDisplayUnit()}` : '';
    statRowElement[DataEnergy.type] = energy ? `${energy.getDisplayValue()} ${energy.getDisplayUnit()}` : '';
    statRowElement[DataVO2Max.type] = vO2Max ? `${vO2Max.getDisplayValue()} ${vO2Max.getDisplayUnit()}` : '';
    statRowElement[DataAerobicTrainingEffect.type] = TTE ? `${TTE.getDisplayValue()} ${TTE.getDisplayUnit()}` : '';
    statRowElement[DataPeakEPOC.type] = EPOC ? `${EPOC.getDisplayValue()} ${EPOC.getDisplayUnit()}` : '';
    statRowElement[DataRecoveryTime.type] = recoveryTime ? `${recoveryTime.getDisplayValue()} ${recoveryTime.getDisplayUnit()}` : '';
    statRowElement[DataPowerAvg.type] = avgPower ? `${avgPower.getDisplayValue()} ${avgPower.getDisplayUnit()}` : '';
    statRowElement[DataPowerMax.type] = maxPower ? `${maxPower.getDisplayValue()} ${maxPower.getDisplayUnit()}` : '';
    statRowElement[DataHeartRateAvg.type] = heartRateAverage ? `${heartRateAverage.getDisplayValue()} ${heartRateAverage.getDisplayUnit()}` : '';
    statRowElement[DataRPE.type] = rpe ? <RPEBorgCR10SCale>rpe.getValue() : undefined;
    statRowElement[DataFeeling.type] = feeling ? <Feelings>feeling.getValue() : undefined;

    if (isMerge && avgSpeed) {
      statRowElement[DataSpeedAvg.type] = DynamicDataLoader.getUnitBasedDataFromDataInstance(avgSpeed, unitSettings)
        .map(data => `${data.getDisplayValue()}${data.getDisplayUnit()}`)
        .join(', ');
    } else {
      const speedValues: string[] = [];
      for (const activityType of activityTypes) {
        const derivedDataTypes = ActivityTypesHelper.averageSpeedDerivedDataTypesToUseForActivityType(
          ActivityTypes[activityType as keyof typeof ActivityTypes]
        );
        for (const dataType of derivedDataTypes) {
          // Hide Grade Adjusted Pace from the dashboard event table
          if ((typeof DataGradeAdjustedPace !== 'undefined' && dataType === DataGradeAdjustedPace.type) || dataType === 'GradeAdjustedPace' || dataType === 'Average Grade Adjusted Pace') {
            continue;
          }
          const stat = getStat(dataType);
          if (!stat) {
            continue;
          }
          const unitBasedData = DynamicDataLoader.getUnitBasedDataFromDataInstance(stat, unitSettings);
          for (const data of unitBasedData) {
            speedValues.push(`${data.getDisplayValue()}${data.getDisplayUnit()}`);
          }
        }
      }
      statRowElement[DataSpeedAvg.type] = speedValues.join(', ');
    }

    // Add the sorts
    statRowElement[`sort.${DataDistance.type}`] = distance ? <number>distance.getValue() : 0;
    statRowElement[`sort.${DataDuration.type}`] = duration ? <number>duration.getValue() : 0;
    statRowElement[`sort.${DataAscent.type}`] = ascent ? <number>ascent.getValue() : 0;
    statRowElement[`sort.${DataDescent.type}`] = descent ? <number>descent.getValue() : 0;
    statRowElement[`sort.${DataEnergy.type}`] = energy ? <number>energy.getValue() : 0;
    statRowElement[`sort.${DataVO2Max.type}`] = vO2Max ? <number>vO2Max.getValue() : 0;
    statRowElement[`sort.${DataPeakEPOC.type}`] = EPOC ? <number>EPOC.getValue() : 0;
    statRowElement[`sort.${DataRecoveryTime.type}`] = recoveryTime ? <number>recoveryTime.getValue() : 0;
    statRowElement[`sort.${DataAerobicTrainingEffect.type}`] = TTE ? <number>TTE.getValue() : 0;
    statRowElement[`sort.${DataSpeedAvg.type}`] = avgSpeed ? <number>avgSpeed.getValue() : 0;
    statRowElement[`sort.${DataPowerAvg.type}`] = avgPower ? <number>avgPower.getValue() : 0;
    statRowElement[`sort.${DataPowerMax.type}`] = avgPower ? <number>avgPower.getValue() : 0;

    return statRowElement;
  }

  abstract isSticky(column: string);

  abstract isStickyEnd(column: string);
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
  isAscentExcluded?: boolean,
  isDescentExcluded?: boolean,
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
  Gradient?: string,
  Color?: string,
}
