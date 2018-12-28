import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
import {EventUtilities} from 'quantified-self-lib/lib/events/utilities/event.utilities';
// import {EventExporterTCX} from 'quantified-self-lib/lib/events/adapters/exporters/exporter.tcx';
import {EventService} from '../../services/app.event.service';
import {FileService} from '../../services/app.file.service';
import {EventFormComponent} from '../event-form/event.form.component';
import {MatDialog, MatSnackBar} from '@angular/material';
import {EventExporterJSON} from 'quantified-self-lib/lib/events/adapters/exporters/exporter.json';
import {AppUser} from '../../authentication/app.auth.service';

@Component({
  selector: 'app-event-actions',
  templateUrl: './event.actions.component.html',
  styleUrls: ['./event.actions.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,

})
export class EventActionsComponent implements OnInit{
  @Input() event: EventInterface;
  @Input() user: AppUser;

  constructor(
    private eventService: EventService,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private snackBar: MatSnackBar,
    public dialog: MatDialog) {
  }

  ngOnInit(): void {
    if (!this.user){
      throw "User is required"
    }
  }

  editEvent() {
    const dialogRef = this.dialog.open(EventFormComponent, {
      width: '75vh',
      disableClose: true,
      data: {event: this.event},
    });

    dialogRef.afterClosed().subscribe(result => {
      console.log('The dialog was closed');
    });
  }

  // downloadEventAsTCX(event: EventInterface) {
  //   // EventUtilities.getEventAsTCXBloB(event).then((blob: Blob) => {
  //   //   FileService.downloadFile(
  //   //     blob,
  //   //     event.name,
  //   //     EventExporterTCX.fileExtension,
  //   //   );
  //   //   this.snackBar.open('File served', null, {
  //   //     duration: 5000,
  //   //   });
  //   // });
  // }

  downloadEventAsJSON() {
    this.eventService.getEventAsJSONBloB(this.user, this.event.getID()).then((blob: Blob) => {
      FileService.downloadFile(
        blob,
        this.event.name,
        EventExporterJSON.fileExtension,
      );
      this.snackBar.open('File served', null, {
        duration: 5000,
      });
    });
  }

  deleteEvent() {
    this.eventService.deleteEventForUser(this.user, this.event.getID());
    this.router.navigate(['/dashboard']);
    this.snackBar.open('Event deleted', null, {
      duration: 5000,
    });
  }
}
