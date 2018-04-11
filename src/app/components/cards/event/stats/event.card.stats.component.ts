import {ChangeDetectionStrategy, Component, Input, OnChanges} from '@angular/core';
import {EventInterface} from '../../../../entities/events/event.interface';
import {MatTableDataSource} from "@angular/material";
import {SummaryInterface} from "../../../../entities/summary/summary.interface";
import {Summary} from "../../../../entities/summary/summary";

@Component({
  selector: 'app-event-card-stats',
  templateUrl: './event.card.stats.component.html',
  styleUrls: ['./event.card.stats.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardStatsComponent implements OnChanges {
  @Input() event: EventInterface;
  data: MatTableDataSource<Object>;
  columns: Array<Object>;

  ngOnChanges() {
    // Create table data

    const data = [];
    // Create a summary object to get the keys
    const rows = Object.keys(new Summary())
    // Filter out the intensityZones
      .filter(key => key !== 'intensityZones')
      // Create an array with rows of keys and cols of the event activities stats for the keys
      .reduce((array, key) => {
        array.push(
          this.event.getActivities().reduce((rowObj, activity, index) => {
            rowObj['Activity ' + (index + 1)] = activity.summary[key];
            return rowObj;
          }, {name: key})
        );
        return array;
      }, []);

    this.columns = (Object.keys(rows[0]));
    this.data = new MatTableDataSource(rows);
  }

}
