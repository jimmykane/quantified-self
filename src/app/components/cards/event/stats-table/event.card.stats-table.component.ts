import {ChangeDetectionStrategy, Component, Input, OnChanges} from '@angular/core';
import {MatTableDataSource} from '@angular/material/table';
import {EventInterface} from '@sports-alliance/sports-lib/lib/events/event.interface';
import {ActivityInterface} from '@sports-alliance/sports-lib/lib/activities/activity.interface';
import {DataInterface} from '@sports-alliance/sports-lib/lib/data/data.interface';
import {AppColors} from '../../../../services/color/app.colors';
import {DynamicDataLoader} from '@sports-alliance/sports-lib/lib/data/data.store';
import {UserUnitSettingsInterface} from '@sports-alliance/sports-lib/lib/users/settings/user.unit.settings.interface';
import {DataSpeed} from '@sports-alliance/sports-lib/lib/data/data.speed';
import {DataPace} from '@sports-alliance/sports-lib/lib/data/data.pace';
import {DataVerticalSpeed} from '@sports-alliance/sports-lib/lib/data/data.vertical-speed';
import {DataSwimPace} from '@sports-alliance/sports-lib/lib/data/data.swim-pace';
import {ActivityTypes} from '@sports-alliance/sports-lib/lib/activities/activity.types';
import {ScreenBreakPoints} from '../../../screen-size/sreen-size.abstract';
import {DataTableAbstract} from '../../../data-table/data-table.abstract';
import {AppEventColorService} from '../../../../services/color/app.event.color.service';
import { DataGradeAdjustedPace } from '@sports-alliance/sports-lib/lib/data/data.grade-adjusted-pace';

@Component({
  selector: 'app-event-stats-table',
  templateUrl: './event.card.stats-table.component.html',
  styleUrls: ['./event.card.stats-table.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class EventCardStatsTableComponent implements OnChanges {
  @Input() event: EventInterface;
  @Input() userUnitSettings: UserUnitSettingsInterface;
  @Input() selectedActivities: ActivityInterface[];
  data: MatTableDataSource<Object>;
  columns: Array<Object>;
  appColors = AppColors;

  constructor(private eventColorService: AppEventColorService) {
  }

  ngOnChanges(simpleChanges) {
    this.data = new MatTableDataSource<Object>();
    this.columns = [];
    if (!this.selectedActivities.length || !this.userUnitSettings) {
      return;
    }

    // Create the columns
    this.columns = ['Name'].concat(this.selectedActivities
      .map((activity, index) => {
        return `${activity.creator.name} ${this.eventColorService.getActivityColor(this.event.getActivities(), activity)}`
      }));

    // Collect all the stat types from all the activities
    // @todo refactor and extract to service
    // @todo perfromance this costs! Gets called more than 1-2 times, about 5
    const stats = this.selectedActivities.reduce((statsMap, activity) => {
      Array.from(activity.getStats().values()).forEach((stat) => {
        // If its not derived set it
        if (!DynamicDataLoader.isUnitDerivedDataType(Object.getPrototypeOf(Object.getPrototypeOf(stat)).getType())) {
          statsMap.set(stat.getType(), stat);
          return
        }

        // IF it's derived and there are no user uni settings noop
        if (!this.userUnitSettings) {
          return
        }

        // If the user has preference
        if (
          (Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(stat))).getType() === DataPace.type && this.userUnitSettings.paceUnits.indexOf(Object.getPrototypeOf(Object.getPrototypeOf(stat)).getType()) !== -1)
          || (Object.getPrototypeOf(Object.getPrototypeOf(stat)).getType() === DataPace.type && this.userUnitSettings.paceUnits.indexOf(Object.getPrototypeOf(Object.getPrototypeOf(stat)).getType()) !== -1)
        ) {
          statsMap.set(stat.getType(), stat);
          return;
        }

        if (
          (Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(stat))).getType() === DataGradeAdjustedPace.type && this.userUnitSettings.gradeAdjustedPaceUnits.indexOf(Object.getPrototypeOf(Object.getPrototypeOf(stat)).getType()) !== -1)
          || (Object.getPrototypeOf(Object.getPrototypeOf(stat)).getType() === DataGradeAdjustedPace.type && this.userUnitSettings.gradeAdjustedPaceUnits.indexOf(Object.getPrototypeOf(Object.getPrototypeOf(stat)).getType()) !== -1)
        ) {
          statsMap.set(stat.getType(), stat);
          return;
        }

        if ([ActivityTypes.Swimming, ActivityTypes['Open water swimming']].indexOf(activity.type) !== -1 &&
          ((Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(stat))).getType() === DataSwimPace.type && this.userUnitSettings.swimPaceUnits.indexOf(Object.getPrototypeOf(Object.getPrototypeOf(stat)).getType()) !== -1)
            || (Object.getPrototypeOf(Object.getPrototypeOf(stat)).getType() === DataSwimPace.type && this.userUnitSettings.swimPaceUnits.indexOf(Object.getPrototypeOf(Object.getPrototypeOf(stat)).getType()) !== -1))) {
          statsMap.set(stat.getType(), stat);
          return;
        }
        if (Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(stat))).getType() === DataSpeed.type && this.userUnitSettings.speedUnits.indexOf(Object.getPrototypeOf(Object.getPrototypeOf(stat)).getType()) !== -1) {
          statsMap.set(stat.getType(), stat);
          return;
        }
        if (Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(stat))).getType() === DataVerticalSpeed.type && this.userUnitSettings.verticalSpeedUnits.indexOf(Object.getPrototypeOf(Object.getPrototypeOf(stat)).getType()) !== -1) {
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
          rowObj[`${activity.creator.name} ${this.eventColorService.getActivityColor(this.event.getActivities(), activity)}`] =
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
      if (left.Name < right.Name) {
        return -1;
      }
      if (left.Name > right.Name) {
        return 1;
      }
      return 0;
    });

    // debugger;

    // Set the data
    this.data = new MatTableDataSource(data);
  }

  applyFilter(event) {
    this.data.filter = event.target.value.trim().toLowerCase();
  }

  getColumnHeaderName(columnHeader: string): string {
    return columnHeader.slice(0, -7);
  }

  getColumnHeaderColor(columnHeader: string): string {
    return columnHeader.slice(-7);
  }
}
