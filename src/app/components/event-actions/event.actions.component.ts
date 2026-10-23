import { isCompleteEvent, type EventRead } from '@shared/event-read';
import { Auth } from 'app/firebase/auth';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, EventEmitter, Input, OnDestroy, OnInit, Output, inject } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Privacy } from '@sports-alliance/sports-lib';
import { AppEventService } from '../../services/app.event.service';
import { AppFileService } from '../../services/app.file.service';
import { User } from '@sports-alliance/sports-lib';
import { ConfirmationDialogComponent, ConfirmationDialogData } from '../confirmation-dialog/confirmation-dialog.component';
import { take } from 'rxjs/operators';
import { Subscription, firstValueFrom } from 'rxjs';
import { activityElevationMetric, applySavedActivityElevation, type ActivityElevationUpdate } from '@shared/activity-ascent';
import { isBenchmarkEvent } from '@shared/event-classification';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppOriginalFileDownloadService } from '../../services/app.original-file-download.service';

import { DataDistance } from '@sports-alliance/sports-lib';

import { ServiceNames, GarminAPIEventMetaData } from '@sports-alliance/sports-lib';
import { EventExporterGPX } from '@sports-alliance/sports-lib';
import { DataStartPosition } from '@sports-alliance/sports-lib';
import { LoggerService } from '../../services/logger.service';
import {
  AppEventReprocessService,
  ReprocessError,
  ReprocessPhase,
  ReprocessProgress
} from '../../services/app.event-reprocess.service';
import { AppProcessingService } from '../../services/app.processing.service';
import { AppEventSharingService } from '../../services/app.event-sharing.service';
import { CalendarDayDetailsNavigationService } from '../../services/calendar-day-details-navigation.service';
import { AppHapticsService } from '../../services/app.haptics.service';

