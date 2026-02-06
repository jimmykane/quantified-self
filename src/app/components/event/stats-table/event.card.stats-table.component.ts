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
import { expandCollapse } from '../../../animations/animations';
import { computeStatDiff } from '../../../helpers/stats-diff.helper';

@Component({
  selector: 'app-event-stats-table',
  templateUrl: './event.card.stats-table.component.html',
  styleUrls: ['./event.card.stats-table.component.css'],
  animations: [expandCollapse],
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
    const activityColumnKeys = this.selectedActivities.map((activity) => {
      const label = this.getActivityHeaderLabel(activity);
      const color = this.eventColorService.getActivityColor(this.selectedActivities, activity);
      return `${label} ${color}`;
    });
    this.columns = ['Name'].concat(activityColumnKeys);

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
      let isComplexObject = false;
      const row = this.selectedActivities.reduce((rowObj: any, activity, index) => {
        const activityStat = activity.getStat(stat.getType());
        if (!activityStat) {
          return rowObj;
        }
        const displayValue = activityStat.getDisplayValue();
        const displayUnit = activityStat.getDisplayUnit();

        // Check if any activity has a value that renders as [object Object]
        if (String(displayValue).includes('[object Object]')) {
          isComplexObject = true;
        }

        rowObj[activityColumnKeys[index]] =
          (displayValue || '') +
          ' ' +
          (displayUnit || '');
        return rowObj;
      }, { Name: `${stat.getDisplayType()}` } as any);

      if (!isComplexObject) {
        array.push(row);
      }
      return array;
    }, [] as any[]);

    // If we are comparing only 2 activities then add a diff column.
    // @todo support more than 2 activities for diff
    if (this.event?.isMerge && this.selectedActivities.length === 2) {
      this.columns = this.columns.concat(['Difference']);
      Array.from(stats.values()).forEach((stat: DataInterface) => {
        const row = data.find(r => r.Name === stat.getDisplayType());
        if (!row) {
          return;
        }
        const diff = computeStatDiff(
          this.selectedActivities[0],
          this.selectedActivities[1],
          stat.getType(),
          stat.getType(),
          this.userUnitSettings
        );
        if (!diff) {
          return;
        }
        row['Difference'] = {
          display: diff.display,
          percent: diff.percent,
        };
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

    // Add Software Version row (if available)
    const swVersionRow = { Name: 'Software Version' } as any;
    let hasSwVersion = false;

    this.selectedActivities.forEach((activity, index) => {
      const creator = activity.creator as any;
      // Check commonly used fields for SW version
      const version = creator.swInfo || creator.swVersion || creator.version;

      if (version !== undefined && version !== null && version !== '') {
        hasSwVersion = true;
        swVersionRow[activityColumnKeys[index]] = version;
      } else {
        swVersionRow[activityColumnKeys[index]] = '';
      }
    });

    if (hasSwVersion) {
      data.push(swVersionRow);
    }

    // debugger;

    // Set the data
    this.data = new MatTableDataSource<any>(data);

    // Custom filter predicate for multi-term search (comma-separated, OR logic)
    this.data.filterPredicate = (row: any, filter: string) => {
      const terms = filter.split(',').map(t => t.trim()).filter(t => t.length > 0);
      if (terms.length === 0) return true;

      const rowString = Object.values(row).join(' ').toLowerCase();
      return terms.some(term => rowString.includes(term));
    };
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

  shouldShowActivityHeaderLabel(columnHeader: string): boolean {
    if (columnHeader === 'Name') {
      return false;
    }
    if (columnHeader === 'Difference') {
      return true;
    }
    if (!this.event?.isMerge && (this.selectedActivities?.length ?? 0) === 1) {
      return false;
    }
    return true;
  }

  getDifferenceColor(percent: number): string {
    return this.eventColorService.getDifferenceColor(percent);
  }

  shouldShowHeaderRow(): boolean {
    return (this.selectedActivities?.length ?? 0) > 1;
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

  private getActivityHeaderLabel(activity: ActivityInterface): string {
    if (!this.event?.isMerge && this.selectedActivities?.length === 1) {
      return 'Value';
    }
    if (this.event?.isMerge) {
      return activity.creator?.name || 'Device';
    }
    const activityType = (activity as any)?.type;
    if (activityType === null || activityType === undefined) {
      return 'Activity';
    }
    if (typeof activityType === 'number') {
      return ActivityTypes[activityType] || String(activityType);
    }
    return String(activityType);
  }
}
