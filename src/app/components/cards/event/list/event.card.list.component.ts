import {ChangeDetectionStrategy, Component, Input, OnChanges} from '@angular/core';
import {EventInterface} from '../../../../entities/events/event.interface';
import {List} from 'immutable';
import {ActionButtonService} from '../../../../services/action-buttons/app.action-button.service';
import {ActionButton} from "../../../../services/action-buttons/app.action-button";
import {EventService} from "../../../../services/app.event.service";


@Component({
  selector: 'app-event-card-list',
  templateUrl: './event.card.list.component.html',
  styleUrls: ['./event.card.list.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardListComponent implements OnChanges {
  @Input() events: EventInterface[];

  public eventSelectionMap: Map<EventInterface, boolean> = new Map<EventInterface, boolean>();

  constructor(private eventService: EventService, private actionButtonService: ActionButtonService) {}

  ngOnChanges(): void {
  }

  clickEventCard(event: EventInterface) {
    this.eventSelectionMap.set(event, !this.eventSelectionMap.get(event));
    const selectedEvents = [];
    this.eventSelectionMap.forEach((value, key, map) => {
      if (value === true) {
        selectedEvents.push(key);
      }
    });
    if (selectedEvents.length > 1){
      this.actionButtonService.addActionButton('mergeEvents', new ActionButton(
        'compare_arrows',
        () => {
          this.eventService.mergeEvents(selectedEvents).then((event: EventInterface) => {
            this.eventService.addEvents([event]);
            this.actionButtonService.removeActionButton('mergeEvents');
            this.eventSelectionMap.clear();
          })
        },
        'material'
      ))
    }else {
      this.actionButtonService.removeActionButton('mergeEvents');
    }
  }
}
