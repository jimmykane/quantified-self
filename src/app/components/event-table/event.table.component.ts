import {ChangeDetectionStrategy, Component, HostListener, Input, OnChanges, OnDestroy, OnInit} from '@angular/core';
import {EventInterface} from '../../entities/events/event.interface';
import {ActionButtonService} from '../../services/action-buttons/app.action-button.service';
import {ActionButton} from '../../services/action-buttons/app.action-button';
import {EventService} from '../../services/app.event.service';
import {Router} from '@angular/router';
import {MatSnackBar} from '@angular/material';
import {EventUtilities} from '../../entities/events/utilities/event.utilities';


@Component({
  selector: 'app-event-card-list',
  templateUrl: './event.table.component.html',
  styleUrls: ['./event.table.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class EventTableComponent implements OnChanges, OnInit, OnDestroy {
  @Input() events: EventInterface[];

  public eventSelectionMap: Map<EventInterface, boolean> = new Map<EventInterface, boolean>();

  constructor(private snackBar: MatSnackBar, private eventService: EventService, private actionButtonService: ActionButtonService, private router: Router) {
  }

  ngOnInit() {
  }

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
    if (selectedEvents.length > 1) {
      this.actionButtonService.addActionButton('mergeEvents', new ActionButton(
        'compare_arrows',
        () => {
          this.actionButtonService.removeActionButton('mergeEvents');
          EventUtilities.mergeEvents(selectedEvents).then((mergedEvent: EventInterface) => {
            this.actionButtonService.removeActionButton('mergeEvents');
            this.eventService.addAndSaveEvent(mergedEvent);
            this.eventSelectionMap.clear();
            this.router.navigate(['/dashboard'], {
              queryParams: {
                eventID: mergedEvent.getID(),
                tabIndex: 0
              }
            }).then(() => {
              this.snackBar.open('Events merged', null, {
                duration: 5000,
              });
            });
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
}
