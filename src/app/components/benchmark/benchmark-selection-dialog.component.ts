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
        minHeight="var(--benchmark-overlay-min-height)" borderRadius="12px" [showShade]="false">
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
                <div style="margin-top: 4px; font-size: 0.85em; opacity: 0.8;">
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
  styles: [`
    .dialog-subtitle { 
        color: var(--mat-sys-on-surface-variant); 
        margin-bottom: 1rem;
    }
    .loading-hint {
        font-size: 0.9rem;
        color: var(--mat-sys-on-surface-variant);
        margin-bottom: 0.75rem;
    }
    .benchmark-selection-overlay {
        --benchmark-overlay-min-height: 160px;
    }
    ::ng-deep .benchmark-selection-overlay .loading-overlay-container {
        display: flex;
        flex-direction: column;
        height: 100%;
    }
    .selection-list {
        margin-bottom: 0.5rem;
        width: 100%;
        flex: 1 1 auto;
        min-height: 0;
    }
    ::ng-deep .selection-list .mat-mdc-list-item,
    ::ng-deep .selection-list .mdc-list-item {
        height: auto !important;
        min-height: 56px;
    }
    ::ng-deep .selection-list .mdc-list-item__content {
        align-items: stretch;
        white-space: normal;
    }
    .empty-state {
        padding: 1rem;
        text-align: center;
        color: var(--mat-sys-on-surface-variant);
    }
    .activity-line {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        width: 100%;
        box-sizing: border-box;
    }
    .activity-main {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        min-width: 0;
    }
    .activity-name {
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .activity-meta {
        font-size: 0.85em;
        color: var(--mat-sys-on-surface-variant);
    }
    .device-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.2rem 0.5rem;
        border-radius: 999px;
        font-size: 0.7rem;
        font-weight: 600;
        line-height: 1;
        background: transparent;
        border: 1px solid var(--pill-color, var(--mat-sys-primary));
        color: var(--pill-color, var(--mat-sys-primary));
        white-space: nowrap;
        flex-shrink: 1;
        max-width: 100%;
        min-width: 0;
        overflow: hidden;
    }
    .device-pill-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .device-pill mat-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
    }
    mat-list-option {
        margin-bottom: 0.5rem;
        padding: 0.5rem 0;
        border-radius: 8px;
    }
    .selection-hint {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1rem;
        margin-top: 1rem;
        background: var(--mat-sys-surface-variant);
        border-radius: 8px;
        color: var(--mat-sys-on-surface-variant);
    }
    .preview-title {
        font-weight: 500;
        margin-bottom: 0.5rem;
        text-align: center;
    }
    .role-assignment {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        margin-top: 0.5rem;
        flex-wrap: wrap;
    }
    .role-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 0.75rem 1rem;
        border-radius: 8px;
        min-width: 140px;
        text-align: center;
        background: var(--mat-sys-surface-variant);
        border: 1px solid var(--role-color, var(--mat-sys-outline-variant));
        box-sizing: border-box;
    }
    .role-card.reference {
        color: var(--mat-sys-on-surface);
    }
    .role-card.test {
        color: var(--mat-sys-on-surface);
    }
    .role-label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        opacity: 0.8;
        margin-bottom: 0.25rem;
    }
    .device-name {
        font-weight: 600;
        font-size: 0.9rem;
    }
    .swap-btn {
        color: var(--mat-sys-primary);
    }
    .options-container {
        margin-top: 1rem;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 0.75rem;
    }
    .auto-align-checkbox {
        align-self: flex-start;
    }
    .auto-align-info {
        width: 100%;
    }
    ::ng-deep .auto-align-checkbox .mdc-label {
        white-space: normal;
        line-height: 1.2;
    }
    @media (max-width: 600px) {
        .benchmark-selection-overlay {
            --benchmark-overlay-min-height: 240px;
        }
        .activity-line {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.35rem;
        }
        .activity-line .device-pill {
            align-self: flex-start;
            font-size: 0.6rem;
            padding: 0.1rem 0.4rem;
            max-width: 100%;
        }
        .role-card .device-pill {
            align-self: center;
        }
        .role-assignment {
            flex-direction: column;
            align-items: stretch;
        }
        .swap-btn {
            align-self: center;
            transform: rotate(90deg);
        }
        .role-card {
            width: 100%;
            min-width: 0;
            padding: 0.6rem 0.75rem;
        }
        .role-label {
            font-size: 0.6rem;
        }
        .auto-align-info ul {
            padding-left: 1.25rem;
        }
        .auto-align-info li {
            margin-bottom: 0.4rem;
        }
    }
    .fade-in {
        animation: fadeIn 0.3s ease-in;
    }
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(5px); }
        to { opacity: 1; transform: translateY(0); }
    }
  `],
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
