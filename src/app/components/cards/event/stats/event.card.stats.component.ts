import {ChangeDetectionStrategy, Component, Input, OnChanges} from '@angular/core';
import {MatTableDataSource} from '@angular/material';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {ActivityInterface} from 'quantified-self-lib/lib/activities/activity.interface';
import {DataInterface} from 'quantified-self-lib/lib/data/data.interface';

@Component({
  selector: 'app-event-card-stats',
  templateUrl: './event.card.stats.component.html',
  styleUrls: ['./event.card.stats.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class EventCardStatsComponent implements OnChanges {
  @Input() event: EventInterface;
  @Input() selectedActivites: ActivityInterface[];
  data: MatTableDataSource<Object>;
  columns: Array<Object>;

  ngOnChanges() {
    if (!this.selectedActivites.length) {
      this.data = new MatTableDataSource<Object>();
      this.columns = [];
      return;
    }

    // Collect all the stat types from all the activities
    const stats = this.selectedActivites.reduce((statsMap, activity) => {
      Array.from(activity.getStats().values()).forEach((stat) => {
        statsMap.set(stat.getClassName(), stat);
      });
      return statsMap;
    }, new Map<string, DataInterface>());

    // Create the data as rows
    const data = Array.from(stats.values()).reduce((array, stat) => {
      array.push(
        this.selectedActivites.reduce((rowObj, activity, index) => {
          const activityStat = activity.getStat(stat.getClassName());
          rowObj['#' + index + ' ' + activity.creator.name] =
            (activityStat ? activityStat.getDisplayValue() : '') +
            ' ' +
            (activityStat ? activityStat.getDisplayUnit() : '');
          return rowObj;
        }, {Name: stat.getType()}),
      );
      return array;
    }, []);

    // Get the columns
    this.columns = (Object.keys(data[0]));
    // Set the data
    this.data = new MatTableDataSource(data);
  }

  applyFilter(filterValue: string) {
    filterValue = filterValue.trim(); // Remove whitespace
    filterValue = filterValue.toLowerCase(); // MatTableDataSource defaults to lowercase matches
    this.data.filter = filterValue;
  }
}
