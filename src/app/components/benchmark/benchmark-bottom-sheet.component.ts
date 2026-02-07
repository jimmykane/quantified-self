import { Component, ElementRef, Inject, ViewChild, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
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
  providers: [DatePipe],
  standalone: false
})
export class BenchmarkBottomSheetComponent {
  @ViewChild('shareFrame') shareFrame?: ElementRef<HTMLElement>;
  referenceColor = '';
  testColor = '';
  isSharing = false;
  shareTimestamp = new Date();

  private datePipe = inject(DatePipe);

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
    const shareWindow = this.openShareWindow();

    try {
      const isMobile = window.matchMedia('(max-width: 600px)').matches;
      const appUrl = environment.appUrl || window.location.origin;
      const displayUrl = this.getDisplayUrl(appUrl);
      const filename = `benchmark-${this.shareTimestamp.getTime()}.png`;
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

      const shared = await this.tryNativeShare(dataUrl, filename);
      if (shared) {
        if (shareWindow) {
          shareWindow.close();
        }
        return;
      }

      if (shareWindow) {
        this.renderShareWindow(shareWindow, dataUrl);
      } else {
        this.downloadShareImage(dataUrl, filename);
      }
    } catch (error) {
      if (shareWindow) {
        this.renderShareWindowError(shareWindow);
      }
      console.error('Failed to share benchmark image', error);
    } finally {
      this.isSharing = false;
    }
  }

  private formatShareDate(date: Date): string {
    const datePart = this.datePipe.transform(date, 'mediumDate');
    const timePart = this.datePipe.transform(date, 'shortTime');
    if (datePart && timePart) {
      return `${datePart}, ${timePart}`;
    }
    return date.toISOString();
  }

  private getDisplayUrl(appUrl: string): string {
    try {
      return new URL(appUrl).host;
    } catch {
      return appUrl.replace(/^https?:\/\//, '');
    }
  }

  private openShareWindow(): Window | null {
    const shareWindow = window.open('', '_blank');
    if (!shareWindow) return null;

    shareWindow.document.write(`
      <!doctype html>
      <html>
        <head><title>Benchmark Share</title></head>
        <body style="margin:0; background:#111; color:#fff; font-family:Arial, sans-serif; display:flex; justify-content:center; align-items:center; height:100vh;">
          <div>Generating benchmark image...</div>
        </body>
      </html>
    `);
    shareWindow.document.close();
    return shareWindow;
  }

  private renderShareWindow(shareWindow: Window, dataUrl: string): void {
    shareWindow.document.open();
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
  }

  private renderShareWindowError(shareWindow: Window): void {
    shareWindow.document.open();
    shareWindow.document.write(`
      <!doctype html>
      <html>
        <head><title>Benchmark Share</title></head>
        <body style="margin:0; background:#111; color:#fff; font-family:Arial, sans-serif; display:flex; justify-content:center; align-items:center; height:100vh;">
          <div>Unable to generate the benchmark image.</div>
        </body>
      </html>
    `);
    shareWindow.document.close();
  }

  private downloadShareImage(dataUrl: string, filename: string): void {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.rel = 'noopener';
    link.click();
  }

  private async tryNativeShare(dataUrl: string, filename: string): Promise<boolean> {
    if (!('share' in navigator)) return false;
    const file = this.dataUrlToFile(dataUrl, filename);
    if (!file) return false;

    const shareData: ShareData = {
      files: [file],
      title: 'Benchmark Report',
    };

    if (navigator.canShare && !navigator.canShare(shareData)) {
      return false;
    }

    try {
      await navigator.share(shareData);
      return true;
    } catch {
      return false;
    }
  }

  private dataUrlToFile(dataUrl: string, filename: string): File | null {
    if (typeof File === 'undefined') return null;
    const parts = dataUrl.split(',');
    if (parts.length !== 2) return null;

    const meta = parts[0];
    const base64 = parts[1];
    const mimeMatch = meta.match(/data:(.*?);base64/i);
    const mime = mimeMatch?.[1] ?? 'image/png';

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    return new File([bytes], filename, { type: mime });
  }
}
