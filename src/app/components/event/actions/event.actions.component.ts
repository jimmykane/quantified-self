import {ChangeDetectionStrategy, Component, Input} from '@angular/core';
import {FileService} from '../../../services/app.file.service';
import {EventService} from '../../../services/app.event.service';
import {EventExporterTCX} from '../../../entities/events/adapters/exporters/exporter.tcx';
import {EventInterface} from '../../../entities/events/event.interface';
import {Router} from '@angular/router';

@Component({
  selector: 'app-event-actions',
  templateUrl: './event.actions.component.html',
  styleUrls: ['./event.actions.component.css'],
  providers: [],
    changeDetection: ChangeDetectionStrategy.OnPush

})
export class EventActionsComponent {
  @Input() event: EventInterface;

  constructor(private eventService: EventService, private router: Router) {
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

  deleteEvent(event: EventInterface) {
    this.eventService.deleteEvent(event);
    this.router.navigate(['/dashboard']);
  }
}