@Component({
  selector: 'app-event-actions',
  templateUrl: './event.actions.component.html',
  styleUrls: ['./event.actions.component.css'],
  providers: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class EventActionsComponent implements OnInit, OnDestroy {
  private readonly sendAuth = inject(Auth, { optional: true });
  private readonly destroyRef = inject(DestroyRef);
  private ascentEditorOpen = false;
  get canSendOwnedActivities(): boolean { return !!this.user && this.sendAuth?.currentUser?.uid === this.user.uid; }
  get canEditAscent(): boolean {
    return this.canSendOwnedActivities && !isBenchmarkEvent(this.event as unknown as { isMerge?: unknown; mergeType?: unknown });
  }
  async editAscent(): Promise<void> {
    if (!this.canEditAscent || this.isReprocessing || this.ascentEditorOpen || this.destroyRef.destroyed) return;
    const event = this.event, eventId = event.getID(), owner = this.user;
    const isCurrent = () => !this.destroyRef.destroyed && this.event === event && event.getID() === eventId
      && this.user?.uid === owner.uid && this.canEditAscent && !this.isReprocessing;
    this.ascentEditorOpen = true;
    let opened = false;
    try {
      const { ActivityAscentEditorComponent } = await import('../activity-ascent-editor/activity-ascent-editor.component');
      if (!isCurrent()) return;
      this.hapticsService.selection();
      const ref = this.dialog.open(ActivityAscentEditorComponent, {
        data: { eventId, user: owner }, width: '480px', maxWidth: 'calc(100vw - 32px)',
      });
      opened = true;
      this.ascentDialogSubscription = ref.afterClosed().pipe(take(1)).subscribe((saved: ActivityElevationUpdate | undefined) => {
        this.ascentEditorOpen = false;
        if (!saved || !isCurrent()) return;
        if (isCompleteEvent(event)) applySavedActivityElevation(event, saved);
        else event.applySavedStat?.(activityElevationMetric(saved.metric).type, saved.eventValue);
        this.ascentChanged.emit(event);
        this.changeDetectorRef.markForCheck();
      });
    } catch (error) {
      this.logger.error('Could not open the elevation editor', error);
      if (isCurrent()) {
        this.hapticsService.error();
        this.snackBar.open('Could not open elevation editing. Try again.', undefined, { duration: 3500 });
      }
    } finally { if (!opened) this.ascentEditorOpen = false; }
  }
  async sendToService(): Promise<void> {
    if (!this.canSendOwnedActivities) return;
    const ids = [this.event.getID()];
    const opened = await this.router.navigate(['/send-activities'], { queryParams: { source: 'saved' }, state: { activitySendSelection: ids, activitySendOwner: this.user.uid } });
    if (opened) this.hapticsService.selection();
  }

  @Input() event!: EventRead;
  @Input() user!: User;
  @Input() showDownloadOriginal = false;
  @Input() navigateAfterDelete = true;
  @Output() eventDeleted = new EventEmitter<string>();
  @Output() ascentChanged = new EventEmitter<EventRead>();

  public isReprocessing = false;
  public isSharing = false;

  public garminAPIServiceMetaData!: GarminAPIEventMetaData;
  private deleteConfirmationSubscription!: Subscription;
  private ascentDialogSubscription?: Subscription;

  private analyticsService = inject(AppAnalyticsService);
  private originalFileDownloadService = inject(AppOriginalFileDownloadService);
  private logger = inject(LoggerService);
  private eventReprocessService = inject(AppEventReprocessService);
  private processingService = inject(AppProcessingService);
  private eventSharingService = inject(AppEventSharingService);
  private dayDetailsNavigation = inject(CalendarDayDetailsNavigationService);
  private hapticsService = inject(AppHapticsService);


  constructor(
    private eventService: AppEventService,
    private changeDetectorRef: ChangeDetectorRef,
    private router: Router,
    private location: Location,
    private snackBar: MatSnackBar,
    private fileService: AppFileService,
    private dialog: MatDialog) {
  }

  async ngOnInit() {
    if (!this.user) {
      throw new Error('User is required')
    }

  }

  async menuOpen(_event: unknown) {
    if (this.isSharing) {
      return;
    }
    this.hapticsService.selection();
    if (!this.showDownloadOriginal) {
      return;
    }


    this.garminAPIServiceMetaData = <GarminAPIEventMetaData>(await this.eventService.getEventMetaData(this.user, this.event.getID(), ServiceNames.GarminAPI)
      .pipe(take(1)).toPromise());
    this.changeDetectorRef.detectChanges();
  }

  isHydrated() {
    const activities = this.event.getActivities?.() ?? [];
    return activities.some(activity => activity.getAllStreams().length > 0);
  }

  hasDistance() {
    const activities = this.event.getActivities?.() ?? [];
    return activities.some(activity => activity.hasStreamData(DataDistance.type));
  }

  hasPositionalData() {
    return this.event.getStat(DataStartPosition.type) || (this.event.getActivities?.() ?? []).filter(activity => activity.hasPositionData()).length > 0
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
    return 'No original source files available for this activity';
  }

  public get isPubliclyShared(): boolean {
    return (this.event as { privacy?: unknown } | null)?.privacy === 'public';
  }

  async shareEventLink(): Promise<void> {
    if (this.isSharing) {
      return;
    }

    const eventID = this.event.getID();
    const confirmed = await this.confirmReprocessAction({
      title: 'Share activity publicly?',
      message: 'Anyone with the link will be able to view this activity and its source files while sharing is enabled.',
      confirmLabel: 'Share',
      confirmColor: 'primary',
    });
    if (!confirmed) {
      return;
    }

    await this.updateEventSharing(eventID, true, 'event');
  }

  async copyPublicEventLink(): Promise<void> {
    if (this.isSharing) {
      return;
    }
    const eventID = this.event.getID();
    const copied = this.eventSharingService.copyShareUrl('event', this.user.uid, eventID);
    this.snackBar.open(copied ? 'Public link copied' : 'Could not copy public link', undefined, {
      duration: 2500,
    });
    if (copied) {
      this.hapticsService.success();
    } else {
      this.hapticsService.error();
    }
  }

  async stopSharingEvent(): Promise<void> {
    if (this.isSharing) {
      return;
    }

    const eventID = this.event.getID();
    const confirmed = await this.confirmReprocessAction({
      title: 'Stop sharing this activity?',
      message: 'The public activity and comparison links will stop working. The activity remains available to you.',
      confirmLabel: 'Stop sharing',
      confirmColor: 'warn',
    });
    if (!confirmed) {
      return;
    }

    await this.updateEventSharing(eventID, false, 'event');
  }

  private async updateEventSharing(eventID: string, enabled: boolean, copyKind: 'event' | 'comparison'): Promise<void> {
    if (this.isSharing) {
      return;
    }
    this.isSharing = true;
    this.changeDetectorRef.markForCheck();
    try {
      const response = await this.eventSharingService.setEventSharing(this.user, eventID, enabled);
      (this.event as { privacy?: Privacy }).privacy = response.privacy === 'public' ? Privacy.Public : Privacy.Private;
      if (enabled) {
        const copied = this.eventSharingService.copyShareUrl(copyKind, this.user.uid, eventID);
        this.snackBar.open(copied ? 'Public link copied' : 'Sharing enabled', undefined, { duration: 2500 });
      } else {
        this.snackBar.open('Sharing stopped', undefined, { duration: 2500 });
      }
      this.hapticsService.success();
    } catch (error) {
      this.logger.error('[EventActionsComponent] Failed to update sharing', error);
      this.snackBar.open('Could not update sharing', undefined, { duration: 3500 });
      this.hapticsService.error();
    } finally {
      this.isSharing = false;
      this.changeDetectorRef.markForCheck();
    }
  }

  async reGenerateStatistics() {
    if (this.isReprocessing) {
      return;
    }
    const source = this.event, owner = this.user;
    try {
      this.isReprocessing = true;
      const confirmed = await this.confirmReprocessAction({
        title: 'Regenerate activity statistics?',
        message: 'This will re-calculate statistics like distance, ascent, descent etc...',
        confirmLabel: 'Regenerate',
        confirmColor: 'primary',
      });
      if (!confirmed || !this.isCurrentEvent(source, owner)) {
        return;
      }

      this.snackBar.open('Re-calculating activity statistics', undefined, {
        duration: 2000,
      });
      const jobId = this.processingService.addJob('process', 'Re-calculating activity statistics...');
      this.processingService.updateJob(jobId, { status: 'processing', progress: 5 });

      try {
        const event = await this.completeEvent(source, owner);
        if (!event || !this.isCurrentEvent(source, owner)) {
          this.processingService.removeJob(jobId);
          return;
        }
        await this.eventReprocessService.regenerateEventStatistics(owner, event, {
          onProgress: (progress) => this.updateReprocessJob(jobId, progress),
        });

        this.processingService.completeJob(jobId, 'Activity statistics recalculated');
        this.snackBar.open('Activity statistics have been recalculated', undefined, {
          duration: 2000,
        });
        this.hapticsService.success();
        if (!this.destroyRef.destroyed) this.changeDetectorRef.markForCheck();
      } catch (error) {
        this.processingService.failJob(jobId, 'Re-calculation failed');
        this.logger.error('[EventActionsComponent] Failed to re-calculate activity statistics', error);
        this.snackBar.open(this.getReprocessErrorMessage(error, 'Could not recalculate statistics.'), undefined, {
          duration: 4000,
        });
        this.hapticsService.error();
      }
    } finally {
      this.isReprocessing = false;
    }
  }

  async reImportActivityFromFile() {
    if (this.isReprocessing || !this.canReimportFromOriginalFile()) {
      return;
    }
    const source = this.event, owner = this.user;
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
      if (!confirmed || !this.isCurrentEvent(source, owner)) {
        return;
      }

      this.snackBar.open('Reimporting activity from source file', undefined, {
        duration: 2000,
      });
      const jobId = this.processingService.addJob('process', 'Reimporting activity from source file...');
      this.processingService.updateJob(jobId, { status: 'processing', progress: 5 });

      try {
        const event = await this.completeEvent(source, owner);
        if (!event || !this.isCurrentEvent(source, owner)) {
          this.processingService.removeJob(jobId);
          return;
        }
        await this.eventReprocessService.reimportEventFromOriginalFiles(owner, event, {
          onProgress: (progress) => this.updateReprocessJob(jobId, progress),
        });

        this.processingService.completeJob(jobId, 'Activity reimport completed');
        this.snackBar.open('Activity reimported from source file', undefined, {
          duration: 2000,
        });
        this.hapticsService.success();
        if (!this.destroyRef.destroyed) this.changeDetectorRef.markForCheck();
      } catch (error) {
        this.processingService.failJob(jobId, 'Reimport failed');
        this.logger.error('[EventActionsComponent] Failed to reimport activity from source file', error);
        this.snackBar.open(this.getReprocessErrorMessage(error, 'Could not reimport activity from file.'), undefined, {
          duration: 4000,
        });
        this.hapticsService.error();
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
        return 'Saving activity...';
      case 'done':
        return 'Done';
      default:
        return 'Processing...';
    }
  }

  private getReprocessErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof ReprocessError) {
      if (error.code === 'NON_ACTIVITY_SOURCE') return error.message;
      if (error.code === 'NO_ORIGINAL_FILES') {
        return 'No original source files found for this activity.';
      }
      if (error.code === 'MULTI_FILE_INCOMPLETE') {
        return 'Reimport failed because one or more source files could not be parsed.';
      }
      if (error.code === 'PARSE_FAILED') {
        return 'Could not parse the original source file.';
      }
      if (error.code === 'PERSIST_FAILED') {
        return 'Could not save the updated activity after reprocessing.';
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

  // downloadEventAsTCX(event: EventRead) {
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

  private isCurrentEvent(source: EventRead, owner: User): boolean {
    return !this.destroyRef.destroyed && this.event === source && this.user?.uid === owner?.uid;
  }

  private async completeEvent(source: EventRead, owner: User) {
    if (!this.isCurrentEvent(source, owner)) return null;
    if (isCompleteEvent(source)) return source;
    const event = await firstValueFrom(this.eventService.getEventAndActivities(owner, source.getID()));
    if (!this.isCurrentEvent(source, owner)) return null;
    if (!event) throw new Error('Activity no longer exists');
    return event;
  }

  async downloadGPX() {
    const source = this.event, owner = this.user;
    this.hapticsService.selection();
    try {
      const event = await this.completeEvent(source, owner);
      if (!event || !this.isCurrentEvent(source, owner)) return;
      const blob = await this.eventService.getEventAsGPXBloB(owner, event);
      if (!this.isCurrentEvent(source, owner)) return;
      this.fileService.downloadFile(
        blob,
        this.getFileName(source),
        new EventExporterGPX().fileExtension,
      );
      this.analyticsService.logEvent('downloaded_gpx_file');
      this.snackBar.open('GPX file served', undefined, {
        duration: 2000,
      });
      this.hapticsService.success();
    } catch (error) {
      if (!this.isCurrentEvent(source, owner)) return;
      this.logger.error('[EventActionsComponent] Failed to download GPX from original files', error);
      this.snackBar.open('Could not download GPX file', undefined, {
        duration: 3000,
      });
      this.hapticsService.error();
    }
  }



  async downloadOriginals() {
    this.hapticsService.selection();
    this.snackBar.open('Preparing download...', undefined, { duration: 2000 });
    try {
      const originalFiles = this.eventService.getOriginalEventDownloadSources(this.event as any);

      if (originalFiles.length === 0) {
        this.snackBar.open('No original files found.', undefined, { duration: 3000 });
        this.hapticsService.error();
        return;
      }

      const result = await this.originalFileDownloadService.downloadOriginalFiles({
        sources: originalFiles,
        downloadFile: (path) => this.eventService.downloadOriginalFile(path),
        fallbackFileName: 'original-file',
      });

      if (result.mode === 'none') {
        this.hapticsService.error();
        return;
      }

      this.analyticsService.logEvent(
        result.mode === 'zip' ? 'downloaded_original_files_zip' : 'downloaded_original_file',
      );
      this.hapticsService.success();
    } catch (error: any) {
      this.logger.error('Download failed', error);
      this.snackBar.open('Failed to download original files.', undefined, { duration: 3000 });
      this.hapticsService.error();
    }
  }



  async delete() {
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: 'Delete activity?',
        message: 'This activity, its recorded data and original files will be permanently deleted. You cannot undo this.',
        confirmLabel: 'Delete activity',
        cancelLabel: 'Cancel',
        confirmColor: 'warn',
      } as ConfirmationDialogData,
    });
    this.deleteConfirmationSubscription = dialogRef.afterClosed().subscribe(async (result) => {
      if (!result) {
        return;
      }
      try {
        await this.eventService.deleteAllEventData(this.user, this.event.getID());
        this.dayDetailsNavigation.markEventDeleted(this.event.getID());
        this.eventDeleted.emit(this.event.getID());
        if (this.navigateAfterDelete) {
          await this.leaveDeletedEventRoute();
        }
        this.snackBar.open('Activity deleted', undefined, {
          duration: 2000,
        });
        this.hapticsService.success();
      } catch (error) {
        this.logger.error('[EventActionsComponent] Failed to delete event', error);
        this.snackBar.open('Could not delete activity', undefined, {
          duration: 3000,
        });
        this.hapticsService.error();
      }
    });
  }

  private async leaveDeletedEventRoute(): Promise<void> {
    if (this.router.lastSuccessfulNavigation?.previousNavigation) {
      this.location.back();
      return;
    }
    await this.router.navigate(['/dashboard']);
  }

  ngOnDestroy(): void {
    this.ascentDialogSubscription?.unsubscribe();
    if (this.deleteConfirmationSubscription) {
      this.deleteConfirmationSubscription.unsubscribe()
    }
  }

  private getFileName(event: EventRead): string {
    const eventDate = this.fileService.toDate(event.startDate);
    const dateStr = eventDate ? eventDate.toISOString() : 'unknown';
    return `${dateStr}#${event.getActivityTypesAsString()}`
  }

}
