import { Component, inject, Inject, Optional } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppEventService } from '../../../services/app.event.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { LoggerService } from '../../../services/logger.service';
import { environment } from '../../../../environments/environment';
import { Auth, getIdToken } from '@angular/fire/auth';
import { UploadAbstractDirective } from '../upload-abstract.directive';
import { FileInterface } from '../file.interface';
import { AppProcessingService } from '../../../services/app.processing.service';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getSize } from '@sports-alliance/sports-lib';
import { AppFunctionsService } from '../../../services/app.functions.service';


@Component({
  selector: 'app-upload-activity-to-service',
  templateUrl: './upload-activities-to-service.component.html',
  styleUrls: ['../upload-abstract.css', './upload-activities-to-service.component.css'],
  standalone: false
})

export class UploadActivitiesToServiceComponent extends UploadAbstractDirective {
  protected snackBar = inject(MatSnackBar);
  protected dialog = inject(MatDialog);
  protected processingService = inject(AppProcessingService);
  protected router = inject(Router);
  protected logger = inject(LoggerService);
  public data = inject(MAT_DIALOG_DATA, { optional: true });
  public dialogRef = inject(MatDialogRef<UploadActivitiesToServiceComponent>, { optional: true });
  private auth = inject(Auth);
  private eventService = inject(AppEventService);
  private userService = inject(AppUserService);
  private analyticsService = inject(AppAnalyticsService);

  private functionsService = inject(AppFunctionsService);
  private serviceName: ServiceNames = ServiceNames.SuuntoApp;

  constructor() {
    super();
    if (this.data?.serviceName) {
      this.serviceName = this.data.serviceName;
    }
  }

  /**
   * Process each uploaded GPX
   * @returns {Promise}
   * @param file
   */
  async processAndUploadFile(file: FileInterface) {
    this.analyticsService.logEvent('upload_activity_to_service', { service: ServiceNames.SuuntoApp });
    return new Promise<boolean>((resolve, reject) => {
      const fileReader = new FileReader();
      fileReader.onload = async () => {
        if (!(fileReader.result instanceof ArrayBuffer) || file.extension !== 'fit') {
          reject('Not a valid file');
          return;
        }
        if (!this.auth.currentUser) {
          reject('User not logged in');
          return;
        }
        const idToken = await getIdToken(this.auth.currentUser, true);
        try {
          if (getSize(fileReader.result) > 10485760) {
            throw new Error(`Cannot upload route because the size is greater than 10MB`);
          }

          // Convert ArrayBuffer to Base64
          const base64String = btoa(new Uint8Array(fileReader.result as ArrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));

          if (file.jobId) {
            this.processingService.updateJob(file.jobId, { progress: 50 });
          }

          this.functionsService.call<any, { status: string; code?: string; message?: string }>(
            'importActivityToSuuntoApp',
            { file: base64String }
          ).then((response) => {
            if (file.jobId) {
              this.processingService.updateJob(file.jobId, { progress: 100 });
            }
            if (response.data.code === 'ALREADY_EXISTS') {
              if (file.jobId) {
                this.processingService.updateJob(file.jobId, { status: 'duplicate', details: 'Activity already exists in Suunto' });
              }
              this.snackBar.open(`Activity already exists in Suunto: ${file.filename}.${file.extension}`, 'OK', { duration: 5000 });
              resolve(true);
            } else {
              resolve(true);
            }
          }).catch((e) => {
            this.logger.error(e);
            const errorMessage = e.message || 'Unknown error';
            this.snackBar.open(`Could not upload ${file.filename}.${file.extension}, reason: ${errorMessage} `, 'OK', { duration: 10000 });
            reject(e);
          });

        } catch (e: any) {
          this.logger.error(e);
          const errorMessage = typeof e.error === 'string' ? e.error : e.message;
          this.snackBar.open(`Could not upload ${file.filename}.${file.extension}, reason: ${errorMessage} `, 'OK', { duration: 10000 });
          reject(e);
          return;
        }
      };

      // Read it depending on the extension
      if (file.extension === 'fit') {
        fileReader.readAsArrayBuffer(file.file);
      } else {
        reject('Unknown file type');
      }
    });
  }
}
