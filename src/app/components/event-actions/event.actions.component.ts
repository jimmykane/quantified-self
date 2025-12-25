import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { EventInterface } from '@sports-alliance/sports-lib';
import { AppEventService } from '../../services/app.event.service';
import { AppFileService } from '../../services/app.file.service';
import { EventFormComponent } from '../event-form/event.form.component';
import { EventExporterJSON } from '@sports-alliance/sports-lib';
import { Privacy } from '@sports-alliance/sports-lib';
import { AppSharingService } from '../../services/app.sharing.service';
import { User } from '@sports-alliance/sports-lib';
import { DeleteConfirmationComponent } from '../delete-confirmation/delete-confirmation.component';
import { Analytics, logEvent } from '@angular/fire/analytics';
import { ActivityFormComponent } from '../activity-form/activity.form.component';
import { take } from 'rxjs/operators';
import { EventUtilities } from '@sports-alliance/sports-lib';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatDialog } from '@angular/material/dialog';
import { Clipboard } from '@angular/cdk/clipboard';
import { ActivityCropFormComponent } from '../activity-crop-form/activity.crop.form.component';
import { DataDistance } from '@sports-alliance/sports-lib';
import { environment } from '../../../environments/environment';
import * as Sentry from '@sentry/browser';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Auth, getIdToken } from '@angular/fire/auth';
import {
  GarminHealthAPIEventMetaDataInterface,
  ServiceNames,
  SuuntoAppEventMetaDataInterface
} from '@sports-alliance/sports-lib';
import { EventExporterGPX } from '@sports-alliance/sports-lib';
import { DataStartPosition } from '@sports-alliance/sports-lib';
import { ActivityUtilities } from '@sports-alliance/sports-lib';
import { AppWindowService } from '../../services/app.window.service';

