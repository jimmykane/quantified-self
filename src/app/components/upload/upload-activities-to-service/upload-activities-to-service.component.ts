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
import { getSize } from '@sports-alliance/sports-lib/lib/events/utilities/helpers';


@Component({
  selector: 'app-upload-activity-to-service',
  templateUrl: './upload-activities-to-service.component.html',
  styleUrls: ['../upload-abstract.css', './upload-activities-to-service.component.css'],
})

export class UploadActivitiesToServiceComponent extends UploadAbstractDirective {

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
    this.afa.logEvent('upload_activity_to_service', { service: ServiceNames.SuuntoApp });
    return new Promise((resolve, reject) => {
      const fileReader = new FileReader;
      fileReader.onload = async () => {
        if (!(fileReader.result instanceof ArrayBuffer) || file.extension !== 'fit') {
          reject('Not a valid file')
          return;
        }
        const idToken = await (await this.afAuth.currentUser).getIdToken(true);
        try {
          if (getSize(fileReader.result) > 10485760) {
            throw new Error(`Cannot upload route because the size is greater than 10MB`);
          }
          const formData = new FormData();
          formData.append('file', file.file, file.name);
          await this.http.post(environment.functions.uploadActivity,
            formData,
            {
              headers:
                new HttpHeaders({
                  'Authorization': `Bearer ${idToken}`
                })
            }).toPromise();
        } catch (e) {
          Sentry.captureException(e);
          this.snackBar.open(`Could not upload ${file.filename}.${file.extension}, reason: ${e.message}`, 'OK', { duration: 10000 });
          reject(e);
          return;
        }
        resolve(true);
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
