import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges } from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import { EventInterface } from '@sports-alliance/sports-lib';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { DataTableAbstractDirective, StatRowElement } from '../../data-table/data-table-abstract.directive';
import { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { LapTypes } from '@sports-alliance/sports-lib';
import { DataHeartRateMax } from '@sports-alliance/sports-lib';
import { isNumber } from '@sports-alliance/sports-lib';
import { isEventLapTypeAllowed } from '../../../helpers/event-lap-type.helper';

interface LapTableRow extends StatRowElement {
  '#': number;
  Type: LapTypes;
  'Maximum Heart Rate': string;
}

@Component({
  selector: 'app-event-card-laps',
  templateUrl: './event.card.laps.component.html',
  styleUrls: ['./event.card.laps.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class EventCardLapsComponent extends DataTableAbstractDirective implements OnChanges {
  @Input() event: EventInterface;
  @Input() selectedActivities: ActivityInterface[];
  @Input() unitSettings: UserUnitSettingsInterface;

  public availableLapTypes: LapTypes[] = []

  public dataSourcesMap = new Map<string, MatTableDataSource<LapTableRow>>();
  public columnsMap = new Map<string, string[]>();

  constructor(public eventColorService: AppEventColorService, protected changeDetectorRef: ChangeDetectorRef) {
    super(changeDetectorRef);
  }

  ngOnChanges() {
    this.updateAvailableLapTypes();
    this.updateData();
  }

  private updateAvailableLapTypes() {
    this.availableLapTypes = [];
    if (this.selectedActivities) {
      this.selectedActivities.forEach(activity => {
        this.availableLapTypes = [...new Set(this.availableLapTypes.concat(
          activity.getLaps().map(lap => lap.type)
            .filter(lapType => this.shouldShowLapType(lapType))
        ))];
      });
    }
  }

  private shouldShowLapType(lapType: LapTypes): boolean {
    return isEventLapTypeAllowed(lapType, []);
  }

  private updateData() {
    this.dataSourcesMap.clear();
    this.columnsMap.clear();

    if (!this.selectedActivities) {
      return;
    }

    this.selectedActivities.forEach(activity => {
      this.availableLapTypes.forEach(lapType => {
        const data = this.generateLapData(activity, lapType);
        const key = this.getKey(activity, lapType);

        if (data.length > 0) {
          const dataSource = new MatTableDataSource(data);
          this.dataSourcesMap.set(key, dataSource);
          this.columnsMap.set(key, this.calculateColumns(dataSource));
        }
      });
    });
  }

  private getKey(activity: ActivityInterface, lapType: LapTypes): string {
    return `${activity.getID()}-${lapType}`;
  }

  private generateLapData(activity: ActivityInterface, lapType: LapTypes): LapTableRow[] {
    return activity.getLaps().filter(lap => lap.type === lapType).reduce<LapTableRow[]>((lapDataArray, lap, index) => {
      const statRowElement = this.getStatsRowElement(lap.getStatsAsArray(), [activity.type], this.unitSettings);
      const maxHR = lap.getStat(DataHeartRateMax.type);
      const row: LapTableRow = {
        ...statRowElement,
        '#': index + 1,
        Type: lap.type,
        Duration: lap.getDuration().getDisplayValue(false, true, true),
        'Maximum Heart Rate': maxHR ? `${maxHR.getDisplayValue()} ${maxHR.getDisplayUnit()}` : '',
      };

      lapDataArray.push(row);
      return lapDataArray;
    }, []);
  }

  private calculateColumns(dataSource: MatTableDataSource<LapTableRow>): string[] {
    return this.getColumnsToDisplay().filter(column => {
      return dataSource.data.find(row => {
        const cellValue = row[column as keyof LapTableRow];
        return isNumber(cellValue) || Boolean(cellValue); // isNumber allow 0's to be accepted
      });
    });
  }

  getDataSource(activity: ActivityInterface, lapType: LapTypes): MatTableDataSource<LapTableRow> | undefined {
    return this.dataSourcesMap.get(this.getKey(activity, lapType));
  }

  getColumns(activity: ActivityInterface, lapType: LapTypes): string[] {
    return this.columnsMap.get(this.getKey(activity, lapType)) || [];
  }

  getColumnsToDisplay() {
    return [
      '#',
      'Duration',
      'Distance',
      'Ascent',
      'Descent',
      'Energy',
      'Average Heart Rate',
      'Maximum Heart Rate',
      'Average Speed',
      'Average Power',
    ]
  }

  isSticky(column: string) {
    return column === '#'
  }

  isStickyEnd(column: string) {
    return false;
  }
}
