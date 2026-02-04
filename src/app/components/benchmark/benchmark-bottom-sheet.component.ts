import { Component, Inject } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { BenchmarkResult } from '../../../../functions/src/shared/app-event.interface';

@Component({
  selector: 'app-benchmark-bottom-sheet',
  template: `
    <div class="bottom-sheet-container">
        <div class="bottom-sheet-header">
            <div class="title-row">
                <mat-icon color="primary">analytics</mat-icon>
                <h2 mat-dialog-title>Hardware Benchmark Analysis</h2>
            </div>
            <div class="header-actions">
                <button mat-icon-button matTooltip="Re-run with different activities" (click)="rerun()">
                    <mat-icon>refresh</mat-icon>
                </button>
                <button mat-icon-button (click)="close()">
                    <mat-icon>close</mat-icon>
                </button>
            </div>
        </div>
        <div class="bottom-sheet-content qs-scrollbar">
            <app-benchmark-report [result]="data.result"></app-benchmark-report>
        </div>
    </div>
  `,
  styleUrls: ['./benchmark-bottom-sheet.component.css'],
  standalone: false
})
export class BenchmarkBottomSheetComponent {
  constructor(
    @Inject(MAT_BOTTOM_SHEET_DATA) public data: { result: BenchmarkResult },
    private bottomSheetRef: MatBottomSheetRef<BenchmarkBottomSheetComponent>
  ) { }

  close() {
    this.bottomSheetRef.dismiss();
  }

  rerun() {
    this.bottomSheetRef.dismiss({ rerun: true });
  }
}
