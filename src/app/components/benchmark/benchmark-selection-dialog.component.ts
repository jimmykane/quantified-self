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
        <p><strong>Ready to Compare:</strong></p>
        <div class="comparison-pill">
           <span>{{ selection.selected[0].creator?.name || 'Device A' }}</span>
           <mat-icon>compare_arrows</mat-icon>
           <span>{{ selection.selected[1].creator?.name || 'Device B' }}</span>
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
    .comparison-pill {
        display: flex;
        align-items: center;
        gap: 1rem;
        background: var(--mat-sys-secondary-container);
        color: var(--mat-sys-on-secondary-container);
        padding: 0.5rem 1rem;
        border-radius: 999px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.9rem;
        justify-content: center;
        margin-top: 1rem;
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
    // Enforce max 2
    if (this.selection.selected.length > 2) {
      // Deselect the oldest one/first one effectively? Or just prevent?
      // Let's just deselect the previous one if we adding a 3rd
      const toDeselect = this.selection.selected.find(x => x !== event.option.value); // Naive
      // simpler: if 3 selected, splice?
      // SelectionModel doesn't strictly enforce limit.
      // Let's manually manage if needed, or just let users toggle.
      // The button is disabled if !== 2. That's enough for MVP.
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
