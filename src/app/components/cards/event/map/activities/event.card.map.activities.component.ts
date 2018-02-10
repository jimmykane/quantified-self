import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges} from '@angular/core';
import {EventInterface} from '../../../../../entities/events/event.interface';
import {EventService} from '../../../../../services/app.event.service';



@Component({
  selector: 'app-event-card-map-activities',
  templateUrl: './event.card.map.activities.component.html',
  styleUrls: ['./event.card.map.activities.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardMapActivitiesComponent implements OnChanges {
  @Input() event: EventInterface;

  constructor(private changeDetectorRef: ChangeDetectorRef, public eventService: EventService) {
  }

  ngOnChanges() {
  }
}

