import {ChangeDetectionStrategy, Component, Input, OnChanges} from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {DataDistance} from 'quantified-self-lib/lib/data/data.distance';
import {DataAscent} from 'quantified-self-lib/lib/data/data.ascent';
import {DataDescent} from 'quantified-self-lib/lib/data/data.descent';
import {DataHeartRateAvg} from 'quantified-self-lib/lib/data/data.heart-rate-avg';

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
  }

  getData(activity) {
    return new MatTableDataSource(activity.getLaps().reduce((lapDataArray, lap, index) => {
      const lapObj = {
        '#': index + 1,
        'Type': lap.type,
        'Start Time': lap.startDate.toLocaleTimeString(),
        // 'End Time': lap.endDate.toLocaleTimeString(),
        'Duration': lap.getDuration().getDisplayValue(),
      };
      if (lap.getDistance()) {
        lapObj[DataDistance.type] = lap.getDistance().getDisplayValue() + lap.getDistance().getDisplayUnit();
      }
      if (lap.getStat(DataAscent.type)) {
        lapObj[DataAscent.type] = lap.getStat(DataAscent.type).getDisplayValue() + ' ' + lap.getStat(DataAscent.type).getDisplayUnit();
      }
      if (lap.getStat(DataDescent.type)) {
        lapObj[DataDescent.type] = lap.getStat(DataDescent.type).getDisplayValue() + ' ' + lap.getStat(DataDescent.type).getDisplayUnit();
      }
      if (lap.getStat(DataHeartRateAvg.type)) {
        lapObj[DataHeartRateAvg.type] = lap.getStat(DataHeartRateAvg.type).getDisplayValue() + ' ' + lap.getStat(DataHeartRateAvg.type).getDisplayUnit();
      }
      lapDataArray.push(lapObj);
      return lapDataArray;
    }, []));
  }

  getColumns(activity) {
    return Object.keys(this.getData(activity).data[0]);
  }
}
