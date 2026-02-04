import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ActivityInterface } from '@sports-alliance/sports-lib';
import { SelectionModel } from '@angular/cdk/collections';

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
      
      <mat-selection-list #list [multiple]="true" (selectionChange)="onSelectionChange($event)">
        <mat-list-option *ngFor="let activity of data.activities" [value]="activity" [selected]="selection.isSelected(activity)">
          <div mat-line class="activity-line">
            <span class="activity-name">{{ activity.name || activity.creator?.name || 'Unknown Activity' }}</span>
            <span class="activity-meta">{{ activity.startDate | date:'shortTime' }} • {{ activity.creator?.name || 'Unknown Device' }}</span>
          </div>
        </mat-list-option>
      </mat-selection-list>

      <div *ngIf="selection.selected.length === 2" class="preview-info fade-in">
        <p class="preview-title">Ready to Compare:</p>
        
        <div class="role-assignment">
          <div class="role-card reference">
            <span class="role-label">Reference (Ground Truth)</span>
            <span class="device-name">{{ selection.selected[0].creator?.name || 'Device A' }}</span>
          </div>
          
          <button mat-icon-button class="swap-btn" (click)="swapActivities()" matTooltip="Swap Reference and Test">
            <mat-icon>swap_horiz</mat-icon>
          </button>
          
          <div class="role-card test">
            <span class="role-label">Test Device</span>
            <span class="device-name">{{ selection.selected[1].creator?.name || 'Device B' }}</span>
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
              [disabled]="selection.selected.length !== 2"
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
        font-family: 'JetBrains Mono', monospace;
    }
    .activity-meta {
        font-size: 0.85em;
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
        font-family: 'JetBrains Mono', monospace;
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

  selection = new SelectionModel<ActivityInterface>(true, []);
  autoAlignTime = true;

  constructor(
    public dialogRef: MatDialogRef<BenchmarkSelectionDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: BenchmarkSelectionData
  ) {
    if (this.data.initialSelection) {
      this.selection.select(...this.data.initialSelection);
    }
  }

  onSelectionChange(event: any): void {
    // Enforce max 2 - the button is disabled if !== 2, that's enough for MVP.
  }

  swapActivities(): void {
    if (this.selection.selected.length === 2) {
      const [first, second] = this.selection.selected;
      this.selection.clear();
      this.selection.select(second, first);
    }
  }

  confirm(): void {
    if (this.selection.selected.length === 2) {
      this.dialogRef.close({
        activities: this.selection.selected,
        options: { autoAlignTime: this.autoAlignTime }
      });
    }
  }
}
