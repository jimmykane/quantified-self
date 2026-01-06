import { Component, inject, Inject, Optional } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppEventService } from '../../../services/app.event.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { LoggerService } from '../../../services/logger.service';
import { environment } from '../../../../environments/environment';
import { HttpClient, HttpHeaders, HttpEventType } from '@angular/common/http';
import { Auth, getIdToken } from '@angular/fire/auth';
import { UploadAbstractDirective } from '../upload-abstract.directive';
import { FileInterface } from '../file.interface';
import { AppProcessingService } from '../../../services/app.processing.service';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getSize } from '@sports-alliance/sports-lib';


@Component({
  selector: 'app-upload-activity-to-service',
  templateUrl: './upload-activities-to-service.component.html',
  styleUrls: ['../upload-abstract.css', './upload-activities-to-service.component.css'],
  standalone: false
})

export class UploadActivitiesToServiceComponent extends UploadAbstractDirective {
  private auth = inject(Auth);
  private eventService = inject(AppEventService);
  private userService = inject(AppUserService);
  private analyticsService = inject(AppAnalyticsService);
  private http = inject(HttpClient);
  private serviceName: ServiceNames = ServiceNames.SuuntoApp;

  constructor(
    protected snackBar: MatSnackBar,
    protected dialog: MatDialog,
    protected processingService: AppProcessingService,
    protected router: Router,
    @Optional() @Inject(MAT_DIALOG_DATA) public data: any,
    @Optional() public dialogRef: MatDialogRef<UploadActivitiesToServiceComponent>,
    logger: LoggerService) {
    super(snackBar, dialog, processingService, router, logger);
    if (data?.serviceName) {
      this.serviceName = data.serviceName;
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

          this.http.post(environment.functions.uploadActivity,
            fileReader.result,
            {
              headers: new HttpHeaders({
                'Authorization': `Bearer ${idToken} `,
                'Content-Type': 'application/octet-stream'
              }),
              reportProgress: true,
              observe: 'events'
            }).subscribe({
              next: (event: any) => {
                if (event.type === HttpEventType.UploadProgress) {
                  const percentDone = Math.round((100 * event.loaded) / event.total);
                  if (file.jobId) {
                    this.processingService.updateJob(file.jobId, { progress: percentDone });
                  }
                } else if (event.type === HttpEventType.Response) {
                  resolve(true);
                }
              },
              error: (e: any) => {
                this.logger.error(e);
                this.snackBar.open(`Could not upload ${file.filename}.${file.extension}, reason: ${e.message} `, 'OK', { duration: 10000 });
                reject(e);
              }
            });

        } catch (e: any) {
          this.logger.error(e);
          this.snackBar.open(`Could not upload ${file.filename}.${file.extension}, reason: ${e.message} `, 'OK', { duration: 10000 });
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
