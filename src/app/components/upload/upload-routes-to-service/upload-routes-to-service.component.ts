import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LoggerService } from '../../../services/logger.service';
import { AppAnalyticsService } from '../../../services/app.analytics.service';
import { environment } from '../../../../environments/environment';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Auth, getIdToken } from '@angular/fire/auth';
import { UploadAbstractDirective } from '../upload-abstract.directive';
import { FileInterface } from '../file.interface';
import { AppFilesStatusService } from '../../../services/upload/app-files-status.service';
import { ServiceNames } from '@sports-alliance/sports-lib';
import * as Pako from 'pako';
import { getSize } from '@sports-alliance/sports-lib';

@Component({
  selector: 'app-upload-route-to-service',
  templateUrl: './upload-routes-to-service.component.html',
  styleUrls: ['../upload-abstract.css', './upload-routes-to-service.component.css'],
  standalone: false
})

export class UploadRoutesToServiceComponent extends UploadAbstractDirective {
  private analyticsService = inject(AppAnalyticsService);
  private auth = inject(Auth);

  constructor(
    protected snackBar: MatSnackBar,
    protected dialog: MatDialog,
    protected filesStatusService: AppFilesStatusService,
    private http: HttpClient,
    protected router: Router,
    protected logger: LoggerService) {
    super(snackBar, dialog, filesStatusService, router, logger);
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
          const compressed = btoa(Pako.gzip(fileReader.result as string, { to: 'string' }));
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
          this.snackBar.open(`Could not upload ${file.filename}.${file.extension}, reason: ${e.message} `, 'OK', { duration: 10000 });
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
