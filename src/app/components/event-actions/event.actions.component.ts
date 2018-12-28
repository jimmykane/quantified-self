import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
// import {EventExporterTCX} from 'quantified-self-lib/lib/events/adapters/exporters/exporter.tcx';
import {EventService} from '../../services/app.event.service';
import {FileService} from '../../services/app.file.service';
import {EventFormComponent} from '../event-form/event.form.component';
import {MatDialog, MatSnackBar} from '@angular/material';
import {EventExporterJSON} from 'quantified-self-lib/lib/events/adapters/exporters/exporter.json';
import {AppUser} from '../../authentication/app.auth.service';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';

@Component({
  selector: 'app-event-actions',
  templateUrl: './event.actions.component.html',
  styleUrls: ['./event.actions.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,

})
export class EventActionsComponent implements OnInit {
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
    if (!this.user) {
      throw "User is required"
    }
  }

  async share() {
    if (this.event.privacy !== Privacy.public) {
      await this.eventService.updateEventProperties(this.user, this.event.getID(), {privacy: Privacy.public});
    }
    const toCopy = String(`${window.location.protocol}//${window.location.host}/event?shareID=${btoa(`userID=${this.user.uid}&eventID=${this.event.getID()}`)}`);
    this.copyToClipboard(toCopy);
    this.snackBar.open('Share Url Copied to clipboard', 'copied!', {
      duration: 10000,
    });
  }

  edit() {
    const dialogRef = this.dialog.open(EventFormComponent, {
      width: '75vh',
      disableClose: true,
      data: {event: this.event},
    });

    dialogRef.afterClosed().subscribe(result => {
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

  download() {
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

  delete() {
    this.eventService.deleteEventForUser(this.user, this.event.getID());
    this.router.navigate(['/dashboard']);
    this.snackBar.open('Event deleted', null, {
      duration: 5000,
    });
  }

  private copyToClipboard(text: string) {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
}
