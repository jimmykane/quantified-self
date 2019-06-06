import {ChangeDetectionStrategy, Component, Input, OnChanges} from '@angular/core';
import {MatTableDataSource} from '@angular/material/table';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {DataInterface} from 'quantified-self-lib/lib/data/data.interface';
import {AppColors} from '../../../../services/color/app.colors';
import {DynamicDataLoader} from 'quantified-self-lib/lib/data/data.store';
import {UserUnitSettingsInterface} from "quantified-self-lib/lib/users/user.unit.settings.interface";
import {DataSpeed} from "quantified-self-lib/lib/data/data.speed";
import {DataPace} from "quantified-self-lib/lib/data/data.pace";
import {DataVerticalSpeed} from "quantified-self-lib/lib/data/data.vertical-speed";

@Component({
  selector: 'app-event-card-stats',
  templateUrl: './event.card.stats.component.html',
  styleUrls: ['./event.card.stats.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class EventCardStatsComponent implements OnChanges {
  @Input() event: EventInterface;
  @Input() userUnitSettings: UserUnitSettingsInterface;
  @Input() selectedActivities: ActivityInterface[];
  data: MatTableDataSource<Object>;
  columns: Array<Object>;
  appColors = AppColors;

  ngOnChanges(simpleChanges) {
    this.data = new MatTableDataSource<Object>();
    this.columns = [];
    if (!this.selectedActivities.length) {
      return;
    }

    // Create the columns
    this.columns = ['Name'].concat(this.selectedActivities
      .map(activity => activity.creator.name)
      .map((key, index) => {
        return `${key} ${(new Array(index + 1)).join(' ')}`
      }));

    // Collect all the stat types from all the activities
    // @todo refactor and extract to service
    const stats = this.selectedActivities.reduce((statsMap, activity) => {
      Array.from(activity.getStats().values()).forEach((stat) => {
        // If its not derived set it
        if (!DynamicDataLoader.isUnitDerivedDataType(Object.getPrototypeOf(Object.getPrototypeOf(stat)).getType())) {
          statsMap.set(stat.getType(), stat);
          return
        }
        // IF it's derived and there are no user uni settings noop
        if (!this.userUnitSettings){
          return
        }
        // If the user has preference
        if (Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(stat))).getType() === DataPace.type && this.userUnitSettings.paceUnits.indexOf(Object.getPrototypeOf(Object.getPrototypeOf(stat)).getType()) !== -1){
          statsMap.set(stat.getType(), stat);
          return;
        }
        if (Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(stat))).getType() === DataSpeed.type && this.userUnitSettings.speedUnits.indexOf(Object.getPrototypeOf(Object.getPrototypeOf(stat)).getType()) !== -1){
          statsMap.set(stat.getType(), stat);
          return;
        }
        if (Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(stat))).getType() === DataVerticalSpeed.type && this.userUnitSettings.verticalSpeedUnits.indexOf(Object.getPrototypeOf(Object.getPrototypeOf(stat)).getType()) !== -1){
          statsMap.set(stat.getType(), stat);
          return;
        }
      });
      return statsMap;
    }, new Map<string, DataInterface>());

    // Create the data as rows
    const data = Array.from(stats.values()).reduce((array, stat) => {
      array.push(
        this.selectedActivities.reduce((rowObj, activity, index) => {
          const activityStat = activity.getStat(stat.getType());
          if (!activityStat) {
            return rowObj;
          }
          rowObj[`${activity.creator.name} ${(new Array(index + 1)).join(' ')}`] =
            (activityStat ? activityStat.getDisplayValue() : '') +
            ' ' +
            (activityStat ? activityStat.getDisplayUnit() : '');
          return rowObj;
        }, {Name: `${stat.getDisplayType()}`}),
      );
      return array;
    }, []);

    // If we are comparing only 2 activities then add a diff column.
    // @todo support more than 2 activities for diff
    if (this.selectedActivities.length === 2) {
      this.columns = this.columns.concat(['Difference']);
      Array.from(stats.values()).forEach((stat: DataInterface, index) => {
        const firstActivityStat = this.selectedActivities[0].getStat(stat.getType());
        const secondActivityStat = this.selectedActivities[1].getStat(stat.getType());
        if (!firstActivityStat || !secondActivityStat) {
          return;
        }
        const firstActivityStatValue = firstActivityStat.getValue();
        const secondActivityStatValue = secondActivityStat.getValue();
        if (typeof firstActivityStatValue !== 'number' || typeof secondActivityStatValue !== 'number') {
          return;
        }
        // Create an obj
        data[index]['Difference'] = {};
        data[index]['Difference']['display'] = (DynamicDataLoader.getDataInstanceFromDataType(stat.getType(), Math.abs(firstActivityStatValue - secondActivityStatValue))).getDisplayValue() + ' ' + (DynamicDataLoader.getDataInstanceFromDataType(stat.getType(), Math.abs(firstActivityStatValue - secondActivityStatValue))).getDisplayUnit();
        data[index]['Difference']['percent'] = 100 * Math.abs((firstActivityStatValue - secondActivityStatValue) / ((firstActivityStatValue + secondActivityStatValue) / 2));
        // Correct the NaN with both 0's
        if (firstActivityStatValue === 0 && secondActivityStatValue === 0) {
          data[index]['Difference']['percent'] = 0
        }
      })
    }

    data.sort((left, right) => {
      if (left.Name < right.Name)
        return -1;
      if (left.Name > right.Name)
        return 1;
      return 0;
    });

    // debugger;

    // Set the data
    this.data = new MatTableDataSource(data);
  }


  /**
   * This gets the base and extended unit datatypes from a datatype array depending on the user settings
   * @param dataTypes
   * @param userUnitSettings
   */
  private getUnitBasedDataTypesToUseFromDataTypes(dataTypes: string[], userUnitSettings?: UserUnitSettingsInterface): string[] {
    let unitBasedDataTypes = [];
    if (!userUnitSettings) {
      return unitBasedDataTypes
    }
    if (dataTypes.indexOf(DataPace.type) !== -1) {
      unitBasedDataTypes = unitBasedDataTypes.concat(userUnitSettings.paceUnits);
    }
    if (dataTypes.indexOf(DataSpeed.type) !== -1) {
      unitBasedDataTypes = unitBasedDataTypes.concat(userUnitSettings.speedUnits);
    }
    if (dataTypes.indexOf(DataVerticalSpeed.type) !== -1) {
      unitBasedDataTypes = unitBasedDataTypes.concat(userUnitSettings.verticalSpeedUnits);
    }
    return unitBasedDataTypes;
  }

  applyFilter(filterValue: string) {
    filterValue = filterValue.trim(); // Remove whitespace
    filterValue = filterValue.toLowerCase(); // MatTableDataSource defaults to lowercase matches
    this.data.filter = filterValue;
  }
}
