import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import { EventInterface } from '@sports-alliance/sports-lib';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { DataInterface } from '@sports-alliance/sports-lib';
import { AppColors } from '../../../services/color/app.colors';
import { DynamicDataLoader } from '@sports-alliance/sports-lib';
import { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { DataSpeed } from '@sports-alliance/sports-lib';
import { DataPace } from '@sports-alliance/sports-lib';
import { DataVerticalSpeed } from '@sports-alliance/sports-lib';
import { DataSwimPace } from '@sports-alliance/sports-lib';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { DataGradeAdjustedPace } from '@sports-alliance/sports-lib';
import { SelectionModel } from '@angular/cdk/collections';
import { DataExportService } from '../../../services/data-export.service';

@Component({
  selector: 'app-event-stats-table',
  templateUrl: './event.card.stats-table.component.html',
  styleUrls: ['./event.card.stats-table.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class EventCardStatsTableComponent implements OnChanges {
  @Input() event!: EventInterface;
  @Input() userUnitSettings!: UserUnitSettingsInterface;
  @Input() selectedActivities!: ActivityInterface[];
  @Input() showAsExpansion = true;
  data: MatTableDataSource<any> = new MatTableDataSource<any>();
  columns!: string[];
  appColors = AppColors;
  selection = new SelectionModel<any>(true, []);

  constructor(
    private eventColorService: AppEventColorService,
    private dataExportService: DataExportService
  ) {
  }

  ngOnChanges(simpleChanges: any) {
    this.data = new MatTableDataSource<object>();
    this.columns = [];
    this.selection.clear();
    if (!this.selectedActivities.length || !this.userUnitSettings) {
      return;
    }

    // Create the columns
    this.columns = ['Name'].concat(this.selectedActivities
      .map((activity, index) => {
        return `${activity.creator.name} ${this.eventColorService.getActivityColor(this.selectedActivities, activity)}`
      }));

    // Collect all the stat types from all the activities
    const stats = this.selectedActivities.reduce((statsMap: Map<string, DataInterface>, activity) => {
      activity.getStatsAsArray().forEach((stat) => {
        const statType = stat.getType();

        // Helper to check if a stat belongs to a base type group by traversing prototypes
        const isOfBaseType = (s: any, baseType: string) => {
          let current = Object.getPrototypeOf(s);
          while (current && typeof current.getType === 'function') {
            try {
              if (current.getType() === baseType) {
                return true;
              }
            } catch (e) {
              // Ignore errors if getType fails on some prototype
            }
            current = Object.getPrototypeOf(current);
          }
          return false;
        };

        const isSwimming = [ActivityTypes.Swimming, ActivityTypes['Open water swimming']].includes(activity.type as any);

        // Define unit preferences and their base types
        const unitPreferences: { baseType: string, units: string[], onlyIfSwimming?: boolean }[] = [
          { baseType: DataSwimPace.type, units: this.userUnitSettings.swimPaceUnits, onlyIfSwimming: true },
          { baseType: DataPace.type, units: this.userUnitSettings.paceUnits },
          { baseType: DataGradeAdjustedPace.type, units: this.userUnitSettings.gradeAdjustedPaceUnits },
          { baseType: DataSpeed.type, units: this.userUnitSettings.speedUnits },
          { baseType: DataVerticalSpeed.type, units: this.userUnitSettings.verticalSpeedUnits },
        ];

        // Check each preference
        for (const pref of unitPreferences) {
          if (isOfBaseType(stat, pref.baseType)) {
            if (pref.onlyIfSwimming && !isSwimming) {
              return;
            }
            if (pref.units.includes(statType)) {
              statsMap.set(statType, stat);
            }
            return;
          }
        }

        // If it's not a derived type (or not one we specifically handle above), just add it if it's not unit-derived
        if (!DynamicDataLoader.isUnitDerivedDataType(statType)) {
          statsMap.set(statType, stat);
        }
      });
      return statsMap;
    }, new Map<string, DataInterface>());

    // Create the data as rows
    const data = Array.from(stats.values()).reduce((array, stat) => {
      array.push(
        this.selectedActivities.reduce((rowObj: any, activity, index) => {
          const activityStat = activity.getStat(stat.getType());
          if (!activityStat) {
            return rowObj;
          }
          rowObj[`${activity.creator.name} ${this.eventColorService.getActivityColor(this.selectedActivities, activity)}`] =
            (activityStat ? activityStat.getDisplayValue() : '') +
            ' ' +
            (activityStat ? activityStat.getDisplayUnit() : '');
          return rowObj;
        }, { Name: `${stat.getDisplayType()}` } as any),
      );
      return array;
    }, [] as any[]);

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
        data[index]['Difference'] = {} as any;
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
    this.data = new MatTableDataSource<any>(data);
  }

  applyFilter(event: any) {
    this.data.filter = event.target.value.trim().toLowerCase();
  }

  getColumnHeaderName(columnHeader: string): string {
    return this.dataExportService.getColumnHeaderName(columnHeader);
  }

  getColumnHeaderColor(columnHeader: string): string {
    if (columnHeader === 'Name' || columnHeader === 'Difference') {
      return 'inherit';
    }
    return columnHeader.slice(-7);
  }

  toggleRow(row: any) {
    this.selection.toggle(row);
  }

  clearSelection() {
    this.selection.clear();
  }

  isSelectionEmpty(): boolean {
    return this.selection.isEmpty();
  }

  copyToClipboard(): void {
    const selectedRows = this.selection.selected;
    if (selectedRows.length === 0) return;
    this.dataExportService.copyToMarkdown(selectedRows, this.columns);
  }

  copyToSheets(): void {
    const selectedRows = this.selection.selected;
    if (selectedRows.length === 0) return;
    this.dataExportService.copyToSheets(selectedRows, this.columns);
  }
}
