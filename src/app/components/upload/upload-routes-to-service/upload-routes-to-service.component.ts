import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LoggerService } from '../../../services/logger.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { environment } from '../../../../environments/environment';
import { HttpClient, HttpHeaders, HttpEventType } from '@angular/common/http';
import { Auth, getIdToken } from '@angular/fire/auth';
import { UploadAbstractDirective } from '../upload-abstract.directive';
import { FileInterface } from '../file.interface';
import { AppProcessingService } from '../../../services/app.processing.service';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getSize } from '@sports-alliance/sports-lib';
import { BrowserCompatibilityService } from '../../../services/browser.compatibility.service';



@Component({
  selector: 'app-upload-route-to-service',
  templateUrl: './upload-routes-to-service.component.html',
  styleUrls: ['../upload-abstract.css', './upload-routes-to-service.component.css'],
  standalone: false
})

export class UploadRoutesToServiceComponent extends UploadAbstractDirective {
  private analyticsService = inject(AppAnalyticsService);
  private auth = inject(Auth);
  private compatibilityService = inject(BrowserCompatibilityService);
  private http = inject(HttpClient);

  public data: any = inject(MAT_DIALOG_DATA, { optional: true });
  public dialogRef = inject(MatDialogRef<UploadRoutesToServiceComponent>, { optional: true });

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
    this.analyticsService.logEvent('upload_route_to_service', { service: ServiceNames.SuuntoApp });
    return new Promise((resolve, reject) => {
      const fileReader = new FileReader();
      fileReader.onload = async () => {
        if (!(typeof fileReader.result === 'string')) {
          reject(`Not a GPX file`)
          return;
        }

        if (!this.auth.currentUser) {
          reject('User not logged in');
          return;
        }

        const idToken = await getIdToken(this.auth.currentUser, true);
        let compressedBuffer: ArrayBuffer;

        try {
          // Check for native support
          if (!this.compatibilityService.checkCompressionSupport()) {
            reject('Unsupported browser');
            return;
          }

          const stream = new Blob([fileReader.result as string]).stream();
          const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
          compressedBuffer = await new Response(compressedStream).arrayBuffer();

          if (compressedBuffer.byteLength > 10485760) {
            throw new Error(`Cannot upload route because the size is greater than 10MB`);
          }
        } catch (e: any) {
          this.logger.error(e);
          const errorMessage = e.message || 'Compression failed';
          this.snackBar.open(`Could not process ${file.filename}.${file.extension}, reason: ${errorMessage} `, 'OK', { duration: 10000 });
          reject(e);
          return;
        }

        this.http.post(environment.functions.uploadRoute,
          compressedBuffer,
          {
            headers:
              new HttpHeaders({
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
              const errorMessage = e.error?.message || e.error || e.message;
              this.snackBar.open(`Could not upload ${file.filename}.${file.extension}, reason: ${errorMessage} `, 'OK', { duration: 10000 });
              reject(e);
            }
          });
      }

      // Read it depending on the extension
      if (file.extension === 'gpx') {
        fileReader.readAsText(file.file);
      } else {
        reject('Unknown file type');
      }
    })
  }
}
