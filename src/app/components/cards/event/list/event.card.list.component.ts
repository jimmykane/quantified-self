import {ChangeDetectionStrategy, Component, HostListener, Input, OnChanges, OnDestroy, OnInit} from '@angular/core';
import {EventInterface} from '../../../../entities/events/event.interface';
import {ActionButtonService} from '../../../../services/action-buttons/app.action-button.service';
import {ActionButton} from '../../../../services/action-buttons/app.action-button';
import {EventService} from '../../../../services/app.event.service';
import {Router} from '@angular/router';


@Component({
  selector: 'app-event-card-list',
  templateUrl: './event.card.list.component.html',
  styleUrls: ['./event.card.list.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventCardListComponent implements OnChanges, OnInit, OnDestroy {
  @Input() events: EventInterface[];
  gridListColumnCount: number;

  public eventSelectionMap: Map<EventInterface, boolean> = new Map<EventInterface, boolean>();

  constructor(private eventService: EventService, private actionButtonService: ActionButtonService, private router: Router) {
  }

  ngOnInit() {
    this.gridListColumnCount = this.getColumnsFromWidth((window.innerWidth));
  }

  ngOnChanges(): void {
  }

  @HostListener('window:resize', ['$event.target.innerWidth'])
  onResize(width) {
    this.gridListColumnCount = this.getColumnsFromWidth(width);
  }

  clickEventCard(event: EventInterface) {
    this.eventSelectionMap.set(event, !this.eventSelectionMap.get(event));
    const selectedEvents = [];
    this.eventSelectionMap.forEach((value, key, map) => {
      if (value === true) {
        selectedEvents.push(key);
      }
    });
    if (selectedEvents.length > 1) {
      this.actionButtonService.addActionButton('mergeEvents', new ActionButton(
        'compare_arrows',
        () => {
          this.eventService.mergeEvents(selectedEvents).then((mergedEvent: EventInterface) => {
            this.eventService.addEvents([mergedEvent]);
            this.actionButtonService.removeActionButton('mergeEvents');
            this.router.navigate(['/dashboard'], {queryParams: {eventID: mergedEvent.getID(), tabIndex: 0}});
          })
        },
        'material'
      ))
    } else {
      this.actionButtonService.removeActionButton('mergeEvents');
    }
  }

  ngOnDestroy() {
    this.actionButtonService.removeActionButton('mergeEvents');
  }

  private getColumnsFromWidth(width: number): number {
    if (width < 700) {
      return 1;
    } else if (width < 1000) {
      return 2;
    } else if (width < 1300) {
      return 3;
    }else {
      return 4;
    }
  }
}
