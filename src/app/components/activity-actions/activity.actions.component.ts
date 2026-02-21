import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnInit } from '@angular/core';
import { EventInterface } from '@sports-alliance/sports-lib';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { ActivityFormComponent } from '../activity-form/activity.form.component';
import { User } from '@sports-alliance/sports-lib';
import { firstValueFrom } from 'rxjs';
import { ConfirmationDialogComponent, ConfirmationDialogData } from '../confirmation-dialog/confirmation-dialog.component';
import { DataDistance } from '@sports-alliance/sports-lib';
import {
  AppEventReprocessService,
  ReprocessError,
  ReprocessPhase,
  ReprocessProgress
} from '../../services/app.event-reprocess.service';
import { AppProcessingService } from '../../services/app.processing.service';

@Component({
  selector: 'app-activity-actions',
  templateUrl: './activity.actions.component.html',
  styleUrls: ['./activity.actions.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [],
  standalone: false
})
export class ActivityActionsComponent implements OnInit {
  @Input() event: EventInterface;
  @Input() user: User;
  @Input() activity: ActivityInterface;

  constructor(
    private eventReprocessService: AppEventReprocessService,
    private processingService: AppProcessingService,
    private changeDetectorRef: ChangeDetectorRef,
    private snackBar: MatSnackBar,
    public dialog: MatDialog) {
  }

  ngOnInit(): void {
    if (!this.user || !this.event) {
      throw new Error('Component needs events and user');
    }
  }

  editActivity() {
    const dialogRef = this.dialog.open(ActivityFormComponent, {
      width: '75vw',
      data: {
        event: this.event,
        activity: this.activity,
        user: this.user
      },
    });
  }

  isHydrated() {
    return this.activity.getAllStreams().length > 0;
  }

  hasDistance() {
    return this.activity.hasStreamData(DataDistance.type);
  }

  async reGenerateStatistics() {
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
      const result = await this.eventReprocessService.regenerateActivityStatistics(
        this.user,
        this.event as any,
        this.activity.getID(),
        {
          onProgress: (progress) => this.updateReprocessJob(jobId, progress),
        },
      );
      const updatedActivityId = result.updatedActivityId || this.activity.getID();
      const updatedActivity = this.event.getActivities().find(activity => activity.getID() === updatedActivityId);
      if (updatedActivity) {
        this.activity = updatedActivity;
      }
      this.processingService.completeJob(jobId, 'Activity and event statistics recalculated');
      this.snackBar.open('Activity and event statistics have been recalculated', undefined, {
        duration: 2000,
      });
      this.changeDetectorRef.detectChanges();
    } catch (error) {
      this.processingService.failJob(jobId, 'Re-calculation failed');
      this.snackBar.open(this.getReprocessErrorMessage(error, 'Could not recalculate statistics.'), undefined, {
        duration: 4000,
      });
    }
  }

  cropActivity() {
    // @todo: Implement crop activity
  }

  private updateReprocessJob(jobId: string, progress: ReprocessProgress): void {
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
      if (error.code === 'PARSE_FAILED') {
        return 'Could not parse the original source file.';
      }
      if (error.code === 'ACTIVITY_NOT_FOUND_AFTER_REHYDRATE') {
        return 'The selected activity could not be matched after rehydration.';
      }
      if (error.code === 'PERSIST_FAILED') {
        return 'Could not save the updated event after reprocessing.';
      }
    }
    return fallback;
  }

  private async confirmReprocessAction(dialogData: ConfirmationDialogData): Promise<boolean> {
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        cancelLabel: 'Cancel',
        ...dialogData,
      } as ConfirmationDialogData,
    });
    const confirmed = await firstValueFrom(dialogRef.afterClosed());
    return confirmed === true;
  }

}
