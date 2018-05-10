import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input} from '@angular/core';
import {FileService} from '../../../../services/app.file.service';
import {EventService} from '../../../../services/app.event.service';
import {Router} from '@angular/router';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventUtilities} from 'quantified-self-lib/lib/events/utilities/event.utilities';
import {EventExporterTCX} from 'quantified-self-lib/lib/events/adapters/exporters/exporter.tcx';

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
    EventUtilities.getEventAsTCXBloB(event).then((blob: Blob) => {
      FileService.downloadFile(
        blob,
        event.name,
        (new EventExporterTCX).getfileExtension()
      );
    });
  }

  deleteEvent(event: EventInterface) {
    this.eventService.deleteEvent(event);
    this.router.navigate(['/dashboard']);
  }
}
