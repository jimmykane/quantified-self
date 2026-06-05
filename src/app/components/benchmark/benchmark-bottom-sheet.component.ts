import { Component, ElementRef, Inject, ViewChild, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppEventInterface, BenchmarkResult } from '@shared/app-event.interface';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { AppBreakpoints } from '../../constants/breakpoints';
import { EventInterface, User, UserSummariesSettingsInterface, UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { AppShareService } from '../../services/app.share.service';
import { environment } from '../../../environments/environment';
import { saveAs } from 'file-saver';
import { BenchmarkReviewService } from '../../services/benchmark-review.service';
import { BenchmarkReviewTagsDialogComponent } from './benchmark-review-tags-dialog.component';

type NativeShareStatus = 'shared' | 'unsupported' | 'cancelled' | 'failed';

@Component({
  selector: 'app-benchmark-bottom-sheet',
  template: `
    <div class="bottom-sheet-container">
        <app-bottom-sheet-header title="Hardware Benchmark Analysis" icon="analytics">
            <button mat-icon-button class="icon-button-square" matTooltip="Share options" [matMenuTriggerFor]="shareMenu" [disabled]="isSharing" aria-busy="{{isSharing}}">
                <mat-icon>share</mat-icon>
            </button>
            <mat-menu #shareMenu="matMenu" xPosition="before" class="qs-menu-panel">
              <button mat-menu-item (click)="shareBenchmark()" [disabled]="isSharing">
                <mat-icon>share</mat-icon>
                <span>Share</span>
              </button>
              <button mat-menu-item (click)="copyBenchmarkSummary()" [disabled]="isSharing">
                <mat-icon>content_copy</mat-icon>
                <span>Copy summary</span>
              </button>
              <button mat-menu-item (click)="openReviewTagsDialog()" [disabled]="isSharing || !canEditReviewTags">
                <mat-icon>sell</mat-icon>
                <span>Edit tags</span>
              </button>
              <button mat-menu-item (click)="downloadBenchmark()" [disabled]="isSharing">
                <mat-icon>download</mat-icon>
                <span>Save image</span>
              </button>
            </mat-menu>
            <button mat-icon-button matTooltip="Re-run with different activities" (click)="rerun()">
                <mat-icon>refresh</mat-icon>
            </button>
            <button mat-icon-button (click)="close()">
                <mat-icon>close</mat-icon>
            </button>
        </app-bottom-sheet-header>
        <mat-progress-bar *ngIf="isSharing" class="share-progress qs-progress-accent" mode="indeterminate"></mat-progress-bar>
        <div class="bottom-sheet-content qs-scrollbar">
            <div #shareFrame class="benchmark-share-frame">
              <app-benchmark-report
                  [result]="data.result"
                  [event]="data.event"
                  [unitSettings]="data.unitSettings"
                  [summariesSettings]="data.summariesSettings"
                  [benchmarkReviewTags]="benchmarkReviewTags"
                  [referenceColor]="referenceColor"
                  [testColor]="testColor">
              </app-benchmark-report>
            </div>
        </div>
    </div>
  `,
  styleUrls: ['./benchmark-bottom-sheet.component.scss'],
  providers: [DatePipe],
  standalone: false
})
export class BenchmarkBottomSheetComponent {
  @ViewChild('shareFrame') shareFrame?: ElementRef<HTMLElement>;
  referenceColor = '';
  testColor = '';
  isSharing = false;
  shareTimestamp = new Date();
  benchmarkReviewTags: string[] = [];
  canEditReviewTags = false;

  private datePipe = inject(DatePipe);
  private dialog = inject(MatDialog);

  constructor(
    @Inject(MAT_BOTTOM_SHEET_DATA) public data: {
      result: BenchmarkResult;
      event?: EventInterface;
      persistEvent?: AppEventInterface;
      user?: User;
      onEventTagsSaved?: (tags: string[]) => void;
      reviewTagSuggestions?: string[];
      unitSettings?: UserUnitSettingsInterface;
      summariesSettings?: UserSummariesSettingsInterface;
      brandText?: string | null;
    },
    private bottomSheetRef: MatBottomSheetRef<BenchmarkBottomSheetComponent>,
    private eventColorService: AppEventColorService,
    private shareService: AppShareService,
    private snackBar: MatSnackBar,
    private benchmarkReviewService: BenchmarkReviewService
  ) {
    this.benchmarkReviewTags = this.benchmarkReviewService.getEventTags(this.data.persistEvent);
    this.canEditReviewTags = !!this.data.user && !!this.data.persistEvent?.getID?.();
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

  copyBenchmarkSummary(): void {
    const copied = this.benchmarkReviewService.copySummary(this.data.result, this.benchmarkReviewTags);
    this.snackBar.open(copied ? 'Benchmark summary copied.' : 'Could not copy benchmark summary.', undefined, { duration: 2500 });
  }

  openReviewTagsDialog(): void {
    const user = this.data.user;
    const event = this.data.persistEvent;
    if (!user || !event?.getID?.()) {
      this.snackBar.open('Sign in to edit review tags.', undefined, { duration: 3000 });
      return;
    }

    const dialogRef = this.dialog.open(BenchmarkReviewTagsDialogComponent, {
      width: 'min(34rem, calc(100vw - 32px))',
      maxWidth: 'calc(100vw - 32px)',
      data: {
        title: 'Benchmark tags',
        tags: this.benchmarkReviewTags,
        suggestions: this.benchmarkReviewService.normalizeTags([
          ...(this.data.reviewTagSuggestions || []),
          ...this.benchmarkReviewTags,
        ]),
        save: async (tags: string[]) => {
          const savedTags = await this.benchmarkReviewService.saveEventTags(user, event, tags);
          this.benchmarkReviewTags = savedTags;
          this.data.onEventTagsSaved?.(savedTags);
          return savedTags;
        },
      },
    });

    dialogRef.afterClosed().subscribe((savedTags: string[] | null | undefined) => {
      if (!Array.isArray(savedTags)) {
        return;
      }
      this.benchmarkReviewTags = savedTags;
      this.snackBar.open('Review tags saved.', undefined, { duration: 2000 });
    });
  }

  async shareBenchmark(): Promise<void> {
    if (this.isSharing || !this.shareFrame?.nativeElement) {
      return;
    }
    this.isSharing = true;

    try {
      const payload = await this.buildSharePayload();
      if (!payload) {
        return;
      }

      const nativeShareStatus = await this.tryNativeShare(payload.imageBlob, payload.filename);
      if (nativeShareStatus === 'shared') {
        return;
      }
      if (nativeShareStatus === 'cancelled') {
        this.notifyShareIssue('Share canceled.');
        return;
      }
      if (nativeShareStatus === 'failed') {
        this.notifyShareIssue('Native share failed. Downloading image instead.');
      }
      if (nativeShareStatus === 'unsupported') {
        this.notifyShareIssue('Native share is not available. Downloading image instead.');
      }

      this.downloadShareImage(payload.imageBlob, payload.filename);
    } catch (error) {
      console.error('Failed to share benchmark image', error);
      const details = this.getErrorMessage(error);
      this.notifyShareIssue(`Share failed while generating image. ${details}`);
    } finally {
      this.isSharing = false;
    }
  }

  async downloadBenchmark(): Promise<void> {
    if (this.isSharing || !this.shareFrame?.nativeElement) {
      return;
    }
    this.isSharing = true;

    try {
      const payload = await this.buildSharePayload();
      if (!payload) {
        return;
      }

      this.downloadShareImage(payload.imageBlob, payload.filename);
      this.notifyShareIssue('Benchmark image downloaded.');
    } catch (error) {
      console.error('Failed to download benchmark image', error);
      const details = this.getErrorMessage(error);
      this.notifyShareIssue(`Download failed while generating image. ${details}`);
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

  private getAppLogoUrl(): string {
    return new URL('assets/logos/app/logo-100x100.png', document.baseURI).toString();
  }

  private async buildSharePayload(): Promise<{ imageBlob: Blob; filename: string } | null> {
    this.shareTimestamp = new Date();
    const isMobile = window.matchMedia(AppBreakpoints.XSmall).matches;
    const appUrl = environment.appUrl || window.location.origin;
    const displayUrl = this.getDisplayUrl(appUrl);
    const filename = `benchmark-${this.shareTimestamp.getTime()}.png`;
    const customBrandText = (this.data.brandText || '').trim();
    const shareFrameElement = this.shareFrame?.nativeElement;

    if (!shareFrameElement) {
      return null;
    }

    const dataUrl = await this.shareService.shareBenchmarkAsImage(shareFrameElement, {
      scale: isMobile ? 1.5 : 2,
      width: 1080,
      embedFonts: true,
      fast: isMobile,
      renderTimeoutMs: isMobile ? 10000 : 15000,
      watermark: {
        brand: customBrandText,
        timestamp: this.formatShareDate(this.shareTimestamp),
        url: displayUrl,
        logoUrl: this.getAppLogoUrl(),
      }
    });

    const imageBlob = this.dataUrlToBlob(dataUrl);
    if (!imageBlob) {
      this.notifyShareIssue('Share failed while preparing the image file.');
      return null;
    }

    return { imageBlob, filename };
  }

  private downloadShareImage(imageBlob: Blob, filename: string): void {
    saveAs(imageBlob, filename);
  }

  private async tryNativeShare(imageBlob: Blob, filename: string): Promise<NativeShareStatus> {
    if (!('share' in navigator)) return 'unsupported';
    if (typeof File === 'undefined') return 'unsupported';

    const file = new File([imageBlob], filename, { type: imageBlob.type || 'image/png' });
    const shareData: ShareData = {
      files: [file],
      title: 'Benchmark Report',
    };

    if (navigator.canShare && !navigator.canShare(shareData)) {
      return 'unsupported';
    }

    try {
      await navigator.share(shareData);
      return 'shared';
    } catch (error) {
      if (this.isShareCanceled(error)) {
        return 'cancelled';
      }
      console.error('Native share failed', error);
      return 'failed';
    }
  }

  private notifyShareIssue(message: string): void {
    this.snackBar.open(message, 'Close', { duration: 6000 });
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return 'Unknown error';
  }

  private isShareCanceled(error: unknown): boolean {
    if (!(error instanceof DOMException)) return false;
    return error.name === 'AbortError';
  }

  private dataUrlToBlob(dataUrl: string): Blob | null {
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

    return new Blob([bytes], { type: mime });
  }
}
