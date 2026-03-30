import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnDestroy, OnInit, inject, Output, EventEmitter } from '@angular/core';
import { Router } from '@angular/router';
import { EventInterface } from '@sports-alliance/sports-lib';
import { AppEventService } from '../../services/app.event.service';
import { AppFileService } from '../../services/app.file.service';
import { EventFormComponent } from '../event-form/event.form.component';
import { EventExporterJSON } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
import { ConfirmationDialogComponent, ConfirmationDialogData } from '../confirmation-dialog/confirmation-dialog.component';
import { take } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { AppAnalyticsService } from '../../services/app.analytics.service';

import { DataDistance } from '@sports-alliance/sports-lib';
import { environment } from '../../../environments/environment';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Auth, getIdToken } from 'app/firebase/auth';

import { ServiceNames, GarminAPIEventMetaData } from '@sports-alliance/sports-lib';
import { EventExporterGPX } from '@sports-alliance/sports-lib';
import { DataStartPosition } from '@sports-alliance/sports-lib';
import { AppWindowService } from '../../services/app.window.service';
import { LoggerService } from '../../services/logger.service';
import {
  AppEventReprocessService,
  ReprocessError,
  ReprocessPhase,
  ReprocessProgress
} from '../../services/app.event-reprocess.service';
import { AppProcessingService } from '../../services/app.processing.service';

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

  public isReprocessing = false;

  public garminAPIServiceMetaData!: GarminAPIEventMetaData;
  private deleteConfirmationSubscription!: Subscription;

  private auth = inject(Auth);
  private analyticsService = inject(AppAnalyticsService);
  private logger = inject(LoggerService);
  private eventReprocessService = inject(AppEventReprocessService);
  private processingService = inject(AppProcessingService);


  constructor(
    private eventService: AppEventService,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private snackBar: MatSnackBar,
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

  isHydrated() {
    const activities = this.event.getActivities();
    return activities.some(activity => activity.getAllStreams().length > 0);
  }

  hasDistance() {
    const activities = this.event.getActivities();
    return activities.some(activity => activity.hasStreamData(DataDistance.type));
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

  public canReimportFromOriginalFile(): boolean {
    const eventAny = this.event as any;
    return !!((eventAny.originalFiles && eventAny.originalFiles.length > 0) ||
      (eventAny.originalFile && eventAny.originalFile.path));
  }

  public getReimportDisabledReason(): string {
    if (this.canReimportFromOriginalFile()) {
      return '';
    }
    return 'No original source files available for this event';
  }

  async reGenerateStatistics() {
    if (this.isReprocessing) {
      return;
    }
    try {
      this.isReprocessing = true;
      const confirmed = await this.confirmReprocessAction({
        title: 'Regenerate activity statistics?',
        message: 'This will re-calculate statistics like distance, ascent, descent etc...',
        confirmLabel: 'Regenerate',
        confirmColor: 'primary',
      });
      if (!confirmed) {
        return;
      }

      this.snackBar.open('Re-calculating activity statistics', undefined, {
        duration: 2000,
      });
      const jobId = this.processingService.addJob('process', 'Re-calculating activity statistics...');
      this.processingService.updateJob(jobId, { status: 'processing', progress: 5 });

      try {
        await this.eventReprocessService.regenerateEventStatistics(this.user, this.event as any, {
          onProgress: (progress) => this.updateReprocessJob(jobId, progress),
        });

        this.processingService.completeJob(jobId, 'Activity and event statistics recalculated');
        this.snackBar.open('Activity and event statistics have been recalculated', undefined, {
          duration: 2000,
        });
        this.changeDetectorRef.detectChanges();
      } catch (error) {
        this.processingService.failJob(jobId, 'Re-calculation failed');
        this.logger.error('[EventActionsComponent] Failed to re-calculate activity statistics', error);
        this.snackBar.open(this.getReprocessErrorMessage(error, 'Could not recalculate statistics.'), undefined, {
          duration: 4000,
        });
      }
    } finally {
      this.isReprocessing = false;
    }
  }

  async reImportActivityFromFile() {
    if (this.isReprocessing || !this.canReimportFromOriginalFile()) {
      return;
    }
    try {
      this.isReprocessing = true;
      const sourceFilesCount = this.getSourceFilesCount();
      const confirmed = await this.confirmReprocessAction({
        title: 'Reimport activity from file?',
        message: sourceFilesCount > 1
          ? `This will download and reparse ${sourceFilesCount} source files and replace current activity data.`
          : 'This will download and reparse the original source file and replace current activity data.',
        confirmLabel: 'Reimport',
        confirmColor: 'primary',
      });
      if (!confirmed) {
        return;
      }

      this.snackBar.open('Reimporting activity from source file', undefined, {
        duration: 2000,
      });
      const jobId = this.processingService.addJob('process', 'Reimporting activity from source file...');
      this.processingService.updateJob(jobId, { status: 'processing', progress: 5 });

      try {
        await this.eventReprocessService.reimportEventFromOriginalFiles(this.user, this.event as any, {
          onProgress: (progress) => this.updateReprocessJob(jobId, progress),
        });

        this.processingService.completeJob(jobId, 'Activity reimport completed');
        this.snackBar.open('Activity reimported from source file', undefined, {
          duration: 2000,
        });
        this.changeDetectorRef.detectChanges();
      } catch (error) {
        this.processingService.failJob(jobId, 'Reimport failed');
        this.logger.error('[EventActionsComponent] Failed to reimport activity from source file', error);
        this.snackBar.open(this.getReprocessErrorMessage(error, 'Could not reimport activity from file.'), undefined, {
          duration: 4000,
        });
      }
    } finally {
      this.isReprocessing = false;
    }
  }

  private updateReprocessJob(jobId: string, progress: ReprocessProgress) {
    this.processingService.updateJob(jobId, {
      status: progress.phase === 'done' ? 'completed' : 'processing',
      title: this.getReprocessTitle(progress.phase),
      progress: progress.progress,
      details: progress.details,
    });
  }

  private getReprocessTitle(phase: ReprocessPhase): string {
    switch (phase) {
      case 'validating':
        return 'Validating source files...';
      case 'downloading':
        return 'Downloading source files...';
      case 'parsing':
        return 'Parsing source files...';
      case 'merging':
        return 'Merging parsed activities...';
      case 'regenerating_stats':
        return 'Generating statistics...';
      case 'persisting':
        return 'Saving event...';
      case 'done':
        return 'Done';
      default:
        return 'Processing...';
    }
  }

  private getReprocessErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof ReprocessError) {
      if (error.code === 'NO_ORIGINAL_FILES') {
        return 'No original source files found for this event.';
      }
      if (error.code === 'MULTI_FILE_INCOMPLETE') {
        return 'Reimport failed because one or more source files could not be parsed.';
      }
      if (error.code === 'PARSE_FAILED') {
        return 'Could not parse the original source file.';
      }
      if (error.code === 'PERSIST_FAILED') {
        return 'Could not save the updated event after reprocessing.';
      }
    }
    return fallback;
  }

  private getSourceFilesCount(): number {
    const eventAny = this.event as any;
    if (eventAny.originalFiles && eventAny.originalFiles.length > 0) {
      return eventAny.originalFiles.length;
    }
    return eventAny.originalFile?.path ? 1 : 0;
  }

  private async confirmReprocessAction(dialogData: ConfirmationDialogData): Promise<boolean> {
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        cancelLabel: 'Cancel',
        ...dialogData,
      } as ConfirmationDialogData,
    });
    const confirmed = await dialogRef.afterClosed().pipe(take(1)).toPromise();
    return confirmed === true;
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
    try {
      const blob = await this.eventService.getEventAsJSONBloB(this.user, this.event as any);
      this.fileService.downloadFile(
        blob,
        this.getFileName(this.event),
        new EventExporterJSON().fileExtension,
      );
      this.snackBar.open('JSON file served', undefined, {
        duration: 2000,
      });
    } catch (error) {
      this.logger.error('[EventActionsComponent] Failed to download JSON from original files', error);
      this.snackBar.open('Could not download JSON file', undefined, {
        duration: 3000,
      });
    }
  }

  async downloadGPX() {
    try {
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
    } catch (error) {
      this.logger.error('[EventActionsComponent] Failed to download GPX from original files', error);
      this.snackBar.open('Could not download GPX file', undefined, {
        duration: 3000,
      });
    }
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
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: 'Are you sure you want to delete?',
        message: 'All data will be permanently deleted. This operation cannot be undone.',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        confirmColor: 'warn',
      } as ConfirmationDialogData,
    });
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
