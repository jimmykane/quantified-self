import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { MatSelectionListChange } from '@angular/material/list';

export interface BenchmarkSelectionData {
  activities: ActivityInterface[];
  initialSelection?: ActivityInterface[];
}

@Component({
  selector: 'app-benchmark-selection-dialog',
  template: `
    <h2 mat-dialog-title>Select Activities to Compare</h2>
    <mat-dialog-content>
      <p class="dialog-subtitle">Choose exactly two activities to generate a hardware benchmark.</p>
      
      <mat-selection-list #list (selectionChange)="onSelectionChange($event)">
        <mat-list-option *ngFor="let activity of data.activities" [value]="activity" [selected]="isSelected(activity)">
          <div class="activity-line">
            <span class="activity-name">{{ activity.name || activity.creator?.name || 'Unknown Activity' }}</span>
            <span class="activity-meta">{{ activity.startDate | date:'shortTime' }} • {{ activity.creator?.name || 'Unknown Device' }}</span>
          </div>
        </mat-list-option>
      </mat-selection-list>

      <div *ngIf="selectedActivities.length !== 2" class="selection-hint">
        <mat-icon color="warn">info</mat-icon>
        <span>{{ selectedActivities.length === 0 ? 'Select two activities' : 'Select one more activity' }}</span>
      </div>

      <div *ngIf="selectedActivities.length === 2" class="preview-info fade-in">
        <p class="preview-title">Ready to Compare:</p>
        
        <div class="role-assignment">
          <div class="role-card reference">
            <span class="role-label">Reference (Ground Truth)</span>
            <span class="device-name">{{ selectedActivities[0].creator?.name || 'Device A' }}</span>
          </div>
          
          <button mat-icon-button class="swap-btn" (click)="swapActivities()" matTooltip="Swap Reference and Test">
            <mat-icon>swap_horiz</mat-icon>
          </button>
          
          <div class="role-card test">
            <span class="role-label">Test Device</span>
            <span class="device-name">{{ selectedActivities[1].creator?.name || 'Device B' }}</span>
          </div>
        </div>
        
        <div class="options-container">
            <mat-checkbox [(ngModel)]="autoAlignTime">
                Auto-align Time (Use Correlation)
            </mat-checkbox>
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
    .activity-line {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }
    .activity-name {
        font-weight: 500;
    }
    .activity-meta {
        font-size: 0.85em;
        color: var(--mat-sys-on-surface-variant);
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
    }
    .role-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 0.75rem 1rem;
        border-radius: 8px;
        min-width: 140px;
        text-align: center;
    }
    .role-card.reference {
        background: var(--mat-sys-primary-container);
        color: var(--mat-sys-on-primary-container);
    }
    .role-card.test {
        background: var(--mat-sys-tertiary-container);
        color: var(--mat-sys-on-tertiary-container);
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
        justify-content: center;
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

  selectedActivities: ActivityInterface[] = [];
  autoAlignTime = true;

  constructor(
    public dialogRef: MatDialogRef<BenchmarkSelectionDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: BenchmarkSelectionData
  ) {
    // Pre-select activities if provided (for rerun scenarios)
    if (this.data.initialSelection && this.data.initialSelection.length > 0) {
      this.selectedActivities = [...this.data.initialSelection];
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
}
