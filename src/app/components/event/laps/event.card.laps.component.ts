import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges } from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import { EventInterface } from '@sports-alliance/sports-lib';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { DataTableAbstractDirective } from '../../data-table/data-table-abstract.directive';
import { UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { AppEventColorService } from '../../../services/color/app.event.color.service';
import { LapTypes } from '@sports-alliance/sports-lib';
import { DataHeartRateMax } from '@sports-alliance/sports-lib';
import { isNumber } from '@sports-alliance/sports-lib';

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

  constructor(public eventColorService: AppEventColorService, protected changeDetectorRef: ChangeDetectorRef) {
    super(changeDetectorRef);
  }

  ngOnChanges() {
    this.selectedActivities.forEach(activity => this.availableLapTypes = [...new Set(this.availableLapTypes.concat(activity.getLaps().map(lap => lap.type)))])
  }

  getData(activity: ActivityInterface, lapType: LapTypes) {
    return new MatTableDataSource(activity.getLaps().filter(lap => lap.type === lapType).reduce((lapDataArray, lap, index) => {
      const statRowElement = this.getStatsRowElement(lap.getStatsAsArray(), [activity.type], this.unitSettings);
      statRowElement['#'] = index + 1;
      statRowElement['Type'] = lap.type;
      const maxHR = lap.getStat(DataHeartRateMax.type);
      statRowElement['Duration'] = lap.getDuration().getDisplayValue(false, true, true);

      statRowElement['Maximum Heart Rate'] = maxHR ? `${maxHR.getDisplayValue()} ${maxHR.getDisplayUnit()}` : '';
      lapDataArray.push(statRowElement);
      return lapDataArray;
    }, []));
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

  getColumnsToDisplayByActivityLapTypes(activity: ActivityInterface, availableLapType: LapTypes) {
    return this.getColumnsToDisplay().filter(column => {
      return this.getData(activity, availableLapType).data.find(row => {
        return isNumber(row[column]) || row[column]; // isNumber allow 0's to be accepted
      });
    });
  }

  isSticky(column: string) {
    return column === '#'
  }

  isStickyEnd(column: string) {
    return false;
  }
}
