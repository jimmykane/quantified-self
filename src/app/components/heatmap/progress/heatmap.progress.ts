import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-heatmap-progress-info',
  templateUrl: './heatmap.progress.html',
  styleUrls: ['./heatmap.progress.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeatmapProgressComponent implements OnInit, OnDestroy {

  totalProgress: number;
  bufferProgress: number;

  private totalProgressSubscription: Subscription
  private bufferProgressSubscription: Subscription


  constructor(@Inject(MAT_BOTTOM_SHEET_DATA) public data: any,
              private bottomSheetRef: MatBottomSheetRef<HeatmapProgressComponent>,
              private snackBar: MatSnackBar,
              private changeDetectorRef: ChangeDetectorRef) {
    this.totalProgressSubscription = data.totalProgress.subscribe((value) => {
      this.totalProgress = value
      this.changeDetectorRef.detectChanges()
      if (this.totalProgress === 100) {
        this.bottomSheetRef.dismiss();
        this.snackBar.open(`Heatmap generated successfully`, null, {
          duration: 2000,
        });
      }
    })
    this.bufferProgressSubscription = data.bufferProgress.subscribe((value) => {
      this.bufferProgress = value
      this.changeDetectorRef.detectChanges()
    })
  }


  ngOnInit() {
  }

  ngOnDestroy(): void {
    if (this.totalProgressSubscription) {
      this.totalProgressSubscription.unsubscribe()
    }
    if (this.bufferProgressSubscription) {
      this.bufferProgressSubscription.unsubscribe()
    }
  }
}
