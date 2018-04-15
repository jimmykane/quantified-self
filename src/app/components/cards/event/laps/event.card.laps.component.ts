import {ChangeDetectionStrategy, Component, Input} from '@angular/core';
import {EventInterface} from '../../../../entities/events/event.interface';
import {MatTableDataSource} from '@angular/material';
import {DataHeartRateAvg} from '../../../../entities/data/data.heart-rate-avg';
import {DataAscent} from '../../../../entities/data/data.ascent';
import {DataDescent} from '../../../../entities/data/data.descent';

@Component({
  selector: 'app-event-card-laps',
  templateUrl: './event.card.laps.component.html',
  styleUrls: ['./event.card.laps.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardLapsComponent {
  @Input() event: EventInterface;

  // // Get the columns
  //   this.columns = (Object.keys(data[0]));
  //   // Set the data
  //   this.data = new MatTableDataSource(data);
  getData(activity) {
    return new MatTableDataSource(activity.getLaps().reduce((lapDataArray, lap, index) => {
      lapDataArray.push({
        '#': index,
        'Distance': lap.getDistance().getDisplayValue() + lap.getDistance().getDisplayUnit(),
        'Start Time': lap.startDate.toLocaleTimeString(),
        'End Time': lap.endDate.toLocaleTimeString(),
        [DataAscent.type]: lap.getStat(DataAscent.className).getDisplayValue() + ' ' + lap.getStat(DataAscent.className).getDisplayUnit(),
        [DataDescent.type]: lap.getStat(DataDescent.className).getDisplayValue() + ' ' + lap.getStat(DataDescent.className).getDisplayUnit(),
        [DataHeartRateAvg.type]: lap.getStat(DataHeartRateAvg.className).getDisplayValue() + ' ' + lap.getStat(DataHeartRateAvg.className).getDisplayUnit(),
      });
      return lapDataArray;
    }, []));
  }

  getColumns() {
    return ['#', 'Distance', 'Start Time', 'End Time', DataAscent.type, DataDescent.type, DataHeartRateAvg.type]
  }
}
