import { Component, ElementRef, Inject, ViewChild } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { BenchmarkResult } from '../../../../functions/src/shared/app-event.interface';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { EventInterface, UserSummariesSettingsInterface, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { AppShareService } from '../../services/app.share.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-benchmark-bottom-sheet',
  template: `
    <div class="bottom-sheet-container">
        <app-bottom-sheet-header title="Hardware Benchmark Analysis" icon="analytics">
            <button mat-icon-button class="icon-button-square" matTooltip="Share as image" (click)="shareBenchmark()" [disabled]="isSharing" aria-busy="{{isSharing}}">
                <mat-icon>share</mat-icon>
            </button>
            <button mat-icon-button matTooltip="Re-run with different activities" (click)="rerun()">
                <mat-icon>refresh</mat-icon>
            </button>
            <button mat-icon-button (click)="close()">
                <mat-icon>close</mat-icon>
            </button>
        </app-bottom-sheet-header>
        <mat-progress-bar *ngIf="isSharing" class="share-progress" mode="indeterminate" color="accent"></mat-progress-bar>
        <div class="bottom-sheet-content qs-scrollbar">
            <div #shareFrame class="benchmark-share-frame">
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
    </div>
  `,
  styleUrls: ['./benchmark-bottom-sheet.component.css'],
  standalone: false
})
export class BenchmarkBottomSheetComponent {
  @ViewChild('shareFrame') shareFrame?: ElementRef<HTMLElement>;
  referenceColor = '';
  testColor = '';
  isSharing = false;
  shareTimestamp = new Date();

  constructor(
    @Inject(MAT_BOTTOM_SHEET_DATA) public data: {
      result: BenchmarkResult;
      event?: EventInterface;
      unitSettings?: UserUnitSettingsInterface;
      summariesSettings?: UserSummariesSettingsInterface;
    },
    private bottomSheetRef: MatBottomSheetRef<BenchmarkBottomSheetComponent>,
    private eventColorService: AppEventColorService,
    private shareService: AppShareService
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

  async shareBenchmark(): Promise<void> {
    if (this.isSharing || !this.shareFrame?.nativeElement) {
      return;
    }
    this.isSharing = true;
    this.shareTimestamp = new Date();

    try {
      const isMobile = window.matchMedia('(max-width: 600px)').matches;
      const appUrl = environment.appUrl || window.location.origin;
      const displayUrl = this.getDisplayUrl(appUrl);
      const dataUrl = await this.shareService.shareBenchmarkAsImage(this.shareFrame.nativeElement, {
        scale: isMobile ? 1.5 : 2,
        width: 1080,
        watermark: {
          brand: 'Quantified Self',
          timestamp: this.formatShareDate(this.shareTimestamp),
          url: displayUrl,
          logoUrl: 'assets/logos/app/logo.svg',
        }
      });

      const shareWindow = window.open();
      if (shareWindow) {
        shareWindow.document.write(`
          <!doctype html>
          <html>
            <head><title>Benchmark Share</title></head>
            <body style="margin:0; background:#111; display:flex; justify-content:center; align-items:center;">
              <img src="${dataUrl}" alt="Benchmark Share" style="max-width:100%; height:auto;" />
            </body>
          </html>
        `);
        shareWindow.document.close();
      } else {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `benchmark-${this.shareTimestamp.getTime()}.png`;
        link.click();
      }
    } catch (error) {
      console.error('Failed to share benchmark image', error);
    } finally {
      this.isSharing = false;
    }
  }

  private formatShareDate(date: Date): string {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }

  private getDisplayUrl(appUrl: string): string {
    try {
      return new URL(appUrl).host;
    } catch {
      return appUrl.replace(/^https?:\/\//, '');
    }
  }
}
