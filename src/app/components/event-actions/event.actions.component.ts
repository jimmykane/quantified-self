import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
// import {EventExporterTCX} from 'quantified-self-lib/lib/events/adapters/exporters/exporter.tcx';
import {EventService} from '../../services/app.event.service';
import {FileService} from '../../services/app.file.service';
import {EventFormComponent} from '../event-form/event.form.component';
import {MatDialog, MatSnackBar} from '@angular/material';
import {EventExporterJSON} from 'quantified-self-lib/lib/events/adapters/exporters/exporter.json';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';
import {ClipboardService} from '../../services/app.clipboard.service';
import {SharingService} from '../../services/app.sharing.service';
import {User} from 'quantified-self-lib/lib/users/user';

@Component({
  selector: 'app-event-actions',
  templateUrl: './event.actions.component.html',
  styleUrls: ['./event.actions.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,

})
export class EventActionsComponent implements OnInit {
  @Input() event: EventInterface;
  @Input() user: User;

  constructor(
    private eventService: EventService,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private snackBar: MatSnackBar,
    private clipboardService: ClipboardService,
    private sharingService: SharingService,
    private fileService: FileService,
    private dialog: MatDialog) {
  }

  ngOnInit(): void {
    if (!this.user) {
      throw "User is required"
    }
  }

  async share() {
    if (this.event.privacy !== Privacy.public) {
      this.eventService.updateEventProperties(this.user, this.event.getID(), {privacy: Privacy.public});
    }
    this.clipboardService.copyToClipboard(this.sharingService.getShareURLForEvent(this.user.uid, this.event.getID()));
    this.snackBar.open('Privacy is changed to public and link copied to your keyboard', 'go to share link', {
      duration: 10000,
    }).onAction().toPromise().then(() => {

    });
  }

  edit() {
    const dialogRef = this.dialog.open(EventFormComponent, {
      width: '75vh',
      disableClose: true,
      data: {
        event: this.event,
        user: this.user
      },
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

  async download() {
    const blob = await this.eventService.getEventAsJSONBloB(this.user, this.event.getID());
    this.fileService.downloadFile(
      blob,
      this.event.name,
      EventExporterJSON.fileExtension,
    );
    this.snackBar.open('File served', null, {
      duration: 5000,
    });
  }

  async delete() {
    await this.eventService.deleteEventForUser(this.user, this.event.getID());
    await this.router.navigate(['/dashboard']);
    this.snackBar.open('Event deleted', null, {
      duration: 5000,
    });
  }
}
