import {ChangeDetectionStrategy, Component, Input} from '@angular/core';
import {EventInterface} from '../../../../entities/events/event.interface';
import {MatTableDataSource} from "@angular/material";

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
        'Start': lap.startDate.toString(),
        'End': lap.endDate.toString(),

      });
      return lapDataArray;
    }, []));
  }

  getColumns() {
    return ['#', 'Distance', 'Start', 'End']
  }
}
