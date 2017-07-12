import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges} from '@angular/core';
import {MapsAPILoader} from '@agm/core';
import {DataPositionInterface} from '../../../../../entities/data/data.position.interface';
import {ActivityInterface} from "../../../../../entities/activities/activity.interface";

declare const google: any;


@Component({
  selector: 'app-card-map-activities',
  templateUrl: './event.card.map.activities.component.html',
  styleUrls: ['./event.card.map.activities.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardMapActivitiesComponent implements OnChanges {
  @Input() activities: ActivityInterface[];

  constructor(private changeDetectorRef: ChangeDetectorRef) {
  }

  ngOnChanges() {
  }
}

