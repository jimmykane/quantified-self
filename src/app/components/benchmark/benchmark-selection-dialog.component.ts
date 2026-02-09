import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { MatSelectionListChange } from '@angular/material/list';
import { AppEventColorService } from '../../services/color/app.event.color.service';

export interface BenchmarkSelectionData {
  activities: ActivityInterface[];
  initialSelection?: ActivityInterface[];
  isLoading?: boolean;
}

@Component({
  selector: 'app-benchmark-selection-dialog',
  template: `
    <h2 mat-dialog-title>Select Activities to Compare</h2>
    <mat-dialog-content>
      <p class="dialog-subtitle">Choose two activities to generate a hardware benchmark.</p>

      <app-loading-overlay class="benchmark-selection-overlay" [isLoading]="isLoading" height="auto"
        minHeight="var(--benchmark-overlay-min-height)" borderRadius="12px" [showShade]="false" [showSkeleton]="true">
        @if (activities.length > 0) {
        <mat-selection-list #list class="selection-list" (selectionChange)="onSelectionChange($event)">
          <mat-list-option *ngFor="let activity of activities" [value]="activity" [selected]="isSelected(activity)">
            <div class="activity-line">
              <div class="activity-main">
                <span class="activity-name">{{ activity.name || activity.type || 'Unknown Activity' }}</span>
                <span class="activity-meta">{{ activity.startDate | date:'shortTime' }}</span>
              </div>
              <span class="device-pill" [style.--pill-color]="getActivityColor(activity)">
                <mat-icon>watch</mat-icon>
                <span class="device-pill-text">{{ activity.creator?.name || 'Unknown Device' }}</span>
              </span>
            </div>
          </mat-list-option>
        </mat-selection-list>
        }
        @if (!isLoading && activities.length === 0) {
        <div class="empty-state">No activities available.</div>
        }
      </app-loading-overlay>

      <div *ngIf="!isLoading && selectedActivities.length !== 2" class="selection-hint">
        <mat-icon color="warn">info</mat-icon>
        <span>{{ selectedActivities.length === 0 ? 'Select two activities' : 'Select one more activity' }}</span>
      </div>

      <div *ngIf="!isLoading && selectedActivities.length === 2" class="preview-info fade-in">
        <p class="preview-title">Ready to Compare:</p>
        
        <div class="role-assignment">
          <div class="role-card reference" [style.--role-color]="getSelectedActivityColor(0)">
            <span class="role-label">Reference (Ground Truth)</span>
            <span class="device-pill" [style.--pill-color]="getSelectedActivityColor(0)">
              <mat-icon>watch</mat-icon>
              <span class="device-pill-text">{{ selectedActivities[0].creator?.name || 'Device A' }}</span>
            </span>
          </div>
          
          <button mat-icon-button class="swap-btn" (click)="swapActivities()" matTooltip="Swap Reference and Test">
            <mat-icon>swap_horiz</mat-icon>
          </button>
          
          <div class="role-card test" [style.--role-color]="getSelectedActivityColor(1)">
            <span class="role-label">Test Device</span>
            <span class="device-pill" [style.--pill-color]="getSelectedActivityColor(1)">
              <mat-icon>watch</mat-icon>
              <span class="device-pill-text">{{ selectedActivities[1].creator?.name || 'Device B' }}</span>
            </span>
          </div>
        </div>
        
        <div class="options-container">
            <mat-checkbox [(ngModel)]="autoAlignTime" class="auto-align-checkbox">
                Auto-align Time (Use Correlation)
            </mat-checkbox>
            
            <app-status-info type="info" title="How Auto-align Works" class="auto-align-info">
                <ul>
                    <li><strong>Streams:</strong> Uses <strong>Altitude</strong> (priority) or <strong>Speed</strong>.</li>
                    <li><strong>Method:</strong> Cross-correlation (Pearson) on a 5-minute sample at 1Hz.</li>
                    <li><strong>Window:</strong> Tests shifts of ±15 seconds to find best match.</li>
                </ul>
                <div class="auto-align-note">
                    <em>Note: For indoor activities (no GPS altitude), alignment requires a Speed source. Without valid data, no alignment is applied.</em>
                    <br/>
                    <em>Contact us for a feature request or ideas on this or changes.</em>
                </div>
            </app-status-info>
        </div>
      </div>

    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="primary" 
              [disabled]="selectedActivities.length !== 2"
              (click)="confirm()">
        Run Benchmark
      </button>
    </mat-dialog-actions>
  `,
  styleUrls: ['./benchmark-selection-dialog.component.css'],
  standalone: false
})
export class BenchmarkSelectionDialogComponent {

  activities: ActivityInterface[] = [];
  selectedActivities: ActivityInterface[] = [];
  autoAlignTime = true;
  isLoading = false;

  constructor(
    public dialogRef: MatDialogRef<BenchmarkSelectionDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: BenchmarkSelectionData,
    private eventColorService: AppEventColorService
  ) {
    this.activities = data.activities ?? [];
    this.isLoading = !!data.isLoading;
    // Pre-select activities if provided (for rerun scenarios)
    if (this.data.initialSelection && this.data.initialSelection.length > 0) {
      this.selectedActivities = [...this.data.initialSelection];
    }
  }

  setActivities(activities: ActivityInterface[], initialSelection?: ActivityInterface[]): void {
    this.activities = activities;
    this.isLoading = false;
    if (this.selectedActivities.length === 0 && initialSelection?.length) {
      this.selectedActivities = [...initialSelection];
    }
  }

  /** Check if an activity should be pre-selected */
  isSelected(activity: ActivityInterface): boolean {
    return this.selectedActivities.some(a => a.getID() === activity.getID());
  }

  onSelectionChange(event: MatSelectionListChange): void {
    this.selectedActivities = event.source.selectedOptions.selected.map(opt => opt.value);
  }

  swapActivities(): void {
    if (this.selectedActivities.length === 2) {
      this.selectedActivities = [this.selectedActivities[1], this.selectedActivities[0]];
    }
  }

  confirm(): void {
    if (this.selectedActivities.length === 2) {
      this.dialogRef.close({
        activities: this.selectedActivities,
        options: { autoAlignTime: this.autoAlignTime }
      });
    }
  }

  getActivityColor(activity: ActivityInterface): string {
    return this.eventColorService.getActivityColor(this.activities, activity);
  }

  getSelectedActivityColor(index: number): string {
    const activity = this.selectedActivities[index];
    if (!activity) return '';
    return this.getActivityColor(activity);
  }
}
