import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input} from '@angular/core';
import {Router} from '@angular/router';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventUtilities} from 'quantified-self-lib/lib/events/utilities/event.utilities';
import {EventExporterTCX} from 'quantified-self-lib/lib/events/adapters/exporters/exporter.tcx';
import {EventService} from '../../services/app.event.service';
import {FileService} from '../../services/app.file.service';
import {EventFormComponent} from '../event-form/event.form.component';
import {MatDialog} from '@angular/material';

@Component({
  selector: 'app-event-actions',
  templateUrl: './event.actions.component.html',
  styleUrls: ['./event.actions.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,

})
export class EventActionsComponent {
  @Input() event: EventInterface;

  constructor(private eventService: EventService, private changeDetectorRef: ChangeDetectorRef, private router: Router, public dialog: MatDialog) {
  }

  editEvent(event: EventInterface) {
    let dialogRef = this.dialog.open(EventFormComponent, {
      width: '250px',
      data: {},
    });

    dialogRef.afterClosed().subscribe(result => {
      console.log('The dialog was closed');
    });
  }

  downloadEventAsTCX(event: EventInterface) {
    EventUtilities.getEventAsTCXBloB(event).then((blob: Blob) => {
      FileService.downloadFile(
        blob,
        event.name,
        EventExporterTCX.fileExtension,
      );
    });
  }

  deleteEvent(event: EventInterface) {
    this.eventService.deleteEvent(event);
    this.router.navigate(['/dashboard']);
  }
}