@Component({
  selector: 'app-event-actions',
  templateUrl: './event.actions.component.html',
  styleUrls: ['./event.actions.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class EventActionsComponent implements OnInit, OnDestroy {
  @Input() event!: EventInterface;
  @Input() user!: User;
  @Input() showDownloadOriginal = false;

  public suuntoAppServiceMetaData: SuuntoAppEventMetaDataInterface;

  public garminHealthAPIServiceMetaData: GarminHealthAPIEventMetaDataInterface;
  private deleteConfirmationSubscription;
  private auth = inject(Auth);
  private analytics = inject(Analytics);


  constructor(
    private eventService: AppEventService,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private snackBar: MatSnackBar,
    private clipboardService: Clipboard,
    private sharingService: AppSharingService,
    private fileService: AppFileService,
    private deleteConfirmationBottomSheet: MatBottomSheet,
    private http: HttpClient,
    private windowService: AppWindowService,
    private dialog: MatDialog) {
  }

  async ngOnInit() {
    if (!this.user) {
      throw new Error('User is required')
    }

  }

  async menuOpen(event) {
    if (!this.showDownloadOriginal) {
      return;
    }
    if (this.suuntoAppServiceMetaData) {
      return;
    }
    this.suuntoAppServiceMetaData = <SuuntoAppEventMetaDataInterface>(await this.eventService.getEventMetaData(this.user, this.event.getID(), ServiceNames.SuuntoApp)
      .pipe(take(1)).toPromise());

    this.garminHealthAPIServiceMetaData = <GarminHealthAPIEventMetaDataInterface>(await this.eventService.getEventMetaData(this.user, this.event.getID(), ServiceNames.GarminHealthAPI)
      .pipe(take(1)).toPromise());
    this.changeDetectorRef.detectChanges();
  }

  async share() {
    if (this.event.privacy !== Privacy.Public) {
      await this.eventService.setEventPrivacy(this.user, this.event.getID(), Privacy.Public);
    }
    this.clipboardService.copy(this.sharingService.getShareURLForEvent(this.user.uid, this.event.getID()));
    logEvent(this.analytics, 'share', { method: 'event_actions', content_type: 'event' });
    this.snackBar.open('Privacy is changed to public and link copied to your clipboard', undefined, {
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
  }

  cropEventActivity() {
    const dialogRef = this.dialog.open(ActivityCropFormComponent, {
      width: '75vw',
      disableClose: false,
      data: {
        event: this.event,
        activity: this.event.getFirstActivity(),
        user: this.user
      },
    });
  }

  hasDistance() {
    return this.event.getFirstActivity().hasStreamData(DataDistance.type);
  }

  hasPositionalData() {
    return this.event.getStat(DataStartPosition.type) || this.event.getActivities().filter(activity => activity.hasPositionData()).length > 0
  }

  editEvent() {
    const dialogRef = this.dialog.open(EventFormComponent, {
      width: '75vw',
      disableClose: false,
      data: {
        event: this.event,
        user: this.user
      },
    });
  }

  async reGenerateStatistics() {
    this.snackBar.open('Re-calculating activity statistics', undefined, {
      duration: 2000,
    });
    // To use this component we need the full hydrated object and we might not have it
    this.event.getFirstActivity().clearStreams();
    this.event.getFirstActivity().addStreams(await this.eventService.getAllStreams(this.user, this.event.getID(), this.event.getFirstActivity().getID()).pipe(take(1)).toPromise());
    this.event.getFirstActivity().clearStats();
    ActivityUtilities.generateMissingStreamsAndStatsForActivity(this.event.getFirstActivity());
    EventUtilities.reGenerateStatsForEvent(this.event);
    await this.eventService.writeAllEventData(this.user, this.event);
    this.snackBar.open('Activity and event statistics have been recalculated', undefined, {
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

  async downloadJSON() {
    const blob = await this.eventService.getEventAsJSONBloB(this.user, this.event.getID());
    this.fileService.downloadFile(
      blob,
      this.getFileName(this.event),
      new EventExporterJSON().fileExtension,
    );
    this.snackBar.open('JSON file served', undefined, {
      duration: 2000,
    });
  }

  async downloadGPX() {
    const blob = await this.eventService.getEventAsGPXBloB(this.user, this.event.getID());
    this.fileService.downloadFile(
      blob,
      this.getFileName(this.event),
      new EventExporterGPX().fileExtension,
    );
    logEvent(this.analytics, 'downloaded_gpx_file');
    this.snackBar.open('GPX file served', undefined, {
      duration: 2000,
    });
  }

  async downloadSuuntoFIT() {
    try {
      const result = await this.http.post(
        environment.functions.getSuuntoFITFile,
        {
          firebaseAuthToken: await getIdToken(this.auth.currentUser, true),
          workoutID: this.suuntoAppServiceMetaData.serviceWorkoutID,
          userName: this.suuntoAppServiceMetaData.serviceUserName,
        },
        {
          headers:
            new HttpHeaders({
              'Authorization': await getIdToken(this.auth.currentUser, true)
            }),
          responseType: 'arraybuffer',
        }).toPromise();
      this.fileService.downloadFile(new Blob([new Uint8Array(result)], { type: 'application/octet-stream' }), `${this.getFileName(this.event)}#${this.suuntoAppServiceMetaData.serviceWorkoutID}`, 'fit');
      this.snackBar.open('Download started', undefined, {
        duration: 2000,
      });
      logEvent(this.analytics, 'downloaded_fit_file', { method: ServiceNames.SuuntoApp });
    } catch (e) {
      this.snackBar.open(`Could not download original fit file due to ${e.message}`, undefined, {
        duration: 5000,
      });
      Sentry.captureException(e);
    }
  }

  async downloadOriginals() {
    this.snackBar.open('Preparing download...', undefined, { duration: 2000 });
    try {
      const eventAny = this.event as any;
      if (eventAny.originalFiles && eventAny.originalFiles.length > 0) {
        // Multiple files -> ZIP
        const filesToZip = [];
        for (const fileMeta of eventAny.originalFiles) {
          const arrayBuffer = await this.eventService.downloadFile(fileMeta.path);
          const parts = fileMeta.path.split('/');
          const fileName = parts[parts.length - 1]; // Use basename
          filesToZip.push({ data: arrayBuffer, fileName });
        }
        await this.fileService.downloadAsZip(filesToZip, `${this.getFileName(this.event)}.zip`);
        logEvent(this.analytics, 'downloaded_original_files_zip');

      } else if (eventAny.originalFile && eventAny.originalFile.path) {
        // Single file -> Direct download
        const arrayBuffer = await this.eventService.downloadFile(eventAny.originalFile.path);
        const parts = eventAny.originalFile.path.split('.');
        const ext = parts[parts.length - 1];
        const blob = new Blob([arrayBuffer]); // Type unknown, default blob
        this.fileService.downloadFile(blob, this.getFileName(this.event), ext);
        logEvent(this.analytics, 'downloaded_original_file');
      } else {
        this.snackBar.open('No original files found.', undefined, { duration: 3000 });
      }
    } catch (error: any) {
      console.error('Download failed', error);
      this.snackBar.open('Failed to download original files.', undefined, { duration: 3000 });
      Sentry.captureException(error);
    }
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
      this.snackBar.open('Event deleted', undefined, {
        duration: 2000,
      });
    });
  }

  ngOnDestroy(): void {
    if (this.deleteConfirmationSubscription) {
      this.deleteConfirmationSubscription.unsubscribe()
    }
  }

  private getFileName(event): string {
    return `${this.event.startDate.toISOString()}#${this.event.getActivityTypesAsString()}`
  }

}
