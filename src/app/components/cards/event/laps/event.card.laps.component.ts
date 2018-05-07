import {ChangeDetectionStrategy, Component, Input, OnChanges} from '@angular/core';
import {EventInterface} from '../../../../entities/events/event.interface';
import {MatTableDataSource} from '@angular/material';
import {DataHeartRateAvg} from '../../../../entities/data/data.heart-rate-avg';
import {DataAscent} from '../../../../entities/data/data.ascent';
import {DataDescent} from '../../../../entities/data/data.descent';
import {DataDistance} from '../../../../entities/data/data.distance';
import {ActivityInterface} from '../../../../entities/activities/activity.interface';

@Component({
  selector: 'app-event-card-laps',
  templateUrl: './event.card.laps.component.html',
  styleUrls: ['./event.card.laps.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class EventCardLapsComponent implements OnChanges {
  @Input() event: EventInterface;
  @Input() selectedActivities: ActivityInterface[];

  ngOnChanges() {
    debugger;
  }

  getData(activity) {
    return new MatTableDataSource(activity.getLaps().reduce((lapDataArray, lap, index) => {
      const lapObj = {
        '#': index + 1,
        'Type': lap.type,
        'Start Time': lap.startDate.toLocaleTimeString(),
        'End Time': lap.endDate.toLocaleTimeString(),
        'Duration': lap.getDuration().getDisplayValue(),
      };
      if (lap.getDistance()) {
        lapObj[DataDistance.type] = lap.getDistance().getDisplayValue() + lap.getDistance().getDisplayUnit();
      }
      if (lap.getStat(DataAscent.className)) {
        lapObj[DataAscent.type] = lap.getStat(DataAscent.className).getDisplayValue() + ' ' + lap.getStat(DataAscent.className).getDisplayUnit();
      }
      if (lap.getStat(DataDescent.className)) {
        lapObj[DataDescent.type] = lap.getStat(DataDescent.className).getDisplayValue() + ' ' + lap.getStat(DataDescent.className).getDisplayUnit();
      }
      if (lap.getStat(DataHeartRateAvg.className)) {
        lapObj[DataHeartRateAvg.type] = lap.getStat(DataHeartRateAvg.className).getDisplayValue() + ' ' + lap.getStat(DataHeartRateAvg.className).getDisplayUnit();
      }
      lapDataArray.push(lapObj);
      return lapDataArray;
    }, []));
  }

  getColumns(activity) {
    return Object.keys(this.getData(activity).data[0]);
  }
}
