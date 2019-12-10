import {ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnDestroy, OnInit} from '@angular/core';
import {Router} from '@angular/router';
import {EventInterface} from 'quantified-self-lib/lib/events/event.interface';
// import {EventExporterTCX} from 'quantified-self-lib/lib/events/adapters/exporters/exporter.tcx';
import {EventService} from '../../services/app.event.service';
import {FileService} from '../../services/app.file.service';
import {EventFormComponent} from '../event-form/event.form.component';
import {MatDialog} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import {EventExporterJSON} from 'quantified-self-lib/lib/events/adapters/exporters/exporter.json';
import {Privacy} from 'quantified-self-lib/lib/privacy/privacy.class.interface';
import {ClipboardService} from '../../services/app.clipboard.service';
import {SharingService} from '../../services/app.sharing.service';
import {User} from 'quantified-self-lib/lib/users/user';
import {MatBottomSheet} from '@angular/material';
import {DeleteConfirmationComponent} from '../delete-confirmation/delete-confirmation.component';
import * as firebase from 'firebase/app';
import {AngularFireAnalytics} from '@angular/fire/analytics';
import {ActivityFormComponent} from '../activity-form/activity.form.component';
import {take} from 'rxjs/operators';
import {EventUtilities} from 'quantified-self-lib/lib/events/utilities/event.utilities';

@Component({
  selector: 'app-event-actions',
  templateUrl: './event.actions.component.html',
  styleUrls: ['./event.actions.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,

})
export class EventActionsComponent implements OnInit, OnDestroy {
  @Input() event: EventInterface;
  @Input() user: User;

  private deleteConfirmationSubscription;

  constructor(
    private eventService: EventService,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private snackBar: MatSnackBar,
    private clipboardService: ClipboardService,
    private sharingService: SharingService,
    private fileService: FileService,
    private deleteConfirmationBottomSheet: MatBottomSheet,
    private afa: AngularFireAnalytics,
    private dialog: MatDialog) {
  }

  ngOnInit(): void {
    if (!this.user) {
      throw new Error('User is required')
    }
  }

  async share() {
    if (this.event.privacy !== Privacy.Public) {
      await this.eventService.setEventPrivacy(this.user, this.event.getID(), Privacy.Public);
    }
    this.clipboardService.copyToClipboard(this.sharingService.getShareURLForEvent(this.user.uid, this.event.getID()));
    await this.afa.logEvent('share', {method: 'event_actions', content_type: 'event'});
    this.snackBar.open('Privacy is changed to public and link copied to your clipboard', null, {
      duration: 20000,
    })
  }

  editEventActivity() {
    const dialogRef = this.dialog.open(ActivityFormComponent, {
      width: '75vw',
      disableClose: false,
      data: {
        event: this.event,
        activity: this.event.getFirstActivity(),
        user: this.user
      },
    });
    // dialogRef.afterClosed().subscribe(result => {
    // });
  }

  async reGenerateStatistics() {
    this.snackBar.open('Re-calculating activity statistics', null, {
      duration: 2000,
    });
    // To use this component we need the full hydrated object and we might not have it
    this.event.getFirstActivity().clearStreams();
    this.event.getFirstActivity().addStreams(await this.eventService.getAllStreams(this.user, this.event.getID(), this.event.getFirstActivity().getID()).pipe(take(1)).toPromise());
    this.event.getFirstActivity().clearStats();
    EventUtilities.generateMissingStreamsAndStatsForActivity(this.event.getFirstActivity());
    EventUtilities.reGenerateStatsForEvent(this.event);
    await this.eventService.setEvent(this.user, this.event);
    this.snackBar.open('Activity and event statistics have been recalculated', null, {
      duration: 2000,
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
  //   //     duration: 2000,
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
      duration: 2000,
    });
  }

  async delete() {
    const deleteConfirmationBottomSheet = this.deleteConfirmationBottomSheet.open(DeleteConfirmationComponent, {
    });
    this.deleteConfirmationSubscription = deleteConfirmationBottomSheet.afterDismissed().subscribe(async (result) => {
      if (!result) {
        return;
      }
      await this.eventService.deleteAllEventData(this.user, this.event.getID());
      await this.router.navigate(['/dashboard']);
      this.snackBar.open('Event deleted', null, {
        duration: 2000,
      });
    });
  }

  ngOnDestroy(): void {
    if (this.deleteConfirmationSubscription){
      this.deleteConfirmationSubscription.unsubscribe()
    }
  }


}
