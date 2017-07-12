import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input} from '@angular/core';
import {FileService} from '../../../../services/app.file.service';
import {EventService} from '../../../../services/app.event.service';
import {EventExporterTCX} from '../../../../entities/events/adapters/exporters/exporter.tcx';
import {EventInterface} from '../../../../entities/events/event.interface';
import {Router} from '@angular/router';

@Component({
  selector: 'app-event-card-actions-menu',
  templateUrl: './event.card.actions.menu.component.html',
  styleUrls: ['./event.card.actions.menu.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush

})
export class EventCardActionsMenuComponent {
  @Input() event: EventInterface;

  constructor(private eventService: EventService, private changeDetectorRef: ChangeDetectorRef, private router: Router) {
  }

  downloadEventAsTCX(event: EventInterface) {
    EventService.getEventAsTCXBloB(event).then((blob: Blob) => {
      FileService.downloadFile(
        blob,
        event.getName(),
        (new EventExporterTCX).getfileExtension()
      );
    });
  }

  mergeAllEventActivities(event: EventInterface) {
    this.eventService.mergeAllEventActivities(event).then((mergedActivitiesEvent: EventInterface) => {
      this.eventService.saveEvent(mergedActivitiesEvent);
      this.router.navigate(['/dashboard'], {queryParams: {eventID: mergedActivitiesEvent.getID(), tabIndex: 0}});
    });
  }

  deleteEvent(event: EventInterface) {
    this.eventService.deleteEvent(event);
    this.router.navigate(['/dashboard']);
  }
}
