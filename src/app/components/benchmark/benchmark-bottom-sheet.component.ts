import { Component, Inject } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { BenchmarkResult } from '../../../../functions/src/shared/app-event.interface';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { EventInterface, UserSummariesSettingsInterface, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';

@Component({
  selector: 'app-benchmark-bottom-sheet',
  template: `
    <div class="bottom-sheet-container">
        <app-bottom-sheet-header title="Hardware Benchmark Analysis" icon="analytics">
            <button mat-icon-button matTooltip="Re-run with different activities" (click)="rerun()">
                <mat-icon>refresh</mat-icon>
            </button>
            <button mat-icon-button (click)="close()">
                <mat-icon>close</mat-icon>
            </button>
        </app-bottom-sheet-header>
        <div class="bottom-sheet-content qs-scrollbar">
            <app-benchmark-report 
                [result]="data.result"
                [event]="data.event"
                [unitSettings]="data.unitSettings"
                [summariesSettings]="data.summariesSettings"
                [referenceColor]="referenceColor"
                [testColor]="testColor">
            </app-benchmark-report>
        </div>
    </div>
  `,
  styleUrls: ['./benchmark-bottom-sheet.component.css'],
  standalone: false
})
export class BenchmarkBottomSheetComponent {
  referenceColor = '';
  testColor = '';

  constructor(
    @Inject(MAT_BOTTOM_SHEET_DATA) public data: {
      result: BenchmarkResult;
      event?: EventInterface;
      unitSettings?: UserUnitSettingsInterface;
      summariesSettings?: UserSummariesSettingsInterface;
    },
    private bottomSheetRef: MatBottomSheetRef<BenchmarkBottomSheetComponent>,
    private eventColorService: AppEventColorService
  ) {
    this.calculateColors();
  }

  calculateColors() {
    if (!this.data.event || !this.data.result) return;

    const activities = this.data.event.getActivities();
    const reference = activities.find(a => a.getID() === this.data.result.referenceId);
    const test = activities.find(a => a.getID() === this.data.result.testId);

    if (reference) {
      this.referenceColor = this.eventColorService.getActivityColor(activities, reference);
    }
    if (test) {
      this.testColor = this.eventColorService.getActivityColor(activities, test);
    }
  }

  close() {
    this.bottomSheetRef.dismiss();
  }

  rerun() {
    this.bottomSheetRef.dismiss({ rerun: true });
  }
}
