import {ChangeDetectionStrategy, Component, Input, OnChanges} from '@angular/core';
import {EventInterface} from '../../../../entities/events/event.interface';


@Component({
  selector: 'app-event-card-list',
  templateUrl: './event.card.list.component.html',
  styleUrls: ['./event.card.list.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardListComponent implements OnChanges {
  @Input() events: EventInterface[];

  public eventSelectionMap: Map<EventInterface, boolean> = new Map<EventInterface, boolean>();

  ngOnChanges(): void {
  }

  clickEventCard(event: EventInterface) {
    this.eventSelectionMap.set(event, !this.eventSelectionMap.get(event));
  }
}
