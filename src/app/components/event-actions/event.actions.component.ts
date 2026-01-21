import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnDestroy, OnInit, inject, Output, EventEmitter } from '@angular/core';
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
import { ActivityFormComponent } from '../activity-form/activity.form.component';
import { take } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { EventUtilities } from '@sports-alliance/sports-lib';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatIconModule } from '@angular/material/icon';
import { AppAnalyticsService } from '../../services/app.analytics.service';

import { DataDistance } from '@sports-alliance/sports-lib';
import { environment } from '../../../environments/environment';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Auth, getIdToken } from '@angular/fire/auth';

import { ServiceNames, GarminAPIEventMetaData } from '@sports-alliance/sports-lib';
import { EventExporterGPX } from '@sports-alliance/sports-lib';
import { DataStartPosition } from '@sports-alliance/sports-lib';
import { ActivityUtilities } from '@sports-alliance/sports-lib';
import { AppWindowService } from '../../services/app.window.service';
import { LoggerService } from '../../services/logger.service';

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



  public garminAPIServiceMetaData!: GarminAPIEventMetaData;
  private deleteConfirmationSubscription!: Subscription;

  private auth = inject(Auth);
  private analyticsService = inject(AppAnalyticsService);
  private logger = inject(LoggerService);


  constructor(
    private eventService: AppEventService,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private snackBar: MatSnackBar,
    private clipboardService: Clipboard,
    private sharingService: AppSharingService,
    private fileService: AppFileService,
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


    this.garminAPIServiceMetaData = <GarminAPIEventMetaData>(await this.eventService.getEventMetaData(this.user, this.event.getID(), ServiceNames.GarminAPI)
      .pipe(take(1)).toPromise());
    this.changeDetectorRef.detectChanges();
  }

  async share() {
    if (this.event.privacy !== Privacy.Public) {
      await this.eventService.setEventPrivacy(this.user, this.event.getID(), Privacy.Public);
    }
    this.clipboardService.copy(this.sharingService.getShareURLForEvent(this.user.uid, this.event.getID()));
    this.analyticsService.logEvent('share', { method: 'event_actions', content_type: 'event', item_id: this.event.getID() });
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



  isHydrated() {
    const activities = this.event.getActivities();
    return activities.length > 0 && activities[0].getAllStreams().length > 0;
  }

  hasDistance() {
    const activities = this.event.getActivities();
    return activities.length > 0 && activities[0].hasStreamData(DataDistance.type);
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
    // We attach streams from the original file (if exists) instead of Firestore
    await this.eventService.attachStreamsToEventWithActivities(this.user, this.event as any).pipe(take(1)).toPromise();

    this.event.getActivities().forEach(activity => {
      activity.clearStats();
      ActivityUtilities.generateMissingStreamsAndStatsForActivity(activity);
    });

    EventUtilities.reGenerateStatsForEvent(this.event);
    await this.eventService.writeAllEventData(this.user, this.event);
    this.snackBar.open('Activity and event statistics have been recalculated', undefined, {
      duration: 2000,
    });
    this.changeDetectorRef.detectChanges();
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
    const blob = await this.eventService.getEventAsJSONBloB(this.user, this.event as any);
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
    const blob = await this.eventService.getEventAsGPXBloB(this.user, this.event as any);
    this.fileService.downloadFile(
      blob,
      this.getFileName(this.event),
      new EventExporterGPX().fileExtension,
    );
    this.analyticsService.logEvent('downloaded_gpx_file');
    this.snackBar.open('GPX file served', undefined, {
      duration: 2000,
    });
  }



  async downloadOriginals() {
    this.snackBar.open('Preparing download...', undefined, { duration: 2000 });
    try {
      const eventAny = this.event as any;
      const eventDate = this.fileService.toDate(this.event.startDate);
      const eventId = this.event.getID ? this.event.getID() : undefined;

      if (eventAny.originalFiles && eventAny.originalFiles.length > 1) {
        // Multiple files -> ZIP
        const filesToZip: { data: ArrayBuffer, fileName: string }[] = [];
        const totalFiles = eventAny.originalFiles.length;

        for (let i = 0; i < totalFiles; i++) {
          const fileMeta = eventAny.originalFiles[i];
          const arrayBuffer = await this.eventService.downloadFile(fileMeta.path);
          const extension = this.fileService.getExtensionFromPath(fileMeta.path);
          // Use fileMeta.startDate if available, fallback to eventDate
          const fileDate = this.fileService.toDate(fileMeta.startDate) || eventDate;
          const fileName = this.fileService.generateDateBasedFilename(
            fileDate, extension, i + 1, totalFiles, eventId
          );
          filesToZip.push({ data: arrayBuffer, fileName });
        }

        const zipFileName = this.fileService.generateDateRangeZipFilename(eventDate, eventDate);
        await this.fileService.downloadAsZip(filesToZip, zipFileName);
        this.analyticsService.logEvent('downloaded_original_files_zip');

      } else if ((eventAny.originalFiles && eventAny.originalFiles.length === 1) ||
        (eventAny.originalFile && eventAny.originalFile.path)) {
        // Single file -> Direct download
        const fileMeta = eventAny.originalFiles?.[0] || eventAny.originalFile;
        const arrayBuffer = await this.eventService.downloadFile(fileMeta.path);
        const extension = this.fileService.getExtensionFromPath(fileMeta.path);
        const fileName = this.fileService.generateDateBasedFilename(eventDate, extension, undefined, undefined, eventId);
        const blob = new Blob([arrayBuffer]);
        // Download with basename (without extension) and extension separately
        const baseNameWithoutExt = fileName.replace(`.${extension}`, '');
        this.fileService.downloadFile(blob, baseNameWithoutExt, extension);
        this.analyticsService.logEvent('downloaded_original_file');
      } else {
        this.snackBar.open('No original files found.', undefined, { duration: 3000 });
      }
    } catch (error: any) {
      this.logger.error('Download failed', error);
      this.snackBar.open('Failed to download original files.', undefined, { duration: 3000 });
      this.logger.error(error);
    }
  }



  async delete() {
    const dialogRef = this.dialog.open(DeleteConfirmationComponent);
    this.deleteConfirmationSubscription = dialogRef.afterClosed().subscribe(async (result) => {
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

  private getFileName(event: EventInterface): string {
    const eventDate = this.fileService.toDate(event.startDate);
    const dateStr = eventDate ? eventDate.toISOString() : 'unknown';
    return `${dateStr}#${event.getActivityTypesAsString()}`
  }

}
