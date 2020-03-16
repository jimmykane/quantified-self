import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges} from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import {EventInterface} from '@sports-alliance/sports-lib/lib/events/event.interface';
import {ActivityInterface} from '@sports-alliance/sports-lib/lib/activities/activity.interface';
import {DataDistance} from '@sports-alliance/sports-lib/lib/data/data.distance';
import {DataAscent} from '@sports-alliance/sports-lib/lib/data/data.ascent';
import {DataDescent} from '@sports-alliance/sports-lib/lib/data/data.descent';
import {DataHeartRateAvg} from '@sports-alliance/sports-lib/lib/data/data.heart-rate-avg';
import {LoadingAbstractDirective} from '../../../loading/loading-abstract.directive';
import {DataTableAbstractDirective} from '../../../data-table/data-table-abstract.directive';
import {ScreenBreakPoints} from '../../../screen-size/sreen-size.abstract';
import {UserUnitSettingsInterface} from '@sports-alliance/sports-lib/lib/users/settings/user.unit.settings.interface';
import {AppEventColorService} from '../../../../services/color/app.event.color.service';

@Component({
  selector: 'app-event-card-laps',
  templateUrl: './event.card.laps.component.html',
  styleUrls: ['./event.card.laps.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class EventCardLapsComponent extends DataTableAbstractDirective implements OnChanges {
  @Input() event: EventInterface;
  @Input() selectedActivities: ActivityInterface[];
  @Input() unitSettings: UserUnitSettingsInterface;

  constructor(public eventColorService: AppEventColorService, protected changeDetectorRef: ChangeDetectorRef) {
    super(changeDetectorRef);
  }

  ngOnChanges() {
  }

  getData(activity: ActivityInterface) {
    return new MatTableDataSource(activity.getLaps().reduce((lapDataArray, lap, index) => {
      const statRowElement = this.getStatsRowElement(lap.getStatsAsArray(), [activity.type], this.unitSettings);
      statRowElement['#'] = index + 1;
      statRowElement['Type'] = lap.type;
      lapDataArray.push(statRowElement);
      return lapDataArray;
    }, []));
  }

  getColumnsToDisplayDependingOnScreenSize() {

    // push all the rest
    let columns = [
      '#',
      'Type',
      'Duration',
      'Distance',
      'Ascent',
      'Descent',
      'Energy',
      'Average Heart Rate',
      'Average Speed',
      'Average Power',
    ];

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.Highest) {
      return columns;
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.VeryHigh) {
      columns = columns.filter(column => ['Energy'].indexOf(column) === -1)
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.High) {
      columns = columns.filter(column => ['Energy', 'Average Power'].indexOf(column) === -1)
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.Moderate) {
      columns = columns.filter(column => ['Energy', 'Average Power', 'Descent'].indexOf(column) === -1)
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.Low) {
      columns = columns.filter(column => ['Energy', 'Average Power', 'Descent'].indexOf(column) === -1)
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.VeryLow) {
      columns = columns.filter(column => ['Energy', 'Average Power', 'Descent', 'Ascent'].indexOf(column) === -1)
    }

    if (this.getScreenWidthBreakPoint() === ScreenBreakPoints.Lowest) {
      columns = columns.filter(column => ['Energy', 'Average Power', 'Average Speed', 'Descent', 'Ascent', 'Descent'].indexOf(column) === -1)
    }

    return columns
  }
}
