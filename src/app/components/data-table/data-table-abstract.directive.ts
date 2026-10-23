import { ChangeDetectorRef, Directive, } from '@angular/core';
import type { EventRead } from '@shared/event-read';
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
import { resolveUnitAwareDisplayStat } from '@shared/unit-aware-display';

/** Bounded dependencies for full-reader cache validation; summary revisions observe only requested metrics. */
export const EVENT_TABLE_STAT_TYPES = [DataDistance.type, DataDuration.type, DataAscent.type, DataDescent.type,
  DataEnergy.type, DataVO2Max.type, DataPeakEPOC.type, DataRecoveryTime.type, DataAerobicTrainingEffect.type,
  DataSpeedAvg.type, DataPowerAvg.type, DataPowerMax.type, DataHeartRateAvg.type, DataRPE.type, DataFeeling.type];

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
    const byType = new Map<string, DataInterface>();
    stats.forEach(stat => { if (!byType.has(stat.getType())) byType.set(stat.getType(), stat); });
    return this.getStatsRowElementFromReader({ getStat: type => byType.get(type) } as Pick<EventRead, 'getStat'>, activityTypes, unitSettings, isMerge);
  }

  getStatsRowElementFromReader(reader: Pick<EventRead, 'getStat'>, activityTypes: string[], unitSettings?: UserUnitSettingsInterface, isMerge = false): StatRowElement {
    const statRowElement = {} as StatRowElement;
    const lazy = (key: string, read: () => unknown) => Object.defineProperty(statRowElement, key, {
      enumerable: true, configurable: true,
      get() {
        const value = read();
        Object.defineProperty(this, key, { value, enumerable: true, configurable: true, writable: true });
        return value;
      },
      set(value) { Object.defineProperty(this, key, { value, enumerable: true, configurable: true, writable: true }); },
    });
    const getStat = (type: string) => reader.getStat(type) || undefined;

    for (const type of EVENT_TABLE_STAT_TYPES) {
      if ([DataSpeedAvg.type, DataDistance.type, DataDuration.type, DataRPE.type, DataFeeling.type].includes(type)) continue;
      lazy(type, () => {
        const stat = getStat(type);
        return stat ? resolveUnitAwareDisplayStat(stat, unitSettings, { stripRepeatedUnit: true })?.text
          ?? `${stat.getDisplayValue()} ${stat.getDisplayUnit()}` : '';
      });
    }
    lazy(DataDuration.type, () => {
      const stat = getStat(DataDuration.type);
      return stat ? `${stat.getDisplayValue()}` : '';
    });
    lazy(DataDistance.type, () => {
      const stat = getStat(DataDistance.type);
      return stat ? resolveUnitAwareDisplayStat(stat, unitSettings, { stripRepeatedUnit: true })?.text
        ?? `${stat.getDisplayValue()} ${stat.getDisplayUnit()}` : '';
    });
    for (const type of [DataRPE.type, DataFeeling.type]) lazy(type, () => getStat(type)?.getValue());
    lazy(DataSpeedAvg.type, () => {
      const averageSpeed = getStat(DataSpeedAvg.type);
      if (isMerge && averageSpeed) {
        return DynamicDataLoader.getUnitBasedDataFromDataInstance(averageSpeed, unitSettings)
          .map(data => `${data.getDisplayValue()}${data.getDisplayUnit()}`).join(', ');
      }
      const speedValues: string[] = [];
      for (const activityType of activityTypes) {
        const types = ActivityTypesHelper.averageSpeedDerivedDataTypesToUseForActivityType(
          ActivityTypes[activityType as keyof typeof ActivityTypes]);
        for (const type of types) {
          if (type === DataGradeAdjustedPace.type || type === 'GradeAdjustedPace' || type === 'Average Grade Adjusted Pace') continue;
          const stat = getStat(type);
          if (!stat) continue;
          for (const data of DynamicDataLoader.getUnitBasedDataFromDataInstance(stat, unitSettings)) {
            speedValues.push(`${data.getDisplayValue()}${data.getDisplayUnit()}`);
          }
        }
      }
      return speedValues.join(', ');
    });
    for (const type of EVENT_TABLE_STAT_TYPES) {
      if (type === DataRPE.type || type === DataFeeling.type) continue;
      lazy(`sort.${type}`, () => getStat(type)?.getValue() ?? 0);
    }

    return statRowElement;
  }

  abstract isSticky(column: string);

  abstract isStickyEnd(column: string);
}

export interface StatRowElement {
  Event?: EventRead,
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
  'Average Stroke Rate'?: string,
  'Average Power'?: string,
  'Device Names'?: string,
  'Device Name Items'?: Array<{ label: string; color: string; trackKey: string }>,
  'Tags'?: string,
  'Tag Values'?: string[],
  'Tags Title'?: string,
  'Tag Action Label'?: string,
  'Tags Accessible Label'?: string,
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
