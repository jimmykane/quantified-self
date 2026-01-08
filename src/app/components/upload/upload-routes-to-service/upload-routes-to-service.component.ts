import { Component, inject, Inject, Optional } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LoggerService } from '../../../services/logger.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { environment } from '../../../../environments/environment';
import { HttpClient, HttpHeaders } from '@angular/common/http';
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

  private serviceName: ServiceNames; // Added this line

  constructor(
    protected snackBar: MatSnackBar,
    protected dialog: MatDialog,
    protected processingService: AppProcessingService,
    private http: HttpClient,
    protected router: Router,
    @Optional() @Inject(MAT_DIALOG_DATA) public data: any,
    @Optional() public dialogRef: MatDialogRef<UploadRoutesToServiceComponent>,
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
    this.analyticsService.logEvent('upload_route_to_service', { service: ServiceNames.SuuntoApp });
    return new Promise((resolve, reject) => {
      const fileReader = new FileReader;
      fileReader.onload = async () => {
        if (!(typeof fileReader.result === 'string')) {
          reject(`Not a GPX file`)
          return;
        }

        const idToken = await getIdToken(this.auth.currentUser, true)
        try {
          // Check for native support
          if (!this.compatibilityService.checkCompressionSupport()) {
            reject('Unsupported browser');
            return;
          }

          const stream = new Blob([fileReader.result as string]).stream();
          const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
          const compressedBuffer = await new Response(compressedStream).arrayBuffer();
          // Convert ArrayBuffer to Base64
          const compressed = btoa(String.fromCharCode(...new Uint8Array(compressedBuffer)));

          if (getSize(compressed) > 10485760) {
            throw new Error(`Cannot upload route because the size is greater than 10MB`);
          }
          await this.http.post(environment.functions.uploadRoute,
            compressed,
            {
              headers:
                new HttpHeaders({
                  'Authorization': `Bearer ${idToken} `
                })
            }).toPromise();
        } catch (e) {
          this.logger.error(e);
          const errorMessage = typeof e.error === 'string' ? e.error : e.message;
          this.snackBar.open(`Could not upload ${file.filename}.${file.extension}, reason: ${errorMessage} `, 'OK', { duration: 10000 });
          reject(e);
          return;
        }
        resolve(true);
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
