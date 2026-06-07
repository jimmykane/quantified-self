import { Component, EventEmitter, inject, Input, OnInit, Output } from '@angular/core';

import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { AppRouteService } from '../../../services/app.route.service';
import { AppRouteUploadService } from '../../../services/app.route-upload.service';
import { BrowserCompatibilityService } from '../../../services/browser.compatibility.service';
import { SharedModule } from '../../../modules/shared.module';
import { FileInterface } from '../file.interface';
import { UploadAbstractDirective, UploadBatchSummary } from '../upload-abstract.directive';
import { getRouteUsageLimitForRole } from '@shared/limits';

const SUPPORTED_ROUTE_UPLOAD_EXTENSIONS = new Set(['fit', 'gpx']);
const TEXT_COMPRESSIBLE_ROUTE_EXTENSIONS = new Set(['gpx']);

@Component({
  selector: 'app-upload-routes',
  templateUrl: './upload-routes.component.html',
  styleUrls: ['../upload-abstract.css', '../upload-activities/upload-activities.component.css'],
  standalone: true,
  imports: [SharedModule],
})
export class UploadRoutesComponent extends UploadAbstractDirective implements OnInit {
  @Input() isHandset: boolean = false;
  @Input() uploadLabel: string | null = null;
  @Input() upgradeLabel: string | null = null;
  @Input() disabled = false;
  @Input() promptAction = false;
  @Input() showUploadIcon = false;
  @Input() showRemainingCountWithCustomLabel = false;
  @Input() uploadIcon = 'route';
  @Output() routeUploadComplete = new EventEmitter<UploadBatchSummary>();

  protected routeService = inject(AppRouteService);
  protected analyticsService = inject(AppAnalyticsService);
  protected authService = inject(AppAuthService);
  protected routeUploadService = inject(AppRouteUploadService);
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

    const authUser = this.authService.currentUser;
    if (!authUser || authUser.uid !== this.user.uid) {
      return;
    }

    try {
      this.uploadCount = await this.routeService.getRouteCount(this.user);
    } catch (error: unknown) {
      if (this.isPermissionDeniedError(error)) {
        const currentAuthUser = this.authService.currentUser;
        if (!currentAuthUser || currentAuthUser.uid !== this.user.uid) {
          this.logger.warn('[UploadRoutesComponent] Skipping upload count during auth transition', {
            requestedUid: this.user.uid,
            authUid: currentAuthUser?.uid || null,
          });
          return;
        }
      }

      throw error;
    }

    const role = await this.userService.getSubscriptionRole() || 'free';
    try {
      this.uploadLimit = getRouteUsageLimitForRole(role);
    } catch (error) {
      this.logger.error(`[UploadRoutesComponent] Unsupported route upload limit role '${role}'`, error);
      this.uploadLimit = getRouteUsageLimitForRole('free');
    }
  }

  private isPermissionDeniedError(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return code === 'permission-denied' || code === 'firestore/permission-denied';
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
    if (!TEXT_COMPRESSIBLE_ROUTE_EXTENSIONS.has(extension)) {
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

  processAndUploadFile(file: FileInterface): Promise<{ routeId: string; duplicate?: boolean }> {
    const extension = file.extension.toLowerCase().trim();
    this.analyticsService.logEvent('upload_route_file', { method: extension });
    return new Promise((resolve, reject) => {
      if (!SUPPORTED_ROUTE_UPLOAD_EXTENSIONS.has(extension)) {
        reject(new Error('Only FIT and GPX route files are supported.'));
        return;
      }

      const fileReader = new FileReader();
      fileReader.onload = async () => {
        try {
          const payload = fileReader.result;
          if (!(payload instanceof ArrayBuffer)) {
            throw new Error('Could not read route file payload.');
          }

          const preparedUpload = await this.prepareUploadPayload(extension, payload);
          const originalFilename = file.name && file.name.trim().length > 0
            ? file.name
            : `${file.filename}.${extension}`;
          const uploadResult = await this.routeUploadService.uploadRouteFile(
            preparedUpload.bytes,
            preparedUpload.extension,
            originalFilename,
          );
          await this.calculateRemainingUploads();

          this.logger.log('[UploadRoutesComponent] Uploaded route', uploadResult.routeId);
          resolve({ routeId: uploadResult.routeId, duplicate: uploadResult.duplicate });
        } catch (error: unknown) {
          const message = this.getUploadErrorMessage(error);
          this.snackBar.open(`Could not upload ${file.name}, reason: ${message}`, 'OK', { duration: 4000 });
          reject(error);
        }
      };

      fileReader.onerror = () => {
        const error = new Error('Could not read route file.');
        this.snackBar.open(`Could not upload ${file.name}, reason: ${error.message}`, 'OK', { duration: 4000 });
        reject(error);
      };

      fileReader.readAsArrayBuffer(file.file);
    });
  }

  private getUploadErrorMessage(error: unknown): string {
    const rawMessage = error instanceof Error ? error.message : 'Unknown route upload error.';
    const genericStatusMatch = rawMessage.match(/^Route upload failed \((\d{3})\)\.?$/);
    if (!genericStatusMatch) {
      return rawMessage;
    }

    const status = Number(genericStatusMatch[1]);
    if (status >= 500) {
      return 'Route upload failed because the server is temporarily unavailable. Please try again shortly.';
    }
    if (status === 429) {
      return 'Route upload limit reached for your current plan.';
    }
    if (status === 401) {
      return 'Route upload is not authorized. Please sign in again.';
    }
    if (status === 400) {
      return 'Could not process uploaded route file. Check file format and try again.';
    }

    return rawMessage;
  }

  protected override onUploadBatchFinished(summary: UploadBatchSummary): void {
    if (summary.successfulUploads > 0) {
      this.routeUploadComplete.emit(summary);
    }
  }

  protected override getDuplicateUploadMessage(): string {
    return 'Route already exists';
  }
}
