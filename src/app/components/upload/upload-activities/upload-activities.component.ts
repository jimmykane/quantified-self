import { Component, inject, Input, OnInit } from '@angular/core';
import { Overlay } from '@angular/cdk/overlay';
import { MatBottomSheet } from '@angular/material/bottom-sheet';

import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { AppEventService } from '../../../services/app.event.service';
import { AppFitUploadService } from '../../../services/app.fit-upload.service';
import { UploadAbstractDirective } from '../upload-abstract.directive';
import { USAGE_LIMITS } from '../../../../../functions/src/shared/limits';

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

  processAndUploadFile(file: { file: File; extension: string; filename: string }): Promise<{ eventId: string }> {
    this.analyticsService.logEvent('upload_file', { method: 'fit' });
    return new Promise((resolve, reject) => {
      if (file.extension !== 'fit') {
        reject(new Error('Only FIT files are supported.'));
        return;
      }

      const fileReader = new FileReader();
      fileReader.onload = async () => {
        try {
          const payload = fileReader.result;
          if (!(payload instanceof ArrayBuffer)) {
            throw new Error('Could not read FIT file payload.');
          }

          const uploadResult = await this.fitUploadService.uploadFitFile(payload, `${file.filename}.${file.extension}`);
          await this.calculateRemainingUploads();

          this.logger.log('[UploadActivitiesComponent] Uploaded FIT event', uploadResult.eventId);
          resolve({ eventId: uploadResult.eventId });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown upload error.';
          this.snackBar.open(`Could not upload ${file.filename}.${file.extension}, reason: ${message}`, 'OK', { duration: 4000 });
          reject(error);
        }
      };

      fileReader.onerror = () => {
        const error = new Error('Could not read FIT file.');
        this.snackBar.open(`Could not upload ${file.filename}.${file.extension}, reason: ${error.message}`, 'OK', { duration: 4000 });
        reject(error);
      };

      fileReader.readAsArrayBuffer(file.file);
    });
  }
}
