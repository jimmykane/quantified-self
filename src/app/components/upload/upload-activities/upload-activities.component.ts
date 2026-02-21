import { Component, inject, Input, OnInit } from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';
import { MatBottomSheet } from '@angular/material/bottom-sheet';

import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { AppEventService } from '../../../services/app.event.service';
import { AppFitUploadService } from '../../../services/app.fit-upload.service';
import { UploadAbstractDirective } from '../upload-abstract.directive';
import { FileInterface } from '../file.interface';
import { USAGE_LIMITS } from '../../../../../functions/src/shared/limits';
import { BrowserCompatibilityService } from '../../../services/browser.compatibility.service';

const SUPPORTED_UPLOAD_EXTENSIONS = new Set(['fit', 'gpx', 'tcx', 'json', 'sml']);
const TEXT_COMPRESSIBLE_EXTENSIONS = new Set(['gpx', 'tcx', 'json', 'sml']);

@Component({
  selector: 'app-upload-activities',
  templateUrl: './upload-activities.component.html',
  styleUrls: ['../upload-abstract.css', './upload-activities.component.css'],
  standalone: false
})
export class UploadActivitiesComponent extends UploadAbstractDirective implements OnInit {
  @Input() isHandset: boolean = false;

  protected bottomSheet = inject(MatBottomSheet);
  protected overlay = inject(Overlay);
  protected eventService = inject(AppEventService);
  protected analyticsService = inject(AppAnalyticsService);
  protected authService = inject(AppAuthService);
  protected fitUploadService = inject(AppFitUploadService);
  protected browserCompatibilityService = inject(BrowserCompatibilityService);

  public uploadCount: number | null = null;
  public uploadLimit: number | null = null;

  constructor() {
    super();
  }

  async ngOnInit() {
    const user = await this.authService.getUser();
    if (user) {
      this.user = user;
    }
    super.ngOnInit();
    await this.calculateRemainingUploads();
  }

  async calculateRemainingUploads() {
    if (!this.user) return;

    if (this.userService.hasProAccessSignal()) {
      this.uploadCount = null;
      this.uploadLimit = null;
      return;
    }

    this.uploadCount = await this.eventService.getEventCount(this.user);
    const role = await this.userService.getSubscriptionRole() || 'free';
    this.uploadLimit = USAGE_LIMITS[role] || USAGE_LIMITS['free'];
  }

  private hasGzipMagic(data: ArrayBuffer): boolean {
    const bytes = new Uint8Array(data);
    return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  }

  private async gzipPayload(data: ArrayBuffer): Promise<ArrayBuffer> {
    const sourceStream = new Response(data).body;
    if (!sourceStream) {
      throw new Error('Could not initialize compression stream.');
    }
    const compressedStream = sourceStream.pipeThrough(new CompressionStream('gzip'));
    return new Response(compressedStream).arrayBuffer();
  }

  private async prepareUploadPayload(extension: string, payload: ArrayBuffer): Promise<{ bytes: ArrayBuffer; extension: string }> {
    if (!TEXT_COMPRESSIBLE_EXTENSIONS.has(extension)) {
      return { bytes: payload, extension };
    }

    if (this.hasGzipMagic(payload)) {
      return { bytes: payload, extension: `${extension}.gz` };
    }

    if (!this.browserCompatibilityService.checkCompressionSupport()) {
      return { bytes: payload, extension };
    }

    const compressed = await this.gzipPayload(payload);
    return { bytes: compressed, extension: `${extension}.gz` };
  }

  processAndUploadFile(file: FileInterface): Promise<{ eventId: string }> {
    const extension = file.extension.toLowerCase().trim();
    this.analyticsService.logEvent('upload_file', { method: extension });
    return new Promise((resolve, reject) => {
      if (!SUPPORTED_UPLOAD_EXTENSIONS.has(extension)) {
        reject(new Error('Only FIT, GPX, TCX, JSON, and SML files are supported.'));
        return;
      }

      const fileReader = new FileReader();
      fileReader.onload = async () => {
        try {
          const payload = fileReader.result;
          if (!(payload instanceof ArrayBuffer)) {
            throw new Error('Could not read file payload.');
          }

          const preparedUpload = await this.prepareUploadPayload(extension, payload);
          const originalFilename = file.name && file.name.trim().length > 0
            ? file.name
            : `${file.filename}.${extension}`;
          const uploadResult = await this.fitUploadService.uploadActivityFile(
            preparedUpload.bytes,
            preparedUpload.extension,
            originalFilename,
          );
          await this.calculateRemainingUploads();

          this.logger.log('[UploadActivitiesComponent] Uploaded event', uploadResult.eventId);
          resolve({ eventId: uploadResult.eventId });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown upload error.';
          this.snackBar.open(`Could not upload ${file.name}, reason: ${message}`, 'OK', { duration: 4000 });
          reject(error);
        }
      };

      fileReader.onerror = () => {
        const error = new Error('Could not read file.');
        this.snackBar.open(`Could not upload ${file.name}, reason: ${error.message}`, 'OK', { duration: 4000 });
        reject(error);
      };

      fileReader.readAsArrayBuffer(file.file);
    });
  }
}
