import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';

@Component({
  selector: 'app-my-tracks-progress-info',
  templateUrl: './tracks.progress.html',
  styleUrls: ['./tracks.progress.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class MyTracksProgressComponent implements OnInit, OnDestroy {

  totalProgress = 0;
  bufferProgress = 0;

  private totalProgressSubscription: Subscription
  private bufferProgressSubscription: Subscription


  private data = inject(MAT_BOTTOM_SHEET_DATA);
  private bottomSheetRef = inject(MatBottomSheetRef<MyTracksProgressComponent>);
  private changeDetectorRef = inject(ChangeDetectorRef);

  constructor() {
    this.totalProgressSubscription = this.data.totalProgress.subscribe((value: number) => {
      this.totalProgress = value
      this.changeDetectorRef.detectChanges()
      if (this.totalProgress >= 100) {
        this.bottomSheetRef.dismiss();
      }
    })
    this.bufferProgressSubscription = this.data.bufferProgress.subscribe((value: number) => {
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
