import { Component } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import * as Sentry from '@sentry/browser';
import { AngularFireAnalytics } from '@angular/fire/compat/analytics';
import { environment } from '../../../../environments/environment';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { UploadAbstractDirective } from '../upload-abstract.directive';
import { FileInterface } from '../file.interface';
import { AppFilesStatusService } from '../../../services/upload/app-files-status.service';
import { ServiceNames } from '@sports-alliance/sports-lib/lib/meta-data/event-meta-data.interface';
import * as Pako from 'pako';
import { getSize } from '@sports-alliance/sports-lib/lib/events/utilities/helpers';

@Component({
    selector: 'app-upload-route-to-service',
    templateUrl: './upload-routes-to-service.component.html',
    styleUrls: ['../upload-abstract.css', './upload-routes-to-service.component.css'],
    standalone: false
})

export class UploadRoutesToServiceComponent extends UploadAbstractDirective {

  constructor(
    protected snackBar: MatSnackBar,
    protected dialog: MatDialog,
    protected filesStatusService: AppFilesStatusService,
    private http: HttpClient,
    private afAuth: AngularFireAuth,
    private afa: AngularFireAnalytics) {
    super(snackBar, dialog, filesStatusService);
  }

  /**
   * Process each uploaded GPX
   * @returns {Promise}
   * @param file
   */
  async processAndUploadFile(file: FileInterface) {
    this.afa.logEvent('upload_route_to_service', {service: ServiceNames.SuuntoApp});
    return new Promise((resolve, reject) => {
      const fileReader = new FileReader;
      fileReader.onload = async () => {
        if (!(typeof fileReader.result === 'string')) {
          reject(`Not a GPX file`)
          return;
        }
        const idToken = await (await this.afAuth.currentUser).getIdToken(true)
        try {
          const compressed = btoa(Pako.gzip(fileReader.result as string, {to: 'string'}));
          if (getSize(compressed) > 10485760) {
            throw new Error(`Cannot upload route because the size is greater than 10MB`);
          }
          await this.http.post(environment.functions.uploadRoute,
            compressed,
            {
              headers:
                new HttpHeaders({
                  'Authorization': `Bearer ${idToken}`
                })
            }).toPromise();
        } catch (e) {
          Sentry.captureException(e);
          this.snackBar.open(`Could not upload ${file.filename}.${file.extension}, reason: ${e.message}`, 'OK', {duration: 10000});
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
